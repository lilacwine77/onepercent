use crate::{
    checks::*, constants::*, errors::MachineError, events::BagFed, params, state::views::*,
    state::*, util::*,
};
use anchor_lang::{prelude::*, Discriminator};
#[derive(Accounts)]
pub struct Feed<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(seeds=[CONFIG_SEED],bump=config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(mut,seeds=[DECK_SEED],bump=deck.load()?.bump)]
    pub deck: AccountLoader<'info, Deck>,
    /// CHECK: Donation-safe creation and full owner/header validation in the handler.
    #[account(mut,seeds=[BINDER_SEED,depositor.key().as_ref()],bump)]
    pub binder: UncheckedAccount<'info>,
    /// CHECK: Canonical instructions sysvar.
    #[account(address=anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, Feed<'info>>,
    amounts: Vec<u64>,
    expiry: i64,
    nonce: u32,
    att_ix: u8,
) -> Result<()> {
    let c = ctx.accounts.config.load()?;
    let m = ctx.accounts.machine.load()?;
    require!(m.exec.kind == EXEC_KIND_NONE, MachineError::ExecInFlight);
    top_level()?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        (c.admin_paused | c.guardian_paused) & params::PAUSE_BITS_FEED == 0,
        MachineError::Paused
    );
    require!(
        (PHASE_STOCK_UP..=PHASE_ON_AIR).contains(&m.phase),
        MachineError::WrongPhase
    );
    require!(m.end_ts == 0 || now < m.end_ts, MachineError::SeasonOver);
    let count = amounts.len();
    require!(
        (1..=MAX_FEED_BAGS).contains(&count)
            && ctx.remaining_accounts.len()
                == count.checked_mul(4).ok_or(MachineError::MathOverflow)?
            && amounts.iter().all(|x| *x > 0),
        MachineError::InvalidArgument
    );
    require_keys_eq!(
        *ctx.accounts.depositor.owner,
        anchor_lang::system_program::ID,
        MachineError::NotWallet
    );
    require!(
        !c.is_team(&ctx.accounts.depositor.key()),
        MachineError::TeamWallet
    );
    require!(c.disabled_roles & (1 << 5) == 0, MachineError::RoleDisabled);
    single_feed(
        &ctx.accounts.instructions.to_account_info(),
        crate::instruction::Feed::DISCRIMINATOR,
    )?;
    let bags: Vec<(Pubkey, u64)> = ctx
        .remaining_accounts
        .chunks_exact(4)
        .zip(amounts.iter())
        .map(|(a, n)| (a.first().map(|x| *x.key).unwrap_or_default(), *n))
        .collect();
    for (index, (mint, _)) in bags.iter().enumerate() {
        require!(
            !bags.iter().take(index).any(|(earlier, _)| earlier == mint),
            MachineError::DuplicateMint
        );
    }
    let owner = ctx.accounts.depositor.key();
    let binder = ctx.accounts.binder.to_account_info();
    let payer = ctx.accounts.depositor.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();
    ensure_binder(&binder, &owner, &payer, &system)?;
    verify_ed25519(
        &ctx.accounts.instructions.to_account_info(),
        att_ix,
        &c.intake_signer,
        &feed_message(&owner, nonce, expiry, &bags)?,
    )?;
    validate_expiry(now, expiry, params::ATTESTATIONS_FEED_TTL_SECONDS)?;
    accept_nonce(
        header_mut::<Binder>(&mut binder.try_borrow_mut_data()?)?,
        nonce,
    )?;
    let auth = Pubkey::create_program_address(&[VAULT_AUTH_SEED, &[m.vault_auth_bump]], &crate::ID)
        .map_err(|_| error!(MachineError::VaultMismatch))?;
    for (index, (accounts, amount)) in ctx
        .remaining_accounts
        .chunks_exact(4)
        .zip(amounts.iter())
        .enumerate()
    {
        let result = (|| -> Result<()> {
            let mint = accounts.first().ok_or(MachineError::InvalidArgument)?;
            let vault = accounts.get(1).ok_or(MachineError::InvalidArgument)?;
            let ledger = accounts.get(2).ok_or(MachineError::InvalidArgument)?;
            let curve = accounts.get(3).ok_or(MachineError::InvalidArgument)?;
            let (decimals, _) = mint_is_safe(mint)?;
            require!(
                *mint.key != c.token_mint
                    && *mint.key != params::WSOL_MINT
                    && *mint.key != NATIVE_MINT_2022,
                MachineError::MintForbidden
            );
            pump_origin(mint.key, curve)?;
            let token = validate_vault(mint, vault, &auth)?;
            require!(ledger.is_writable, MachineError::LedgerMismatch);
            ensure_ledger(ledger, mint.key, &payer, &system)?;
            prior_transfer(
                &ctx.accounts.instructions.to_account_info(),
                mint,
                vault.key,
                &owner,
                *amount,
                decimals,
            )?;
            let mut data = ledger.try_borrow_mut_data()?;
            let h = header_mut::<MintLedger>(&mut data)?;
            require!(
                token.amount >= h.accounted && token.amount.saturating_sub(h.accounted) >= *amount,
                MachineError::TokensNotReceived
            );
            h.accounted = h
                .accounted
                .checked_add(*amount)
                .ok_or(MachineError::MathOverflow)?;
            Ok(())
        })();
        if result.is_err() {
            msg!("feed: bag {}", index);
        }
        result?;
    }
    let increment = u16::try_from(count).map_err(|_| error!(MachineError::MathOverflow))?;
    let fresh = {
        let mut data = binder.try_borrow_mut_data()?;
        let h = header_mut::<Binder>(&mut data)?;
        let next = h
            .fresh_in_deck
            .checked_add(increment)
            .ok_or(MachineError::MathOverflow)?;
        require!(
            u32::from(next) <= params::FEED_RULES_FRESH_CAP_PER_WALLET,
            MachineError::FreshCapReached
        );
        h.fresh_in_deck = next;
        next
    };
    let deck = ctx.accounts.deck.to_account_info();
    let mut h = *header::<Deck>(&deck.try_borrow_data()?)?;
    let next = h
        .len
        .checked_add(u32::from(increment))
        .ok_or(MachineError::MathOverflow)?;
    require!(next <= params::COVERAGE_DECK_MAX, MachineError::DeckFull);
    let deposit = rent_min(params::ACCOUNT_SIZES_DECK_ENTRY as usize)?.saturating_sub(rent_min(0)?);
    transfer(
        &payer,
        &deck,
        &system,
        deposit
            .checked_mul(u64::from(increment))
            .ok_or(MachineError::MathOverflow)?,
    )?;
    if next > h.cap {
        deck.resize(deck_size(next))?;
        h.cap = next;
    }
    require!(
        deck.lamports() >= rent_min(deck_size(h.cap))?,
        MachineError::DeckUnderfunded
    );
    let start = h.len;
    h.len = next;
    h.total_fed = h
        .total_fed
        .checked_add(u64::from(increment))
        .ok_or(MachineError::MathOverflow)?;
    let mut data = deck.try_borrow_mut_data()?;
    *header_mut::<Deck>(&mut data)? = h;
    let entries = tail_mut::<DeckEntry>(&mut data, DECK_HEADER)?;
    for (index, (mint, amount)) in bags.iter().enumerate() {
        let position = start
            .checked_add(u32::try_from(index).map_err(|_| error!(MachineError::MathOverflow))?)
            .ok_or(MachineError::MathOverflow)?;
        *entries
            .get_mut(position as usize)
            .ok_or(MachineError::AccountMismatch)? = DeckEntry {
            depositor: owner,
            mint: *mint,
            amount: *amount,
            deposit: u32::try_from(deposit).unwrap_or(u32::MAX),
            flags: ENTRY_FRESH,
            _pad: [0; 3],
        };
        emit!(BagFed {
            depositor: owner,
            mint: *mint,
            amount: *amount,
            deck_index: position,
            deposit,
            fresh_in_deck: fresh
        });
    }
    Ok(())
}
