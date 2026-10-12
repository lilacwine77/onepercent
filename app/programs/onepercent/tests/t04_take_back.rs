#[path = "common/intake_cases.rs"]
mod cases;
mod common;
#[path = "common/reference.rs"]
mod reference;
use anchor_lang::prelude::Pubkey;
use cases::*;
use common::*;
use onepercent::{
    params,
    state::{Binder, Deck, MintLedger},
};
use solana_signer::Signer;

fn user_key(user: &solana_keypair::Keypair) -> Pubkey {
    pubkey(&user.pubkey())
}
#[test]
fn t04_01_take_back_spl_and_t22() {
    for t22 in [false, true] {
        let mut env = Env::new();
        let bag = if t22 {
            metadata_bag(&mut env)
        } else {
            env.new_pump_mint(false)
        };
        let user = env.user_with_bag(&bag, 1000);
        let u = user_key(&user);
        env.feed(&user, &bag, 1000, 0).unwrap();
        let before = env.account(u).lamports;
        let tx = env
            .send(&[env.take_back_ix(u, &bag, 0, 1000)], &[&user])
            .unwrap();
        assert_eq!(
            token_amount(&env, ata(&u, &bag.mint, &bag.token_program)),
            1000
        );
        assert_eq!(env.account(u).lamports - before, 406400);
        assert_eq!(env.state::<Deck>(env.deck).len, 0);
        assert_eq!(
            env.state::<Binder>(pda(&[b"binder", u.as_ref()]).0)
                .fresh_in_deck,
            0
        );
        assert_eq!(
            env.state::<MintLedger>(pda(&[b"ledger", bag.mint.as_ref()]).0)
                .accounted,
            0
        );
        assert_eq!(event_bytes(&tx.logs, "BagTakenBack").len(), 1);
        check_intake(&env);
    }
}
#[test]
fn t04_02_take_back_middle_moves_last() {
    let mut env = Env::new();
    let user = env.user();
    let u = user_key(&user);
    let mut bags = vec![];
    for nonce in 0..5 {
        let b = env.new_pump_mint(false);
        reset_user_bag(&mut env, u, &b, 1000);
        env.feed(&user, &b, 1000, nonce).unwrap();
        bags.push(b);
    }
    let tx = env
        .send(&[env.take_back_ix(u, &bags[2], 2, 1000)], &[&user])
        .unwrap();
    let current = entries(&env);
    assert_eq!(current.len(), 4);
    assert_eq!(current[2].mint, bags[4].mint);
    let events = event_bytes(&tx.logs, "BagTakenBack");
    assert_eq!(events.len(), 1);
    assert_eq!(read_u32(&events[0], 84), 4);
}
#[test]
fn t04_03_stale_or_foreign_rejected() {
    for mode in 0..4 {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        env.feed(&user, &bag, 1000, 0).unwrap();
        let other = env.user();
        let replacement = env.new_pump_mint(false);
        let (signer, which, index, amount) = match mode {
            0 => (&user, &bag, 1, 1000),
            1 => (&user, &replacement, 0, 1000),
            2 => (&user, &bag, 0, 999),
            _ => (&other, &bag, 0, 1000),
        };
        if mode == 1 {
            env.token_account(user_key(signer), which, 0);
            env.token_account(env.vault_auth, which, 0);
            env.set_state(
                pda(&[b"ledger", which.mint.as_ref()]).0,
                &MintLedger {
                    mint: which.mint,
                    payer: user_key(signer),
                    accounted: 0,
                },
                &[],
                0,
            );
        }
        if mode == 3 {
            env.token_account(user_key(signer), which, 0);
        }
        assert_error(
            env.send(
                &[env.take_back_ix(user_key(signer), which, index, amount)],
                &[signer],
            ),
            "CardMoved",
        );
    }
}
#[test]
fn t04_04_every_phase_everything_paused() {
    for phase in 1..=6 {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        env.feed(&user, &bag, 1000, 0).unwrap();
        env.inject_phase(phase);
        env.warp(params::SEASON_DURATION_SECONDS + 1);
        config(&mut env, |c| {
            c.admin_paused = 31;
            c.guardian_paused = 31;
            c.disabled_roles = 0x78;
            c.active_queue = 3;
            c.vrf_queues[3] = Pubkey::new_unique();
        });
        env.send(
            &[env.take_back_ix(user_key(&user), &bag, 0, 1000)],
            &[&user],
        )
        .unwrap();
        assert_eq!(
            token_amount(&env, ata(&user_key(&user), &bag.mint, &bag.token_program)),
            1000
        );
    }
}
#[test]
fn t04_05_after_pick_fails() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    env.feed(&user, &bag, 1000, 0).unwrap();
    let first = entries(&env)[0];
    let filler = env.inject_deck(54);
    let filler_ledger = pda(&[b"ledger", filler.mint.as_ref()]).0;
    edit_state::<MintLedger>(&mut env, filler_ledger, |l| l.accounted -= 1000);
    env.mutate(env.deck, |a| {
        a.data[64..144].copy_from_slice(bytemuck::bytes_of(&first))
    });
    let stock = env.new_pump_mint(false);
    env.seed_bucket(
        0,
        &stock,
        1,
        1_000_000_000_000,
        30 * params::LAMPORTS_PER_SOL,
    );
    env.inject_phase(3);
    let buyer = env.user();
    let (pull, _) = env.buy(&buyer, 0, 1).unwrap();
    let mut random = [0; 32];
    for n in 0..100_000u64 {
        random[..8].copy_from_slice(&n.to_le_bytes());
        let mut len = 54;
        let mut wanted = 0;
        let mut picked = false;
        for k in 0..4 {
            let index = reference::dust_index(&random, 1, 0, k, len);
            if index == wanted {
                picked = true;
                break;
            }
            if wanted == len - 1 {
                wanted = index;
            }
            len -= 1;
        }
        if picked {
            break;
        }
    }
    env.fulfill(pull, random).unwrap();
    assert_error(
        env.send(
            &[env.take_back_ix(user_key(&user), &bag, 0, 1000)],
            &[&user],
        ),
        "CardMoved",
    );
    let before = env.account(user_key(&user)).lamports;
    env.settle(pull, 0).unwrap();
    assert!(env.account(user_key(&user)).lamports >= before + 2_000_000);
}
#[test]
fn t04_06_with_donations() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    let u = user_key(&user);
    env.feed(&user, &bag, 1000, 0).unwrap();
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    let binder = pda(&[b"binder", u.as_ref()]).0;
    for at in [env.deck, binder, ledger] {
        env.donate_lamports(at, 12345);
    }
    let vault = ata(&env.vault_auth, &bag.mint, &bag.token_program);
    env.donate_tokens(vault, 777);
    env.send(&[env.take_back_ix(u, &bag, 0, 1000)], &[&user])
        .unwrap();
    assert_eq!(token_amount(&env, vault), 777);
    assert_eq!(env.state::<MintLedger>(ledger).accounted, 0);
    assert_eq!(
        token_amount(&env, ata(&u, &bag.mint, &bag.token_program)),
        1000
    );
    check_intake(&env);
}
#[test]
fn t04_07_rent_changes() {
    for rate in [2575, 6960] {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        env.feed(&user, &bag, 1000, 0).unwrap();
        if rate == 6960 {
            let first = entries(&env)[0];
            let filler = env.inject_deck(10_000);
            let filler_ledger = pda(&[b"ledger", filler.mint.as_ref()]).0;
            edit_state::<MintLedger>(&mut env, filler_ledger, |l| l.accounted -= 1000);
            env.mutate(env.deck, |a| {
                a.data[64..144].copy_from_slice(bytemuck::bytes_of(&first))
            });
        }
        env.set_rent(rate);
        let before = env.account(user_key(&user)).lamports;
        env.send(
            &[env.take_back_ix(user_key(&user), &bag, 0, 1000)],
            &[&user],
        )
        .unwrap();
        if rate == 2575 {
            assert_eq!(env.account(user_key(&user)).lamports - before, 406400);
        } else {
            let deck = env.state::<Deck>(env.deck);
            assert!(deck.cap > deck.len);
            assert!(env.account(user_key(&user)).lamports >= before);
        }
    }
}
#[test]
fn t04_08_destination_with_cpi_guard() {
    let mut env = Env::new();
    let bag = metadata_bag(&mut env);
    let user = env.user_with_bag(&bag, 1000);
    let u = user_key(&user);
    env.feed(&user, &bag, 1000, 0).unwrap();
    let destination = ata(&u, &bag.mint, &bag.token_program);
    let mut account = env.account(destination);
    account.data.extend_from_slice(&11u16.to_le_bytes());
    account.data.extend_from_slice(&1u16.to_le_bytes());
    account.data.push(1);
    account.lamports = env.rent_min(account.data.len());
    env.put(destination, account);
    env.send(&[env.take_back_ix(u, &bag, 0, 1000)], &[&user])
        .unwrap();
    assert_eq!(token_amount(&env, destination), 1000);
}
#[test]
fn t04_09_refed_entry_without_binder() {
    for mode in 0..3 {
        let mut env = Env::new();
        let bag = env.inject_deck(1);
        let user = env.user();
        let u = user_key(&user);
        env.token_account(u, &bag, 0);
        env.mutate(env.deck, |a| {
            write_key(&mut a.data, 64, &u);
            a.data[64 + 76] = if mode == 2 { 1 } else { 2 };
        });
        let mut ix = env.take_back_ix(u, &bag, 0, 1000);
        if mode == 1 {
            ix.accounts[2] = meta(Pubkey::new_unique(), true, false);
        }
        let result = env.send(&[ix], &[&user]);
        match mode {
            0 => {
                result.unwrap();
                assert_eq!(
                    token_amount(&env, ata(&u, &bag.mint, &bag.token_program)),
                    1000
                );
            }
            1 => assert_error(result, "ConstraintSeeds"),
            _ => assert_error(result, "AccountMismatch"),
        };
    }
}
