mod common;
#[path = "common/mycards.rs"]
mod mycards;
use common::{pack_cases::*, *};
use mycards::*;
use onepercent::{
    constants::{ENTRY_REFED, MAX_FEED_BACK_CARDS},
    events::CardFedBack,
    params,
    state::*,
};
use solana_signer::Signer;

#[test]
fn t14_01_dust_and_foil() {
    for kind in 0..=4 {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        e.mutate(binder(owner), |a| a.data[160] = kind);
        let ledger = e.account(pda(&[b"ledger", bag.mint.as_ref()]).0);
        let vault = e.account(ata(&e.vault_auth, &bag.mint, &bag.token_program));
        let wallet = e.account(owner).lamports;
        let deck = e.state::<Deck>(e.deck);
        let tx = e.send(&[fb_ix(&e, owner, &[0])], &[&u]).unwrap();
        let event = &events::<CardFedBack>(&tx)[0];
        let entry = &entries(&e)[0];
        assert_eq!(
            (entry.depositor, entry.mint, entry.amount, entry.flags),
            (owner, bag.mint, 1000, ENTRY_REFED)
        );
        assert_eq!(event.slot_refund, e.rent_min(168) - e.rent_min(112));
        assert_eq!(event.deposit, u64::from(entry.deposit));
        assert_eq!(
            e.account(owner).lamports,
            wallet + event.slot_refund - event.deposit
        );
        assert_eq!(
            (event.kind, event.card_index, event.deck_index),
            (kind, 0, 0)
        );
        assert_eq!(
            (
                e.state::<Binder>(binder(owner)).len,
                e.state::<Binder>(binder(owner)).fresh_in_deck
            ),
            (0, 0)
        );
        assert_eq!(e.state::<Deck>(e.deck).total_fed, deck.total_fed + 1);
        assert_eq!(e.account(pda(&[b"ledger", bag.mint.as_ref()]).0), ledger);
        assert_eq!(
            e.account(ata(&e.vault_auth, &bag.mint, &bag.token_program)),
            vault
        );
    }
}
#[test]
fn t14_02_special_kinds_refused() {
    for kind in 5..=8 {
        let (mut e, u, _) = fixture(1);
        let owner = pubkey(&u.pubkey());
        e.mutate(binder(owner), |a| a.data[160] = kind);
        let ix = fb_ix(&e, owner, &[0]);
        unchanged_on_error(&mut e, &u, &[ix], "NotFeedable");
    }
}
#[test]
fn t14_03_fresh_cap_not_applied() {
    let (mut e, u, _) = fixture(1);
    let owner = pubkey(&u.pubkey());
    edit::<Binder>(&mut e, binder(owner), |b| {
        b.fresh_in_deck = params::FEED_RULES_FRESH_CAP_PER_WALLET as u16
    });
    e.send(&[fb_ix(&e, owner, &[0])], &[&u]).unwrap();
    assert_eq!(
        u32::from(e.state::<Binder>(binder(owner)).fresh_in_deck),
        params::FEED_RULES_FRESH_CAP_PER_WALLET
    );
}
#[test]
fn t14_04_eight_descending() {
    assert_eq!(
        MAX_FEED_BACK_CARDS, 8,
        "P0 TX_LIMITS.redeemPerTx parity pin"
    );
    for indices in [
        vec![0, 1],
        vec![1, 1],
        vec![1, 3, 2],
        (0..9).rev().collect(),
        vec![],
    ] {
        let (mut e, u, _) = fixture(9);
        let owner = pubkey(&u.pubkey());
        let ix = fb_ix(&e, owner, &indices);
        unchanged_on_error(&mut e, &u, &[ix], "InvalidArgument");
    }
    let (mut e, u, _) = fixture(8);
    let owner = pubkey(&u.pubkey());
    e.send(
        &[fb_ix(&e, owner, &(0..8).rev().collect::<Vec<_>>())],
        &[&u],
    )
    .unwrap();
    assert_eq!(entries(&e).len(), 8);
    assert!(entries(&e).iter().all(|entry| entry.flags == ENTRY_REFED));
    assert!(cards(&e, owner).is_empty());
}
#[test]
fn t14_05_gates() {
    for (mode, error) in [
        (0, "Paused"),
        (1, "WrongPhase"),
        (2, "SeasonOver"),
        (3, "ExecInFlight"),
        (4, "CardMoved"),
    ] {
        let (mut e, u, _) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let config = e.config;
        let machine = e.machine;
        let now = e.now();
        match mode {
            0 => edit::<Config>(&mut e, config, |c| c.admin_paused = params::PAUSE_BITS_FEED),
            1 => e.inject_phase(4),
            2 => edit::<Machine>(&mut e, machine, |m| m.end_ts = now),
            3 => edit::<Machine>(&mut e, machine, |m| m.exec.kind = 1),
            _ => {}
        }
        let ix = fb_ix(&e, owner, &[if mode == 4 { 1 } else { 0 }]);
        unchanged_on_error(&mut e, &u, &[ix], error);
    }
}
#[test]
fn t14_06_refed_take_back_after_binder_close() {
    for prefunded in [false, true] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        e.send(&[fb_ix(&e, owner, &[0]), close_binder_ix(owner)], &[&u])
            .unwrap();
        assert!(e.closed(binder(owner)));
        if prefunded {
            e.fund(binder(owner), e.rent_min(0));
        }
        e.send(&[e.take_back_ix(owner, &bag, 0, 1000)], &[&u])
            .unwrap();
        assert_eq!(e.state::<Deck>(e.deck).len, 0);
        assert_eq!(
            read_u64(
                &e.account(ata(&owner, &bag.mint, &bag.token_program)).data,
                64
            ),
            1000
        );
        e.check_invariants();
    }
}
#[test]
fn t14_07_refed_pulled_royalty_without_fresh() {
    let (mut e, u, bag) = fixture(1);
    let owner = pubkey(&u.pubkey());
    e.send(&[fb_ix(&e, owner, &[0])], &[&u]).unwrap();
    let entry = entries(&e)[0];
    let mut deck = e.state::<Deck>(e.deck);
    deck.len = 100;
    deck.cap = 100;
    deck.total_fed = 100;
    let tail = bytemuck::cast_slice(&vec![entry; 100]).to_vec();
    let deck_key = e.deck;
    e.set_state(deck_key, &deck, &tail, 100 * u64::from(entry.deposit));
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    edit::<MintLedger>(&mut e, ledger, |l| l.accounted += 99 * 1000);
    let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
    e.mutate(vault, |a| {
        let amount = read_u64(&a.data, 64);
        write_u64(&mut a.data, 64, amount + 99 * 1000);
    });
    let machine = e.machine;
    edit::<Machine>(&mut e, machine, |m| m.buckets[0].cost = 300_000_000_000);
    let buyer = e.user();
    let (pull, _) = e.buy(&buyer, 0, 1).unwrap();
    e.fulfill(pull, [1; 32]).unwrap();
    let record = records(&e, pull)[0];
    assert_eq!(record.fresh_mask, 0);
    assert_eq!(record.house_mask, 0);
    let before = e.account(owner).lamports;
    let amount: u64 = record.royalties.iter().map(|r| r.lamports + r.refund).sum();
    e.settle(pull, 0).unwrap();
    assert_eq!(e.account(owner).lamports, before + amount);
    assert_eq!(e.state::<Binder>(binder(owner)).fresh_in_deck, 0);
}
#[test]
fn t14_08_deck_bounds_and_rent() {
    let (mut e, u, _) = fixture(1);
    let owner = pubkey(&u.pubkey());
    let deck = e.deck;
    edit::<Deck>(&mut e, deck, |d| d.len = params::COVERAGE_DECK_MAX);
    let ix = fb_ix(&e, owner, &[0]);
    unchanged_on_error(&mut e, &u, &[ix], "DeckFull");
    let (mut e, u, _) = fixture(1);
    let owner = pubkey(&u.pubkey());
    e.set_rent(6960);
    let ix = fb_ix(&e, owner, &[0]);
    unchanged_on_error(&mut e, &u, &[ix], "DeckUnderfunded");
}
#[test]
fn t14_report_cu() {
    Env::deterministic_bench_signers(20261009);
    for n in [1, 8] {
        let (mut max_cu, mut max_bytes) = (0, 0);
        for sample in 0..32 {
            let (mut e, u, bag) = measurement_fixture(n, sample % 2 != 0, sample as u64);
            let owner = pubkey(&u.pubkey());
            if sample % 4 >= 2 {
                seed_refed(&mut e, owner, &bag, 1);
            }
            e.donate_lamports(binder(owner), u64::try_from(sample).unwrap());
            let ix = fb_ix(&e, owner, &(0..n as u16).rev().collect::<Vec<_>>());
            let (cu, bytes) = measure(&mut e, &u, vec![ix]);
            max_cu = max_cu.max(cu);
            max_bytes = max_bytes.max(bytes);
        }
        println!("P2 CASE feed_back x{n} normal: max_cu={max_cu}, samples=32");
        for (large_deck, large_binder) in [(true, false), (false, true), (true, true)] {
            let count = if large_binder {
                usize::from(u16::MAX)
            } else {
                n
            };
            let (mut e, u, bag) = measurement_fixture(count, false, 2000 + n as u64);
            let owner = pubkey(&u.pubkey());
            if large_deck {
                seed_refed(&mut e, owner, &bag, params::COVERAGE_DECK_MAX - n as u32);
            }
            let before_deck = e.state::<Deck>(e.deck).len;
            let ix = fb_ix(&e, owner, &(0..n as u16).rev().collect::<Vec<_>>());
            let (cu, bytes) = measure(&mut e, &u, vec![ix]);
            assert_eq!(e.state::<Deck>(e.deck).len, before_deck + n as u32);
            assert_eq!(usize::from(e.state::<Binder>(binder(owner)).len), count - n);
            e.check_invariants();
            println!(
                "P2 CASE feed_back x{n} account_sizes: deck_entries={before_deck}, binder_cards={count}, cu={cu}, bytes={bytes}"
            );
            max_cu = max_cu.max(cu);
            max_bytes = max_bytes.max(bytes);
        }
        println!(
            "P2 REPORT feed_back x{n}: max_cu={max_cu}, max_bytes={max_bytes}, recommended_cu={}",
            (max_cu * 125).div_ceil(100_000) * 1000
        );
    }
}

#[test]
fn t14_09_cpi_rejects_active_exec_atomically_and_accepts_clear_exec() {
    for active in [false, true] {
        let (mut e, u, _) = fixture(1);
        let owner = pubkey(&u.pubkey());
        if active {
            let machine = e.machine;
            edit::<Machine>(&mut e, machine, |m| m.exec.kind = 1);
        }
        let ix = via_cpi(fb_ix(&e, owner, &[0]));
        if active {
            unchanged_on_error(&mut e, &u, &[ix], "ExecInFlight");
        } else {
            e.send(&[ix], &[&u]).unwrap();
            assert!(cards(&e, owner).is_empty());
        }
    }
}

#[test]
fn t14_10_slot_refunds_fund_entry_deposits_before_charge() {
    for count in [1usize, 8] {
        let (mut e, u, bag) = fixture(count);
        let owner = pubkey(&u.pubkey());
        let wallet_min = e.rent_min(0);
        let slot_refund = e.rent_min(112 + count * 56) - e.rent_min(112);
        let deposit = (e.rent_min(80) - e.rent_min(0)) * count as u64;
        let initial = wallet_min + deposit - slot_refund;
        assert!(initial.saturating_sub(deposit) < wallet_min);
        if count == 8 {
            assert!(initial < deposit, "the batch requires its slot refunds");
        }
        e.fund(owner, initial);
        let ledger = e.account(pda(&[b"ledger", bag.mint.as_ref()]).0);
        let vault = e.account(ata(&e.vault_auth, &bag.mint, &bag.token_program));
        let deck_balance = e.account(e.deck).lamports;
        let indices: Vec<_> = (0..count as u16).rev().collect();
        // The separate harness payer covers transaction fees; the owner funds entry rent.
        let tx = e.send(&[fb_ix(&e, owner, &indices)], &[&u]).unwrap();
        let emitted = events::<CardFedBack>(&tx);
        assert_eq!(emitted.len(), count);
        assert_eq!(
            emitted.iter().map(|event| event.slot_refund).sum::<u64>(),
            slot_refund
        );
        assert_eq!(
            emitted.iter().map(|event| event.deposit).sum::<u64>(),
            deposit
        );
        assert_eq!(e.account(owner).lamports, wallet_min);
        assert_eq!(e.account(binder(owner)).lamports, e.rent_min(112));
        assert_eq!(e.account(e.deck).lamports, deck_balance + deposit);
        assert_eq!(e.state::<Binder>(binder(owner)).len, 0);
        assert_eq!(entries(&e).len(), count);
        assert!(entries(&e).iter().all(|entry| entry.flags == ENTRY_REFED));
        assert_eq!(e.account(pda(&[b"ledger", bag.mint.as_ref()]).0), ledger);
        assert_eq!(
            e.account(ata(&e.vault_auth, &bag.mint, &bag.token_program)),
            vault
        );
        e.check_invariants();
    }
}
