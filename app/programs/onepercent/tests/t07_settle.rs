mod common;
use anchor_lang::prelude::Pubkey;
use common::{pack_cases::*, *};
use onepercent::{
    events::*,
    state::{Binder, Machine},
};
use solana_signer::Signer;
fn opened(
    mainnet: bool,
    qty: u8,
    referrer: Option<Pubkey>,
) -> (Env, solana_keypair::Keypair, Pubkey) {
    let (mut e, u, _, _) = setup(mainnet);
    let who = pubkey(&u.pubkey());
    e.send(&[e.buy_ix(who, 0, qty, 0, referrer)], &[&u])
        .unwrap();
    let p = pda(&[b"pull", who.as_ref(), &0u32.to_le_bytes()]).0;
    e.fulfill(p, [1; 32]).unwrap();
    (e, u, p)
}
#[test]
fn p3_legacy_revealed_pull_settles_before_activation_without_a_new_gate() {
    let (mut e, _, p) = opened(false, 2, None);
    // Simulate the deployed layout: revealed Pull, zeroed reserved extension.
    e.mutate(e.machine, |a| a.data[2656..3080].fill(0));
    let before = e.state::<Machine>(e.machine);
    e.settle(p, 0).unwrap();
    assert!(!e.closed(p));
    assert_eq!(e.state::<Machine>(e.machine).unsettled_reveals, 0);
    e.settle(p, 1).unwrap();
    assert!(e.closed(p));
    let after = e.state::<Machine>(e.machine);
    assert_eq!(after.unsettled_reveals, 0);
    assert_eq!(after.last_reveal_ts, 0);
    assert_eq!(after.stock_sol, before.stock_sol);
    e.send(&[instruction(
        "advance_phase",
        vec![meta(e.config, false, false), meta(e.machine, true, false)],
        &[],
    )], &[]).unwrap();
    let activated = e.state::<Machine>(e.machine);
    assert_eq!(activated.last_reveal_ts, e.now());
    assert_eq!(activated.unsettled_reveals, 0);
    e.check_invariants();
}
#[test]
fn t07_01_settle_x1_pays_and_closes() {
    let r = Pubkey::new_unique();
    let (mut e, u, p) = opened(false, 1, Some(r));
    let rec = records(&e, p)[0];
    let depositor = rec.royalties[0].depositor;
    let before = e.account(depositor).lamports;
    let buyer = pubkey(&u.pubkey());
    let before_buyer = e.account(buyer).lamports;
    e.binder(depositor, &[], 0, 0);
    e.mutate(binder(depositor), |a| write_u16(&mut a.data, 102, 4));
    e.mutate(p, |a| a.data[176 + 196] = 15);
    let remaining = e.account(p).lamports - 4 * 2_406_400 - 2_000_000;
    let m = e.settle(p, 0).unwrap();
    assert_eq!(e.account(depositor).lamports, before + 4 * 2_406_400);
    assert_eq!(e.account(r).lamports, 2_000_000);
    assert_eq!(e.account(buyer).lamports, before_buyer + remaining);
    assert_eq!(e.state::<Binder>(binder(depositor)).fresh_in_deck, 0);
    assert!(e.closed(p));
    assert_eq!(events::<PackSettled>(&m).len(), 1);
    assert_eq!(events::<PullClosed>(&m).len(), 1);
    e.check_invariants();
}
#[test]
fn t07_02_idempotent_and_closed_noop() {
    let (mut e, _, p) = opened(false, 2, None);
    let ix = e.settle_ix(p, 0);
    e.send(&[ix.clone()], &[]).unwrap();
    let before = e.account(p);
    e.send(&[ix.clone()], &[]).unwrap();
    assert_eq!(e.account(p), before);
    e.settle(p, 1).unwrap();
    e.send(&[ix], &[]).unwrap();
    assert!(e.closed(p));
    e.check_invariants();
}
#[test]
fn t07_03_pending_rejected() {
    let (mut e, u, _, _) = setup(false);
    let (p, _) = e.buy(&u, 0, 1).unwrap();
    assert_error(e.settle(p, 0), "PullNotRevealed");
    e.check_invariants();
}
#[test]
fn t07_04_wrong_accounts() {
    for index in [2, 3, 4, 8] {
        let (mut e, _, p) = opened(false, 1, Some(Pubkey::new_unique()));
        if index == 8 {
            let d = records(&e, p)[0].royalties[0].depositor;
            e.binder(d, &[], 0, 0);
            e.mutate(binder(d), |a| write_u16(&mut a.data, 102, 4));
            e.mutate(p, |a| a.data[176 + 196] = 15);
        }
        let mut ix = e.settle_ix(p, 0);
        ix.accounts[index] = meta(Pubkey::new_unique(), true, false);
        assert_error(e.send(&[ix], &[]), "AccountMismatch");
    }
    for index in [2, 3, 4] {
        let r = Pubkey::new_unique();
        let (mut e, _, p) = opened(false, 1, Some(r));
        e.fund(r, 1_000_000);
        let mut ix = e.settle_ix(p, 0);
        let target = ix.accounts[index].pubkey;
        for a in &mut ix.accounts {
            if a.pubkey == target {
                a.is_writable = false;
            }
        }
        assert_error(e.send(&[ix], &[]), "AccountMismatch");
    }
}
#[test]
fn t07_05_non_creditable_payees() {
    for mainnet in [false, true] {
        for mode in 0..3 {
            let r = Pubkey::new_unique();
            let (mut e, _, p) = opened(mainnet, 1, Some(r));
            let d = records(&e, p)[0].royalties[0].depositor;
            if mode == 0 {
                e.make_program(d);
                e.make_program(r);
            } else if mode == 1 {
                e.mutate(d, |a| a.owner = addr(&onepercent::ID));
                e.put(
                    r,
                    solana_account::Account {
                        lamports: 1_000_000,
                        owner: addr(&onepercent::ID),
                        ..Default::default()
                    },
                );
            } else {
                e.fund(d, 0);
            }
            let before = e.state::<Machine>(e.machine);
            let m = e.settle(p, 0).unwrap();
            if mode < 2 {
                let after = e.state::<Machine>(e.machine);
                assert_eq!(
                    after.stock_sol,
                    before.stock_sol + 4 * 2_406_400 + 2_000_000
                );
                assert_eq!(after.team_sol, before.team_sol);
                assert_eq!(events::<ReferralRedirected>(&m)[0].amount, 2_000_000);
                assert_eq!(events::<RoyaltyRedirected>(&m).len(), 4);
            } else {
                assert_eq!(e.account(d).lamports, 4 * 2_406_400);
            }
            e.check_invariants();
        }
    }
}
#[test]
fn t07_06_x10_two_packs_per_tx() {
    let (mut e, _, p) = opened(false, 10, None);
    for pair in [[8, 1], [5, 3], [0, 9], [6, 2], [7, 4]] {
        let ixs = [e.settle_ix(p, pair[0]), e.settle_ix(p, pair[1])];
        let msg = solana_message::Message::new(&ixs, Some(&e.authority.pubkey()));
        assert!(
            (msg.serialize().len() + 1 + 64 * usize::from(msg.header.num_required_signatures))
                <= 1232
        );
        e.send(&ixs, &[]).unwrap();
        e.check_invariants();
    }
    assert!(e.closed(p));
}
#[test]
fn t07_07_house_slots_skipped() {
    let (mut e, u, _, _) = setup(false);
    let (p, _) = e.buy(&u, 0, 1).unwrap();
    e.inject_deck(2);
    e.fulfill(p, [1; 32]).unwrap();
    let rec = records(&e, p)[0];
    assert_eq!(rec.house_mask.count_ones(), 2);
    let m = e.settle(p, 0).unwrap();
    let paid = events::<PackSettled>(&m)[0].paid;
    assert_eq!(paid.iter().filter(|v| **v == 0).count(), 2);
    assert!(e.closed(p));
}
#[test]
fn t07_08_rent_increase_before_settle() {
    let (mut e, u, p) = opened(false, 10, None);
    let before = e.account(pubkey(&u.pubkey())).lamports;
    e.set_rent(6960);
    for k in 0..10 {
        e.settle(p, k).unwrap();
    }
    assert!(e.account(pubkey(&u.pubkey())).lamports >= before);
    assert!(e.closed(p));
    e.check_invariants();
}
#[test]
fn t07_09_any_phase_all_paused() {
    for phase in 0..=6 {
        let (mut e, _, p) = opened(false, 1, None);
        e.inject_phase(phase);
        pause_all(&mut e);
        e.settle(p, 0).unwrap();
        e.check_invariants();
    }
}
#[test]
fn t07_10_settle_frees_cap_room() {
    let (mut e, _, p) = opened(false, 1, None);
    let rec = records(&e, p)[0];
    let d = rec.royalties[0].depositor;
    let feeder = e.user();
    let who = pubkey(&feeder.pubkey());
    let bag = e.new_pump_mint(false);
    e.token_account(who, &bag, 10000);
    e.binder(who, &[], 0, 0);
    e.mutate(binder(who), |a| write_u16(&mut a.data, 102, 25));
    e.mutate(p, |a| {
        write_key(&mut a.data, 176, &who);
        a.data[176 + 196] = 1;
    });
    assert_error(e.feed(&feeder, &bag, 1000, 0), "FreshCapReached");
    e.settle(p, 0).unwrap();
    assert_eq!(e.state::<Binder>(binder(who)).fresh_in_deck, 24);
    e.feed(&feeder, &bag, 1000, 0).unwrap();
    assert_eq!(e.state::<Binder>(binder(who)).fresh_in_deck, 25);
    assert_ne!(d, who);
}
#[test]
fn t07_11_reserved_and_program_payees() {
    let rent = anchor_lang::solana_program::sysvar::rent::ID;
    let (mut e, _, p) = opened(true, 2, Some(rent));
    let before = e.state::<Machine>(e.machine).stock_sol;
    for k in 0..2 {
        e.settle(p, k).unwrap();
    }
    assert_eq!(e.state::<Machine>(e.machine).stock_sol, before + 4_000_000);
    e.check_invariants();
    for phase in [3, 5] {
        let (mut e, u, p) = opened(true, 1, None);
        let who = pubkey(&u.pubkey());
        let d = records(&e, p)[0].royalties[0].depositor;
        e.make_program(d);
        e.make_program(who);
        e.inject_phase(phase);
        let before = e.state::<Machine>(e.machine);
        let whole = e.account(p).lamports;
        let ix = e.settle_ix(p, 0);
        assert!(!ix.accounts[2].is_writable && !ix.accounts[4].is_writable);
        let mut writable = ix.clone();
        writable.accounts[2].is_writable = true;
        writable.accounts[4].is_writable = true;
        let simulation = e
            .svm
            .simulate_transaction(solana_transaction::Transaction::new(
                &[&e.authority],
                solana_message::Message::new_with_blockhash(
                    &[writable],
                    Some(&e.authority.pubkey()),
                    &e.svm.latest_blockhash(),
                ),
                e.svm.latest_blockhash(),
            ));
        println!(
            "T07.11 executable writable mainnet simulation: {}",
            if simulation.is_ok() {
                "accepted"
            } else {
                "rejected"
            }
        );
        e.send(&[ix], &[]).unwrap();
        let after = e.state::<Machine>(e.machine);
        if phase == 5 {
            assert_eq!(after.burn_sol, before.burn_sol + whole);
        } else {
            assert_eq!(after.stock_sol, before.stock_sol + whole);
        }
        e.check_invariants();
    }
    let r = Pubkey::new_unique();
    let (mut e, _, p) = opened(true, 1, Some(r));
    let before = e.state::<Machine>(e.machine).stock_sol;
    let mut ix = e.settle_ix(p, 0);
    ix.accounts[3].is_writable = false;
    e.send(&[ix], &[]).unwrap();
    assert_eq!(e.state::<Machine>(e.machine).stock_sol, before + 2_000_000);
    e.check_invariants();
}

#[test]
fn t07_12_empty_signer_payees_require_writable() {
    for mainnet in [false, true] {
        for buyer in [false, true] {
            let (mut e, user, pull) = opened(mainnet, 1, None);
            let target = if buyer {
                pubkey(&user.pubkey())
            } else {
                records(&e, pull)[0].royalties[0].depositor
            };
            e.fund(target, 0);
            let mut ix = e.settle_ix(pull, 0);
            for account in &mut ix.accounts {
                if account.pubkey == addr(&target) {
                    account.is_writable = false;
                }
            }
            let pull_before = e.account(pull);
            let machine_before = e.account(e.machine);
            let economics_before = e.state::<Machine>(e.machine);
            let royalties: u64 = records(&e, pull)[0]
                .royalties
                .iter()
                .map(|r| r.lamports + r.refund)
                .sum();
            let expected = if buyer {
                pull_before.lamports - royalties
            } else {
                royalties
            };
            assert_error(e.send(&[ix.clone()], &[]), "AccountMismatch");
            assert_eq!(e.account(pull), pull_before);
            assert_eq!(e.account(e.machine), machine_before);
            assert_eq!(e.svm.get_balance(&addr(&target)).unwrap_or(0), 0);
            for account in &mut ix.accounts {
                if account.pubkey == addr(&target) {
                    account.is_writable = true;
                }
            }
            let meta = e.send(&[ix], &[]).unwrap();
            assert_eq!(e.account(target).lamports, expected);
            assert!(events::<RoyaltyRedirected>(&meta).is_empty());
            let settled = events::<PackSettled>(&meta);
            assert_eq!(settled[0].redirected_mask, 0);
            assert_eq!(settled[0].paid.iter().sum::<u64>(), royalties);
            assert!(!events::<PullClosed>(&meta)[0].to_stock);
            assert_eq!(
                events::<PullClosed>(&meta)[0].lamports,
                pull_before.lamports - royalties
            );
            let economics_after = e.state::<Machine>(e.machine);
            assert_eq!(
                economics_after.last_reveal_ts,
                economics_before.last_reveal_ts
            );
            assert!(economics_after.last_reveal_ts > 0);
            assert_eq!(
                (economics_after.stock_sol, economics_after.team_sol),
                (economics_before.stock_sol, economics_before.team_sol)
            );
            assert!(e.closed(pull));
            e.check_invariants();
        }
    }
}

#[test]
fn t07_13_referral_redirects_to_stock_or_done_burn() {
    for mainnet in [false, true] {
        for phase in [3, 5] {
            for mode in 0..3 {
                let referrer = Pubkey::new_unique();
                let (mut e, _, pull) = opened(mainnet, 1, Some(referrer));
                let seq = e.state::<onepercent::state::Pull>(pull).seq;
                if mode == 0 {
                    e.make_program(referrer);
                } else if mode == 1 {
                    e.put(
                        referrer,
                        solana_account::Account {
                            owner: addr(&onepercent::ID),
                            lamports: e.rent_min(0),
                            ..Default::default()
                        },
                    );
                }
                e.inject_phase(phase);
                let before = e.state::<Machine>(e.machine);
                let mut ix = e.settle_ix(pull, 0);
                ix.accounts[3].is_writable = false;
                let meta = e.send(&[ix], &[]).unwrap();
                let after = e.state::<Machine>(e.machine);
                assert_eq!(after.team_sol, before.team_sol);
                assert_eq!(
                    after.stock_sol - before.stock_sol,
                    if phase == 5 { 0 } else { 2_000_000 }
                );
                assert_eq!(
                    after.burn_sol - before.burn_sol,
                    if phase == 5 { 2_000_000 } else { 0 }
                );
                let redirected = events::<ReferralRedirected>(&meta);
                assert_eq!(redirected.len(), 1);
                assert_eq!(
                    (
                        redirected[0].seq,
                        redirected[0].pack,
                        redirected[0].referrer,
                        redirected[0].amount
                    ),
                    (seq, 0, referrer, 2_000_000)
                );
                let settled = events::<PackSettled>(&meta);
                assert_eq!(
                    (settled[0].referral_paid, settled[0].referral_to_team),
                    (0, 0)
                );
                e.check_invariants();
            }
        }
    }
}

#[test]
fn t07_14_closed_fresh_binder_is_skipped_but_address_checked() {
    for mainnet in [false, true] {
        for readonly in [false, true] {
            let (mut e, _, pull) = opened(mainnet, 1, None);
            let depositor = records(&e, pull)[0].royalties[0].depositor;
            let closed_binder = binder(depositor);
            e.fund(closed_binder, 0);
            e.mutate(pull, |a| a.data[176 + 196] = 15);
            let before = e.account(depositor).lamports;
            let mut ix = e.settle_ix(pull, 0);
            for account in &mut ix.accounts {
                if account.pubkey == addr(&closed_binder) {
                    account.is_writable = !readonly;
                }
            }
            let mut wrong = ix.clone();
            wrong.accounts[8] = meta(Pubkey::new_unique(), false, false);
            assert_error(e.send(&[wrong], &[]), "AccountMismatch");
            e.send(&[ix], &[]).unwrap();
            assert_eq!(e.account(depositor).lamports, before + 4 * 2_406_400);
            assert!(e.closed(closed_binder));
            assert!(e.closed(pull));
            e.check_invariants();
        }
    }
}
