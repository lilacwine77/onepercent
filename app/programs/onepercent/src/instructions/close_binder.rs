#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*, errors::MachineError, events::BinderClosed, state::views::*, state::*, util::*,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseBinder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Canonical address; absent accounts are no-ops and live accounts are fully checked.
    #[account(mut, seeds = [BINDER_SEED, owner.key().as_ref()], bump)]
    pub binder: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CloseBinder>) -> Result<()> {
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
    {
        let data = binder.try_borrow_data()?;
        let h = header::<Binder>(&data)?;
        require!(
            h.len == 0 && h.fresh_in_deck == 0 && h.sol_owed == 0,
            MachineError::BinderNotEmpty
        );
        require!(h.reserved == 0, MachineError::PullPending);
        require!(
            h.season_spend == 0 || h.flags & 0b11 == 0b11,
            MachineError::FinalNotClaimed
        );
    }
    let owner = ctx.accounts.owner.to_account_info();
    let owner_after = owner.lamports().saturating_add(binder.lamports());
    require!(
        owner_after == 0 || owner_after >= rent_min(owner.data_len())?,
        MachineError::PayeeBelowRent
    );
    let lamports = close_to(&binder, &owner)?;
    emit!(BinderClosed {
        owner: ctx.accounts.owner.key(),
        lamports,
    });
    Ok(())
}
