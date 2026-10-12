use crate::{constants::*, errors::MachineError, state::*};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::Token,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[derive(Accounts)]
pub struct ExecEnd<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, seeds = [MACHINE_SEED], bump = machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [LEDGER_SEED, mint.key().as_ref()], bump,
        constraint = ledger.load()?.mint == mint.key() @ MachineError::LedgerMismatch)]
    pub ledger: AccountLoader<'info, MintLedger>,
    #[account(mut,
        address = get_associated_token_address_with_program_id(&vault_auth.key(), &mint.key(), &token_program.key()) @ MachineError::VaultMismatch,
        constraint = vault.mint == mint.key() && vault.owner == vault_auth.key() @ MachineError::VaultMismatch)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Canonical token authority; the handler signs token operations with its seeds.
    #[account(seeds = [VAULT_AUTH_SEED], bump = machine.load()?.vault_auth_bump)]
    pub vault_auth: UncheckedAccount<'info>,
    /// CHECK: StockSell requires writable; M2 P1 validates the canonical wSOL destination or System sentinel.
    pub sol_dest: UncheckedAccount<'info>,
    #[account(address = *mint.to_account_info().owner @ MachineError::AccountMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub spl_token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExecEnd>, kind: u8) -> Result<()> {
    crate::checks::top_level()?;
    let clock = Clock::get()?;
    let record = ctx.accounts.machine.load()?.exec;
    require!(
        kind != EXEC_KIND_NONE && record.kind == kind && record.slot == clock.slot,
        MachineError::ExecPairing
    );
    let config = ctx.accounts.config.load()?;
    super::exec_begin::check_role(&config, kind, &ctx.accounts.signer.key())?;
    {
        let machine = ctx.accounts.machine.load()?;
        super::exec_begin::check_mint(
            &config,
            &machine,
            kind,
            record.bucket,
            &ctx.accounts.mint.key(),
        )?;
    }
    crate::util::validate_vault(
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.vault_auth.key(),
    )?;
    let sol_dest = crate::util::validate_sol_dest(
        &ctx.accounts.sol_dest.to_account_info(),
        &ctx.accounts.vault_auth.key(),
        kind == EXEC_KIND_STOCK_SELL,
    )?;
    let (amount_now, target) = if kind == EXEC_KIND_STOCK_SELL {
        (
            sol_dest.ok_or(MachineError::AccountMismatch)?.amount,
            ctx.accounts.sol_dest.key(),
        )
    } else {
        ctx.accounts.vault.reload()?;
        (ctx.accounts.vault.amount, ctx.accounts.vault.key())
    };
    require_keys_eq!(target, record.target, MachineError::AccountMismatch);
    let delta = amount_now.saturating_sub(record.v0);
    require!(delta >= record.min_out, MachineError::SlippageExceeded);
    if kind != EXEC_KIND_STOCK_SELL {
        let ledger = ctx.accounts.ledger.load()?;
        require!(
            amount_now.saturating_sub(ledger.accounted) >= delta,
            MachineError::SlackShort
        );
    }
    let tracked_after = match kind {
        EXEC_KIND_STOCK_BUY => {
            let mut machine = ctx.accounts.machine.load_mut()?;
            let b = machine
                .buckets
                .get_mut(usize::from(record.bucket))
                .ok_or(MachineError::BucketInvalid)?;
            let amount = b
                .amount
                .checked_add(delta)
                .ok_or(MachineError::MathOverflow)?;
            let cost = b
                .cost
                .checked_add(record.amount)
                .ok_or(MachineError::MathOverflow)?;
            crate::math::exec::preserve_granularity(b, amount, cost)?;
            b.amount = amount;
            b.cost = cost;
            let mut ledger = ctx.accounts.ledger.load_mut()?;
            ledger.accounted = ledger
                .accounted
                .checked_add(delta)
                .ok_or(MachineError::MathOverflow)?;
            machine.stock_sol
        }
        EXEC_KIND_JACKPOT_BUY => {
            let mut machine = ctx.accounts.machine.load_mut()?;
            machine.jackpot_tokens = machine
                .jackpot_tokens
                .checked_add(delta)
                .ok_or(MachineError::MathOverflow)?;
            machine.jackpot_cost = machine
                .jackpot_cost
                .checked_add(record.amount)
                .ok_or(MachineError::MathOverflow)?;
            let mut ledger = ctx.accounts.ledger.load_mut()?;
            ledger.accounted = ledger
                .accounted
                .checked_add(delta)
                .ok_or(MachineError::MathOverflow)?;
            machine.jackpot_sol
        }
        EXEC_KIND_BURN => {
            let bump = ctx.accounts.machine.load()?.vault_auth_bump;
            crate::util::vault_burn(
                &ctx.accounts.mint.to_account_info(),
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.vault_auth.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                bump,
                delta,
                ctx.accounts.mint.decimals,
            )?;
            let mut machine = ctx.accounts.machine.load_mut()?;
            machine.burned_total = machine
                .burned_total
                .checked_add(delta)
                .ok_or(MachineError::MathOverflow)?;
            machine.burn_sol
        }
        EXEC_KIND_STOCK_SELL => {
            let bump = ctx.accounts.machine.load()?.vault_auth_bump;
            crate::util::vault_close(
                &ctx.accounts.sol_dest.to_account_info(),
                &ctx.accounts.signer.to_account_info(),
                &ctx.accounts.vault_auth.to_account_info(),
                &ctx.accounts.spl_token_program.to_account_info(),
                bump,
            )?;
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.signer.to_account_info(),
                        to: ctx.accounts.machine.to_account_info(),
                    },
                ),
                delta,
            )?;
            let mut machine = ctx.accounts.machine.load_mut()?;
            machine.stock_sol = machine
                .stock_sol
                .checked_add(delta)
                .ok_or(MachineError::MathOverflow)?;
            machine.stock_sol
        }
        _ => return err!(MachineError::ExecPairing),
    };
    if kind != EXEC_KIND_STOCK_SELL {
        ctx.accounts.vault.reload()?;
        require!(
            ctx.accounts.vault.amount >= ctx.accounts.ledger.load()?.accounted,
            MachineError::VaultInvariant
        );
    }
    ctx.accounts.machine.load_mut()?.exec = ExecRecord {
        kind: 0,
        bucket: 0,
        _pad: [0; 6],
        amount: 0,
        v0: 0,
        min_out: 0,
        slot: 0,
        target: Pubkey::default(),
        aux: 0,
    };
    emit!(crate::events::ExecEnded {
        kind,
        bucket: record.bucket,
        mint: ctx.accounts.mint.key(),
        amount: record.amount,
        min_out: record.min_out,
        delta,
        book: record.aux,
        tracked_after,
        ts: clock.unix_timestamp,
    });
    Ok(())
}
