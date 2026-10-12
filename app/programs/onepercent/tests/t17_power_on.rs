mod common;
#[path = "common/launch_cases.rs"]
mod launch;
use common::{pack_cases::events, *};
use launch::*;
use onepercent::{
    constants::*,
    events::PoweredOn,
    params,
    state::{Machine, MintLedger},
};
use solana_signer::Signer;

#[test]
fn t17_01_power_on_happy() {
    let (mut env, bag) = setup();
    let vault = ata(&env.vault_auth, &bag.mint, &bag.token_program);
    env.mutate(vault, |a| write_u64(&mut a.data, 64, 0));
    let owner = pubkey(&env.authority.pubkey());
    env.token_account(owner, &bag, params::TOKEN_1PCT_DEV_BUY_AMOUNT);
    let now = env.now();
    let tx = env
        .send(
            &[
                env.transfer_ix(owner, &bag, params::TOKEN_1PCT_DEV_BUY_AMOUNT),
                power_ix(&env, &bag),
            ],
            &[],
        )
        .unwrap();
    let m = env.state::<Machine>(env.machine);
    assert_eq!(m.phase, PHASE_POWERED_ON);
    assert_eq!(m.token_mint, bag.mint);
    assert_eq!(m.power_on_ts, now);
    assert_eq!(m.on_air_ts, now + params::SEASON_ON_AIR_DELAY_SECONDS);
    assert_eq!(m.end_ts, m.on_air_ts + params::SEASON_DURATION_SECONDS);
    assert_eq!((m.final_sol_total, m.final_1pct_total), (0, 0));
    assert!(m
        .onepct
        .iter()
        .all(|s| s.amount == params::TOKEN_1PCT_ONE_PCT_CARD_AMOUNT && s.state == ONEPCT_LOCKED));
    assert_eq!(
        env.state::<MintLedger>(pda(&[b"ledger", bag.mint.as_ref()]).0)
            .accounted,
        params::TOKEN_1PCT_DEV_BUY_AMOUNT
    );
    let event = events::<PoweredOn>(&tx).remove(0);
    assert_eq!(
        (event.mint, event.dev_buy, event.accounted),
        (
            bag.mint,
            params::TOKEN_1PCT_DEV_BUY_AMOUNT,
            params::TOKEN_1PCT_DEV_BUY_AMOUNT
        )
    );
}
#[test]
fn t17_02_only_launch_wallet_once() {
    for phase in [PHASE_SETUP, PHASE_POWERED_ON, PHASE_ON_AIR] {
        let (mut env, bag) = setup();
        machine(&mut env, |m| m.phase = phase);
        assert_error(env.send(&[power_ix(&env, &bag)], &[]), "WrongPhase");
    }
    let (mut env, bag) = setup();
    let other = env.user();
    let mut ix = power_ix(&env, &bag);
    ix.accounts[0] = meta(pubkey(&other.pubkey()), true, true);
    assert_error(env.send(&[ix], &[&other]), "Unauthorized");
    env.send(&[power_ix(&env, &bag)], &[]).unwrap();
    assert_error(env.send(&[power_ix(&env, &bag)], &[]), "WrongPhase");
}
#[test]
fn t17_03_power_on_via_cpi_rejected() {
    let (mut env, bag) = setup();
    let before = env.account(env.machine).data;
    assert_error(
        env.send(&[via_cpi(power_ix(&env, &bag))], &[]),
        "NotTopLevel",
    );
    assert_eq!(env.account(env.machine).data, before);
}
#[test]
fn t17_04_mint_safety() {
    let (mut env, bag) = setup();
    env.mutate(bag.mint, |a| a.owner = addr(&token2022()));
    let mut ix = power_ix(&env, &bag);
    ix.accounts[10].pubkey = addr(&token2022());
    assert_error(env.send(&[ix], &[]), "AccountMismatch");
    let (mut env, bag) = setup();
    env.mutate(bag.mint, |a| a.data.resize(166, 0));
    assert_error(env.send(&[power_ix(&env, &bag)], &[]), "MintNotSafe");
    for mutation in 0..4 {
        let (mut env, bag) = setup();
        match mutation {
            0 => config(&mut env, |c| {
                c.token_mint = anchor_lang::prelude::Pubkey::new_unique()
            }),
            1 => env.mutate(bag.mint, |a| write_u32(&mut a.data, 0, 1)),
            2 => env.mutate(bag.mint, |a| write_u32(&mut a.data, 46, 1)),
            _ => env.mutate(bag.mint, |a| a.data[44] = 9),
        }
        assert_error(
            env.send(&[power_ix(&env, &bag)], &[]),
            if mutation == 0 {
                "AccountMismatch"
            } else {
                "MintNotSafe"
            },
        );
    }
}
#[test]
fn t17_05_dbc_pool_and_config_checks() {
    for case in 0..14 {
        let (mut env, bag) = setup();
        let mut ix = power_ix(&env, &bag);
        match case {
            0 => ix.accounts[4].pubkey = addr(&env.fee_in),
            1 => env.mutate(bag.curve, |a| a.owner = addr(&system())),
            2 => ix.accounts[5].pubkey = addr(&env.fee_in),
            3 => env.mutate(params::METEORA_DBC_CONFIG, |a| a.owner = addr(&system())),
            4 => env.mutate(bag.curve, |a| a.data[0] ^= 1),
            5 => env.mutate(bag.curve, |a| a.data[DBC_POOL_BASE_MINT_OFFSET] ^= 1),
            6 => env.mutate(bag.curve, |a| a.data[DBC_POOL_CONFIG_OFFSET] ^= 1),
            7 => env.mutate(bag.curve, |a| a.data.truncate(DBC_POOL_MIN_LEN - 1)),
            8 => env.mutate(params::METEORA_DBC_CONFIG, |a| a.data[0] ^= 1),
            9 => env.mutate(params::METEORA_DBC_CONFIG, |a| {
                a.data[DBC_CONFIG_QUOTE_MINT_OFFSET] ^= 1
            }),
            10 => env.mutate(params::METEORA_DBC_CONFIG, |a| {
                a.data[DBC_CONFIG_FEE_CLAIMER_OFFSET] ^= 1
            }),
            11 => env.mutate(params::METEORA_DBC_CONFIG, |a| {
                a.data[DBC_CONFIG_CREATOR_TRADING_FEE_PERCENTAGE_OFFSET] = 1
            }),
            12 => env.mutate(params::METEORA_DBC_CONFIG, |a| {
                a.data.truncate(DBC_CONFIG_MIN_LEN - 1)
            }),
            _ => env.mutate(params::METEORA_DBC_CONFIG, |a| a.data.truncate(0)),
        }
        assert_error(
            env.send(&[ix], &[]),
            if case < 4 {
                "AccountMismatch"
            } else {
                "NotLaunchCurve"
            },
        );
    }
    // A DBC account with correct fields at a different key is never accepted.
    let (mut env, bag) = setup();
    let wrong = anchor_lang::prelude::Pubkey::new_unique();
    env.put(wrong, env.account(bag.curve));
    let mut ix = power_ix(&env, &bag);
    ix.accounts[4].pubkey = addr(&wrong);
    assert_error(env.send(&[ix], &[]), "AccountMismatch");
}

#[test]
fn t17_06_slack_rule() {
    for (accounted, delta, passes) in [(0, 1, true), (0, -1, false), (5, 4, false)] {
        let (mut env, bag) = setup();
        let vault = ata(&env.vault_auth, &bag.mint, &bag.token_program);
        env.mutate(vault, |a| {
            write_u64(
                &mut a.data,
                64,
                (i128::from(params::TOKEN_1PCT_DEV_BUY_AMOUNT) + delta) as u64,
            )
        });
        if accounted > 0 {
            env.set_state(
                pda(&[b"ledger", bag.mint.as_ref()]).0,
                &MintLedger {
                    mint: bag.mint,
                    payer: pubkey(&env.authority.pubkey()),
                    accounted,
                },
                &[],
                0,
            );
        }
        let result = env.send(&[power_ix(&env, &bag)], &[]);
        if passes {
            result.unwrap();
            assert_eq!(
                env.state::<MintLedger>(pda(&[b"ledger", bag.mint.as_ref()]).0)
                    .accounted,
                params::TOKEN_1PCT_DEV_BUY_AMOUNT
            );
        } else {
            assert_error(result, "SlackShort");
        }
    }
}
#[test]
fn t17_07_fee_in_topup() {
    for rate in [5080, 6960] {
        let (mut env, bag) = setup();
        let before = env.account(env.fee_in).lamports;
        env.set_rent(rate);
        let tx = env.send(&[power_ix(&env, &bag)], &[]).unwrap();
        assert_eq!(env.account(env.fee_in).lamports, env.rent_min(0));
        assert_eq!(
            events::<PoweredOn>(&tx)[0].fee_in_topup,
            env.rent_min(0) - before
        );
    }
}
#[test]
fn t17_08_prefunded_ledger_precreated_vault() {
    let (mut env, bag) = setup();
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    env.donate_lamports(ledger, 12345);
    env.send(&[power_ix(&env, &bag)], &[]).unwrap();
    assert_eq!(
        env.state::<MintLedger>(ledger).payer,
        pubkey(&env.authority.pubkey())
    );
}
#[test]
fn t17_09_season_timeline() {
    let (mut env, bag) = setup();
    env.send(&[power_ix(&env, &bag)], &[]).unwrap();
    env.warp(params::SEASON_ON_AIR_DELAY_SECONDS - 1);
    env.send(&[advance_ix(&env)], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, PHASE_POWERED_ON);
    env.warp(1);
    env.send(&[advance_ix(&env)], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, PHASE_ON_AIR);
}
