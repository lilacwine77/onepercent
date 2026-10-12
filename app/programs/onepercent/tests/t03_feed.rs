#[path = "common/intake_cases.rs"]
mod cases;
mod common;
use anchor_lang::prelude::Pubkey;
use cases::*;
use common::*;
use onepercent::{
    checks, params,
    state::{Binder, MintLedger},
};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn owner(user: &Keypair) -> Pubkey {
    pubkey(&user.pubkey())
}
fn fresh_bag(env: &mut Env, user: &Keypair) -> Bag {
    let bag = env.new_pump_mint(false);
    reset_user_bag(env, owner(user), &bag, 1000);
    bag
}
fn empty_feed(env: &Env, user: Pubkey, bag: &Bag, amount: u64, nonce: u32) -> Vec<Instruction> {
    let ixs = env.feed_ixs(user, &[(bag, amount)], nonce);
    vec![ixs[0].clone(), ixs.last().unwrap().clone()]
}

#[test]
fn t03_01_feed_one_spl_bag() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    let u = owner(&user);
    let before = env.account(u).lamports;
    let source = ata(&u, &bag.mint, &bag.token_program);
    let source_rent = env.account(source).lamports;
    let mut ixs = env.feed_ixs(u, &[(&bag, 1000)], 0);
    ixs.push(close_user_ix(u, &bag));
    let tx = env.send(&ixs, &[&user]).unwrap();
    let e = entries(&env);
    assert_eq!(e.len(), 1);
    assert_eq!(
        (
            e[0].depositor,
            e[0].mint,
            e[0].amount,
            e[0].deposit,
            e[0].flags
        ),
        (u, bag.mint, 1000, 406400, 1)
    );
    let ledger = env.state::<MintLedger>(pda(&[b"ledger", bag.mint.as_ref()]).0);
    assert_eq!((ledger.payer, ledger.accounted), (u, 1000));
    assert_eq!(
        token_amount(&env, ata(&env.vault_auth, &bag.mint, &bag.token_program)),
        1000
    );
    let binder = env.state::<Binder>(pda(&[b"binder", u.as_ref()]).0);
    assert_eq!((binder.fresh_in_deck, binder.feed_nonce_base), (1, 1));
    let costs = 406400 + env.rent_min(80) + env.rent_min(165) + env.rent_min(112);
    assert_eq!(before + source_rent - env.account(u).lamports, costs);
    assert!(env.closed(source));
    assert_eq!(event_bytes(&tx.logs, "BagFed").len(), 1);
    check_intake(&env);
}
#[test]
fn t03_02_feed_one_t22_bag() {
    let mut env = Env::new();
    let bag = metadata_bag(&mut env);
    let user = env.user_with_bag(&bag, 1000);
    env.feed(&user, &bag, 1000, 0).unwrap();
    assert_eq!(
        env.account(ata(&env.vault_auth, &bag.mint, &bag.token_program))
            .data
            .len(),
        170
    );
    assert_eq!(entries(&env)[0].amount, 1000);
    check_intake(&env);
}
#[test]
fn t03_03_feed_six_bags_and_seven_rejected() {
    for count in [6usize, 7] {
        let mut env = Env::new();
        let user = env.user();
        let bags: Vec<_> = (0..count).map(|_| fresh_bag(&mut env, &user)).collect();
        let input: Vec<_> = bags.iter().map(|b| (b, 1000)).collect();
        let result = env.send(&env.feed_ixs(owner(&user), &input, 0), &[&user]);
        if count == 6 {
            result.unwrap();
            assert_eq!(entries(&env).len(), 6);
        } else {
            assert_error(result, "InvalidArgument");
            assert!(entries(&env).is_empty());
        }
    }
}
#[test]
fn t03_04_no_transfer_with_slack_rejected() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    env.token_account(env.vault_auth, &bag, 5000);
    let ixs = empty_feed(&env, owner(&user), &bag, 1000, 0);
    assert_error(env.send(&ixs, &[&user]), "TokensNotReceived");
    assert!(entries(&env).is_empty());
    assert!(env.closed(pda(&[b"ledger", bag.mint.as_ref()]).0));
    assert_eq!(
        token_amount(&env, ata(&env.vault_auth, &bag.mint, &bag.token_program)),
        5000
    );
}
#[test]
fn t03_05_transfer_shapes_rejected() {
    for mode in 0..5 {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        let u = owner(&user);
        env.token_account(env.vault_auth, &bag, 5000);
        let mut ixs = env.feed_ixs(u, &[(&bag, 1000)], 0);
        let delegate = env.user();
        match mode {
            0 => write_u64(&mut ixs[2].data, 1, 999),
            1 => {
                let target = env.token_account(owner(&delegate), &bag, 0);
                ixs[2].accounts[2].pubkey = addr(&target);
            }
            2 => {
                ixs.swap(2, 3);
            }
            3 => {
                let source = ata(&u, &bag.mint, &bag.token_program);
                env.mutate(source, |a| {
                    write_u32(&mut a.data, 72, 1);
                    write_key(&mut a.data, 76, &owner(&delegate));
                    write_u64(&mut a.data, 121, 1000);
                });
                ixs[2].accounts[3] = meta(owner(&delegate), false, true);
            }
            _ => {
                ixs[2].data = vec![3];
                ixs[2].data.extend_from_slice(&1000u64.to_le_bytes());
                ixs[2].accounts.remove(1);
            }
        }
        let signers = if mode == 3 {
            vec![&user, &delegate]
        } else {
            vec![&user]
        };
        assert_error(env.send(&ixs, &signers), "TokensNotReceived");
        assert!(entries(&env).is_empty());
    }
}
#[test]
fn t03_06_two_feeds_one_tx_rejected() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    let mut ixs = env.feed_ixs(owner(&user), &[(&bag, 1000)], 0);
    ixs.push(ixs.last().unwrap().clone());
    assert_error(env.send(&ixs, &[&user]), "MultipleFeeds");
}
#[test]
fn t03_07_attestation_rejections() {
    for mode in 0..8 {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        let u = owner(&user);
        let mut ixs = env.feed_ixs(u, &[(&bag, 1000)], 0);
        let mut expected = "AttestationInvalid";
        match mode {
            0 => {
                let wrong = Keypair::new();
                let message =
                    checks::feed_message(&u, 0, env.now() + 110, &[(bag.mint, 1000)]).unwrap();
                ixs[0].data[16..48].copy_from_slice(wrong.pubkey().as_ref());
                ixs[0].data[48..112].copy_from_slice(wrong.sign_message(&message).as_ref());
            }
            1 => {
                let message =
                    checks::feed_message(&u, 1, env.now() + 110, &[(bag.mint, 1000)]).unwrap();
                ixs[0] = env.attest_ix(&message);
            }
            2 => {
                let message =
                    checks::feed_message(&u, 0, env.now() + 109, &[(bag.mint, 1000)]).unwrap();
                ixs[0] = env.attest_ix(&message);
            }
            3 => {
                let mut message =
                    checks::feed_message(&u, 0, env.now() + 110, &[(bag.mint, 1000)]).unwrap();
                message[12..44].copy_from_slice(Pubkey::new_unique().as_ref());
                ixs[0] = env.attest_ix(&message);
            }
            4 | 5 => {
                let expiry = if mode == 4 {
                    env.now() - 1
                } else {
                    env.now() + 121
                };
                let message = checks::feed_message(&u, 0, expiry, &[(bag.mint, 1000)]).unwrap();
                ixs[0] = env.attest_ix(&message);
                write_u64(&mut ixs.last_mut().unwrap().data, 20, expiry as u64);
                expected = "AttestationExpired";
            }
            6 => {
                *ixs.last_mut().unwrap().data.last_mut().unwrap() = 1;
            }
            _ => {
                *ixs.last_mut().unwrap().data.last_mut().unwrap() = 255;
            }
        }
        assert_error(env.send(&ixs, &[&user]), expected);
    }
    // Malformed layouts are rejected by the real Ed25519 precompile before Feed.
    for mode in 0..3 {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        let mut ixs = env.feed_ixs(owner(&user), &[(&bag, 1000)], 0);
        match mode {
            0 => write_u16(&mut ixs[0].data, 4, 1),
            1 => ixs[0].data[0] = 2,
            _ => write_u16(&mut ixs[0].data, 10, u16::MAX),
        };
        assert!(env.send(&ixs, &[&user]).is_err());
        assert!(entries(&env).is_empty());
    }
    let mut env = Env::new();
    let user = env.user();
    let a = fresh_bag(&mut env, &user);
    let b = fresh_bag(&mut env, &user);
    let mut ixs = env.feed_ixs(owner(&user), &[(&a, 1000), (&b, 1000)], 0);
    let m = checks::feed_message(
        &owner(&user),
        0,
        env.now() + 110,
        &[(b.mint, 1000), (a.mint, 1000)],
    )
    .unwrap();
    ixs[0] = env.attest_ix(&m);
    assert_error(env.send(&ixs, &[&user]), "AttestationInvalid");
}
#[test]
fn t03_08_nonce_window() {
    let mut env = Env::new();
    let user = env.user();
    for nonce in [2, 0, 1] {
        let bag = fresh_bag(&mut env, &user);
        env.feed(&user, &bag, 1000, nonce).unwrap();
    }
    let at = pda(&[b"binder", owner(&user).as_ref()]).0;
    assert_eq!(env.state::<Binder>(at).feed_nonce_base, 3);
    let bag = fresh_bag(&mut env, &user);
    assert_error(env.feed(&user, &bag, 1000, 1), "AttestationReplay");
    env.feed(&user, &bag, 1000, 40).unwrap();
    assert_eq!(env.state::<Binder>(at).feed_nonce_base, 25);
}
#[test]
fn t03_09_phase_rules() {
    for phase in 0..=4 {
        let mut env = Env::new();
        env.inject_phase(phase);
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        let result = env.feed(&user, &bag, 1000, 0);
        if (1..=3).contains(&phase) {
            result.unwrap();
        } else {
            assert_error(result, "WrongPhase");
        }
    }
    let mut env = Env::new();
    env.inject_phase(3);
    env.warp(params::SEASON_DURATION_SECONDS + 1);
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    assert_error(env.feed(&user, &bag, 1000, 0), "SeasonOver");
}
#[test]
fn t03_10_pause_and_role() {
    for mode in 0..3 {
        let mut env = Env::new();
        config(&mut env, |c| match mode {
            0 => c.guardian_paused = 2,
            1 => c.admin_paused = 2,
            _ => c.disabled_roles = 1 << 5,
        });
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        assert_error(
            env.feed(&user, &bag, 1000, 0),
            if mode == 2 { "RoleDisabled" } else { "Paused" },
        );
    }
}
#[test]
fn t03_11_team_and_non_wallet_rejected() {
    for team in [true, false] {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        let u = owner(&user);
        env.token_account(env.vault_auth, &bag, 0);
        if team {
            config(&mut env, |c| c.team_wallets[0] = u);
        } else {
            env.mutate(u, |a| a.owner = addr(&Pubkey::new_unique()));
        }
        assert_error(
            env.feed(&user, &bag, 1000, 0),
            if team { "TeamWallet" } else { "NotWallet" },
        );
    }
}
#[test]
fn t03_12_fresh_cap() {
    let mut env = Env::new();
    let user = env.user();
    let mut first = None;
    for nonce in 0..25 {
        let bag = fresh_bag(&mut env, &user);
        env.feed(&user, &bag, 1000, nonce).unwrap();
        first.get_or_insert(bag);
    }
    let extra = fresh_bag(&mut env, &user);
    assert_error(env.feed(&user, &extra, 1000, 25), "FreshCapReached");
    let bag = first.unwrap();
    env.send(&[env.take_back_ix(owner(&user), &bag, 0, 1000)], &[&user])
        .unwrap();
    env.feed(&user, &extra, 1000, 25).unwrap();
    assert_eq!(
        env.state::<Binder>(pda(&[b"binder", owner(&user).as_ref()]).0)
            .fresh_in_deck,
        25
    );
}
#[test]
fn t03_13_bad_inputs() {
    for mode in 0..3 {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 2000);
        let mut ixs = if mode == 0 {
            env.feed_ixs(owner(&user), &[(&bag, 1000), (&bag, 1000)], 0)
        } else {
            env.feed_ixs(owner(&user), &[(&bag, if mode == 1 { 0 } else { 1000 })], 0)
        };
        if mode == 2 {
            ixs.last_mut().unwrap().accounts.pop();
        }
        assert_error(
            env.send(&ixs, &[&user]),
            if mode == 0 {
                "DuplicateMint"
            } else {
                "InvalidArgument"
            },
        );
    }
}
#[test]
fn t03_14_prefunded_pdas() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    for at in [
        pda(&[b"ledger", bag.mint.as_ref()]).0,
        pda(&[b"binder", owner(&user).as_ref()]).0,
    ] {
        env.donate_lamports(at, 12345);
    }
    env.feed(&user, &bag, 1000, 0).unwrap();
    check_intake(&env);
}
#[test]
fn t03_15_vault_and_ledger_mismatch() {
    for ledger in [false, true] {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        let mut ixs = env.feed_ixs(owner(&user), &[(&bag, 1000)], 0);
        if ledger {
            ixs.last_mut().unwrap().accounts[9].pubkey = addr(&Pubkey::new_unique());
        } else {
            let other = env.token_account(Pubkey::new_unique(), &bag, 0);
            ixs.last_mut().unwrap().accounts[8].pubkey = addr(&other);
        }
        assert_error(
            env.send(&ixs, &[&user]),
            if ledger {
                "LedgerMismatch"
            } else {
                "VaultMismatch"
            },
        );
    }
}
#[test]
fn t03_16_deck_full() {
    let mut env = Env::new();
    env.inject_deck(params::COVERAGE_DECK_MAX - 1);
    let user = env.user();
    let a = fresh_bag(&mut env, &user);
    let b = fresh_bag(&mut env, &user);
    assert_error(
        env.send(
            &env.feed_ixs(owner(&user), &[(&a, 1000), (&b, 1000)], 0),
            &[&user],
        ),
        "DeckFull",
    );
}
#[test]
fn t03_17_deck_underfunded_after_rent_increase() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    env.feed(&user, &bag, 1000, 0).unwrap();
    let saved = entries(&env)[0];
    let filler = env.inject_deck(10_000);
    let filler_ledger = pda(&[b"ledger", filler.mint.as_ref()]).0;
    edit_state::<MintLedger>(&mut env, filler_ledger, |l| l.accounted -= 1000);
    env.mutate(env.deck, |a| {
        a.data[64..144].copy_from_slice(bytemuck::bytes_of(&saved))
    });
    env.set_rent(6960);
    let extra = fresh_bag(&mut env, &user);
    assert_error(env.feed(&user, &extra, 1000, 1), "DeckUnderfunded");
    env.send(&[env.take_back_ix(owner(&user), &bag, 0, 1000)], &[&user])
        .unwrap();
}
#[test]
fn t03_18_second_depositor_same_mint() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let first = env.user_with_bag(&bag, 1000);
    let second = env.user_with_bag(&bag, 2000);
    env.feed(&first, &bag, 1000, 0).unwrap();
    env.feed(&second, &bag, 2000, 0).unwrap();
    let l = env.state::<MintLedger>(pda(&[b"ledger", bag.mint.as_ref()]).0);
    assert_eq!(l.payer, owner(&first));
    assert_eq!(l.accounted, 3000);
    check_intake(&env);
}
#[test]
fn t03_19_vault_precreated_by_attacker() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    let attacker = env.user();
    env.send(
        &[env.create_ata_ix(env.vault_auth, &bag, owner(&attacker))],
        &[&attacker],
    )
    .unwrap();
    env.feed(&user, &bag, 1000, 0).unwrap();
    env.send(&[env.take_back_ix(owner(&user), &bag, 0, 1000)], &[&user])
        .unwrap();
    let vault = ata(&env.vault_auth, &bag.mint, &bag.token_program);
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    let before = env.account(owner(&user)).lamports;
    let refund = env.account(vault).lamports + env.account(ledger).lamports;
    let ix = instruction(
        "close_vault",
        vec![
            meta(env.machine, false, false),
            meta(bag.mint, true, false),
            meta(ledger, true, false),
            meta(vault, true, false),
            meta(env.vault_auth, false, false),
            meta(owner(&user), true, false),
            meta(bag.token_program, false, false),
        ],
        &[],
    );
    env.send(&[ix], &[]).unwrap();
    assert_eq!(env.account(owner(&user)).lamports, before + refund);
}
#[test]
fn t03_20_depositor_cannot_pay() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    env.mutate(owner(&user), |a| a.lamports = 1);
    assert!(env.feed(&user, &bag, 1000, 0).is_err());
    assert!(entries(&env).is_empty());
    assert_eq!(
        token_amount(&env, ata(&owner(&user), &bag.mint, &bag.token_program)),
        1000
    );
}
#[test]
fn t03_21_feed_via_cpi_rejected() {
    let mut env = Env::new();
    let bag = env.new_pump_mint(false);
    let user = env.user_with_bag(&bag, 1000);
    let mut ixs = env.feed_ixs(owner(&user), &[(&bag, 1000)], 0);
    let feed = ixs.pop().unwrap();
    let mut data = vec![0xf3];
    data.extend_from_slice(&feed.data);
    let mut accounts = vec![meta(onepercent::ID, false, false)];
    accounts.extend(feed.accounts);
    ixs.push(Instruction {
        program_id: addr(&vrf()),
        accounts,
        data,
    });
    assert_error(env.send(&ixs, &[&user]), "NotTopLevel");
    assert!(entries(&env).is_empty());
}
