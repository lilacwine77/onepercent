#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*,
    errors::MachineError,
    events::CreatorFeesCollected,
    math::{self, creator_fee},
    params,
    state::Machine,
    util::{address_with_bump, rent_min, transfer},
};
use anchor_lang::{
    prelude::*,
    solana_program::{program_option::COption, program_pack::Pack},
    system_program::{self, Transfer},
};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::{self, spl_token::state::Account as SplAccount, Token},
};

#[derive(Accounts)]
pub struct CollectCreatorFees<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds=[MACHINE_SEED], bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    /// CHECK: Stored-bump PDA, System owner and empty data checked in the handler.
    #[account(mut)]
    pub fee_in: UncheckedAccount<'info>,
    /// CHECK: Canonical native SPL account, or absent System account, checked in the handler.
    #[account(mut)]
    pub fee_in_wsol: UncheckedAccount<'info>,
    pub spl_token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CollectCreatorFees>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let now = Clock::get()?.unix_timestamp;
    let mut machine = ctx.accounts.machine.load_mut()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    require!(machine.phase >= PHASE_POWERED_ON, MachineError::WrongPhase);
    let bump = [machine.fee_in_bump];
    let seeds: &[&[u8]] = &[FEE_IN_SEED, &bump];
    address_with_bump(&ctx.accounts.fee_in.to_account_info(), seeds)?;
    require!(
        *ctx.accounts.fee_in.owner == system_program::ID && ctx.accounts.fee_in.data_is_empty(),
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        ctx.accounts.fee_in_wsol.key(),
        get_associated_token_address_with_program_id(
            &ctx.accounts.fee_in.key(),
            &params::WSOL_MINT,
            &token::ID
        ),
        MachineError::AccountMismatch
    );
    let from_wsol = if *ctx.accounts.fee_in_wsol.owner == token::ID
        && ctx.accounts.fee_in_wsol.data_len() == SplAccount::LEN
    {
        let account = SplAccount::unpack(&ctx.accounts.fee_in_wsol.try_borrow_data()?)
            .map_err(|_| error!(MachineError::AccountMismatch))?;
        require!(
            account.mint == params::WSOL_MINT
                && account.owner == ctx.accounts.fee_in.key()
                && matches!(account.is_native, COption::Some(_)),
            MachineError::AccountMismatch
        );
        account.amount
    } else {
        require!(
            *ctx.accounts.fee_in_wsol.owner == system_program::ID
                && ctx.accounts.fee_in_wsol.data_is_empty(),
            MachineError::AccountMismatch
        );
        0
    };
    let mut hour = math::HourState {
        hour_index: machine.hour_index,
        hit_out_last_hour: machine.hit_out_last_hour,
        hit_out_this_hour: machine.hit_out_this_hour,
        sb_paid_hour: machine.sb_paid_hour,
        sol_at_hour_start: machine.sol_at_hour_start,
        stock_sol: machine.stock_sol,
    };
    math::rotate_hour(&mut hour, now);
    machine.rotate_keeper_history(now);
    machine.hour_index = hour.hour_index;
    machine.hit_out_last_hour = hour.hit_out_last_hour;
    machine.hit_out_this_hour = hour.hit_out_this_hour;
    machine.sb_paid_hour = hour.sb_paid_hour;
    machine.sol_at_hour_start = hour.sol_at_hour_start;
    // D27 snapshots the regime before either transfer credits the Machine.
    let regime = creator_fee::regime(&machine);
    let book = creator_fee::book(&machine);
    let target = creator_fee::target(&machine);
    drop(machine);
    if from_wsol > 0 {
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.spl_token_program.to_account_info(),
            token::CloseAccount {
                account: ctx.accounts.fee_in_wsol.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.fee_in.to_account_info(),
            },
            &[seeds],
        ))?;
        transfer(
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.machine.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            from_wsol,
        )?;
    }
    let from_fee_in = ctx.accounts.fee_in.lamports().saturating_sub(rent_min(0)?);
    if from_fee_in > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.fee_in.to_account_info(),
                    to: ctx.accounts.machine.to_account_info(),
                },
                &[seeds],
            ),
            from_fee_in,
        )?;
    }
    let amount = from_fee_in.saturating_add(from_wsol);
    if amount == 0 {
        return Ok(());
    }
    let split = creator_fee::split(amount, regime);
    let mut machine = ctx.accounts.machine.load_mut()?;
    machine.team_sol = machine.team_sol.saturating_add(split.team);
    if regime != REGIME_AFTER_END {
        machine.credit_stock(split.stock);
    }
    emit!(CreatorFeesCollected {
        regime,
        amount,
        from_fee_in,
        from_wsol,
        to_stock: split.stock,
        to_burn: split.burn,
        to_team: split.team,
        book,
        target,
        ts: now
    });
    Ok(())
}
