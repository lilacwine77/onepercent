mod common;
use common::{pack_cases::*, *};
use onepercent::state::Binder;
use solana_signer::Signer;
#[test]
fn t09_01_redeem_dust_and_hit() {
    for t22 in [false, true] {
        for kind in 0..=4 {
            let (mut e, u, bag) = card_fixture(t22, 1);
            let who = pubkey(&u.pubkey());
            e.mutate(binder(who), |a| a.data[112 + 48] = kind);
            let before = e.account(who).lamports;
            e.send(&[e.redeem_ix(who, &bag, 0, 1000)], &[&u]).unwrap();
            assert_eq!(
                read_u64(
                    &e.account(ata(&who, &bag.mint, &bag.token_program)).data,
                    64
                ),
                1000
            );
            assert_eq!(
                e.account(who).lamports,
                before + e.rent_min(168) - e.rent_min(112)
            );
            e.check_invariants();
        }
    }
}
#[test]
fn t09_02_eight_in_one_tx_descending() {
    let (mut e, u, bag) = card_fixture(false, 8);
    let who = pubkey(&u.pubkey());
    let ixs: Vec<_> = (0..8)
        .rev()
        .map(|i| e.redeem_ix(who, &bag, i, 1000))
        .collect();
    e.send(&ixs, &[&u]).unwrap();
    assert_eq!(e.state::<Binder>(binder(who)).len, 0);
    e.check_invariants();
}
#[test]
fn t09_03_stale_or_foreign() {
    let (mut e, u, bag) = card_fixture(false, 1);
    let who = pubkey(&u.pubkey());
    for (index, amount) in [(1, 1000), (0, 1001)] {
        assert_error(
            e.send(&[e.redeem_ix(who, &bag, index, amount)], &[&u]),
            "CardMoved",
        );
    }
    let other = e.user();
    let mut ix = e.redeem_ix(who, &bag, 0, 1000);
    ix.accounts[0] = meta(pubkey(&other.pubkey()), true, true);
    assert!(e.send(&[ix], &[&other]).is_err());
    e.check_invariants();
}
#[test]
fn t09_04_any_phase_all_paused() {
    for phase in 0..=6 {
        let (mut e, u, bag) = card_fixture(false, 1);
        e.inject_phase(phase);
        pause_all(&mut e);
        e.send(&[e.redeem_ix(pubkey(&u.pubkey()), &bag, 0, 1000)], &[&u])
            .unwrap();
        e.check_invariants();
    }
}
#[test]
fn t09_05_rent_increase_no_shrink() {
    let (mut e, u, bag) = card_fixture(false, 8);
    let who = pubkey(&u.pubkey());
    let before = e.account(binder(who)).data.len();
    e.set_rent(6960);
    e.send(&[e.redeem_ix(who, &bag, 7, 1000)], &[&u]).unwrap();
    assert_eq!(e.account(binder(who)).data.len(), before);
    e.check_invariants();
}
#[test]
fn t09_06_redeem_all_leaves_binder_tight() {
    let (mut e, u, bag) = card_fixture(false, 8);
    let who = pubkey(&u.pubkey());
    for index in (0..8).rev() {
        e.send(&[e.redeem_ix(who, &bag, index, 1000)], &[&u])
            .unwrap();
    }
    let b = e.state::<Binder>(binder(who));
    assert_eq!(b.cap, b.reserved);
    assert_eq!(e.account(binder(who)).lamports, e.rent_min(112));
    e.check_invariants();
}
#[test]
fn t09_07_non_canonical_destination() {
    let (mut e, u, bag) = card_fixture(false, 1);
    let other = e.user();
    let dst = e.token_account(pubkey(&other.pubkey()), &bag, 0);
    let mut ix = e.redeem_ix(pubkey(&u.pubkey()), &bag, 0, 1000);
    ix.accounts[6] = meta(dst, true, false);
    assert!(e.send(&[ix], &[&u]).is_err());
    e.check_invariants();
}
#[test]
fn t09_08_every_kind_redeemable() {
    for kind in 5..=9 {
        let (mut e, u, bag) = card_fixture(false, 1);
        let who = pubkey(&u.pubkey());
        e.mutate(binder(who), |a| a.data[112 + 48] = kind);
        let r = e.send(&[e.redeem_ix(who, &bag, 0, 1000)], &[&u]);
        if kind == 9 {
            assert_error(r, "CardNotRedeemable")
        } else {
            r.unwrap();
            e.check_invariants();
        }
    }
}
