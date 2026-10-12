use crate::{constants::*, errors::MachineError, events::ConfigChanged, state::*};
use anchor_lang::prelude::*;
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum GuardianAction {
    SetPause { bits: u8, paused: bool },
    DisableBucket { index: u8 },
    LowerCap { index: u8, cap: u64 },
    DisableRole { role: u8 },
    SelectVrfQueue { index: u8 },
}
#[derive(Accounts)]
pub struct Guardian<'info> {
    pub signer: Signer<'info>,
    #[account(mut,seeds=[CONFIG_SEED],bump=config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut,seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
}
pub fn handler(ctx: Context<Guardian>, action: GuardianAction) -> Result<()> {
    let mut c = ctx.accounts.config.load_mut()?;
    let mut m = ctx.accounts.machine.load_mut()?;
    require!(m.exec.kind == EXEC_KIND_NONE, MachineError::ExecInFlight);
    require!(
        ctx.accounts.signer.key() == c.admin || c.guardians.contains(&ctx.accounts.signer.key()),
        MachineError::Unauthorized
    );
    let mut e = ConfigChanged {
        action: 0,
        actor: ctx.accounts.signer.key(),
        key: Pubkey::default(),
        a: 0,
        b: 0,
    };
    match action {
        GuardianAction::SetPause { bits, paused } => {
            require!(bits & !0x1f == 0, MachineError::InvalidArgument);
            if paused {
                c.guardian_paused |= bits;
            } else {
                c.guardian_paused &= !bits;
            }
            e.action = 8;
            e.a = u64::from(bits);
            e.b = u64::from(paused);
        }
        GuardianAction::DisableBucket { index } => {
            let b = m
                .buckets
                .get_mut(usize::from(index))
                .ok_or(MachineError::BucketInvalid)?;
            require!(b.class != 0, MachineError::BucketInvalid);
            b.enabled = 0;
            e.action = 9;
            e.a = u64::from(index);
        }
        GuardianAction::LowerCap { index, cap } => {
            let b = m
                .buckets
                .get_mut(usize::from(index))
                .ok_or(MachineError::BucketInvalid)?;
            require!(b.class != 0, MachineError::BucketInvalid);
            require!(cap <= b.cap, MachineError::InvalidArgument);
            b.cap = cap;
            e.action = 10;
            e.a = u64::from(index);
            e.b = cap;
        }
        GuardianAction::DisableRole { role } => {
            require!((3..=6).contains(&role), MachineError::InvalidRole);
            c.disabled_roles |= 1u8
                .checked_shl(u32::from(role))
                .ok_or(MachineError::InvalidRole)?;
            e.action = 11;
            e.a = u64::from(role);
        }
        GuardianAction::SelectVrfQueue { index } => {
            let queue = *c
                .vrf_queues
                .get(usize::from(index))
                .ok_or(MachineError::QueueNotAllowed)?;
            require!(queue != Pubkey::default(), MachineError::QueueNotAllowed);
            c.active_queue = index;
            e.action = 12;
            e.a = u64::from(index);
            e.key = queue;
        }
    }
    emit!(e);
    Ok(())
}
