#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*, errors::MachineError, events::FinalSolClaimed, math::final_pull::final_share,
    state::*, util::*,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ClaimFinalSol<'info> {
    #[account(mut, seeds = [MACHINE_SEED], bump = machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(mut, seeds = [BINDER_SEED, owner.key().as_ref()], bump = binder.load()?.bump,
        constraint = binder.load()?.owner == owner.key() @ MachineError::AccountMismatch)]
    pub binder: AccountLoader<'info, Binder>,
    /// CHECK: Canonical Binder owner; non-creditable payees receive their SOL in the Binder.
    pub owner: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ClaimFinalSol>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let mut machine = ctx.accounts.machine.load_mut()?;
    require!(
        matches!(machine.phase, PHASE_FINAL_PULL | PHASE_DONE),
        MachineError::WrongPhase
    );
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    let mut binder = ctx.accounts.binder.load_mut()?;
    if binder.flags & FINAL_SOL_CLAIMED != 0 {
        return Ok(());
    }
    let share = final_share(
        machine.final_sol_total,
        binder.season_spend,
        machine.total_spend,
    );
    let pay = share.min(machine.final_pool_sol);
    let mut to_owed = false;
    if pay > 0 {
        let source = ctx.accounts.machine.to_account_info();
        // Donations are harmless. Preserve rent and every other tracked liability.
        let tracked = machine
            .stock_sol
            .saturating_add(machine.jackpot_sol)
            .saturating_add(machine.burn_sol)
            .saturating_add(machine.team_sol)
            .saturating_add(machine.final_pool_sol);
        require!(
            source.lamports() >= rent_min(MACHINE_SIZE)?.saturating_add(tracked),
            MachineError::VaultInvariant
        );
        let owner = ctx.accounts.owner.to_account_info();
        payee_check(&owner)?;
        to_owed = !creditable(&owner, pay)?;
        let target = if to_owed {
            ctx.accounts.binder.to_account_info()
        } else {
            owner
        };
        let paid = move_lamports(&source, &target, pay)?;
        require!(paid == pay, MachineError::VaultInvariant);
        if to_owed {
            binder.sol_owed = binder.sol_owed.saturating_add(paid);
        }
        machine.final_pool_sol = machine.final_pool_sol.saturating_sub(paid);
    }
    binder.flags |= FINAL_SOL_CLAIMED;
    emit!(FinalSolClaimed {
        owner: ctx.accounts.owner.key(),
        share,
        paid: pay,
        to_owed,
        remaining: machine.final_pool_sol,
    });
    Ok(())
}
