#![deny(clippy::arithmetic_side_effects)]
use crate::{constants::*, errors::MachineError, events::TeamWithdrawn, state::*, util::*};
use anchor_lang::prelude::*;
#[derive(Accounts)]
pub struct TeamWithdraw<'info> {
    #[account(mut,seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(seeds=[CONFIG_SEED],bump=config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    /// CHECK: Destination is the configured team wallet, with credit safety checked below.
    #[account(mut,address=config.load()?.team_wallet @ MachineError::AccountMismatch)]
    pub team_wallet: UncheckedAccount<'info>,
}
pub fn handler(ctx: Context<TeamWithdraw>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let mut m = ctx.accounts.machine.load_mut()?;
    require!(m.exec.kind == EXEC_KIND_NONE, MachineError::ExecInFlight);
    let other = m
        .stock_sol
        .saturating_add(m.jackpot_sol)
        .saturating_add(m.burn_sol)
        .saturating_add(m.final_pool_sol);
    let amount = m.team_sol.min(
        ctx.accounts
            .machine
            .to_account_info()
            .lamports()
            .saturating_sub(rent_min(MACHINE_SIZE)?)
            .saturating_sub(other),
    );
    if amount == 0 {
        return Ok(());
    }
    require!(
        creditable(&ctx.accounts.team_wallet.to_account_info(), amount)?,
        MachineError::AccountMismatch
    );
    let moved = move_lamports(
        &ctx.accounts.machine.to_account_info(),
        &ctx.accounts.team_wallet.to_account_info(),
        amount,
    )?;
    m.team_sol = m.team_sol.saturating_sub(moved);
    emit!(TeamWithdrawn {
        to: ctx.accounts.team_wallet.key(),
        amount: moved
    });
    Ok(())
}
