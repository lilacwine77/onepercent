mod common;
use common::{pack_cases::*, *};
use onepercent::state::{Binder, Machine, Pull};
use solana_signer::Signer;
#[test]
fn t08_01_too_early() {
    for mainnet in [false, true] {
        let (mut e, u, _, _) = setup(mainnet);
        let (p, _) = e.buy(&u, 0, 1).unwrap();
        e.warp(299);
        assert_error(e.send(&[e.refund_ix(p)], &[]), "TooEarlyToRefund");
        e.check_invariants();
    }
}
#[test]
fn t08_02_full_refund_after_timeout() {
    for mainnet in [false, true] {
        let (mut e, u, _, _) = setup(mainnet);
        let who = pubkey(&u.pubkey());
        let before = e.account(who).lamports;
        let (p, _) = e.buy(&u, 0, 10).unwrap();
        let q = e.account(e.queue).lamports;
        e.warp(300);
        e.send(&[e.refund_ix(p)], &[]).unwrap();
        assert!(e.closed(p));
        let b = e.state::<Binder>(binder(who));
        assert_eq!((b.len, b.cap, b.reserved), (0, 0, 0));
        assert_eq!(e.account(who).lamports, before - 500_000 - e.rent_min(112));
        assert_eq!(e.account(e.queue).lamports, q);
        let m = e.state::<Machine>(e.machine);
        assert_eq!(
            (m.pending_pulls, m.reserved_dust, m.buckets[0].reserved),
            (0, 0, 0)
        );
        e.check_invariants();
    }
}
#[test]
fn t08_03_noop_cases() {
    for mainnet in [false, true] {
        let (mut e, u, _, _) = setup(mainnet);
        let (p, _) = e.buy(&u, 0, 1).unwrap();
        let ix = e.refund_ix(p);
        e.fulfill(p, [1; 32]).unwrap();
        let before = e.account(p);
        e.send(&[ix], &[]).unwrap();
        assert_eq!(e.account(p), before);
        let (p, _) = e.buy(&u, 0, 1).unwrap();
        let ix = e.refund_ix(p);
        let cb = e.raw_fulfill_ix(p, [1; 32], e.state::<Pull>(p).seq, false);
        e.warp(300);
        e.send(&[ix.clone()], &[]).unwrap();
        e.send(&[ix], &[]).unwrap();
        e.send(&[cb], &[]).unwrap();
        e.check_invariants();
    }
}
#[test]
fn t08_04_any_phase_all_paused() {
    for mainnet in [false, true] {
        for phase in 0..=6 {
            let (mut e, u, _, _) = setup(mainnet);
            let (p, _) = e.buy(&u, 0, 1).unwrap();
            e.inject_phase(phase);
            pause_all(&mut e);
            e.warp(300);
            e.send(&[e.refund_ix(p)], &[]).unwrap();
            e.check_invariants();
        }
    }
}
#[test]
fn t08_05_expiries_never_pause() {
    for mainnet in [false, true] {
        let (mut e, u, _, _) = setup(mainnet);
        let pulls: Vec<_> = (0..10).map(|_| e.buy(&u, 0, 1).unwrap().0).collect();
        e.warp(301);
        for p in pulls {
            e.send(&[e.refund_ix(p)], &[]).unwrap();
        }
        e.buy(&u, 0, 1).unwrap();
        e.check_invariants();
    }
}
#[test]
fn t08_06_refund_program_buyer() {
    for mainnet in [false, true] {
        for program in [false, true] {
            let (mut e, u, _, _) = setup(mainnet);
            let who = pubkey(&u.pubkey());
            let (p, _) = e.buy(&u, 0, 1).unwrap();
            let pull_lamports = e.account(p).lamports;
            let b = binder(who);
            let binder_lamports = e.account(b).lamports;
            e.warp(300);
            if program {
                e.make_program(who);
            }
            let mut ix = e.refund_ix(p);
            ix.accounts[3].is_writable = false;
            let before = e.state::<Machine>(e.machine).stock_sol;
            let result = e.send(&[ix], &[]);
            if program {
                result.unwrap();
                assert_eq!(
                    e.state::<Machine>(e.machine).stock_sol,
                    before + pull_lamports
                );
                assert_eq!(e.account(b).lamports, binder_lamports);
                assert_eq!(e.state::<Binder>(b).reserved, 0);
                e.check_invariants();
            } else {
                assert_error(result, "AccountMismatch");
            }
        }
    }
}

#[test]
#[allow(deprecated)]
fn t08_07_empty_buyer_requires_writable() {
    for mainnet in [false, true] {
        let (mut e, user, _, _) = setup(mainnet);
        let buyer = pubkey(&user.pubkey());
        let (pull, _) = e.buy(&user, 0, 1).unwrap();
        let donation = anchor_lang::solana_program::system_instruction::transfer(
            &pubkey(&e.authority.pubkey()),
            &pull,
            5_000_000_000,
        );
        e.send(&[ix(donation)], &[]).unwrap();
        e.fund(buyer, 0);
        e.warp(300);
        let b = binder(buyer);
        let before = [e.account(pull), e.account(e.machine), e.account(b)];
        let economics_before = e.state::<Machine>(e.machine);
        let expected = before[0].lamports + before[2].lamports - e.rent_min(112);
        let mut ix = e.refund_ix(pull);
        ix.accounts[3].is_writable = false;
        assert_error(e.send(&[ix.clone()], &[]), "AccountMismatch");
        assert_eq!(
            [e.account(pull), e.account(e.machine), e.account(b)],
            before
        );
        assert_eq!(e.svm.get_balance(&addr(&buyer)).unwrap_or(0), 0);
        ix.accounts[3].is_writable = true;
        e.send(&[ix], &[]).unwrap();
        assert!(e.closed(pull));
        assert_eq!(e.account(buyer).lamports, expected);
        let economics_after = e.state::<Machine>(e.machine);
        assert_eq!(
            (economics_after.stock_sol, economics_after.team_sol),
            (economics_before.stock_sol, economics_before.team_sol)
        );
        e.check_invariants();
    }
}
