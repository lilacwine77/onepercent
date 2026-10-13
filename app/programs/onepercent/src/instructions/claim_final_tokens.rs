#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*, errors::MachineError, events::FinalTokensClaimed, math::final_pull::final_share,
    state::views::*, state::*, util::grow_binder,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ClaimFinalTokens<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [MACHINE_SEED], bump = machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(mut, seeds = [BINDER_SEED, owner.key().as_ref()], bump = binder.load()?.bump,
        constraint = binder.load()?.owner == owner.key() @ MachineError::AccountMismatch)]
    pub binder: AccountLoader<'info, Binder>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimFinalTokens>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let machine = ctx.accounts.machine.load()?;
    require!(
        matches!(machine.phase, PHASE_FINAL_PULL | PHASE_DONE),
        MachineError::WrongPhase
    );
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    let binder = ctx.accounts.binder.load()?;
    if binder.flags & FINAL_TOKENS_CLAIMED != 0 {
        return Ok(());
    }
    let spend = binder.season_spend;
    let onepct = final_share(machine.final_1pct_total, spend, machine.total_spend)
        .min(machine.final_pool_1pct);
    let mut buckets = [0u64; 16];
    let mut count = u8::from(onepct > 0);
    for (bucket, share) in machine.buckets.iter().zip(&mut buckets) {
        if bucket.class != BUCKET_EMPTY {
            *share = final_share(bucket.final_pool, spend, machine.total_spend).min(bucket.amount);
            count = count.saturating_add(u8::from(*share > 0));
        }
    }
    drop(binder);
    drop(machine);
    let binder_info = ctx.accounts.binder.to_account_info();
    let initial_lamports = binder_info.lamports();
    if count > 0 {
        grow_binder(
            &binder_info,
            &ctx.accounts.owner.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            u16::from(count),
        )?;
    }
    let slot_rent = binder_info.lamports().saturating_sub(initial_lamports);
    let mut machine = ctx.accounts.machine.load_mut()?;
    let mut data = binder_info.try_borrow_mut_data()?;
    if onepct > 0 {
        append_card(&mut data, machine.token_mint, onepct)?;
        machine.final_pool_1pct = machine.final_pool_1pct.saturating_sub(onepct);
    }
    for (bucket, share) in machine.buckets.iter_mut().zip(buckets) {
        if share > 0 {
            append_card(&mut data, bucket.mint, share)?;
            bucket.amount = bucket.amount.saturating_sub(share);
        }
    }
    header_mut::<Binder>(&mut data)?.flags |= FINAL_TOKENS_CLAIMED;
    emit!(FinalTokensClaimed {
        owner: ctx.accounts.owner.key(),
        onepct,
        buckets,
        cards: count,
        slot_rent
    });
    Ok(())
}

fn append_card(data: &mut [u8], mint: Pubkey, amount: u64) -> Result<()> {
    let mut binder = *header::<Binder>(data)?;
    let card = tail_mut::<Card>(data, BINDER_HEADER)?
        .get_mut(usize::from(binder.len))
        .ok_or(MachineError::BinderFull)?;
    *card = Card {
        mint,
        amount,
        value: 0,
        kind: KIND_FINAL,
        edition: EDITION_NONE,
        flags: 0,
        _pad: 0,
        seq_lo: 0,
    };
    binder.len = binder.len.saturating_add(1);
    binder.reserved = binder.reserved.saturating_sub(1);
    *header_mut::<Binder>(data)? = binder;
    Ok(())
}
