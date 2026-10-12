// This module is compiled only with cfg(test); failed fixture expectations
// should fail the test immediately.
#![allow(clippy::unwrap_used)]

use super::*;
use crate::{constants, params};

#[test]
fn split_has_exact_documented_amounts_and_conserves_u64_extremes() {
    assert_eq!(
        split(params::PACK_EDITIONS_PRICE_LAMPORTS[0]),
        Split {
            royalty: 2_000_000,
            jackpot: 5_000_000,
            burn: 5_000_000,
            referral: 2_000_000,
            team: 8_000_000,
            stock: 72_000_000,
        }
    );
    for price in [0, 1, 49, 50, 99, 100, u64::MAX - 1, u64::MAX] {
        let s = split(price);
        assert_eq!(
            u128::from(s.stock)
                + u128::from(s.royalty) * 4
                + u128::from(s.jackpot)
                + u128::from(s.burn)
                + u128::from(s.referral)
                + u128::from(s.team),
            u128::from(price)
        );
    }
    assert_eq!(
        tier_value(params::PACK_EDITIONS_PRICE_LAMPORTS[0], 1),
        Some(50_000_000)
    );
    assert_eq!(
        tier_value(params::PACK_EDITIONS_PRICE_LAMPORTS[0], 4),
        Some(1_500_000_000)
    );
    assert_eq!(tier_value(u64::MAX, 4), None);
    assert_eq!(tier_value(1, 0), None);
    assert_eq!(tier_value(1, 9), None);
}

#[test]
fn hash_check_values_and_season_one_segments() {
    assert_eq!(tier_position(&[0; 32], 1, 0), 786_467_289);
    assert_eq!(tier_position(&[0; 32], 1, 1), 67_122_303);
    assert_eq!(tier_position(&[255; 32], 7, 3), 535_533_360);
    for edition in 0..4 {
        assert_eq!(
            draw(&[0; 32], 1, 0, edition, 0, false).unwrap().tier,
            constants::KIND_SILVER
        );
        assert_eq!(
            draw(&[0; 32], 1, 1, edition, 0, false).unwrap().tier,
            constants::KIND_BLUE
        );
        let d = draw(&[0; 32], 1, 1, edition, u8::MAX, true).unwrap();
        assert_eq!(d.widths[1], 0);
        assert!(d.widths[0] > 0 && d.widths[2] > 0);
    }
    assert_eq!(draw(&[0; 32], 0, 0, u8::MAX, 0, false), None);
    assert_eq!(
        (0..4)
            .map(|k| dust_index(&[0; 32], 1, 0, k, 1_000))
            .collect::<Vec<_>>(),
        vec![223, 200, 475, 529]
    );
    assert_eq!(dust_index(&[0; 32], 0, 0, 0, 0), 0);
    assert_eq!(
        bucket_position(&[0; 32], 1, 0, 10_000_000_000),
        6_889_519_747
    );
    let expected = [
        0x29, 0x3b, 0xd9, 0x15, 0x83, 0x52, 0xa1, 0x10, 0x66, 0x04, 0xa8, 0x46, 0xa4, 0xb3, 0x7c,
        0xea, 0x22, 0x30, 0x3e, 0xb6, 0xc4, 0xb1, 0xbc, 0xda, 0xb7, 0xb2, 0x87, 0xd7, 0x50, 0x0d,
        0xcd, 0x1a,
    ];
    assert_eq!(caller_seed(&[0; 32], 1, &[1; 32]), expected);
}

#[test]
fn coverage_is_greedy_stable_and_atomic() {
    let price = params::PACK_EDITIONS_PRICE_LAMPORTS[0];
    let need = coverage_need(price).unwrap();
    let b = BucketInput {
        class: constants::BUCKET_MAJOR,
        enabled: true,
        amount: 1_000_000,
        cost: need * 2,
        reserved: 0,
    };
    let mut buckets = [
        b,
        b,
        BucketInput {
            class: constants::BUCKET_TRENDING,
            cost: u64::MAX,
            ..b
        },
    ];
    assert_eq!(coverage(price, 3, &mut buckets), Some(vec![0, 1, 0]));
    assert_eq!(buckets[0].reserved, need * 2);
    assert_eq!(buckets[1].reserved, need);
    let before = buckets;
    assert_eq!(coverage(price, 2, &mut buckets), None);
    assert_eq!(buckets, before);
    assert_eq!(coverage_need(u64::MAX), None);
    assert_eq!(max_qty(0, 1_000, 0, &[b, b]), 4);
    assert_eq!(max_qty(0, 54, 0, &[b, b]), 1);
    assert_eq!(max_qty(0, 53, 0, &[b, b]), 0);
    assert_eq!(max_qty(0, 100, 100, &[b, b]), 0);
    assert_eq!(max_qty(4, 1_000, 0, &[b, b]), 0);
}

#[test]
fn buckets_weight_free_cost_and_fallback_ignores_disable() {
    let b = BucketInput {
        class: constants::BUCKET_MAJOR,
        enabled: true,
        amount: 1_000,
        cost: 100,
        reserved: 0,
    };
    assert_eq!(bucket_pick(&[0; 32], 1, 0, 1, 50, 0, &[b, b]), Some(1));
    let disabled = BucketInput {
        enabled: false,
        ..b
    };
    assert_eq!(bucket_pick(&[0; 32], 1, 0, 4, 50, 0, &[disabled]), Some(0));
    assert_eq!(bucket_pick(&[0; 32], 1, 0, 4, 101, 0, &[disabled]), None);
    assert_eq!(bucket_pick(&[0; 32], 1, 0, 4, 50, 255, &[disabled]), None);
    assert_eq!(bucket_pick(&[0; 32], 1, 0, 9, 50, 0, &[b]), None);
    let huge = BucketInput {
        amount: u64::MAX,
        cost: u64::MAX,
        ..b
    };
    assert!(bucket_pick(&[255; 32], u64::MAX, 255, 4, u64::MAX, 0, &[huge; 16]).is_some());
    assert_eq!(carve(1, 1, 3), None);
    assert_eq!(
        carve(3, 5, 7),
        Some(Carve {
            tokens: 2,
            amount: 3,
            cost: 4
        })
    );
    assert_eq!(
        carve(7, 5, 7),
        Some(Carve {
            tokens: 5,
            amount: 0,
            cost: 0
        })
    );
    assert_eq!(
        carve(u64::MAX, u64::MAX, u64::MAX),
        Some(Carve {
            tokens: u64::MAX,
            amount: 0,
            cost: 0
        })
    );
    assert_eq!(carve(1, 1, 0), None);
}

#[test]
fn hour_rotation_resets_both_hit_and_sell_back_counters() {
    let mut state = HourState {
        hour_index: 1,
        hit_out_last_hour: 3,
        hit_out_this_hour: 7,
        sb_paid_hour: 11,
        sol_at_hour_start: 13,
        stock_sol: 17,
    };
    let before = state;
    rotate_hour(&mut state, 7_199);
    assert_eq!(state, before);
    rotate_hour(&mut state, 7_200);
    assert_eq!(state.hour_index, 2);
    assert_eq!(state.hit_out_last_hour, 7);
    assert_eq!(state.hit_out_this_hour, 0);
    assert_eq!(state.sb_paid_hour, 0);
    assert_eq!(state.sol_at_hour_start, 17);
    state.hit_out_this_hour = 9;
    rotate_hour(&mut state, 14_400);
    assert_eq!(state.hit_out_last_hour, 0);
    rotate_hour(&mut state, i64::MIN);
    assert_eq!(state.hour_index, 0);
}

#[test]
fn d12_one_unit_two_sol_cannot_back_original() {
    let price = params::PACK_EDITIONS_PRICE_LAMPORTS[0];
    let coarse = BucketInput {
        class: constants::BUCKET_MAJOR,
        enabled: true,
        amount: 1,
        cost: params::LAMPORTS_PER_SOL * 2,
        reserved: 0,
    };
    assert!(coarse.free() >= coverage_need(price).unwrap());
    assert!(!coverage_granularity(price, &coarse));
    let mut buckets = [coarse];
    assert_eq!(coverage(price, 1, &mut buckets), None);
    assert_eq!(buckets, [coarse]);
    assert_eq!(max_qty(0, 100, 0, &buckets), 0);
}

#[test]
fn d12_skips_coarse_larger_bucket_and_selects_qualified_alternative() {
    let price = params::PACK_EDITIONS_PRICE_LAMPORTS[0];
    let coarse = BucketInput {
        class: constants::BUCKET_MAJOR,
        enabled: true,
        amount: 1,
        cost: params::LAMPORTS_PER_SOL * 30,
        reserved: 0,
    };
    let qualified = BucketInput {
        amount: 60,
        cost: params::LAMPORTS_PER_SOL * 3,
        ..coarse
    };
    let mut buckets = [coarse, qualified];
    assert_eq!(coverage(price, 2, &mut buckets), Some(vec![1, 1]));
    assert_eq!(buckets[0], coarse);
    assert_eq!(max_qty(0, 100, 0, &[coarse, qualified]), 2);
}

#[test]
fn d12_granularity_is_per_edition_and_survives_all_pending_carves() {
    let bucket = BucketInput {
        class: constants::BUCKET_MAJOR,
        enabled: true,
        amount: 100,
        cost: params::LAMPORTS_PER_SOL * 30,
        reserved: 0,
    };
    assert!(!coverage_granularity(
        params::PACK_EDITIONS_PRICE_LAMPORTS[0],
        &bucket
    ));
    assert!(coverage_granularity(
        params::PACK_EDITIONS_PRICE_LAMPORTS[3],
        &bucket
    ));
    for &price in &params::PACK_EDITIONS_PRICE_LAMPORTS {
        let smallest = tier_value(price, constants::KIND_SILVER).unwrap();
        let mut active = BucketInput {
            amount: 600,
            ..bucket
        };
        assert!(coverage_granularity(price, &active));
        assert_eq!(
            coverage(price, 1, std::slice::from_mut(&mut active)),
            Some(vec![0])
        );
        for value in [smallest, smallest + 1, smallest * 3, smallest * 4] {
            if value > active.free() {
                continue;
            }
            if let Some(carved) = carve(value, active.amount, active.cost) {
                active.amount = carved.amount;
                active.cost = carved.cost;
                assert!(coverage_granularity(price, &active));
                assert!(active.cost >= active.reserved);
            }
        }
    }
}
