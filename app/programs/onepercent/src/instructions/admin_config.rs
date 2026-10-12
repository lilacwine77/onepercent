use crate::{constants::*, errors::MachineError, events::ConfigChanged, params, state::*};
use anchor_lang::prelude::*;
// The published Borsh enum keeps its fixed account-free wire representation.
#[allow(clippy::large_enum_variant)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AdminAction {
    SetRole {
        role: u8,
        key: Pubkey,
    },
    SetTeam {
        team_wallet: Pubkey,
        team_wallets: [Pubkey; 8],
    },
    SetSeason {
        snapshot_slot: u64,
        snapshot_ts: i64,
        stock_up_ts: i64,
    },
    SetTokenMint {
        mint: Pubkey,
    },
    AddVrfQueue {
        queue: Pubkey,
    },
    UpdateBucket {
        index: u8,
        enabled: bool,
        cap: u64,
    },
    SetPause {
        bits: u8,
        paused: bool,
    },
}
#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut,seeds=[CONFIG_SEED],bump=config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut,seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
}
pub fn handler(ctx: Context<AdminConfig>, action: AdminAction) -> Result<()> {
    require!(
        ctx.remaining_accounts.len()
            == usize::from(matches!(&action, AdminAction::AddVrfQueue { .. })),
        MachineError::InvalidArgument
    );
    let mut c = ctx.accounts.config.load_mut()?;
    let mut m = ctx.accounts.machine.load_mut()?;
    require!(m.exec.kind == EXEC_KIND_NONE, MachineError::ExecInFlight);
    require_keys_eq!(
        ctx.accounts.admin.key(),
        c.admin,
        MachineError::Unauthorized
    );
    let mut event = ConfigChanged {
        action: 0,
        actor: ctx.accounts.admin.key(),
        key: Pubkey::default(),
        a: 0,
        b: 0,
    };
    match action {
        AdminAction::SetRole { role, key } => {
            require!(key != Pubkey::default(), MachineError::InvalidArgument);
            match role {
                0 => c.admin = key,
                1 => {
                    if let Some(x) = c.guardians.get_mut(0) {
                        *x = key;
                    }
                }
                2 => {
                    if let Some(x) = c.guardians.get_mut(1) {
                        *x = key;
                    }
                }
                3 => c.keeper = key,
                4 => c.executor = key,
                5 => c.intake_signer = key,
                6 => c.quote_signer = key,
                7 => c.launch_wallet = key,
                _ => return err!(MachineError::InvalidRole),
            }
            c.disabled_roles &= !1u8.checked_shl(u32::from(role)).unwrap_or_default();
            event.action = 1;
            event.key = key;
            event.a = u64::from(role);
        }
        AdminAction::SetTeam {
            team_wallet,
            team_wallets,
        } => {
            require!(
                team_wallet != Pubkey::default(),
                MachineError::InvalidArgument
            );
            c.team_wallet = team_wallet;
            c.team_wallets = team_wallets;
            event.action = 2;
            event.key = team_wallet;
        }
        AdminAction::SetSeason {
            snapshot_slot,
            snapshot_ts,
            stock_up_ts,
        } => {
            let clock = Clock::get()?;
            require!(c.season_set == 0, MachineError::SeasonAlreadySet);
            require!(m.phase == 0, MachineError::WrongPhase);
            require!(
                snapshot_slot <= clock.slot
                    && snapshot_ts <= clock.unix_timestamp
                    && stock_up_ts > snapshot_ts,
                MachineError::InvalidArgument
            );
            c.snapshot_slot = snapshot_slot;
            c.snapshot_ts = snapshot_ts;
            c.stock_up_ts = stock_up_ts;
            c.season_set = 1;
            event.action = 3;
            event.a = snapshot_slot;
            event.b = u64::try_from(stock_up_ts).unwrap_or_default();
        }
        AdminAction::SetTokenMint { mint } => {
            require!(m.phase == 0, MachineError::WrongPhase);
            require!(mint != Pubkey::default(), MachineError::InvalidArgument);
            c.token_mint = mint;
            event.action = 4;
            event.key = mint;
        }
        AdminAction::AddVrfQueue { queue } => {
            require!(
                ctx.remaining_accounts.len() == 1,
                MachineError::QueueNotAllowed
            );
            let a = ctx
                .remaining_accounts
                .first()
                .ok_or(MachineError::QueueNotAllowed)?;
            require!(
                a.key() == queue
                    && *a.owner == params::PROGRAM_IDS_MAGICBLOCK_VRF
                    && queue != Pubkey::default(),
                MachineError::QueueNotAllowed
            );
            require!(
                !c.vrf_queues.contains(&queue),
                MachineError::InvalidArgument
            );
            let slot = c
                .vrf_queues
                .iter_mut()
                .find(|x| **x == Pubkey::default())
                .ok_or(MachineError::InvalidArgument)?;
            *slot = queue;
            event.action = 5;
            event.key = queue;
        }
        AdminAction::UpdateBucket {
            index,
            enabled,
            cap,
        } => {
            let count = m
                .buckets
                .iter()
                .filter(|b| b.class == 2 && b.enabled != 0)
                .count();
            let b = m
                .buckets
                .get_mut(usize::from(index))
                .ok_or(MachineError::BucketInvalid)?;
            require!(b.class != 0, MachineError::BucketInvalid);
            require!(
                !(enabled
                    && b.class == 2
                    && b.enabled == 0
                    && count >= params::STOCK_TRENDING_MAX_COUNT as usize),
                MachineError::TrendingLimit
            );
            b.enabled = u8::from(enabled);
            b.cap = cap;
            event.action = 6;
            event.a = u64::from(index);
            event.b = cap;
        }
        AdminAction::SetPause { bits, paused } => {
            require!(bits & !0x1f == 0, MachineError::InvalidArgument);
            if paused {
                c.admin_paused |= bits;
            } else {
                c.admin_paused &= !bits;
                c.guardian_paused &= !bits;
            }
            event.action = 7;
            event.a = u64::from(bits);
            event.b = u64::from(paused);
        }
    }
    emit!(event);
    Ok(())
}
