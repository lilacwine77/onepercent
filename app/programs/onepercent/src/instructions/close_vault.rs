#![deny(clippy::arithmetic_side_effects)]
use crate::{constants::*, errors::MachineError, events::VaultClosed, state::*, util::*};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,seeds=[LEDGER_SEED,mint.key().as_ref()],bump,constraint=ledger.load()?.mint==mint.key() @ MachineError::LedgerMismatch)]
    pub ledger: AccountLoader<'info, MintLedger>,
    #[account(mut,address=get_associated_token_address_with_program_id(&vault_auth.key(),&mint.key(),&token_program.key()),constraint=vault.mint==mint.key() && vault.owner==vault_auth.key() @ MachineError::VaultMismatch)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Token transfer signer only.
    #[account(seeds=[VAULT_AUTH_SEED],bump)]
    pub vault_auth: UncheckedAccount<'info>,
    /// CHECK: Refund follows the ledger's stored payer.
    #[account(mut,address=ledger.load()?.payer @ MachineError::AccountMismatch)]
    pub payer: UncheckedAccount<'info>,
    #[account(address=*mint.to_account_info().owner)]
    pub token_program: Interface<'info, TokenInterface>,
}
pub fn handler(ctx: Context<CloseVault>) -> Result<()> {
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
    require!(
        ctx.accounts.ledger.load()?.accounted == 0,
        MachineError::VaultNotEmpty
    );
    require!(
        !ctx.accounts
            .machine
            .load()?
            .buckets
            .iter()
            .any(|b| b.class != BUCKET_EMPTY && b.mint == ctx.accounts.mint.key()),
        MachineError::MintListed
    );
    let burned = ctx.accounts.vault.amount;
    let lamports = ctx
        .accounts
        .vault
        .to_account_info()
        .lamports()
        .saturating_add(ctx.accounts.ledger.to_account_info().lamports());
    require!(
        rent_exempt_after_credit(&ctx.accounts.payer.to_account_info(), lamports)?,
        MachineError::PayeeBelowRent
    );
    if burned > 0 {
        vault_burn(
            &ctx.accounts.mint.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.vault_auth.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            ctx.bumps.vault_auth,
            burned,
            ctx.accounts.mint.decimals,
        )?;
    }
    vault_close(
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.vault_auth.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        ctx.bumps.vault_auth,
    )?;
    close_to(
        &ctx.accounts.ledger.to_account_info(),
        &ctx.accounts.payer.to_account_info(),
    )?;
    emit!(VaultClosed {
        mint: ctx.accounts.mint.key(),
        payer: ctx.accounts.payer.key(),
        burned,
        lamports
    });
    Ok(())
}
