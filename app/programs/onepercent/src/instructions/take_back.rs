#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*,
    errors::MachineError,
    events::{BagTakenBack, VaultShortfall},
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
pub struct TakeBack<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut,seeds=[DECK_SEED],bump=deck.load()?.bump)]
    pub deck: AccountLoader<'info, Deck>,
    /// CHECK: The Binder may be absent for a non-fresh entry; address is always checked.
    #[account(mut,seeds=[BINDER_SEED,depositor.key().as_ref()],bump)]
    pub binder: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,seeds=[LEDGER_SEED,mint.key().as_ref()],bump,constraint=ledger.load()?.mint==mint.key() @ MachineError::LedgerMismatch)]
    pub ledger: AccountLoader<'info, MintLedger>,
    #[account(mut,address=get_associated_token_address_with_program_id(&vault_auth.key(),&mint.key(),&token_program.key()),constraint=vault.mint==mint.key() && vault.owner==vault_auth.key() @ MachineError::VaultMismatch)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Token transfer signer only.
    #[account(seeds=[VAULT_AUTH_SEED],bump)]
    pub vault_auth: UncheckedAccount<'info>,
    #[account(mut,address=get_associated_token_address_with_program_id(&depositor.key(),&mint.key(),&token_program.key()))]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    #[account(address=*mint.to_account_info().owner)]
    pub token_program: Interface<'info, TokenInterface>,
    #[account(seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
}
pub fn handler(ctx: Context<TakeBack>, deck_index: u32, amount: u64) -> Result<()> {
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
    let deck = ctx.accounts.deck.to_account_info();
    let entry = {
        let data = deck.try_borrow_data()?;
        let h = header::<Deck>(&data)?;
        require!(deck_index < h.len, MachineError::CardMoved);
        *tail::<DeckEntry>(&data, DECK_HEADER)?
            .get(deck_index as usize)
            .ok_or(MachineError::CardMoved)?
    };
    require!(
        entry.depositor == ctx.accounts.depositor.key()
            && entry.mint == ctx.accounts.mint.key()
            && entry.amount == amount,
        MachineError::CardMoved
    );
    let projected_refund = {
        let data = deck.try_borrow_data()?;
        let h = header::<Deck>(&data)?;
        let len = h.len.saturating_sub(1);
        let cap = if len < h.cap && deck.lamports() >= rent_min(deck_size(len))? {
            len
        } else {
            h.cap
        };
        u64::from(entry.deposit).min(deck.lamports().saturating_sub(rent_min(deck_size(cap))?))
    };
    if projected_refund > 0 {
        require!(
            rent_exempt_after_credit(&ctx.accounts.depositor.to_account_info(), projected_refund)?,
            MachineError::PayeeBelowRent
        );
    }
    let (_, moved_from) = deck_remove(&mut deck.try_borrow_mut_data()?, deck_index)?;
    let refund = release_deck(&deck, &[entry.deposit])?
        .first()
        .copied()
        .unwrap_or_default();
    move_lamports(&deck, &ctx.accounts.depositor.to_account_info(), refund)?;
    if entry.flags & ENTRY_FRESH != 0 {
        let binder = ctx.accounts.binder.to_account_info();
        validate::<Binder>(&binder)?;
        let mut data = binder.try_borrow_mut_data()?;
        let h = header_mut::<Binder>(&mut data)?;
        require_keys_eq!(
            h.owner,
            ctx.accounts.depositor.key(),
            MachineError::AccountMismatch
        );
        h.fresh_in_deck = h.fresh_in_deck.saturating_sub(1);
    }
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
            mint: ctx.accounts.mint.key(),
            vault_amount: ctx.accounts.vault.amount,
            accounted
        });
    }
    let mut data = deck.try_borrow_mut_data()?;
    let h = header_mut::<Deck>(&mut data)?;
    h.total_taken_back = h.total_taken_back.saturating_add(1);
    emit!(BagTakenBack {
        depositor: entry.depositor,
        mint: entry.mint,
        amount,
        deck_index,
        moved_from,
        refund
    });
    Ok(())
}
