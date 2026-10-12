#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*,
    errors::MachineError,
    events::{CardRedeemed, VaultShortfall},
    state::views::*,
    state::*,
    util::*,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut,seeds=[BINDER_SEED,owner.key().as_ref()],bump=binder.load()?.bump,constraint=binder.load()?.owner==owner.key() @ MachineError::AccountMismatch)]
    pub binder: AccountLoader<'info, Binder>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,seeds=[LEDGER_SEED,mint.key().as_ref()],bump,constraint=ledger.load()?.mint==mint.key() @ MachineError::LedgerMismatch)]
    pub ledger: AccountLoader<'info, MintLedger>,
    #[account(mut,address=get_associated_token_address_with_program_id(&vault_auth.key(),&mint.key(),&token_program.key()),constraint=vault.mint==mint.key() && vault.owner==vault_auth.key() @ MachineError::VaultMismatch)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Token transfer signer only.
    #[account(seeds=[VAULT_AUTH_SEED],bump)]
    pub vault_auth: UncheckedAccount<'info>,
    #[account(mut,address=get_associated_token_address_with_program_id(&owner.key(),&mint.key(),&token_program.key()))]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    #[account(address=*mint.to_account_info().owner)]
    pub token_program: Interface<'info, TokenInterface>,
    #[account(seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
}
pub fn handler(ctx: Context<Redeem>, card_index: u16, amount: u64) -> Result<()> {
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
    let binder = ctx.accounts.binder.to_account_info();
    let card = {
        let data = binder.try_borrow_data()?;
        let h = header::<Binder>(&data)?;
        require!(card_index < h.len, MachineError::CardMoved);
        *tail::<Card>(&data, BINDER_HEADER)?
            .get(usize::from(card_index))
            .ok_or(MachineError::CardMoved)?
    };
    require!(
        card.mint == ctx.accounts.mint.key() && card.amount == amount,
        MachineError::CardMoved
    );
    require!(card.kind <= KIND_FINAL, MachineError::CardNotRedeemable);
    let (_, moved_from) = binder_remove(&mut binder.try_borrow_mut_data()?, card_index)?;
    let refund = shrink_binder(&binder, &ctx.accounts.owner.to_account_info())?;
    vault_transfer(
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.destination.to_account_info(),
        &ctx.accounts.vault_auth.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        ctx.bumps.vault_auth,
        amount,
        ctx.accounts.mint.decimals,
    )?;
    let accounted = {
        let mut ledger = ctx.accounts.ledger.load_mut()?;
        ledger.accounted = ledger.accounted.saturating_sub(amount);
        ledger.accounted
    };
    ctx.accounts.vault.reload()?;
    if ctx.accounts.vault.amount < accounted {
        emit!(VaultShortfall {
            mint: card.mint,
            vault_amount: ctx.accounts.vault.amount,
            accounted
        });
    }
    emit!(CardRedeemed {
        owner: ctx.accounts.owner.key(),
        mint: card.mint,
        amount,
        kind: card.kind,
        card_index,
        moved_from,
        refund
    });
    Ok(())
}
