mod common;
use common::*;
use onepercent::{
    params,
    state::{Binder, Machine, Pull},
};
use solana_signer::Signer;

fn setup() -> (Env, solana_keypair::Keypair, Bag) {
    let mut e = Env::new();
    e.inject_phase(3);
    e.inject_deck(1000);
    let mint = e.new_pump_mint(false);
    e.seed_bucket(0, &mint, 1, 1_000_000_000_000, 300_000_000_000);
    let user = e.user();
    (e, user, mint)
}
#[test]
fn t05_01_buy_og_x1() {
    let (mut e, user, _) = setup();
    let (pull, meta) = e.buy(&user, 0, 1).unwrap();
    let p = e.state::<Pull>(pull);
    assert_eq!(p.price, 100_000_000);
    assert_eq!(p.status, 1);
    assert_eq!(e.account(pull).lamports, e.rent_min(376) + p.price);
    let b = e.state::<Binder>(pda(&[b"binder", pubkey(&user.pubkey()).as_ref()]).0);
    assert_eq!((b.cap, b.reserved, b.pull_nonce), (5, 5, 1));
    let m = e.state::<Machine>(e.machine);
    assert_eq!(
        (
            m.buckets[0].reserved,
            m.reserved_dust,
            m.pending_pulls,
            m.next_seq
        ),
        (1_500_000_000, 4, 1, 2)
    );
    assert_eq!(read_u32(&e.account(e.queue).data, 0), 1);
    assert_eq!(e.account(e.queue).lamports, e.rent_min(65536) + 500_000);
    assert!(meta.logs.iter().any(|l| l.contains("Program data:")));
    e.check_invariants();
}
#[test]
fn t05_02_qty_limits() {
    for edition in 0..4 {
        let (mut e, user, _) = setup();
        let max = params::PACK_EDITIONS_MAX_PER_RIP[edition as usize] as u8;
        e.buy(&user, edition, max).unwrap();
        e.check_invariants();
        assert_error(e.buy(&user, edition, 0).map(|(_, m)| m), "InvalidQuantity");
        assert_error(
            e.buy(&user, edition, max + 1).map(|(_, m)| m),
            "InvalidQuantity",
        );
    }
}
#[test]
fn t05_03_coverage_greedy() {
    for enough in [false, true] {
        let (mut e, user, mint) = setup();
        e.seed_bucket(0, &mint, 1, 1_000_000_000_000, 15_000_000_000);
        let m2 = e.new_pump_mint(false);
        e.seed_bucket(
            1,
            &m2,
            1,
            1_000_000_000_000,
            if enough {
                15_000_000_000
            } else {
                14_900_000_000
            },
        );
        let m3 = e.new_pump_mint(false);
        e.seed_bucket(2, &m3, 2, 1_000_000_000_000, 100_000_000_000);
        let m4 = e.new_pump_mint(false);
        e.seed_bucket(3, &m4, 1, 1_000_000_000_000, 100_000_000_000);
        e.mutate(e.machine, |a| a.data[224 + 3 * 128 + 110] = 0);
        let r = e.buy(&user, 3, 2);
        if enough {
            let (p, _) = r.unwrap();
            let a = e.account(p);
            assert_eq!(a.data[176 + 192], 0);
            assert_eq!(a.data[376 + 192], 1);
            e.check_invariants();
        } else {
            assert_error(r.map(|(_, m)| m), "Refilling");
        }
    }
}
#[test]
fn t05_d12_one_unit_two_sol_refilling() {
    let (mut e, user, mint) = setup();
    e.seed_bucket(0, &mint, 1, 1, 2_000_000_000);
    assert_error(e.buy(&user, 0, 1).map(|(_, m)| m), "Refilling");
    assert_eq!(e.state::<Machine>(e.machine).pending_pulls, 0);
    e.check_invariants();
}
#[test]
fn t05_04_coverage_held_by_pending() {
    let (mut e, user, mint) = setup();
    e.seed_bucket(0, &mint, 1, 1_000_000_000_000, 30_000_000_000);
    let (p, _) = e.buy(&user, 3, 2).unwrap();
    assert_error(e.buy(&user, 3, 1).map(|(_, m)| m), "Refilling");
    e.warp(300);
    e.send(&[e.refund_ix(p)], &[]).unwrap();
    e.buy(&user, 3, 1).unwrap();
    e.check_invariants();
}
#[test]
fn t05_05_machine_hungry() {
    let (mut e, user, _) = setup();
    e.inject_deck(53);
    assert_error(e.buy(&user, 0, 1).map(|(_, m)| m), "MachineHungry");
}
#[test]
fn t05_06_phase_pause_time() {
    for (phase, expired, paused, error) in [
        (2, false, false, "WrongPhase"),
        (3, true, false, "SeasonOver"),
        (3, false, true, "Paused"),
    ] {
        let (mut e, user, _) = setup();
        e.inject_phase(phase);
        if expired {
            let now = e.now();
            e.mutate(e.machine, |a| write_u64(&mut a.data, 56, now as u64));
        }
        if paused {
            e.mutate(e.config, |a| a.data[740] = 1);
        }
        assert_error(e.buy(&user, 0, 1).map(|(_, m)| m), error);
    }
}
#[test]
fn t05_07_team_and_non_wallet() {
    let (mut e, user, _) = setup();
    let owner = pubkey(&user.pubkey());
    e.mutate(e.config, |a| write_key(&mut a.data, 296, &owner));
    assert_error(e.buy(&user, 0, 1).map(|(_, m)| m), "TeamWallet");
    e.mutate(e.config, |a| write_key(&mut a.data, 296, &system()));
    e.mutate(owner, |a| a.owner = addr(&onepercent::ID));
    assert_error(e.buy(&user, 0, 1).map(|(_, m)| m), "NotWallet");
}
#[test]
fn t05_08_queue_rules() {
    let (mut e, user, _) = setup();
    let other = anchor_lang::prelude::Pubkey::new_unique();
    let old = e.queue;
    let account = e.account(old);
    e.put(other, account);
    e.queue = other;
    assert_error(e.buy(&user, 0, 1).map(|(_, m)| m), "QueueNotAllowed");
    e.mutate(e.config, |a| write_key(&mut a.data, 616, &other));
    assert_error(e.buy(&user, 0, 1).map(|(_, m)| m), "QueueNotAllowed");
    let signer =
        solana_keypair::Keypair::new_from_array(e.guardian.to_bytes()[..32].try_into().unwrap());
    e.send(&[e.guardian_ix(vec![4, 1])], &[&signer]).unwrap();
    e.buy(&user, 0, 1).unwrap();
    e.check_invariants();
}
#[test]
fn t05_09_live_flags_m1() {
    let (mut e, user, _) = setup();
    let mut ix = e.buy_ix(pubkey(&user.pubkey()), 0, 1, 0, None);
    ix.data[14] = 4;
    assert_error(e.send(&[ix], &[&user]), "LiveFlagsChanged");
}
#[test]
fn t05_10_referral_binding() {
    let (mut e, user, _) = setup();
    let owner = pubkey(&user.pubkey());
    let first = anchor_lang::prelude::Pubkey::new_unique();
    let second = anchor_lang::prelude::Pubkey::new_unique();
    for (nonce, referrer) in [(0, first), (1, second), (2, owner)] {
        e.send(&[e.buy_ix(owner, 0, 1, nonce, Some(referrer))], &[&user])
            .unwrap();
        assert_eq!(
            e.state::<Binder>(pda(&[b"binder", owner.as_ref()]).0)
                .referrer,
            first
        );
    }
    e.check_invariants();
}
#[test]
fn t05_11_holder_attestation() {
    for (expired, disabled, wrong) in [
        (false, false, false),
        (true, false, false),
        (false, true, false),
        (false, false, true),
    ] {
        let (mut e, user, _) = setup();
        let owner = pubkey(&user.pubkey());
        let expiry = if expired { e.now() - 1 } else { e.now() + 590 };
        let mut msg = params::ATTESTATIONS_HOLD_DOMAIN.to_vec();
        msg.extend_from_slice(onepercent::ID.as_ref());
        msg.extend_from_slice(owner.as_ref());
        msg.extend_from_slice(&expiry.to_le_bytes());
        if wrong {
            msg[12] ^= 1;
        }
        let att = e.attest_ix(&msg);
        let mut buy = e.buy_ix(owner, 0, 1, 0, None);
        buy.data.pop();
        buy.data.push(1);
        buy.data.extend_from_slice(&expiry.to_le_bytes());
        buy.data.push(0);
        if disabled {
            e.mutate(e.config, |a| a.data[742] |= 1 << 5);
        }
        let r = e.send(&[att, buy], &[&user]);
        if expired {
            assert_error(r, "AttestationExpired");
        } else if disabled {
            assert_error(r, "RoleDisabled");
        } else if wrong {
            assert_error(r, "AttestationInvalid");
        } else {
            r.unwrap();
            let p = pda(&[b"pull", owner.as_ref(), &0u32.to_le_bytes()]).0;
            assert_eq!(e.state::<Pull>(p).holder, 1);
            e.check_invariants();
        }
    }
}
#[test]
fn t05_12_pull_nonce_and_prefunded_pull() {
    let (mut e, user, _) = setup();
    let owner = pubkey(&user.pubkey());
    let p = pda(&[b"pull", owner.as_ref(), &0u32.to_le_bytes()]).0;
    e.donate_lamports(p, 1);
    e.buy(&user, 0, 1).unwrap();
    assert!(e.send(&[e.buy_ix(owner, 0, 1, 0, None)], &[&user]).is_err());
    e.check_invariants();
}
#[test]
fn t05_13_binder_reuse() {
    let (mut e, user, _) = setup();
    let owner = pubkey(&user.pubkey());
    let b = e.binder(owner, &[], 0, 5);
    let before = e.account(b).lamports;
    e.buy(&user, 0, 1).unwrap();
    assert_eq!(e.account(b).lamports, before);
    e.check_invariants();
}
#[test]
fn t05_14_binder_full() {
    let (mut e, user, _) = setup();
    let owner = pubkey(&user.pubkey());
    let b = e.binder(owner, &[], 0, 65533);
    e.mutate(b, |a| write_u16(&mut a.data, 104, 65533));
    assert_error(e.buy(&user, 0, 1).map(|(_, m)| m), "BinderFull");
}
#[test]
fn t05_15_concurrent_buyers_no_race() {
    let (mut e, _, _) = setup();
    let buyers: Vec<_> = (0..20).map(|_| e.user()).collect();
    for (index, buyer) in buyers.iter().enumerate() {
        let (p, _) = e.buy(buyer, 0, 1).unwrap();
        assert_eq!(e.state::<Pull>(p).seq, index as u64 + 1);
        e.check_invariants();
    }
}

#[test]
fn t05_10_referral_cannot_bind_after_reveal_or_to_self() {
    let (mut e, user, _) = setup();
    let who = pubkey(&user.pubkey());
    let ix = e.buy_ix(who, 0, 1, 0, Some(who));
    e.send(&[ix], &[&user]).unwrap();
    let b = pda(&[b"binder", who.as_ref()]).0;
    assert_eq!(e.state::<Binder>(b).referrer, system());
    let p = pda(&[b"pull", who.as_ref(), &0u32.to_le_bytes()]).0;
    e.fulfill(p, [2; 32]).unwrap();
    e.send(
        &[e.buy_ix(
            who,
            0,
            1,
            1,
            Some(anchor_lang::prelude::Pubkey::new_unique()),
        )],
        &[&user],
    )
    .unwrap();
    assert_eq!(e.state::<Binder>(b).referrer, system());
    e.check_invariants();
}
#[test]
fn t05_13_binder_three_cards_two_free_slots() {
    let (mut e, user, _) = common::pack_cases::card_fixture(false, 3);
    e.inject_phase(3);
    e.inject_deck(100);
    let hit = e.new_pump_mint(false);
    e.seed_bucket(0, &hit, 1, 1_000_000_000_000, 30_000_000_000);
    let who = pubkey(&user.pubkey());
    let b = pda(&[b"binder", who.as_ref()]).0;
    let mut h = e.state::<Binder>(b);
    h.cap = 5;
    let mut tail = e.account(b).data[112..].to_vec();
    tail.resize(56 * 5, 0);
    e.set_state(b, &h, &tail, 0);
    let before = e.account(b).lamports;
    e.buy(&user, 0, 1).unwrap();
    assert_eq!(
        e.account(b).lamports - before,
        e.rent_min(56 * 3) - e.rent_min(0)
    );
    assert_eq!(e.state::<Binder>(b).cap, 8);
    e.check_invariants();
}
