#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*, errors::MachineError, events::PullRefunded, math, params, state::views::*,
    state::*, util::*,
};
use anchor_lang::prelude::*;
#[derive(Accounts)]
pub struct RefundPull<'info> {
    /// CHECK: Closed Pulls are a no-op; live accounts are fully validated.
    #[account(mut)]
    pub pull: UncheckedAccount<'info>,
    #[account(mut,seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    /// CHECK: PDA, owner and header checked against the live Pull buyer.
    #[account(mut)]
    pub binder: UncheckedAccount<'info>,
    /// CHECK: Matched to the buyer with safe fallback for non-creditable addresses.
    pub buyer: UncheckedAccount<'info>,
}
pub fn handler(ctx: Context<RefundPull>, seq: u64) -> Result<()> {
    let machine = ctx.accounts.machine.load()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    drop(machine);
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let pull = ctx.accounts.pull.to_account_info();
    let Some(p) = live_pull(&pull)? else {
        return Ok(());
    };
    require!(p.seq == seq, MachineError::PullMismatch);
    checked_pull_address(&pull, &p)?;
    if p.status != PULL_PENDING {
        return Ok(());
    }
    require!(
        Clock::get()?.unix_timestamp >= p.created_ts.saturating_add(params::VRF_TIMEOUT_SECONDS),
        MachineError::TooEarlyToRefund
    );
    require_keys_eq!(
        ctx.accounts.buyer.key(),
        p.buyer,
        MachineError::AccountMismatch
    );
    let buyer = ctx.accounts.buyer.to_account_info();
    let binder = ctx.accounts.binder.to_account_info();
    validate_binder_owner(&binder, &p.buyer)?;
    payee_check_signer(&buyer)?;
    {
        let data = pull.try_borrow_data()?;
        let packs = tail::<PackRecord>(&data, PULL_HEADER)?;
        let mut m = ctx.accounts.machine.load_mut()?;
        let coverage = math::coverage_need(p.price).unwrap_or(u64::MAX);
        for record in packs.iter().take(usize::from(p.qty)) {
            if let Some(b) = m.buckets.get_mut(usize::from(record.backing)) {
                b.reserved = b.reserved.saturating_sub(coverage);
            }
        }
        m.reserved_dust = m.reserved_dust.saturating_sub(
            u64::from(params::CARDS_PER_PACK_DUST).saturating_mul(u64::from(p.qty)),
        );
        m.pending_pulls = m.pending_pulls.saturating_sub(1);
    }
    let slots = params::CARDS_PER_PACK_DUST
        .saturating_add(params::CARDS_PER_PACK_HIT)
        .saturating_mul(u32::from(p.qty));
    {
        let mut data = binder.try_borrow_mut_data()?;
        let h = header_mut::<Binder>(&mut data)?;
        h.reserved = h
            .reserved
            .saturating_sub(u16::try_from(slots).unwrap_or(u16::MAX));
    }
    shrink_binder(&binder, &buyer)?;
    let amount = if creditable(&buyer, pull.lamports())? {
        close_to(&pull, &buyer)?
    } else {
        let amount = close_to(&pull, &ctx.accounts.machine.to_account_info())?;
        ctx.accounts.machine.load_mut()?.credit_stock(amount);
        amount
    };
    emit!(PullRefunded {
        pull: *pull.key,
        seq,
        buyer: p.buyer,
        amount
    });
    Ok(())
}
