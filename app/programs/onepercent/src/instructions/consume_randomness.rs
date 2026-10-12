#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*, errors::MachineError, events::*, math, params, state::views::*, state::*,
};
use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::anchor::vrf_callback;
#[vrf_callback]
#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    /// CHECK: The callback validates ownership, identity, shape and writability itself.
    pub pull: UncheckedAccount<'info>,
    /// CHECK: Validated before any mutation; malformed callbacks are acknowledged.
    pub machine: UncheckedAccount<'info>,
    /// CHECK: Validated before any mutation; no account-dependent allocation.
    pub deck: UncheckedAccount<'info>,
    /// CHECK: Validated against the Pull's buyer and stored bump.
    pub binder: UncheckedAccount<'info>,
}
fn valid_address(account: &AccountInfo<'_>, seeds: &[&[u8]]) -> bool {
    Pubkey::create_program_address(seeds, &crate::ID).is_ok_and(|key| key == *account.key)
}
fn validate_callback(
    accounts: &ConsumeRandomness<'_>,
    seq: u64,
    now: i64,
) -> core::result::Result<Pull, u8> {
    let pull = accounts.pull.to_account_info();
    let machine = accounts.machine.to_account_info();
    let deck = accounts.deck.to_account_info();
    let binder = accounts.binder.to_account_info();
    if ![&pull, &machine, &deck, &binder]
        .iter()
        .all(|a| a.is_writable)
    {
        return Err(9);
    }
    if *pull.owner != crate::ID {
        return Err(1);
    }
    let p = {
        let data = pull.try_borrow_data().map_err(|_| 1u8)?;
        *header::<Pull>(&data).map_err(|_| 1u8)?
    };
    if !valid_address(
        &pull,
        &[
            PULL_SEED,
            p.buyer.as_ref(),
            &p.buyer_nonce.to_le_bytes(),
            &[p.bump],
        ],
    ) {
        return Err(2);
    }
    if p.seq != seq {
        return Err(3);
    }
    if p.status != PULL_PENDING {
        return Err(4);
    }
    if !(1..=10).contains(&p.qty)
        || params::PACK_EDITIONS_PRICE_LAMPORTS.get(usize::from(p.edition)) != Some(&p.price)
        || pull.data_len() != pull_size(p.qty)
    {
        return Err(1);
    }
    if now > p.created_ts.saturating_add(params::VRF_TIMEOUT_SECONDS) {
        return Err(5);
    }
    {
        let data = machine.try_borrow_data().map_err(|_| 6u8)?;
        if *machine.owner != crate::ID || data.len() != MACHINE_SIZE {
            return Err(6);
        }
        let h = header::<Machine>(&data).map_err(|_| 6u8)?;
        if !valid_address(&machine, &[MACHINE_SEED, &[h.bump]]) {
            return Err(6);
        }
    }
    {
        let data = deck.try_borrow_data().map_err(|_| 7u8)?;
        if *deck.owner != crate::ID {
            return Err(7);
        }
        let h = header::<Deck>(&data).map_err(|_| 7u8)?;
        if h.len > h.cap
            || data.len() != deck_size(h.cap)
            || !valid_address(&deck, &[DECK_SEED, &[h.bump]])
        {
            return Err(7);
        }
        tail::<DeckEntry>(&data, DECK_HEADER).map_err(|_| 7u8)?;
    }
    {
        let data = binder.try_borrow_data().map_err(|_| 8u8)?;
        if *binder.owner != crate::ID {
            return Err(8);
        }
        let h = header::<Binder>(&data).map_err(|_| 8u8)?;
        if h.owner != p.buyer
            || data.len() != binder_size(h.cap)
            || !valid_address(&binder, &[BINDER_SEED, p.buyer.as_ref(), &[h.bump]])
        {
            return Err(8);
        }
        tail::<Card>(&data, BINDER_HEADER).map_err(|_| 8u8)?;
    }
    Ok(p)
}
fn write_card(binder: &mut Binder, cards: &mut [Card], card: Option<Card>, seq: u64, pack: u8) {
    if let Some(card) = card {
        if binder.len < binder.cap {
            if let Some(slot) = cards.get_mut(usize::from(binder.len)) {
                *slot = card;
                binder.len = binder.len.saturating_add(1);
            } else {
                emit!(CardDropped {
                    seq,
                    pack,
                    tier: card.kind,
                    value: card.value
                });
            }
        } else {
            emit!(CardDropped {
                seq,
                pack,
                tier: card.kind,
                value: card.value
            });
        }
    }
    binder.reserved = binder.reserved.saturating_sub(1);
}
fn remove_entry(
    deck: &mut Deck,
    entries: &mut [DeckEntry],
    index: u32,
) -> Option<(DeckEntry, u32)> {
    if index >= deck.len {
        return None;
    }
    let last = deck.len.saturating_sub(1);
    let entry = *entries.get(index as usize)?;
    let moved = *entries.get(last as usize)?;
    *entries.get_mut(index as usize)? = moved;
    *entries.get_mut(last as usize)? = anchor_lang::__private::bytemuck::Zeroable::zeroed();
    deck.len = last;
    Some((entry, if last == index { u32::MAX } else { last }))
}
// This total helper never turns a revealed Pull into CallbackSkipped.
fn shrink_revealed_deck(
    deck: &AccountInfo<'_>,
    len: u32,
    old_cap: u32,
    lamports: u64,
    rent: &Rent,
) -> u32 {
    if len >= old_cap || lamports < rent.minimum_balance(deck_size(len)) {
        return old_cap;
    }
    if deck.resize(deck_size(len)).is_err() {
        return old_cap;
    }
    // The prevalidated header survives a shrink to at least DECK_HEADER bytes.
    // No external call or retained Deck borrow occurs between resize and here.
    if let Ok(mut data) = deck.try_borrow_mut_data() {
        if let Ok(h) = header_mut::<Deck>(&mut data) {
            h.cap = len;
        }
    }
    len
}
#[inline(never)]
fn reveal(accounts: &ConsumeRandomness<'_>, p: Pull, randomness: [u8; 32], now: i64) -> Result<()> {
    let pull = accounts.pull.to_account_info();
    let machine = accounts.machine.to_account_info();
    let deck = accounts.deck.to_account_info();
    let binder = accounts.binder.to_account_info();
    let mut reveals = Vec::with_capacity(usize::from(p.qty));
    let mut removed = Vec::<(u8, u8, u32)>::with_capacity(
        usize::from(p.qty).saturating_mul(params::CARDS_PER_PACK_DUST as usize),
    );
    let mut stock_inc = 0u64;
    let mut jackpot_inc = 0u64;
    let mut burn_inc = 0u64;
    let mut team_inc = 0u64;
    let mut hit_value_total = 0u64;
    let mut pull_live_flags = 0u8;
    // Every fallible sysvar, borrow and layout check precedes the first write.
    let rent = Rent::get()?;
    let pull_floor = rent.minimum_balance(pull_size(p.qty));
    let mut pull_lamports = pull.try_borrow_mut_lamports()?;
    let mut machine_lamports = machine.try_borrow_mut_lamports()?;
    let mut deck_lamports = deck.try_borrow_mut_lamports()?;
    let mut pull_data = pull.try_borrow_mut_data()?;
    let mut machine_data = machine.try_borrow_mut_data()?;
    let mut deck_data = deck.try_borrow_mut_data()?;
    let mut binder_data = binder.try_borrow_mut_data()?;
    let (pull_fixed, pull_tail) = pull_data.split_at_mut(PULL_HEADER);
    let ph = header_mut::<Pull>(pull_fixed)?;
    let packs = tail_mut::<PackRecord>(pull_tail, 0)?;
    let m = header_mut::<Machine>(&mut machine_data)?;
    let (deck_fixed, deck_tail) = deck_data.split_at_mut(DECK_HEADER);
    let dh = header_mut::<Deck>(deck_fixed)?;
    let entries = tail_mut::<DeckEntry>(deck_tail, 0)?;
    let (binder_fixed, binder_tail) = binder_data.split_at_mut(BINDER_HEADER);
    let bh = header_mut::<Binder>(binder_fixed)?;
    let cards = tail_mut::<Card>(binder_tail, 0)?;
    let mut hour = math::HourState {
        hour_index: m.hour_index,
        hit_out_last_hour: m.hit_out_last_hour,
        hit_out_this_hour: m.hit_out_this_hour,
        sb_paid_hour: m.sb_paid_hour,
        sol_at_hour_start: m.sol_at_hour_start,
        stock_sol: m.stock_sol,
    };
    math::rotate_hour(&mut hour, now);
    // No Result propagation is allowed below this commit boundary. Borrow guards
    // for every payment and all other account views remain live until completion.
    m.rotate_keeper_history(now);
    m.hour_index = hour.hour_index;
    m.hit_out_last_hour = hour.hit_out_last_hour;
    m.hit_out_this_hour = hour.hit_out_this_hour;
    m.sb_paid_hour = hour.sb_paid_hour;
    m.sol_at_hour_start = hour.sol_at_hour_start;
    let split = math::split(p.price);
    let coverage = math::coverage_need(p.price).unwrap_or(u64::MAX);
    let seq_lo = u32::try_from(p.seq & u64::from(u32::MAX)).unwrap_or_default();
    for (index, record) in packs.iter_mut().take(usize::from(p.qty)).enumerate() {
        let pack = u8::try_from(index).unwrap_or_default();
        if let Some(b) = m.buckets.get_mut(usize::from(record.backing)) {
            b.reserved = b.reserved.saturating_sub(coverage);
        }
        stock_inc = stock_inc.saturating_add(split.stock);
        jackpot_inc = jackpot_inc.saturating_add(split.jackpot);
        burn_inc = burn_inc.saturating_add(split.burn);
        team_inc = team_inc.saturating_add(split.team);
        if p.referrer == Pubkey::default() {
            team_inc = team_inc.saturating_add(split.referral);
        }
        if let Some((index, release_ts)) = math::specials::promote_onepct(m, now) {
            emit!(OnePctLive {
                index,
                release_ts,
                ts: now
            });
        }
        let (live, onepct_index) = math::specials::live_flags(m, p.price, now);
        pull_live_flags |= live;
        let Some(draw) = math::draw(&randomness, p.seq, pack, p.edition, live, p.holder != 0)
        else {
            continue;
        };
        let tier = draw.tier;
        let mut value = math::tier_value(p.price, tier).unwrap_or_default();
        let mut hit = None;
        let mut hit_bucket = TIER_NOT_DRAWN;
        let mut hit_mint = Pubkey::default();
        let mut hit_amount = 0u64;
        if (KIND_SILVER..=KIND_BLACK).contains(&tier) {
            let mut buckets = [math::BucketInput::default(); params::STOCK_MAX_BUCKETS as usize];
            for (target, b) in buckets.iter_mut().zip(m.buckets.iter()) {
                *target = math::BucketInput {
                    class: b.class,
                    enabled: b.enabled != 0,
                    amount: b.amount,
                    cost: b.cost,
                    reserved: b.reserved,
                };
            }
            if let Some(source) = math::bucket_pick(
                &randomness,
                p.seq,
                pack,
                tier,
                value,
                record.backing,
                &buckets,
            ) {
                if let Some(b) = m.buckets.get_mut(source) {
                    if let Some(carved) = math::carve(value, b.amount, b.cost) {
                        b.amount = carved.amount;
                        b.cost = carved.cost;
                        hit_bucket = u8::try_from(source).unwrap_or(TIER_NOT_DRAWN);
                        hit_mint = b.mint;
                        hit_amount = carved.tokens;
                        hit = Some(Card {
                            mint: b.mint,
                            amount: carved.tokens,
                            value,
                            kind: tier,
                            edition: p.edition,
                            flags: 0,
                            _pad: 0,
                            seq_lo,
                        });
                        m.hit_out_this_hour = m.hit_out_this_hour.saturating_add(value);
                        if let Some(total) = m.hit_value_out.get_mut(usize::from(p.edition)) {
                            *total = total.saturating_add(value);
                        }
                        hit_value_total = hit_value_total.saturating_add(value);
                    }
                }
            }
        }
        if tier == KIND_ONE_PCT && m.token_mint != Pubkey::default() {
            if let Some((index, slot)) =
                onepct_index.and_then(|index| m.onepct.get_mut(index).map(|slot| (index, slot)))
            {
                hit_mint = m.token_mint;
                hit_amount = slot.amount;
                hit = Some(Card {
                    mint: hit_mint,
                    amount: hit_amount,
                    value: 0,
                    kind: tier,
                    edition: p.edition,
                    flags: 0,
                    _pad: 0,
                    seq_lo,
                });
                slot.state = ONEPCT_PULLED;
                emit!(OnePctPulled {
                    seq: p.seq,
                    pack,
                    index: u8::try_from(index).unwrap_or_default(),
                    buyer: p.buyer,
                    amount: hit_amount,
                    holder: p.holder != 0
                });
            }
        } else if tier == KIND_JACKPOT && m.jackpot_tokens > 0 && m.token_mint != Pubkey::default()
        {
            hit_mint = m.token_mint;
            hit_amount = m.jackpot_tokens;
            value = m.jackpot_cost;
            hit = Some(Card {
                mint: hit_mint,
                amount: hit_amount,
                value,
                kind: tier,
                edition: p.edition,
                flags: 0,
                _pad: 0,
                seq_lo,
            });
            m.jackpot_tokens = 0;
            m.jackpot_cost = 0;
            emit!(JackpotWon {
                seq: p.seq,
                pack,
                buyer: p.buyer,
                edition: p.edition,
                tokens: hit_amount,
                cost: value,
                jackpot_sol_left: m.jackpot_sol
            });
        }
        if hit.is_none() {
            emit!(HitSkipped {
                seq: p.seq,
                pack,
                tier,
                value
            });
        }
        write_card(bh, cards, hit, p.seq, pack);
        let mut dust = [DustPick::default(); 4];
        let mut house_mask = 0u8;
        let mut fresh_mask = 0u8;
        for (k, royalty) in record.royalties.iter_mut().enumerate() {
            let slot = u8::try_from(k).unwrap_or_default();
            let bit = 1u8.checked_shl(u32::from(slot)).unwrap_or_default();
            let len = dh.len;
            let selection = if len > 0 {
                let index = math::dust_index(&randomness, p.seq, pack, slot, len);
                remove_entry(dh, entries, index).map(|(entry, moved)| (index, entry, moved))
            } else {
                None
            };
            if let Some((index, entry, moved_from)) = selection {
                *royalty = Royalty {
                    depositor: entry.depositor,
                    lamports: split.royalty,
                    refund: 0,
                };
                if entry.flags & ENTRY_FRESH != 0 {
                    fresh_mask |= bit;
                }
                removed.push((pack, slot, entry.deposit));
                if let Some(pick) = dust.get_mut(k) {
                    *pick = DustPick {
                        deck_len_before: len,
                        index,
                        moved_from,
                        mint: entry.mint,
                        amount: entry.amount,
                        depositor: entry.depositor,
                        refund: 0,
                    };
                }
                write_card(
                    bh,
                    cards,
                    Some(Card {
                        mint: entry.mint,
                        amount: entry.amount,
                        value: 0,
                        kind: KIND_DUST,
                        edition: p.edition,
                        flags: 0,
                        _pad: 0,
                        seq_lo,
                    }),
                    p.seq,
                    pack,
                );
            } else {
                house_mask |= bit;
                stock_inc = stock_inc.saturating_add(split.royalty);
                *royalty = anchor_lang::__private::bytemuck::Zeroable::zeroed();
                write_card(bh, cards, None, p.seq, pack);
            }
        }
        record.tier = tier;
        record.carved_bucket = hit_bucket;
        record.house_mask = house_mask;
        record.fresh_mask = fresh_mask;
        reveals.push(PackRevealed {
            seq: p.seq,
            pack,
            edition: p.edition,
            live_flags: live,
            holder: p.holder != 0,
            t: draw.t,
            widths: draw.widths,
            tier,
            hit_bucket,
            house_mask,
            hit_mint,
            hit_amount,
            hit_value: if hit.is_some() { value } else { 0 },
            dust,
        });
    }
    let spend = p.price.saturating_mul(u64::from(p.qty));
    bh.season_spend = bh.season_spend.saturating_add(spend);
    m.total_spend = m.total_spend.saturating_add(spend);
    if let Some(total) = m.packs_revealed.get_mut(usize::from(p.edition)) {
        *total = total.saturating_add(u64::from(p.qty));
    }
    m.reserved_dust = m
        .reserved_dust
        .saturating_sub(u64::from(params::CARDS_PER_PACK_DUST).saturating_mul(u64::from(p.qty)));
    m.pending_pulls = m.pending_pulls.saturating_sub(1);
    dh.total_pulled = dh
        .total_pulled
        .saturating_add(u64::try_from(removed.len()).unwrap_or_default());
    ph.status = PULL_REVEALED;
    // Callback remains total: observation never introduces a failure branch.
    m.unsettled_reveals = m.unsettled_reveals.saturating_add(1);
    ph.randomness = randomness;
    ph.revealed_ts = now;
    m.last_reveal_ts = now;
    emit!(crate::events::RevealTimestamped {
        seq: p.seq,
        ts: now
    });
    ph.live_flags = pull_live_flags;
    let deck_len = dh.len;
    let old_cap = dh.cap;
    drop(deck_data);
    // A validated shrink cannot fail: it reduces size, this function released its
    // sole Deck borrow, and no CPI can introduce another one. Keep the old cap if
    // the runtime nevertheless refuses it; refunds then use the retained size.
    let cap = shrink_revealed_deck(&deck, deck_len, old_cap, **deck_lamports, &rent);
    let mut available = (**deck_lamports)
        .saturating_sub(rent.minimum_balance(deck_size(cap)))
        .min(u64::MAX.saturating_sub(**pull_lamports));
    let mut total_refunds = 0u64;
    for (pack, slot, deposit) in &removed {
        let refund = u64::from(*deposit).min(available);
        available = available.saturating_sub(refund);
        total_refunds = total_refunds.saturating_add(refund);
        if let Some(royalty) = packs
            .get_mut(usize::from(*pack))
            .and_then(|r| r.royalties.get_mut(usize::from(*slot)))
        {
            royalty.refund = refund;
        }
        if let Some(pick) = reveals
            .get_mut(usize::from(*pack))
            .and_then(|r| r.dust.get_mut(usize::from(*slot)))
        {
            pick.refund = refund;
        }
    }
    **deck_lamports = (**deck_lamports).saturating_sub(total_refunds);
    **pull_lamports = (**pull_lamports).saturating_add(total_refunds);
    let wanted = stock_inc
        .saturating_add(jackpot_inc)
        .saturating_add(burn_inc)
        .saturating_add(team_inc);
    let moved = wanted
        .min((**pull_lamports).saturating_sub(pull_floor))
        .min(u64::MAX.saturating_sub(**machine_lamports));
    **pull_lamports = (**pull_lamports).saturating_sub(moved);
    **machine_lamports = (**machine_lamports).saturating_add(moved);
    let shortfall = wanted.saturating_sub(moved);
    let mut missing = shortfall;
    for value in [
        &mut stock_inc,
        &mut team_inc,
        &mut jackpot_inc,
        &mut burn_inc,
    ] {
        let loss = (*value).min(missing);
        *value = value.saturating_sub(loss);
        missing = missing.saturating_sub(loss);
    }
    m.stock_sol = m.stock_sol.saturating_add(stock_inc);
    m.jackpot_sol = m.jackpot_sol.saturating_add(jackpot_inc);
    m.burn_sol = m.burn_sol.saturating_add(burn_inc);
    m.team_sol = m.team_sol.saturating_add(team_inc);
    for event in reveals {
        emit!(event);
    }
    emit!(PullRevealed {
        pull: *pull.key,
        seq: p.seq,
        buyer: p.buyer,
        randomness,
        qty: p.qty,
        hit_value_total,
        to_stock: stock_inc,
        to_jackpot: jackpot_inc,
        to_burn: burn_inc,
        to_team: team_inc,
        shortfall
    });
    Ok(())
}
pub fn handler(ctx: Context<ConsumeRandomness>, randomness: [u8; 32], seq: u64) -> Result<()> {
    {
        let account = ctx.accounts.machine.to_account_info();
        if *account.owner == crate::ID {
            if let Ok(data) = account.try_borrow_data() {
                if let Ok(machine) = header::<Machine>(&data) {
                    if valid_address(&account, &[MACHINE_SEED, &[machine.bump]]) {
                        require!(
                            machine.exec.kind == EXEC_KIND_NONE,
                            MachineError::ExecInFlight
                        );
                    }
                }
            }
        }
    }
    let now = match Clock::get() {
        Ok(clock) => clock.unix_timestamp,
        Err(_) => {
            emit!(CallbackSkipped {
                pull: ctx.accounts.pull.key(),
                seq,
                reason: 1
            });
            return Ok(());
        }
    };
    match validate_callback(ctx.accounts, seq, now) {
        Err(reason) => emit!(CallbackSkipped {
            pull: ctx.accounts.pull.key(),
            seq,
            reason
        }),
        Ok(p) => {
            if reveal(ctx.accounts, p, randomness, now).is_err() {
                emit!(CallbackSkipped {
                    pull: ctx.accounts.pull.key(),
                    seq,
                    reason: 1
                });
            }
        }
    }
    Ok(())
}
