#[path = "common/callback.rs"]
mod callback;
mod common;
#[path = "common/reference.rs"]
mod reference;

use callback::{events, packs, setup};
use common::*;
use onepercent::{
    events::{BagTakenBack, PackSettled, PullClosed, PullRefunded, RoyaltyRedirected, VaultClosed},
    state::{Binder, Machine, Pull},
};
use solana_signer::Signer;

#[allow(deprecated)]
fn settles_empty_payee_after_rent_increase(mainnet: bool) {
    let (mut env, buyer, dust, _) = setup(mainnet, 58);
    let depositor = env.user();
    let wallet = pubkey(&depositor.pubkey());
    env.token_account(wallet, &dust, 0);
    // Seed a valid REFED Deck owned by a signer. All subsequent removals,
    // wallet draining, revelation and settlement use actual instructions.
    env.mutate(env.deck, |account| {
        for entry in account.data[64..].chunks_exact_mut(80) {
            write_key(entry, 0, &wallet);
        }
    });
    assert_eq!(env.rent_min(0), 650_240);
    let (pull, _) = env.buy(&buyer, 0, 2).unwrap();
    for index in (1..58).rev() {
        env.send(
            &[env.take_back_ix(wallet, &dust, index, 1_000)],
            &[&depositor],
        )
        .unwrap();
    }
    assert_eq!(read_u32(&env.account(env.deck).data, 8), 1);
    assert_eq!(env.account(env.deck).lamports, 1_381_760);
    let transfer = anchor_lang::solana_program::system_instruction::transfer(
        &wallet,
        &pubkey(&buyer.pubkey()),
        env.account(wallet).lamports,
    );
    env.send(&[ix(transfer)], &[&depositor]).unwrap();
    assert_eq!(env.svm.get_balance(&addr(&wallet)).unwrap_or(0), 0);

    env.set_rent(6_960);
    env.fulfill(pull, [1; 32]).unwrap();
    let records = packs(&env, pull);
    assert_eq!(records[0].house_mask, 14);
    assert_eq!(records[1].house_mask, 15);
    let royalty = records[0].royalties[0];
    let nominal = royalty.lamports + royalty.refund;
    let pull_account = env.account(pull);
    let pull_floor = env.rent_min(pull_account.data.len());
    let actual = nominal.min(pull_account.lamports.saturating_sub(pull_floor));
    let wallet_floor = env.rent_min(0);
    assert_eq!(royalty.refund, 45_440);
    assert_eq!(nominal, 2_045_440);
    assert_eq!(pull_account.lamports, 5_621_760);
    assert_eq!(pull_floor, 4_899_840);
    assert_eq!(actual, 721_920);
    assert_eq!(wallet_floor, 890_880);
    println!(
        "rent-payee features={} nominal={} capped={} wallet_floor={} pull_balance={} pull_floor={}",
        if mainnet { "mainnet" } else { "all" },
        nominal,
        actual,
        wallet_floor,
        pull_account.lamports,
        pull_floor
    );
    let stock_before = env.state::<Machine>(env.machine).stock_sol;
    let result = env.settle(pull, 0).unwrap();
    assert_eq!(env.svm.get_balance(&addr(&wallet)).unwrap_or(0), 0);
    assert_eq!(env.account(pull).lamports, pull_floor);
    assert_eq!(env.state::<Pull>(pull).settled_mask, 1);
    assert_eq!(
        env.state::<Machine>(env.machine).stock_sol,
        stock_before + actual
    );
    let redirected = events::<RoyaltyRedirected>(&result);
    assert_eq!(redirected.len(), 1);
    assert_eq!(redirected[0].depositor, wallet);
    assert_eq!(redirected[0].amount, actual);
    assert_eq!((redirected[0].pack, redirected[0].slot), (0, 0));
    let settled = events::<PackSettled>(&result);
    assert_eq!(settled.len(), 1);
    assert_eq!(settled[0].redirected_mask, 1);
    assert_eq!(settled[0].paid, [actual, 0, 0, 0]);
    env.settle(pull, 1).unwrap();
    assert!(env.closed(pull));
    env.check_invariants();
}

#[test]
fn empty_payee_partial_settlement_all_features() {
    settles_empty_payee_after_rent_increase(false);
}

#[test]
fn empty_payee_partial_settlement_mainnet_features() {
    settles_empty_payee_after_rent_increase(true);
}

#[allow(deprecated)]
fn takes_back_to_underfunded_wallet(mainnet: bool) {
    let (mut env, recipient, dust, _) = setup(mainnet, 1);
    let depositor = env.user();
    let wallet = pubkey(&depositor.pubkey());
    env.token_account(wallet, &dust, 0);
    env.mutate(env.deck, |account| {
        write_key(&mut account.data, 64, &wallet)
    });
    let old_minimum = env.rent_min(0);
    let transfer = anchor_lang::solana_program::system_instruction::transfer(
        &wallet,
        &pubkey(&recipient.pubkey()),
        env.account(wallet).lamports - old_minimum,
    );
    env.send(&[ix(transfer)], &[&depositor]).unwrap();
    assert_eq!(env.account(wallet).lamports, 650_240);
    assert_eq!(env.account(env.deck).lamports, 1_381_760);
    env.set_rent(6_960);
    let refund = env.account(env.deck).lamports - env.rent_min(64);
    assert_eq!(refund, 45_440);
    assert_eq!(env.account(wallet).lamports + refund, 695_680);
    assert_eq!(env.rent_min(0), 890_880);
    println!(
        "take-back rent-payee features={} before=650240 refund=45440 after=695680 floor=890880",
        if mainnet { "mainnet" } else { "all" }
    );
    let ledger = pda(&[b"ledger", dust.mint.as_ref()]).0;
    let vault = ata(&env.vault_auth, &dust.mint, &dust.token_program);
    let destination = ata(&wallet, &dust.mint, &dust.token_program);
    let protected = [env.deck, ledger, vault, destination, wallet];
    let before = protected.map(|at| env.account(at));
    let error = env
        .send(&[env.take_back_ix(wallet, &dust, 0, 1_000)], &[&depositor])
        .unwrap_err();
    assert!(events::<BagTakenBack>(&error.meta).is_empty());
    assert_error(Err(error), "PayeeBelowRent");
    for (at, original) in protected.iter().zip(before.iter()) {
        assert_eq!(env.account(*at), *original);
    }
    let top_up = env.rent_min(0) - env.account(wallet).lamports - refund;
    let transfer = anchor_lang::solana_program::system_instruction::transfer(
        &pubkey(&env.authority.pubkey()),
        &wallet,
        top_up,
    );
    // The top-up and exit share a transaction: the runtime checks their final
    // balance, and the program sees the top-up before deciding creditability.
    let result = env
        .send(
            &[ix(transfer), env.take_back_ix(wallet, &dust, 0, 1_000)],
            &[&depositor],
        )
        .unwrap();
    assert_eq!(events::<BagTakenBack>(&result)[0].refund, refund);
    assert_eq!(env.account(wallet).lamports, env.rent_min(0));
    assert_eq!(read_u64(&env.account(destination).data, 64), 1_000);
    assert_eq!(read_u64(&env.account(ledger).data, 72), 0);
    assert_eq!(read_u32(&env.account(env.deck).data, 8), 0);
    env.check_invariants();
}

#[test]
fn take_back_underfunded_wallet_all_features() {
    takes_back_to_underfunded_wallet(false);
}

#[test]
fn take_back_underfunded_wallet_mainnet_features() {
    takes_back_to_underfunded_wallet(true);
}

#[test]
#[allow(deprecated)]
fn take_back_zero_refund_preserves_underfunded_wallet() {
    for mainnet in [false, true] {
        let mut env = Env::with_mainnet(mainnet);
        let dust = env.new_pump_mint(false);
        let depositor = env.user_with_bag(&dust, 1_000);
        let wallet = pubkey(&depositor.pubkey());
        env.feed(&depositor, &dust, 1_000, 0).unwrap();
        let old_minimum = env.rent_min(0);
        let drain = anchor_lang::solana_program::system_instruction::transfer(
            &wallet,
            &pubkey(&env.authority.pubkey()),
            env.account(wallet).lamports - old_minimum,
        );
        env.send(&[ix(drain)], &[&depositor]).unwrap();
        env.set_rent(10_000);
        assert!(env.account(env.deck).lamports < env.rent_min(64));
        assert!(env.account(wallet).lamports < env.rent_min(0));
        let meta = env
            .send(&[env.take_back_ix(wallet, &dust, 0, 1_000)], &[&depositor])
            .unwrap();
        assert_eq!(events::<BagTakenBack>(&meta)[0].refund, 0);
        assert_eq!(env.account(wallet).lamports, old_minimum);
        assert_eq!(
            read_u64(
                &env.account(ata(&wallet, &dust.mint, &dust.token_program))
                    .data,
                64
            ),
            1_000
        );
        env.check_invariants();
    }
}

#[allow(deprecated)]
fn closes_vault_to_underfunded_payer(mainnet: bool) {
    let mut env = Env::with_mainnet(mainnet);
    let dust = env.new_pump_mint(false);
    let depositor = env.user_with_bag(&dust, 1_000);
    let wallet = pubkey(&depositor.pubkey());
    env.feed(&depositor, &dust, 1_000, 0).unwrap();
    env.send(&[env.take_back_ix(wallet, &dust, 0, 1_000)], &[&depositor])
        .unwrap();
    let vault = ata(&env.vault_auth, &dust.mint, &dust.token_program);
    let ledger = pda(&[b"ledger", dust.mint.as_ref()]).0;
    let refund = env.account(vault).lamports + env.account(ledger).lamports;
    assert_eq!(refund, 2_545_080);
    assert_eq!(read_u64(&env.account(vault).data, 64), 0);
    assert_eq!(read_u64(&env.account(ledger).data, 72), 0);

    // A signer may allocate data to its System account after its Feed. Both
    // the allocation and the preceding reduction to the old rent minimum
    // execute through the real System program, without mutating the payer.
    let old_minimum = env.rent_min(2_048);
    let transfer = anchor_lang::solana_program::system_instruction::transfer(
        &wallet,
        &pubkey(&env.authority.pubkey()),
        env.account(wallet).lamports - old_minimum,
    );
    let allocate = anchor_lang::solana_program::system_instruction::allocate(&wallet, 2_048);
    env.send(&[ix(transfer), ix(allocate)], &[&depositor])
        .unwrap();
    assert_eq!(env.account(wallet).data.len(), 2_048);
    assert_eq!(old_minimum, 11_054_080);
    env.set_rent(6_960);
    assert_eq!(env.rent_min(2_048), 15_144_960);
    assert_eq!(env.account(wallet).lamports + refund, 13_599_160);
    println!(
        "close-vault rent-payee features={} before=11054080 refund=2545080 after=13599160 floor=15144960",
        if mainnet { "mainnet" } else { "all" }
    );
    let protected = [dust.mint, vault, ledger, wallet];
    let before = protected.map(|at| env.account(at));
    let error = env
        .send(&[common::pack_cases::close_ix(&env, &dust)], &[])
        .unwrap_err();
    assert!(events::<VaultClosed>(&error.meta).is_empty());
    assert_error(Err(error), "PayeeBelowRent");
    for (at, original) in protected.iter().zip(before.iter()) {
        assert_eq!(env.account(*at), *original);
    }
    let top_up = env.rent_min(2_048) - env.account(wallet).lamports - refund;
    let transfer = anchor_lang::solana_program::system_instruction::transfer(
        &pubkey(&env.authority.pubkey()),
        &wallet,
        top_up,
    );
    let result = env
        .send(
            &[ix(transfer), common::pack_cases::close_ix(&env, &dust)],
            &[],
        )
        .unwrap();
    assert_eq!(events::<VaultClosed>(&result)[0].lamports, refund);
    assert_eq!(env.account(wallet).lamports, env.rent_min(2_048));
    assert!(env.closed(vault) && env.closed(ledger));
    env.check_invariants();
}

#[test]
fn close_vault_underfunded_payer_all_features() {
    closes_vault_to_underfunded_payer(false);
}

#[test]
fn close_vault_underfunded_payer_mainnet_features() {
    closes_vault_to_underfunded_payer(true);
}

#[allow(deprecated)]
fn refunds_pull_with_rent_unsafe_buyer(mainnet: bool) {
    let (mut env, buyer, _, _) = setup(mainnet, 100);
    let wallet = pubkey(&buyer.pubkey());
    let (pull, _) = env.buy(&buyer, 0, 1).unwrap();
    let binder = pda(&[b"binder", wallet.as_ref()]).0;
    let old_minimum = env.rent_min(100_000);
    let transfer = anchor_lang::solana_program::system_instruction::transfer(
        &wallet,
        &pubkey(&env.authority.pubkey()),
        env.account(wallet).lamports - old_minimum,
    );
    let allocate = anchor_lang::solana_program::system_instruction::allocate(&wallet, 100_000);
    env.send(&[ix(transfer), ix(allocate)], &[&buyer]).unwrap();
    env.set_rent(6_960);
    env.warp(300);
    let buyer_before = env.account(wallet).lamports;
    let binder_before = env.account(binder).lamports;
    let refund = env.account(pull).lamports;
    assert!(buyer_before + refund < env.rent_min(100_000));
    let stock_before = env.state::<Machine>(env.machine).stock_sol;
    let result = env.send(&[env.refund_ix(pull)], &[]).unwrap();
    assert!(env.closed(pull));
    assert_eq!(env.account(wallet).lamports, buyer_before);
    assert_eq!(env.account(binder).lamports, binder_before);
    assert_eq!(env.state::<Binder>(binder).reserved, 0);
    assert_eq!(
        env.state::<Machine>(env.machine).stock_sol,
        stock_before + refund
    );
    assert_eq!(events::<PullRefunded>(&result)[0].amount, refund);
    env.check_invariants();
}

#[test]
fn refund_pull_rent_unsafe_buyer_all_features() {
    refunds_pull_with_rent_unsafe_buyer(false);
}

#[test]
fn refund_pull_rent_unsafe_buyer_mainnet_features() {
    refunds_pull_with_rent_unsafe_buyer(true);
}

#[allow(deprecated)]
fn settles_capped_referral(mainnet: bool) {
    let (mut env, buyer, dust, _) = setup(mainnet, 100);
    let buyer_key = pubkey(&buyer.pubkey());
    let depositor = env.user();
    let wallet = pubkey(&depositor.pubkey());
    let referrer = env.user();
    let referrer_key = pubkey(&referrer.pubkey());
    env.token_account(wallet, &dust, 0);
    env.mutate(env.deck, |account| {
        for entry in account.data[64..].chunks_exact_mut(80) {
            write_key(entry, 0, &wallet);
        }
    });
    let pull = pda(&[b"pull", buyer_key.as_ref(), &0u32.to_le_bytes()]).0;
    env.send(
        &[env.buy_ix(buyer_key, 0, 7, 0, Some(referrer_key))],
        &[&buyer],
    )
    .unwrap();
    for index in (0..100).rev() {
        env.send(
            &[env.take_back_ix(wallet, &dust, index, 1_000)],
            &[&depositor],
        )
        .unwrap();
    }
    let drain = anchor_lang::solana_program::system_instruction::transfer(
        &referrer_key,
        &buyer_key,
        env.account(referrer_key).lamports,
    );
    env.send(&[ix(drain)], &[&referrer]).unwrap();
    env.set_rent(6_960);
    env.fulfill(pull, [1; 32]).unwrap();
    assert!(packs(&env, pull)
        .iter()
        .all(|record| record.house_mask == 15));
    for pack in 0..5 {
        env.settle(pull, pack).unwrap();
        let drain = anchor_lang::solana_program::system_instruction::transfer(
            &referrer_key,
            &buyer_key,
            env.account(referrer_key).lamports,
        );
        env.send(&[ix(drain)], &[&referrer]).unwrap();
    }
    let pull_before = env.account(pull);
    let available = pull_before.lamports - env.rent_min(pull_before.data.len());
    assert_eq!(available, 796_480);
    assert!(available < env.rent_min(0));
    let machine_before = env.state::<Machine>(env.machine);
    let result = env.settle(pull, 5).unwrap();
    let settled = events::<PackSettled>(&result);
    assert_eq!(settled.len(), 1);
    assert_eq!(settled[0].referral_paid, 0);
    assert_eq!(settled[0].referral_to_team, 0);
    let redirected = events::<onepercent::events::ReferralRedirected>(&result);
    assert_eq!(redirected.len(), 1);
    assert_eq!(redirected[0].amount, available);
    assert_eq!(redirected[0].referrer, referrer_key);
    let machine_after = env.state::<Machine>(env.machine);
    assert_eq!(
        machine_after.stock_sol,
        machine_before.stock_sol + available
    );
    assert_eq!(machine_after.team_sol, machine_before.team_sol);
    assert_eq!(env.svm.get_balance(&addr(&referrer_key)).unwrap_or(0), 0);
    env.settle(pull, 6).unwrap();
    assert!(env.closed(pull));
    assert_eq!(env.account(referrer_key).lamports, 2_000_000);
    env.check_invariants();
}

#[test]
fn capped_referral_redirects_all_features() {
    settles_capped_referral(false);
}

#[test]
fn capped_referral_redirects_mainnet_features() {
    settles_capped_referral(true);
}

#[allow(deprecated)]
fn settles_aliased_rent_unsafe_buyer(mainnet: bool) {
    let (mut env, buyer, _, _) = setup(mainnet, 100);
    let wallet = pubkey(&buyer.pubkey());
    env.mutate(env.deck, |account| {
        for entry in account.data[64..].chunks_exact_mut(80) {
            write_key(entry, 0, &wallet);
        }
    });
    let (pull, _) = env.buy(&buyer, 0, 1).unwrap();
    let transfer = anchor_lang::solana_program::system_instruction::transfer(
        &wallet,
        &pubkey(&env.authority.pubkey()),
        env.account(wallet).lamports - env.rent_min(100_000),
    );
    let allocate = anchor_lang::solana_program::system_instruction::allocate(&wallet, 100_000);
    env.send(&[ix(transfer), ix(allocate)], &[&buyer]).unwrap();
    env.set_rent(6_960);
    env.fulfill(pull, [1; 32]).unwrap();
    let buyer_before = env.account(wallet).lamports;
    let pull_balance = env.account(pull).lamports;
    let record = packs(&env, pull)[0];
    assert_eq!(record.house_mask, 0);
    assert!(buyer_before + pull_balance < env.rent_min(100_000));
    let royalties: u64 = record.royalties.iter().map(|r| r.lamports + r.refund).sum();
    let stock_before = env.state::<Machine>(env.machine).stock_sol;
    let result = env.settle(pull, 0).unwrap();
    assert!(env.closed(pull));
    assert_eq!(env.account(wallet).lamports, buyer_before);
    assert_eq!(
        env.state::<Machine>(env.machine).stock_sol,
        stock_before + pull_balance
    );
    let redirected = events::<RoyaltyRedirected>(&result);
    assert_eq!(redirected.len(), 4);
    assert!(redirected.iter().all(|event| event.depositor == wallet));
    assert_eq!(
        redirected.iter().map(|event| event.amount).sum::<u64>(),
        royalties
    );
    assert_eq!(events::<PackSettled>(&result)[0].redirected_mask, 15);
    let closed = events::<PullClosed>(&result);
    assert_eq!(closed.len(), 1);
    assert_eq!(closed[0].to, env.machine);
    assert!(closed[0].to_stock);
    assert_eq!(closed[0].lamports, pull_balance - royalties);
    env.check_invariants();
}

#[test]
fn aliased_buyer_and_pull_remainder_redirect_all_features() {
    settles_aliased_rent_unsafe_buyer(false);
}

#[test]
fn aliased_buyer_and_pull_remainder_redirect_mainnet_features() {
    settles_aliased_rent_unsafe_buyer(true);
}
