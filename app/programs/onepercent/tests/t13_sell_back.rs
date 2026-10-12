mod common;
#[path = "common/mycards.rs"]
mod mycards;
use common::{pack_cases::*, *};
use mycards::*;
use onepercent::{constants::MAX_SELL_BACK_CARDS, events::SoldBack, params, state::*};
use solana_signer::Signer;

#[test]
fn t13_01_payout_exact() {
    for (value, quote, payout) in [
        (50_000_000, 49_999_999, 43_499_999),
        (50_000_000, 60_000_000, 43_500_000),
        (1_500_000_000, 1_400_000_001, 1_218_000_000),
        (15_000_000_000, 15_000_000_000, 13_050_000_000),
        (2, 2, 1),
        (10, 10, 8),
        (100, 99, 86),
        (101, 101, 87),
        (9999, 10000, 8699),
        (10000, 10000, 8700),
        (10001, 10001, 8700),
        (1_000_001, 999_999, 869_999),
    ] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        e.mutate(binder(owner), |a| write_u64(&mut a.data, 152, value));
        let before = e.state::<Machine>(e.machine);
        let wallet = e.account(owner).lamports;
        let ledger = e.account(pda(&[b"ledger", bag.mint.as_ref()]).0);
        let vault = e.account(ata(&e.vault_auth, &bag.mint, &bag.token_program));
        let slot_refund = e.rent_min(168) - e.rent_min(112);
        let tx = e
            .send(&sb_ixs(&e, owner, &bag, &[0], quote), &[&u])
            .unwrap();
        let after = e.state::<Machine>(e.machine);
        let events = events::<SoldBack>(&tx);
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(
            (
                event.payout,
                event.value,
                event.stocked_value,
                event.slot_refund
            ),
            (payout, value.min(quote), value, slot_refund)
        );
        assert_eq!(
            (
                event.owner,
                event.mint,
                event.n,
                event.total_amount,
                event.nonce
            ),
            (owner, bag.mint, 1, 1000, 0)
        );
        assert_eq!(after.buckets[0].amount, before.buckets[0].amount + 1000);
        assert_eq!(
            after.buckets[0].cost,
            before.buckets[0].cost + value.min(quote)
        );
        assert_eq!(after.stock_sol, before.stock_sol - value.min(quote));
        assert_eq!(after.team_sol, before.team_sol + value.min(quote) - payout);
        assert_eq!(after.sb_paid_hour, payout);
        assert_eq!(after.bucket_history[0].sb_inflow_hour, value.min(quote));
        let history = common::pack_cases::events::<onepercent::events::SellHistoryUpdated>(&tx);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].sb_paid_hour, payout);
        assert_eq!(history[0].sb_inflow_hour, value.min(quote));
        assert_eq!(e.account(owner).lamports, wallet + payout + slot_refund);
        assert_eq!(
            (
                e.state::<Binder>(binder(owner)).len,
                e.state::<Binder>(binder(owner)).sb_nonce
            ),
            (0, 1)
        );
        assert_eq!(e.account(pda(&[b"ledger", bag.mint.as_ref()]).0), ledger);
        assert_eq!(
            e.account(ata(&e.vault_auth, &bag.mint, &bag.token_program)),
            vault
        );
    }
    let (mut e, u, bag) = fixture(1);
    let owner = pubkey(&u.pubkey());
    e.mutate(binder(owner), |a| write_u64(&mut a.data, 152, 1));
    let ixs = sb_ixs(&e, owner, &bag, &[0], 1);
    unchanged_on_error(&mut e, &u, &ixs, "InvalidArgument");
}

#[test]
fn t13_02_quote_vs_value() {
    for quote in [25_000_000, 100_000_000] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let value = cards(&e, owner)[0].value;
        let result = e
            .send(&sb_ixs(&e, owner, &bag, &[0], quote), &[&u])
            .unwrap();
        assert_eq!(events::<SoldBack>(&result)[0].value, value.min(quote));
    }
}

#[test]
fn t13_03_eight_descending() {
    assert_eq!(
        MAX_SELL_BACK_CARDS, 8,
        "P0 TX_LIMITS.redeemPerTx parity pin"
    );
    for indices in [
        vec![0, 1],
        vec![1, 1],
        vec![1, 3, 2],
        (0..9).rev().collect(),
        vec![],
    ] {
        let (mut e, u, bag) = fixture(9);
        let owner = pubkey(&u.pubkey());
        let ixs = sb_ixs(&e, owner, &bag, &indices, 1_000_000_000);
        unchanged_on_error(&mut e, &u, &ixs, "InvalidArgument");
    }
    let (mut e, u, bag) = fixture(9);
    let owner = pubkey(&u.pubkey());
    let tx = e
        .send(
            &sb_ixs(
                &e,
                owner,
                &bag,
                &(0..8).rev().collect::<Vec<_>>(),
                1_000_000_000,
            ),
            &[&u],
        )
        .unwrap();
    assert_eq!(events::<SoldBack>(&tx)[0].n, 8);
    assert_eq!(cards(&e, owner).len(), 1);
    assert_eq!(cards(&e, owner)[0].amount, 1000);
}

#[test]
fn t13_04_kinds_and_mints() {
    for kind in [0, 5, 6, 7, 8] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        e.mutate(binder(owner), |a| a.data[160] = kind);
        let ixs = sb_ixs(&e, owner, &bag, &[0], 50_000_000);
        unchanged_on_error(&mut e, &u, &ixs, "NotSellBackable");
    }
    for mismatch in 0..3 {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let mut ixs = sb_ixs(&e, owner, &bag, &[0], 50_000_000);
        match mismatch {
            0 => e.mutate(binder(owner), |a| {
                write_key(
                    &mut a.data,
                    112,
                    &anchor_lang::prelude::Pubkey::new_unique(),
                )
            }),
            1 => e.mutate(binder(owner), |a| write_u64(&mut a.data, 144, 1001)),
            _ => {
                let mut selected = selected(&e, owner, &[0]);
                selected[0].index = 1;
                ixs[1] = sb_ix(&e, owner, &bag, selected, 50_000_000, e.now(), 0);
            }
        }
        unchanged_on_error(&mut e, &u, &ixs, "CardMoved");
    }
}

#[test]
fn t13_05_attestation() {
    // Every signed message region is independently changed while retaining a valid Ed25519 signature.
    for offset in [0, 9, 41, 73, 105, 106, 108, 116, 124, 132, 140, 144] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let selected = selected(&e, owner, &[0]);
        let mut message = sb_message(owner, bag.mint, &selected, 50_000_000, e.now(), 0);
        message[offset] ^= 1;
        let ixs = vec![
            e.attest_ix(&message),
            sb_ix(&e, owner, &bag, selected, 50_000_000, e.now(), 0),
        ];
        unchanged_on_error(&mut e, &u, &ixs, "AttestationInvalid");
    }
    let (mut e, u, bag) = fixture(1);
    let owner = pubkey(&u.pubkey());
    let config = e.config;
    edit::<Config>(&mut e, config, |c| {
        c.quote_signer = anchor_lang::prelude::Pubkey::new_unique()
    });
    let ixs = sb_ixs(&e, owner, &bag, &[0], 50_000_000);
    unchanged_on_error(&mut e, &u, &ixs, "AttestationInvalid");
    for (class, ttl) in [
        (1, params::SELL_BACK_QUOTE_TTL_SECONDS_MAJOR),
        (2, params::SELL_BACK_QUOTE_TTL_SECONDS_TRENDING),
    ] {
        for delta in [-1, 0, ttl, ttl + 1] {
            let (mut e, u, bag) = fixture(1);
            let owner = pubkey(&u.pubkey());
            let machine = e.machine;
            edit::<Machine>(&mut e, machine, |m| m.buckets[0].class = class);
            let selected = selected(&e, owner, &[0]);
            let expiry = e.now() + delta;
            let ixs = vec![
                e.attest_ix(&sb_message(
                    owner, bag.mint, &selected, 50_000_000, expiry, 0,
                )),
                sb_ix(&e, owner, &bag, selected, 50_000_000, expiry, 0),
            ];
            if delta < 0 || delta > ttl {
                unchanged_on_error(&mut e, &u, &ixs, "AttestationExpired");
            } else {
                e.send(&ixs, &[&u]).unwrap();
            }
        }
    }
    for nonce in [0, 2] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        edit::<Binder>(&mut e, binder(owner), |b| b.sb_nonce = 1);
        let selected = selected(&e, owner, &[0]);
        let ixs = vec![
            e.attest_ix(&sb_message(
                owner,
                bag.mint,
                &selected,
                50_000_000,
                e.now(),
                nonce,
            )),
            sb_ix(&e, owner, &bag, selected, 50_000_000, e.now(), nonce),
        ];
        unchanged_on_error(&mut e, &u, &ixs, "AttestationReplay");
    }
}

#[test]
fn t13_06_limits_boundaries() {
    let value = 50_000_000;
    let payout = u64::try_from(
        u128::from(value) * u128::from(params::SELL_BACK_PAYOUT_BPS)
            / u128::from(params::BPS_DENOMINATOR),
    )
    .unwrap();
    for deficit in [0, 1] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let machine = e.machine;
        edit::<Machine>(&mut e, machine, |m| {
            m.stock_sol = params::SELL_BACK_SOL_FLOOR_LAMPORTS + payout - deficit;
            m.sol_at_hour_start = m.stock_sol;
        });
        fund_machine(&mut e);
        let ixs = sb_ixs(&e, owner, &bag, &[0], value);
        if deficit == 0 {
            e.send(&ixs, &[&u]).unwrap();
            assert_eq!(
                e.state::<Machine>(e.machine).stock_sol,
                params::SELL_BACK_SOL_FLOOR_LAMPORTS
            );
        } else {
            unchanged_on_error(&mut e, &u, &ixs, "SellBackFloor");
        }
    }
    for start in [10_000_000_000, 100_000_000_000] {
        for over in [0, 1] {
            let (mut e, u, bag) = fixture(1);
            let owner = pubkey(&u.pubkey());
            let machine = e.machine;
            let cap = params::SELL_BACK_HOURLY_BUDGET_MIN_LAMPORTS.max(
                u64::try_from(
                    u128::from(start)
                        * u128::from(params::SELL_BACK_HOURLY_BUDGET_BPS_OF_STOCK_SOL)
                        / u128::from(params::BPS_DENOMINATOR),
                )
                .unwrap(),
            );
            edit::<Machine>(&mut e, machine, |m| {
                m.sol_at_hour_start = start;
                m.sb_paid_hour = cap - payout + over;
                m.bucket_history[0].sb_inflow_hour = 123;
            });
            let ixs = sb_ixs(&e, owner, &bag, &[0], value);
            if over == 0 {
                e.send(&ixs, &[&u]).unwrap();
            } else {
                unchanged_on_error(&mut e, &u, &ixs, "SellBackBudget");
                e.warp(3600);
                e.send(&sb_ixs(&e, owner, &bag, &[0], value), &[&u])
                    .unwrap();
                let after = e.state::<Machine>(e.machine);
                assert_eq!(after.sb_paid_hour, payout);
                assert_eq!(after.sb_paid_prev_hour, cap - payout + over);
                assert_eq!(after.bucket_history[0].sb_inflow_prev_hour, 123);
                assert_eq!(after.bucket_history[0].sb_inflow_hour, value);
            }
        }
    }
    for short in [0, 1] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let machine = e.machine;
        edit::<Machine>(&mut e, machine, |m| {
            m.buckets[0].cap = m.buckets[0].cost + value - short
        });
        let ixs = sb_ixs(&e, owner, &bag, &[0], value);
        if short == 0 {
            e.send(&ixs, &[&u]).unwrap();
        } else {
            unchanged_on_error(&mut e, &u, &ixs, "BucketCapExceeded");
        }
    }
}

#[test]
fn t13_07_fill_first() {
    for delta in [-1i64, 0, 1] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let machine = e.machine;
        edit::<Machine>(&mut e, machine, |m| {
            m.stock_sol = (params::STOCK_TARGET_BASE_LAMPORTS as i64 + delta
                - m.buckets[0].cost as i64) as u64;
            m.sol_at_hour_start = m.stock_sol;
        });
        fund_machine(&mut e);
        let tx = e
            .send(&sb_ixs(&e, owner, &bag, &[0], 50_000_000), &[&u])
            .unwrap();
        assert_eq!(
            events::<SoldBack>(&tx)[0].to_team,
            if delta < 0 { 0 } else { 6_500_000 }
        );
    }
}

#[test]
fn t13_08_gates() {
    for (mode, error) in [
        (0, "WrongPhase"),
        (1, "SeasonOver"),
        (2, "Paused"),
        (3, "RoleDisabled"),
        (4, "BucketDisabled"),
        (5, "ExecInFlight"),
    ] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let machine = e.machine;
        let config = e.config;
        let now = e.now();
        match mode {
            0 => e.inject_phase(2),
            1 => edit::<Machine>(&mut e, machine, |m| m.end_ts = now),
            2 => edit::<Config>(&mut e, config, |c| {
                c.admin_paused = params::PAUSE_BITS_SELL_BACK
            }),
            3 => edit::<Config>(&mut e, config, |c| c.disabled_roles = 1 << 6),
            4 => edit::<Machine>(&mut e, machine, |m| m.buckets[0].enabled = 0),
            _ => edit::<Machine>(&mut e, machine, |m| m.exec.kind = 1),
        }
        let ixs = sb_ixs(&e, owner, &bag, &[0], 50_000_000);
        unchanged_on_error(&mut e, &u, &ixs, error);
    }
}

#[test]
fn t13_09_i1_check() {
    let (mut e, u, bag) = fixture(1);
    let owner = pubkey(&u.pubkey());
    let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
    e.mutate(vault, |a| write_u64(&mut a.data, 64, 0));
    let ixs = sb_ixs(&e, owner, &bag, &[0], 50_000_000);
    unchanged_on_error(&mut e, &u, &ixs, "VaultInvariant");
}

#[test]
fn t13_10_i12() {
    let (mut e, u, bag) = fixture(8);
    let owner = pubkey(&u.pubkey());
    for index in (0..8).rev() {
        let tx = e
            .send(&sb_ixs(&e, owner, &bag, &[index], 100_000_000), &[&u])
            .unwrap();
        let event = &events::<SoldBack>(&tx)[0];
        let m = e.state::<Machine>(e.machine);
        assert!(
            u128::from(event.payout) * u128::from(params::BPS_DENOMINATOR)
                <= u128::from(event.stocked_value) * u128::from(params::SELL_BACK_PAYOUT_BPS)
        );
        assert!(m.stock_sol >= params::SELL_BACK_SOL_FLOOR_LAMPORTS);
        assert!(
            u128::from(m.sb_paid_hour)
                <= u128::from(params::SELL_BACK_HOURLY_BUDGET_MIN_LAMPORTS).max(
                    u128::from(m.sol_at_hour_start)
                        * u128::from(params::SELL_BACK_HOURLY_BUDGET_BPS_OF_STOCK_SOL)
                        / u128::from(params::BPS_DENOMINATOR),
                )
        );
        assert_eq!(m.exec.kind, 0);
    }
}

#[test]
fn t13_report_cu() {
    Env::deterministic_bench_signers(20261009);
    for n in [1, 8] {
        let (mut max_cu, mut max_bytes) = (0, 0);
        for sample in 0..32 {
            let (mut e, u, bag) = measurement_fixture(n, sample % 2 != 0, sample as u64);
            let owner = pubkey(&u.pubkey());
            if sample % 4 >= 2 {
                let machine = e.machine;
                edit::<Machine>(&mut e, machine, |m| m.buckets[0].reserved = 1);
            }
            e.donate_lamports(binder(owner), u64::try_from(sample).unwrap());
            let mut ixs = sb_ixs(
                &e,
                owner,
                &bag,
                &(0..n as u16).rev().collect::<Vec<_>>(),
                1_000_000_000,
            );
            *ixs.last_mut().unwrap().data.last_mut().unwrap() = 2;
            let (cu, bytes) = measure(&mut e, &u, ixs);
            max_cu = max_cu.max(cu);
            max_bytes = max_bytes.max(bytes);
        }
        println!("P2 CASE sell_back x{n} normal: max_cu={max_cu}, samples=32");
        for token_2022 in [false, true] {
            for large_binder in [false, true] {
                let count = if large_binder {
                    usize::from(u16::MAX)
                } else {
                    n
                };
                let (mut e, u, bag) = measurement_fixture(count, token_2022, 1000 + n as u64);
                let owner = pubkey(&u.pubkey());
                let machine = e.machine;
                edit::<Machine>(&mut e, machine, |m| {
                    let last = m.buckets.len() - 1;
                    m.buckets[last] = m.buckets[0];
                    for (index, bucket) in m.buckets[..last].iter_mut().enumerate() {
                        *bucket = bytemuck::Zeroable::zeroed();
                        bucket.class = 1;
                        bucket.enabled = 1;
                        bucket.mint = anchor_lang::prelude::Pubkey::new_from_array(
                            [u8::try_from(index + 1).unwrap(); 32],
                        );
                    }
                    m.buckets[last].reserved = 1;
                    m.hour_index -= 1;
                });
                let mut ixs = sb_ixs(
                    &e,
                    owner,
                    &bag,
                    &(0..n as u16).rev().collect::<Vec<_>>(),
                    1_000_000_000,
                );
                *ixs.last_mut().unwrap().data.last_mut().unwrap() = 2;
                let (cu, bytes) = measure(&mut e, &u, ixs);
                println!(
                    "P2 CASE sell_back x{n} last_bucket_reserved_rollover: token2022={token_2022}, binder_cards={count}, cu={cu}, bytes={bytes}"
                );
                max_cu = max_cu.max(cu);
                max_bytes = max_bytes.max(bytes);
            }
        }
        println!(
            "P2 REPORT sell_back x{n}: max_cu={max_cu}, max_bytes={max_bytes}, recommended_cu={}",
            (max_cu * 125).div_ceil(100_000) * 1000
        );
    }
}

#[test]
fn t13_11_d12_pending_og_survives_old_ah_black_return() {
    let (mut e, u, bag) = fixture(1);
    let owner = pubkey(&u.pubkey());
    let ah_black =
        onepercent::math::tier_value(params::PACK_EDITIONS_PRICE_LAMPORTS[3], 4).unwrap();
    let og_coverage =
        onepercent::math::coverage_need(params::PACK_EDITIONS_PRICE_LAMPORTS[0]).unwrap();
    assert_eq!((ah_black, og_coverage), (15_000_000_000, 1_500_000_000));
    e.mutate(binder(owner), |a| {
        write_u64(&mut a.data, 144, 30);
        write_u64(&mut a.data, 152, ah_black);
        a.data[160] = 4;
        a.data[161] = 3;
    });
    let machine = e.machine;
    edit::<Machine>(&mut e, machine, |m| {
        m.buckets[0].amount = 30;
        m.buckets[0].cost = og_coverage;
    });
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    edit::<MintLedger>(&mut e, ledger, |l| l.accounted = 60);
    let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
    e.mutate(vault, |a| write_u64(&mut a.data, 64, 60));
    e.mutate(bag.mint, |a| write_u64(&mut a.data, 36, 60));
    seed_refed(&mut e, owner, &bag, 100);
    let buyer = e.user();
    let (pull, _) = e.buy(&buyer, 0, 1).unwrap();
    e.check_invariants();
    assert_eq!(e.state::<Machine>(machine).buckets[0].reserved, og_coverage);
    let ixs = sb_ixs(&e, owner, &bag, &[0], ah_black);
    unchanged_on_error(&mut e, &u, &ixs, "ReservedCapacity");
    assert_eq!(e.state::<Binder>(binder(owner)).sb_nonce, 0);
    assert_eq!(e.state::<Pull>(pull).status, 1);
    e.check_invariants();
    // Once no coverage remains reserved, the same economic return is admissible.
    e.warp(params::VRF_TIMEOUT_SECONDS + 1);
    e.send(&[e.refund_ix(pull)], &[]).unwrap();
    e.send(&sb_ixs(&e, owner, &bag, &[0], ah_black), &[&u])
        .unwrap();
    let bucket = e.state::<Machine>(machine).buckets[0];
    assert_eq!(
        (bucket.amount, bucket.cost, bucket.reserved),
        (60, 16_500_000_000, 0)
    );
    e.check_invariants();
}

#[test]
fn t13_12_cpi_rejects_active_exec_atomically_and_accepts_clear_exec() {
    for active in [false, true] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        if active {
            let machine = e.machine;
            edit::<Machine>(&mut e, machine, |m| m.exec.kind = 1);
        }
        let mut ixs = sb_ixs(&e, owner, &bag, &[0], 50_000_000);
        let inner = ixs.pop().unwrap();
        ixs.push(via_cpi(inner));
        if active {
            unchanged_on_error(&mut e, &u, &ixs, "ExecInFlight");
        } else {
            e.send(&ixs, &[&u]).unwrap();
            assert!(cards(&e, owner).is_empty());
        }
    }
}

#[test]
fn p3_inflow_saturation_does_not_add_a_sell_rejection() {
    for inflow in [u64::MAX - 1, u64::MAX] {
        let (mut e, u, bag) = fixture(1);
        let owner = pubkey(&u.pubkey());
        let at = e.machine;
        edit::<Machine>(&mut e, at, |m| m.bucket_history[0].sb_inflow_hour = inflow);
        e.send(&sb_ixs(&e, owner, &bag, &[0], 50_000_000), &[&u])
            .unwrap();
        assert_eq!(
            e.state::<Machine>(e.machine).bucket_history[0].sb_inflow_hour,
            u64::MAX
        );
    }
}
