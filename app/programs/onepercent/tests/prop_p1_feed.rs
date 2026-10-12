#[path = "common/intake_cases.rs"]
mod cases;
mod common;
#[path = "common/history.rs"]
mod history;
use history::History;
#[path = "common/property.rs"]
mod property;
use anchor_lang::AnchorSerialize;
use cases::*;
use common::*;
use onepercent::{events::BagTakenBack, instructions::GuardianAction, state::Binder};
use proptest::prelude::*;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

#[allow(deprecated)]
fn assert_every_live_entry_can_exit(env: &Env, users: &[Keypair], issued: &[(usize, Bag, u64)]) {
    for (index, entry) in entries(env).iter().enumerate() {
        let (owner_index, bag, _) = issued
            .iter()
            .find(|(_, bag, _)| bag.mint == entry.mint)
            .unwrap();
        let user = &users[*owner_index];
        let blockhash = env.svm.latest_blockhash();
        let message = Message::new_with_blockhash(
            &[env.take_back_ix(entry.depositor, bag, index as u32, entry.amount)],
            Some(&env.authority.pubkey()),
            &blockhash,
        );
        let tx = Transaction::new(&[&env.authority, user], message, blockhash);
        let simulation = match env.svm.simulate_transaction(tx) {
            Ok(simulation) => simulation,
            Err(error) => {
                assert!(error
                    .meta
                    .logs
                    .iter()
                    .any(|line| line.contains("PayeeBelowRent")));
                let wallet = env
                    .svm
                    .get_account(&addr(&entry.depositor))
                    .unwrap_or_default();
                let minimum = env.rent_min(wallet.data.len());
                assert!(wallet.lamports < minimum);
                let top_up = ix(anchor_lang::solana_program::system_instruction::transfer(
                    &pubkey(&env.authority.pubkey()),
                    &entry.depositor,
                    minimum - wallet.lamports,
                ));
                let message = Message::new_with_blockhash(
                    &[
                        top_up,
                        env.take_back_ix(entry.depositor, bag, index as u32, entry.amount),
                    ],
                    Some(&env.authority.pubkey()),
                    &blockhash,
                );
                env.svm
                    .simulate_transaction(Transaction::new(
                        &[&env.authority, user],
                        message,
                        blockhash,
                    ))
                    .unwrap()
            }
        };
        assert!(event_bytes(&simulation.meta.logs, "VaultShortfall").is_empty());
    }
}

fn valid_intake(env: &Env, checked_transactions: &mut usize) {
    env.check_invariants();
    for tx in env.transactions.iter().skip(*checked_transactions) {
        assert!(event_bytes(&tx.logs, "VaultShortfall").is_empty());
    }
    *checked_transactions = env.transactions.len();
}

#[allow(deprecated)]
fn take_back_after_wallet_top_up(env: &mut Env, user: &Keypair, bag: &Bag, index: u32) {
    let entry = &entries(env)[index as usize];
    let owner = pubkey(&user.pubkey());
    let take_back = env.take_back_ix(owner, bag, index, entry.amount);
    // The effective refund cannot exceed the entry's prepaid deposit.
    // If that upper bound already reaches the wallet floor, ordinary TakeBack
    // remains the appropriate scenario for this entry and current rent rate.
    if u64::from(entry.deposit) >= env.rent_min(0) {
        env.send_with_payer(&[take_back], user, &[]).unwrap();
        return;
    }
    let balance = env.account(owner).lamports;
    let sponsor = pubkey(&env.authority.pubkey());
    env.send(
        &[ix(
            anchor_lang::solana_program::system_instruction::transfer(&owner, &sponsor, balance),
        )],
        &[user],
    )
    .unwrap();
    let watched = [
        env.deck,
        pda(&[b"binder", owner.as_ref()]).0,
        pda(&[b"ledger", bag.mint.as_ref()]).0,
        ata(&env.vault_auth, &bag.mint, &bag.token_program),
        ata(&owner, &bag.mint, &bag.token_program),
    ];
    let before = watched.map(|at| env.account(at));
    match env.send(&[take_back.clone()], &[user]) {
        Ok(tx) => {
            // D20: a zero effective refund needs no wallet top-up.
            assert_eq!(common::pack_cases::events::<BagTakenBack>(&tx)[0].refund, 0);
            assert_eq!(env.svm.get_balance(&addr(&owner)).unwrap_or(0), 0);
        }
        Err(error) => {
            assert_error(Err(error), "PayeeBelowRent");
            for (at, account) in watched.into_iter().zip(before) {
                assert_eq!(env.account(at), account, "rejected TakeBack is atomic");
            }
            assert_eq!(env.svm.get_balance(&addr(&owner)).unwrap_or(0), 0);
            env.send(
                &[ix(
                    anchor_lang::solana_program::system_instruction::transfer(
                        &sponsor,
                        &owner,
                        env.rent_min(0),
                    ),
                )],
                &[],
            )
            .unwrap();
            let tx = env.send(&[take_back], &[user]).unwrap();
            assert!(common::pack_cases::events::<BagTakenBack>(&tx)[0].refund > 0);
            assert!(env.account(owner).lamports >= env.rent_min(0));
        }
    }
    // Restore the fixture's purchase budget through an explicit transfer so
    // later random Feed steps continue exercising their own preconditions.
    let restore = balance.saturating_sub(env.svm.get_balance(&addr(&owner)).unwrap_or(0));
    if restore > 0 {
        env.send(
            &[ix(
                anchor_lang::solana_program::system_instruction::transfer(
                    &sponsor, &owner, restore,
                ),
            )],
            &[],
        )
        .unwrap();
    }
}

fn run_case(steps: Vec<(u8, u16)>) -> proptest::test_runner::TestCaseResult {
    let mut env = Env::new();
    let mut checked_transactions = 0;
    let users = [env.user(), env.user(), env.user()];
    let guard = env.guardian.insecure_clone();
    let mut issued = Vec::<(usize, Bag, u64)>::new();
    let mut history = History::new(&env);
    let first_bag = env.new_pump_mint(false);
    reset_user_bag(&mut env, pubkey(&users[0].pubkey()), &first_bag, 1);
    env.send_with_payer(
        &env.feed_ixs(pubkey(&users[0].pubkey()), &[(&first_bag, 1)], 0),
        &users[0],
        &[],
    )
    .unwrap();
    take_back_after_wallet_top_up(&mut env, &users[0], &first_bag, 0);
    issued.push((0, first_bag, 1));
    valid_intake(&env, &mut checked_transactions);
    history.check(&env);
    for (op, arg) in steps {
        let which = usize::from(arg) % users.len();
        let user = &users[which];
        let owner = pubkey(&user.pubkey());
        match op {
            0..=2 => {
                let bag = env.new_pump_mint(arg % 2 == 0);
                let amount = u64::from(arg) + 1;
                reset_user_bag(&mut env, owner, &bag, amount);
                let binder = pda(&[b"binder", owner.as_ref()]).0;
                let nonce = env
                    .svm
                    .get_account(&addr(&binder))
                    .filter(|a| a.owner == addr(&onepercent::ID) && a.data.len() >= 112)
                    .map_or(0, |_| env.state::<Binder>(binder).feed_nonce_base);
                let result =
                    env.send_with_payer(&env.feed_ixs(owner, &[(&bag, amount)], nonce), user, &[]);
                if let Err(error) = &result {
                    prop_assert!(
                        error.meta.logs.iter().any(|l| [
                            "Paused",
                            "DeckUnderfunded",
                            "FreshCapReached"
                        ]
                        .iter()
                        .any(|name| l.contains(name))),
                        "unexpected Feed failure: {error:?}"
                    );
                }
                issued.push((which, bag, amount));
            }
            3 => {
                let current = entries(&env);
                if !current.is_empty() {
                    let index = usize::from(arg) % current.len();
                    let entry = &current[index];
                    let (record, bag, _) = issued
                        .iter()
                        .find(|(_, b, _)| b.mint == entry.mint)
                        .unwrap();
                    let signer = &users[*record];
                    env.send_with_payer(
                        &[env.take_back_ix(
                            pubkey(&signer.pubkey()),
                            bag,
                            index as u32,
                            entry.amount,
                        )],
                        signer,
                        &[],
                    )
                    .unwrap();
                }
            }
            4 => {
                let choices = [env.deck, pda(&[b"binder", owner.as_ref()]).0, env.machine];
                env.donate_lamports(
                    choices[usize::from(arg) % choices.len()],
                    u64::from(arg) + 1,
                );
            }
            5 => {
                let current = entries(&env);
                if !current.is_empty() {
                    let entry = &current[usize::from(arg) % current.len()];
                    let (_, bag, _) = issued
                        .iter()
                        .find(|(_, b, _)| b.mint == entry.mint)
                        .unwrap();
                    let donation = u64::from(arg) + 1;
                    env.donate_tokens(
                        ata(&env.vault_auth, &bag.mint, &bag.token_program),
                        donation,
                    );
                    env.mutate(bag.mint, |a| {
                        let supply = read_u64(&a.data, 36);
                        write_u64(&mut a.data, 36, supply + donation);
                    });
                }
            }
            6 => env.set_rent([5080, 2575, 1322, 696, 6960][usize::from(arg) % 5]),
            7 => env.warp(i64::from(arg)),
            8 => {
                let action = GuardianAction::SetPause {
                    bits: 2,
                    paused: arg % 2 == 0,
                };
                env.send(&[env.guardian_ix(action.try_to_vec().unwrap())], &[&guard])
                    .unwrap();
            }
            _ => {
                let current = entries(&env);
                if !current.is_empty() {
                    let index = usize::from(arg) % current.len();
                    let entry = &current[index];
                    let (record, bag, _) = issued
                        .iter()
                        .find(|(_, b, _)| b.mint == entry.mint)
                        .unwrap();
                    take_back_after_wallet_top_up(&mut env, &users[*record], bag, index as u32);
                }
            }
        }
        valid_intake(&env, &mut checked_transactions);
        history.check(&env);
        assert_every_live_entry_can_exit(&env, &users, &issued);
    }
    // All actual exits are exercised at the end with every entry still live.
    // Donations and rent changes remain in place, as do all pause bits.
    config(&mut env, |c| {
        c.admin_paused = 31;
        c.guardian_paused = 31;
        c.disabled_roles = 0x78;
    });
    env.inject_phase(6);
    history.check(&env);
    loop {
        let current = entries(&env);
        let Some(entry) = current.last() else {
            break;
        };
        let (index, bag, _) = issued
            .iter()
            .find(|(_, b, _)| b.mint == entry.mint)
            .unwrap();
        let signer = &users[*index];
        env.send_with_payer(
            &[env.take_back_ix(
                pubkey(&signer.pubkey()),
                bag,
                (current.len() - 1) as u32,
                entry.amount,
            )],
            signer,
            &[],
        )
        .unwrap();
        valid_intake(&env, &mut checked_transactions);
        history.check(&env);
    }
    for (index, bag, amount) in issued {
        prop_assert_eq!(
            token_amount(
                &env,
                ata(
                    &pubkey(&users[index].pubkey()),
                    &bag.mint,
                    &bag.token_program
                )
            ),
            amount
        );
    }
    prop_assert!(entries(&env).is_empty());
    Ok(())
}

#[test]
fn p1_feed_take_back_donations_rent_and_pauses() {
    property::parallel(
        file!(),
        || prop::collection::vec((0u8..10, any::<u16>()), 200),
        run_case,
    );
}

// M2 P1's new operation is additive: an attested CPI Feed inside a pair always
// fails before crediting the transfer, irrespective of the surrounding donation.
#[test]
fn p1_cpi_feed_inside_exec_pair_never_credits() {
    property::parallel_named(
        file!(),
        concat!(file!(), ".exec"),
        || prop::collection::vec(any::<u16>(), 200),
        |steps| {
            use common::exec_cases::{cpi, expected, ExecFixture};
            let mut fixture = ExecFixture::new(1, 1, false, false);
            let owner = pubkey(&fixture.market.pubkey());
            let bag = fixture.e.new_pump_mint(false);
            fixture.e.token_account(owner, &bag, 1_000_000);
            for arg in steps {
                fixture.e.warp(i64::from(arg % 61));
                fixture.refresh();
                fixture.e.donate_lamports(fixture.e.machine, u64::from(arg));
                let mut tx = fixture.transaction(1_000_000, expected(&fixture, 1_000_000).1);
                let mut feed = fixture.e.feed_ixs(owner, &[(&bag, 1)], 0);
                let inner = feed.pop().unwrap();
                tx.splice(1..1, feed);
                tx.insert(tx.len() - 1, cpi(inner));
                fixture.reject(&tx, "ExecInFlight");
                prop_assert!(entries(&fixture.e).is_empty());
                fixture.e.check_invariants();
            }
            Ok(())
        },
    );
}
