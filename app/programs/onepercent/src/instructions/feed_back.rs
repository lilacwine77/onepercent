use crate::{
    constants::*,
    errors::MachineError,
    events::CardFedBack,
    params,
    state::views::*,
    state::*,
    util::{rent_min, shrink_binder},
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::AccountMeta, program::invoke, system_instruction};

#[derive(Accounts)]
pub struct FeedBack<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(seeds = [MACHINE_SEED], bump = machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(mut, seeds = [DECK_SEED], bump = deck.load()?.bump)]
    pub deck: AccountLoader<'info, Deck>,
    #[account(mut, seeds = [BINDER_SEED, owner.key().as_ref()], bump = binder.load()?.bump,
        constraint = binder.load()?.owner == owner.key() @ MachineError::AccountMismatch)]
    pub binder: AccountLoader<'info, Binder>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FeedBack>, card_indices: Vec<u16>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let config = ctx.accounts.config.load()?;
    let machine = ctx.accounts.machine.load()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        (config.admin_paused | config.guardian_paused) & params::PAUSE_BITS_FEED == 0,
        MachineError::Paused
    );
    require!(
        (PHASE_STOCK_UP..=PHASE_ON_AIR).contains(&machine.phase),
        MachineError::WrongPhase
    );
    require!(
        machine.end_ts == 0 || now < machine.end_ts,
        MachineError::SeasonOver
    );
    require_keys_eq!(
        *ctx.accounts.owner.owner,
        anchor_lang::system_program::ID,
        MachineError::NotWallet
    );
    let owner = ctx.accounts.owner.key();
    require!(!config.is_team(&owner), MachineError::TeamWallet);
    require!(
        (1..=usize::from(MAX_FEED_BACK_CARDS)).contains(&card_indices.len())
            && card_indices
                .iter()
                .zip(card_indices.iter().skip(1))
                .all(|(previous, next)| previous > next),
        MachineError::InvalidArgument
    );
    drop(config);
    drop(machine);
    let binder = ctx.accounts.binder.to_account_info();
    {
        let data = binder.try_borrow_data()?;
        let h = header::<Binder>(&data)?;
        let cards = tail::<Card>(&data, BINDER_HEADER)?;
        for index in &card_indices {
            require!(*index < h.len, MachineError::CardMoved);
            let card = cards
                .get(usize::from(*index))
                .ok_or(MachineError::CardMoved)?;
            require!(card.kind <= KIND_BLACK, MachineError::NotFeedable);
        }
    }
    let deck = ctx.accounts.deck.to_account_info();
    let mut h = *header::<Deck>(&deck.try_borrow_data()?)?;
    let count =
        u32::try_from(card_indices.len()).map_err(|_| error!(MachineError::MathOverflow))?;
    let next_len = h.len.checked_add(count).ok_or(MachineError::MathOverflow)?;
    require!(
        next_len <= params::COVERAGE_DECK_MAX,
        MachineError::DeckFull
    );
    let total_fed = h
        .total_fed
        .checked_add(u64::from(count))
        .ok_or(MachineError::MathOverflow)?;
    let deposit = rent_min(params::ACCOUNT_SIZES_DECK_ENTRY as usize)?
        .checked_sub(rent_min(0)?)
        .ok_or(MachineError::MathOverflow)?;
    let stored_deposit = u32::try_from(deposit).unwrap_or(u32::MAX);
    let total_deposit = deposit
        .checked_mul(u64::from(count))
        .ok_or(MachineError::MathOverflow)?;

    let payer = ctx.accounts.owner.to_account_info();
    let mut removed = Vec::with_capacity(card_indices.len());
    for index in card_indices {
        let (card, moved_from) = binder_remove(&mut binder.try_borrow_mut_data()?, index)?;
        let slot_refund = shrink_binder(&binder, &payer)?;
        removed.push((index, card, moved_from, slot_refund));
    }
    if total_deposit > 0 {
        let mut charge = system_instruction::transfer(payer.key, deck.key, total_deposit);
        // Synchronize both sides of the preceding slot refund before entering the CPI.
        // System transfer consumes its first two accounts; Binder is only synchronized.
        charge.accounts.push(AccountMeta::new(*binder.key, false));
        invoke(
            &charge,
            &[
                payer.clone(),
                deck.clone(),
                binder.clone(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }
    if next_len > h.cap {
        deck.resize(deck_size(next_len))?;
        h.cap = next_len;
    }
    require!(
        deck.lamports() >= rent_min(deck_size(h.cap))?,
        MachineError::DeckUnderfunded
    );
    let start = h.len;
    h.len = next_len;
    h.total_fed = total_fed;
    let mut data = deck.try_borrow_mut_data()?;
    *header_mut::<Deck>(&mut data)? = h;
    let entries = tail_mut::<DeckEntry>(&mut data, DECK_HEADER)?;
    for (offset, (card_index, card, moved_from, slot_refund)) in removed.into_iter().enumerate() {
        let deck_index = start
            .checked_add(u32::try_from(offset).map_err(|_| error!(MachineError::MathOverflow))?)
            .ok_or(MachineError::MathOverflow)?;
        *entries
            .get_mut(usize::try_from(deck_index).map_err(|_| error!(MachineError::MathOverflow))?)
            .ok_or(MachineError::AccountMismatch)? = DeckEntry {
            depositor: owner,
            mint: card.mint,
            amount: card.amount,
            deposit: stored_deposit,
            flags: ENTRY_REFED,
            _pad: [0; 3],
        };
        emit!(CardFedBack {
            owner,
            mint: card.mint,
            amount: card.amount,
            kind: card.kind,
            card_index,
            moved_from,
            deck_index,
            deposit,
            slot_refund,
        });
    }
    Ok(())
}
