#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*, errors::MachineError, events::OwedWithdrawn, state::views::*, state::*, util::*,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct WithdrawOwed<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Canonical address; absent accounts are no-ops and live accounts are fully checked.
    #[account(mut, seeds = [BINDER_SEED, owner.key().as_ref()], bump)]
    pub binder: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<WithdrawOwed>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let binder = ctx.accounts.binder.to_account_info();
    if *binder.owner == anchor_lang::system_program::ID
        && binder.data_is_empty()
        && !binder.executable
    {
        return Ok(());
    }
    validate_binder_owner(&binder, &ctx.accounts.owner.key())?;
    let owed = header::<Binder>(&binder.try_borrow_data()?)?.sol_owed;
    if owed == 0 {
        return Ok(());
    }
    let pay = owed.min(
        binder
            .lamports()
            .saturating_sub(rent_min(binder.data_len())?),
    );
    let owner = ctx.accounts.owner.to_account_info();
    let owner_after = owner.lamports().saturating_add(pay);
    require!(
        owner_after == 0 || owner_after >= rent_min(owner.data_len())?,
        MachineError::PayeeBelowRent
    );
    let amount = move_lamports(&binder, &owner, pay)?;
    let remaining = owed.saturating_sub(amount);
    header_mut::<Binder>(&mut binder.try_borrow_mut_data()?)?.sol_owed = remaining;
    emit!(OwedWithdrawn {
        owner: ctx.accounts.owner.key(),
        amount,
        remaining,
    });
    Ok(())
}
