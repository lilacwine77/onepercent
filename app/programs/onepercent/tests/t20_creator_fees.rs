mod common;
#[path = "common/launch_cases.rs"]
mod launch;
use common::{pack_cases::events, *};
use launch::*;
use onepercent::{
    constants::*, events::CreatorFeesCollected, math::creator_fee, params, state::Machine,
};
use solana_signer::Signer;

fn ready(phase: u8, stock: u64) -> Env {
    let (mut env, bag) = setup();
    env.send(&[power_ix(&env, &bag)], &[]).unwrap();
    machine(&mut env, |m| {
        m.phase = phase;
        m.stock_sol = stock;
    });
    env.donate_lamports(env.machine, stock);
    env
}
#[test]
fn t20_01_regimes() {
    for phase in [
        PHASE_POWERED_ON,
        PHASE_ON_AIR,
        PHASE_BUYS_CLOSED,
        PHASE_FINAL_PULL,
        PHASE_DONE,
    ] {
        for stock in [
            0,
            params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS,
            params::STOCK_TARGET_BASE_LAMPORTS + 1,
        ] {
            let mut env = ready(phase, stock);
            let amount = 1_000_000_007;
            env.donate_lamports(env.fee_in, amount);
            let before = env.state::<Machine>(env.machine);
            let chosen = creator_fee::regime(&before);
            let split = creator_fee::split(amount, chosen);
            let balance = env.account(env.machine).lamports;
            let tx = collect(&mut env);
            let after = env.state::<Machine>(env.machine);
            let ev = events::<CreatorFeesCollected>(&tx).remove(0);
            assert_eq!(
                (ev.regime, ev.amount, ev.from_fee_in, ev.from_wsol),
                (chosen, amount, amount, 0)
            );
            assert_eq!(
                (ev.to_stock, ev.to_burn, ev.to_team),
                (split.stock, 0, split.team)
            );
            assert_eq!(
                (after.stock_sol, after.burn_sol, after.team_sol),
                (stock + split.stock, 0, split.team)
            );
            assert_eq!(env.account(env.machine).lamports, balance + amount);
        }
    }
    let mut env = ready(PHASE_ON_AIR, params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS);
    let now = env.now();
    machine(&mut env, |m| m.end_ts = now - 5);
    env.donate_lamports(env.fee_in, 9);
    let tx = collect(&mut env);
    assert_eq!(events::<CreatorFeesCollected>(&tx)[0].regime, REGIME_SEASON);
    let source = include_str!("../src/instructions/collect_creator_fees.rs");
    assert!(!source.contains("end_ts"));
}
#[test]
fn t20_02_floor_boundary() {
    for phase in [PHASE_POWERED_ON, PHASE_ON_AIR] {
        for cost in [999_999_999, 1_000_000_000] {
            let mut env = ready(phase, 1_000_000_000);
            let now = env.now();
            machine(&mut env, |m| {
                m.buckets[0].cost = cost;
                m.hour_index = (now / 3600 - 1) as u64;
                m.hit_out_this_hour = 2_000_000_000;
                m.sb_paid_hour = 17;
                m.bucket_history[0].sb_inflow_hour = 19;
            });
            env.donate_lamports(env.fee_in, 1_000_000_007);
            let tx = collect(&mut env);
            let ev = events::<CreatorFeesCollected>(&tx).remove(0);
            let after = env.state::<Machine>(env.machine);
            assert_eq!(after.sb_paid_prev_hour, 17);
            assert_eq!(after.bucket_history[0].sb_inflow_prev_hour, 19);
            assert_eq!(ev.book, 1_000_000_000 + cost);
            assert_eq!(
                ev.target,
                params::STOCK_TARGET_BASE_LAMPORTS + 2_000_000_000
            );
            assert_eq!(
                ev.regime,
                if cost < 1_000_000_000 {
                    REGIME_BELOW_FLOOR
                } else {
                    REGIME_SEASON
                }
            );
            assert_eq!(
                ev.to_stock,
                if cost < 1_000_000_000 {
                    1_000_000_007
                } else {
                    500_000_004
                }
            );
        }
    }
    // Crossing the floor inside a single collection does not change that collection's split.
    let mut env = ready(PHASE_ON_AIR, params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS - 1);
    env.donate_lamports(env.fee_in, 9);
    let tx = collect(&mut env);
    assert_eq!(events::<CreatorFeesCollected>(&tx)[0].to_stock, 9);
    env.donate_lamports(env.fee_in, 9);
    let tx = collect(&mut env);
    assert_eq!(events::<CreatorFeesCollected>(&tx)[0].to_stock, 5);
}
#[test]
fn t20_03_fee_in_keeps_rent() {
    let mut env = ready(PHASE_POWERED_ON, 0);
    env.donate_lamports(env.fee_in, 50);
    collect(&mut env);
    assert_eq!(env.account(env.fee_in).lamports, env.rent_min(0));
    env.set_rent(6960);
    let before = env.account(env.fee_in).lamports;
    let tx = collect(&mut env);
    assert_eq!(env.account(env.fee_in).lamports, before);
    assert!(events::<CreatorFeesCollected>(&tx).is_empty());
}

#[test]
fn t20_04_wsol_unwrap() {
    let mut env = ready(PHASE_POWERED_ON, 0);
    let caller = env.user();
    let who = pubkey(&caller.pubkey());
    let balance = env.account(who).lamports;
    let at = seed_fee_wsol(&mut env, 5_000_000);
    let rent = env.rent_min(165);
    let tx = env.send(&[collect_ix(&env, who)], &[&caller]).unwrap();
    let event = events::<CreatorFeesCollected>(&tx).remove(0);
    assert_eq!((event.from_wsol, event.to_stock), (5_000_000, 5_000_000));
    assert!(env.closed(at));
    assert_eq!(env.account(who).lamports, balance + rent);
    for donation in [0, env.rent_min(0)] {
        let mut env = ready(PHASE_POWERED_ON, 0);
        let at = ata(&env.fee_in, &params::WSOL_MINT, &token());
        if donation > 0 {
            env.donate_lamports(at, donation);
        }
        let tx = collect(&mut env);
        assert!(events::<CreatorFeesCollected>(&tx).is_empty());
    }
    for case in 0..6 {
        let mut env = ready(PHASE_POWERED_ON, 0);
        let at = seed_fee_wsol(&mut env, 5_000_000);
        let mut instruction = collect_ix(&env, pubkey(&env.authority.pubkey()));
        match case {
            0 => instruction.accounts[3].pubkey = addr(&env.fee_in),
            1 => env.mutate(at, |a| a.owner = addr(&token2022())),
            2 => env.mutate(at, |a| {
                write_key(&mut a.data, 0, &anchor_lang::prelude::Pubkey::new_unique())
            }),
            3 => env.mutate(at, |a| {
                write_key(&mut a.data, 32, &anchor_lang::prelude::Pubkey::new_unique())
            }),
            4 => env.mutate(at, |a| write_u32(&mut a.data, 109, 0)),
            _ => env.mutate(at, |a| a.data.truncate(164)),
        }
        assert_error(env.send(&[instruction], &[]), "AccountMismatch");
    }
    let mut env = ready(PHASE_POWERED_ON, 0);
    let at = seed_fee_wsol(&mut env, 0);
    let tx = collect(&mut env);
    assert!(!env.closed(at));
    assert!(events::<CreatorFeesCollected>(&tx).is_empty());
}
#[test]
fn t20_05_before_power_on() {
    for phase in [PHASE_SETUP, PHASE_STOCK_UP] {
        let (mut env, _) = setup();
        machine(&mut env, |m| m.phase = phase);
        assert_error(
            env.send(&[collect_ix(&env, pubkey(&env.authority.pubkey()))], &[]),
            "WrongPhase",
        );
    }
}
#[test]
fn t20_06_exit_properties() {
    let mut env = ready(PHASE_POWERED_ON, 0);
    config(&mut env, |c| {
        c.admin_paused = u8::MAX;
        c.guardian_paused = u8::MAX;
        c.disabled_roles = u8::MAX;
    });
    env.donate_lamports(env.fee_in, 12345);
    let tx = env
        .send(
            &[via_cpi(collect_ix(&env, pubkey(&env.authority.pubkey())))],
            &[],
        )
        .unwrap();
    assert_eq!(events::<CreatorFeesCollected>(&tx)[0].to_stock, 12345);
}
#[test]
fn t20_07_split_vectors() {
    for (amount, r, stock, team) in [
        (1_000_000_007, REGIME_BELOW_FLOOR, 1_000_000_007, 0),
        (1_000_000_007, REGIME_SEASON, 500_000_004, 500_000_003),
        (1_000_000_007, REGIME_AFTER_END, 0, 1_000_000_007),
        (9, REGIME_SEASON, 5, 4),
        (9, REGIME_AFTER_END, 0, 9),
        (650_240, REGIME_AFTER_END, 0, 650_240),
    ] {
        assert_eq!(
            creator_fee::split(amount, r),
            creator_fee::CreatorFeeSplit {
                stock,
                burn: 0,
                team
            }
        );
    }
    for r in [REGIME_BELOW_FLOOR, REGIME_SEASON, REGIME_AFTER_END] {
        let split = creator_fee::split(u64::MAX, r);
        assert_eq!(
            u128::from(split.stock) + u128::from(split.burn) + u128::from(split.team),
            u128::from(u64::MAX)
        );
    }
}
#[test]
fn t20_08_direct_sol_seeds_stock_under_current_regime() {
    let mut env = ready(PHASE_POWERED_ON, 0);
    let who = pubkey(&env.authority.pubkey());
    let seed = params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS;
    let donation = ix(anchor_lang::solana_program::system_instruction::transfer(
        &who,
        &env.fee_in,
        seed,
    ));
    let tx = env.send(&[donation, collect_ix(&env, who)], &[]).unwrap();
    let event = events::<CreatorFeesCollected>(&tx).remove(0);
    assert_eq!(
        (event.from_fee_in, event.to_stock, event.to_team),
        (seed, seed, 0)
    );
    let donation = ix(anchor_lang::solana_program::system_instruction::transfer(
        &who,
        &env.fee_in,
        9,
    ));
    let tx = env.send(&[donation, collect_ix(&env, who)], &[]).unwrap();
    let event = events::<CreatorFeesCollected>(&tx).remove(0);
    assert_eq!((event.to_stock, event.to_burn, event.to_team), (5, 0, 4));
}
