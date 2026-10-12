mod common;
#[path = "common/mycards.rs"]
mod mycards;
use common::{pack_cases::*, *};
use mycards::*;
use onepercent::{
    events::{BinderClosed, OwedWithdrawn},
    state::*,
};
use solana_signer::Signer;

#[test]
fn t15_01_close_happy() {
    let (mut e, u, _) = fixture(0);
    let owner = pubkey(&u.pubkey());
    e.donate_lamports(binder(owner), 12345);
    let balance = e.account(binder(owner)).lamports;
    let wallet = e.account(owner).lamports;
    let tx = e.send(&[close_binder_ix(owner)], &[&u]).unwrap();
    assert!(e.closed(binder(owner)));
    assert_eq!(e.account(owner).lamports, wallet + balance);
    let event = &events::<BinderClosed>(&tx)[0];
    assert_eq!((event.owner, event.lamports), (owner, balance));
}
#[test]
fn t15_02_pending_pull_atomic() {
    let (mut e, u, _, _) = setup(false);
    let owner = pubkey(&u.pubkey());
    e.binder(owner, &[], 0, 0);
    let before = e.snapshot();
    let ixs = vec![e.buy_ix(owner, 3, 5, 0, None), close_binder_ix(owner)];
    unchanged_on_error(&mut e, &u, &ixs, "PullPending");
    for key in [e.machine, e.deck, binder(owner)] {
        assert_eq!(e.account(key), before[&key]);
    }
    assert_eq!(e.state::<Machine>(e.machine).pending_pulls, 0);
}
#[test]
fn t15_03_refusals() {
    for (mode, error) in [
        (0, "BinderNotEmpty"),
        (1, "BinderNotEmpty"),
        (2, "BinderNotEmpty"),
        (3, "FinalNotClaimed"),
        (4, "FinalNotClaimed"),
        (5, "FinalNotClaimed"),
    ] {
        let (mut e, u, _) = fixture(if mode == 0 { 1 } else { 0 });
        let owner = pubkey(&u.pubkey());
        edit::<Binder>(&mut e, binder(owner), |b| match mode {
            1 => b.fresh_in_deck = 1,
            2 => b.sol_owed = 1,
            3..=5 => {
                b.season_spend = 1;
                b.flags = (mode - 3) as u8
            }
            _ => {}
        });
        unchanged_on_error(&mut e, &u, &[close_binder_ix(owner)], error);
    }
    let (mut e, u, _) = fixture(0);
    let owner = pubkey(&u.pubkey());
    edit::<Binder>(&mut e, binder(owner), |b| {
        b.season_spend = 1;
        b.flags = 3;
    });
    e.send(&[close_binder_ix(owner)], &[&u]).unwrap();
    assert!(e.closed(binder(owner)));
}
#[test]
fn t15_04_recreate_and_replay() {
    for prefunded in [false, true] {
        let mut e = Env::new();
        let bag = e.new_pump_mint(false);
        let u = e.user_with_bag(&bag, 1000);
        let owner = pubkey(&u.pubkey());
        let ixs = e.feed_ixs(owner, &[(&bag, 1000)], 0);
        e.send(&ixs, &[&u]).unwrap();
        e.send(
            &[e.take_back_ix(owner, &bag, 0, 1000), close_binder_ix(owner)],
            &[&u],
        )
        .unwrap();
        assert!(e.closed(binder(owner)));
        if prefunded {
            e.fund(binder(owner), e.rent_min(0));
        }
        e.send(&ixs, &[&u]).unwrap();
        assert_eq!(entries(&e).len(), 1);
        assert_eq!(
            (entries(&e)[0].mint, entries(&e)[0].amount),
            (bag.mint, 1000)
        );
        assert_eq!(e.state::<Binder>(binder(owner)).fresh_in_deck, 1);
        e.check_invariants();
    }
}
#[test]
fn t15_05_withdraw_owed() {
    for (rent, owed, extra) in [
        (5080, 0, 0),
        (5080, 100_000, 500_000),
        (6960, 2_000_000, 2_000_000),
    ] {
        let (mut e, u, _) = fixture(0);
        let owner = pubkey(&u.pubkey());
        edit::<Binder>(&mut e, binder(owner), |b| b.sol_owed = owed);
        e.donate_lamports(binder(owner), extra);
        e.set_rent(rent);
        let source = e.account(binder(owner));
        let pay = owed.min(
            source
                .lamports
                .saturating_sub(e.rent_min(source.data.len())),
        );
        let wallet = e.account(owner).lamports;
        let tx = e.send(&[owed_ix(owner)], &[&u]).unwrap();
        assert_eq!(e.account(owner).lamports, wallet + pay);
        assert_eq!(e.state::<Binder>(binder(owner)).sol_owed, owed - pay);
        assert_eq!(e.account(binder(owner)).lamports, source.lamports - pay);
        let events = events::<OwedWithdrawn>(&tx);
        if owed == 0 {
            assert!(events.is_empty());
        } else {
            assert_eq!((events[0].amount, events[0].remaining), (pay, owed - pay));
        }
        if rent == 6960 {
            assert!(pay > 0 && pay < owed);
        }
    }
}
#[test]
fn t15_06_exits_every_phase_all_paused() {
    for phase in 0..=6 {
        let (mut e, u, _) = fixture(0);
        let owner = pubkey(&u.pubkey());
        e.inject_phase(phase);
        pause_all(&mut e);
        edit::<Binder>(&mut e, binder(owner), |b| b.sol_owed = 100_000);
        e.donate_lamports(binder(owner), 100_000);
        e.send(&[owed_ix(owner), close_binder_ix(owner)], &[&u])
            .unwrap();
        assert!(e.closed(binder(owner)));
    }
}
#[test]
fn t15_report_cu() {
    Env::deterministic_bench_signers(20261009);
    let (mut owed_max, mut close_max, mut owed_bytes, mut close_bytes) = (0, 0, 0, 0);
    for sample in 0..32 {
        let (mut e, u, _) = measurement_fixture(0, false, sample as u64);
        let owner = pubkey(&u.pubkey());
        edit::<Binder>(&mut e, binder(owner), |b| {
            b.sol_owed = 100_000;
            if sample % 2 != 0 {
                b.season_spend = 1;
                b.flags = 3;
            }
        });
        e.donate_lamports(binder(owner), 100_000 + u64::try_from(sample).unwrap());
        let (cu, bytes) = measure(&mut e, &u, vec![owed_ix(owner)]);
        owed_max = owed_max.max(cu);
        owed_bytes = owed_bytes.max(bytes);
        let (cu, bytes) = measure(&mut e, &u, vec![close_binder_ix(owner)]);
        close_max = close_max.max(cu);
        close_bytes = close_bytes.max(bytes);
    }
    println!(
        "P2 CASE binder normal: withdraw_owed_max_cu={owed_max}, close_binder_max_cu={close_max}, samples=32"
    );
    let count = usize::from(u16::MAX);
    let (mut e, u, bag) = measurement_fixture(count, false, 3000);
    let owner = pubkey(&u.pubkey());
    edit::<Binder>(&mut e, binder(owner), |b| b.sol_owed = 100_000);
    e.donate_lamports(binder(owner), 100_000);
    let (cu, bytes) = measure(&mut e, &u, vec![owed_ix(owner)]);
    println!("P2 CASE withdraw_owed maximum_binder: binder_cards={count}, cu={cu}, bytes={bytes}");
    owed_max = owed_max.max(cu);
    owed_bytes = owed_bytes.max(bytes);
    // An empty retained capacity has no card claims; remaining vault units are slack.
    edit::<Binder>(&mut e, binder(owner), |b| {
        b.len = 0;
        b.season_spend = 1;
        b.flags = 3;
    });
    e.mutate(binder(owner), |a| a.data[112..].fill(0));
    let bucket_amount = e.state::<Machine>(e.machine).buckets[0].amount;
    edit::<MintLedger>(&mut e, pda(&[b"ledger", bag.mint.as_ref()]).0, |l| {
        l.accounted = bucket_amount
    });
    e.check_invariants();
    let (cu, bytes) = measure(&mut e, &u, vec![close_binder_ix(owner)]);
    assert!(e.closed(binder(owner)));
    println!(
        "P2 CASE close_binder maximum_binder: binder_capacity={count}, cu={cu}, bytes={bytes}"
    );
    close_max = close_max.max(cu);
    close_bytes = close_bytes.max(bytes);
    for (name, cu, bytes) in [
        ("withdraw_owed", owed_max, owed_bytes),
        ("close_binder", close_max, close_bytes),
    ] {
        println!(
            "P2 REPORT {name}: max_cu={cu}, max_bytes={bytes}, recommended_cu={}",
            (cu * 125).div_ceil(100_000) * 1000
        );
    }
}

#[test]
fn t15_07_absent_and_prefunded_addresses_are_idempotent() {
    for prefunded in [false, true] {
        let (mut e, u, _) = fixture(0);
        let owner = pubkey(&u.pubkey());
        e.send(&[close_binder_ix(owner)], &[&u]).unwrap();
        if prefunded {
            e.fund(binder(owner), e.rent_min(0));
        }
        let before = e.svm.get_account(&addr(&binder(owner)));
        let wallet = e.account(owner);
        let result = e
            .send(&[owed_ix(owner), close_binder_ix(owner)], &[&u])
            .unwrap();
        assert!(events::<OwedWithdrawn>(&result).is_empty());
        assert!(events::<BinderClosed>(&result).is_empty());
        // Successful dispatch normalizes the runtime rent epoch on a funded account.
        let expected = before.map(|mut account| {
            account.rent_epoch = u64::MAX;
            account
        });
        assert_eq!(e.svm.get_account(&addr(&binder(owner))), expected);
        assert_eq!(e.account(owner), wallet);
    }
}

#[test]
fn t15_08_rent_unsafe_payees_reject_before_mutation_and_retry() {
    for close in [false, true] {
        let (mut e, u, _) = fixture(0);
        let owner = pubkey(&u.pubkey());
        if !close {
            edit::<Binder>(&mut e, binder(owner), |b| b.sol_owed = 100_000);
            e.donate_lamports(binder(owner), 100_000);
        }
        let old_min = e.rent_min(100_000);
        e.mutate(owner, |a| {
            a.data.resize(100_000, 0);
            a.lamports = old_min;
        });
        e.set_rent(6960);
        let ix = if close {
            close_binder_ix(owner)
        } else {
            owed_ix(owner)
        };
        unchanged_on_error(&mut e, &u, &[ix.clone()], "PayeeBelowRent");
        assert_eq!(
            e.state::<Binder>(binder(owner)).sol_owed,
            if close { 0 } else { 100_000 }
        );
        let minimum = e.rent_min(100_000);
        e.mutate(owner, |a| a.lamports = minimum);
        if !close {
            let needed = e.rent_min(112) + 100_000;
            e.mutate(binder(owner), |a| a.lamports = needed);
        }
        e.send(&[ix], &[&u]).unwrap();
        if close {
            assert!(e.closed(binder(owner)));
        } else {
            assert_eq!(e.state::<Binder>(binder(owner)).sol_owed, 0);
        }
    }
}

#[test]
fn t15_09_program_owned_signer_can_receive_both_exits() {
    let (mut e, u, _) = fixture(0);
    let owner = pubkey(&u.pubkey());
    edit::<Binder>(&mut e, binder(owner), |b| b.sol_owed = 100_000);
    e.donate_lamports(binder(owner), 100_000);
    e.mutate(owner, |a| {
        a.owner = addr(&onepercent::ID);
        a.data = vec![0; 17];
    });
    let before = e.account(owner).lamports;
    let binder_balance = e.account(binder(owner)).lamports;
    e.send(&[owed_ix(owner), close_binder_ix(owner)], &[&u])
        .unwrap();
    assert!(e.closed(binder(owner)));
    assert_eq!(e.account(owner).lamports, before + binder_balance);
    assert_eq!(e.account(owner).owner, addr(&onepercent::ID));
}

#[test]
fn t15_10_zero_payment_preserves_owed_and_allows_zero_balance() {
    for balance in [0, 1] {
        let (mut e, u, _) = fixture(0);
        let owner = pubkey(&u.pubkey());
        edit::<Binder>(&mut e, binder(owner), |b| b.sol_owed = 100_000);
        e.fund(owner, balance);
        let mut before = e.account(binder(owner));
        if balance == 0 {
            let tx = e.send(&[owed_ix(owner)], &[&u]).unwrap();
            let event = &events::<OwedWithdrawn>(&tx)[0];
            assert_eq!((event.amount, event.remaining), (0, 100_000));
            // Only successful dispatch normalizes this runtime metadata field.
            before.rent_epoch = u64::MAX;
        } else {
            unchanged_on_error(&mut e, &u, &[owed_ix(owner)], "PayeeBelowRent");
        }
        assert_eq!(e.account(binder(owner)), before);
        assert_eq!(e.svm.get_balance(&addr(&owner)).unwrap_or(0), balance);
    }
}

#[test]
fn t15_11_binder_account_validation_is_atomic_for_both_exits() {
    for close in [false, true] {
        for case in 0..7 {
            let (mut e, u, _) = fixture(0);
            let owner = pubkey(&u.pubkey());
            let at = binder(owner);
            e.mutate(at, |a| match case {
                0 => a.owner = addr(&system()),
                1 => a.owner = addr(&anchor_lang::prelude::Pubkey::new_unique()),
                2 => a.data[0] ^= 1,
                3 => write_key(&mut a.data, 8, &anchor_lang::prelude::Pubkey::new_unique()),
                4 => a.data[110] ^= 1,
                5 => a.data.truncate(111),
                _ => write_u16(&mut a.data, 106, 1),
            });
            let ix = if close {
                close_binder_ix(owner)
            } else {
                owed_ix(owner)
            };
            unchanged_on_error(&mut e, &u, &[ix], "AccountMismatch");
        }
    }
}
