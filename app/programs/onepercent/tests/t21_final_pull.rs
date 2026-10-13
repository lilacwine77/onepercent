mod common;
#[path = "common/final_cases.rs"]
mod final_cases;
#[path = "common/mycards.rs"]
mod mycards;
use common::{
    exec_cases::machine,
    pack_cases::{binder, cards, events, pause_all},
    *,
};
use final_cases::*;
use onepercent::{constants::*, events::*, params, state::*};
use solana_signer::Signer;

#[test]
fn start_rules_and_frozen_pools() {
    let (mut e, owner, _, _) = common::pack_cases::setup(false);
    let (pull, _) = e.buy(&owner, 0, 1).unwrap();
    assert_error(e.send(&[start(&e)], &[]), "WrongPhase");
    due(&mut e);
    machine(&mut e, |m| m.end_ts += 1);
    assert_error(e.send(&[start(&e)], &[]), "FinalPullNotDue");
    e.warp(1);
    assert_error(e.send(&[start(&e)], &[]), "PullPending");
    e.fulfill(pull, [8; 32]).unwrap();
    machine(&mut e, |m| m.exec.kind = EXEC_KIND_STOCK_SELL);
    assert_error(e.send(&[start(&e)], &[]), "ExecInFlight");
    machine(&mut e, |m| m.exec.kind = 0);
    pause_all(&mut e);
    let before = e.state::<Machine>(e.machine);
    let config_before = e.account(e.config).data;
    e.donate_lamports(e.machine, 177);
    let receipt = e.send(&[start(&e)], &[]).unwrap();
    let m = e.state::<Machine>(e.machine);
    assert_eq!((m.phase, m.final_ts), (5, e.now()));
    assert_eq!((m.stock_sol, m.jackpot_sol), (0, 0));
    assert_eq!(m.final_pool_sol, before.stock_sol + before.jackpot_sol);
    assert_eq!(m.final_sol_total, m.final_pool_sol);
    assert_eq!(m.buckets[0].final_pool, before.buckets[0].amount);
    assert_eq!((m.burn_sol, m.team_sol), (before.burn_sol, before.team_sol));
    assert_eq!(
        events::<FinalPullStarted>(&receipt)[0].total_spend,
        before.total_spend
    );
    assert_eq!(e.account(e.config).data, config_before);
    assert_error(e.send(&[start(&e)], &[]), "WrongPhase");
    // Revealed, unsettled draws cannot prevent the snapshot or their own exit.
    e.settle(pull, 0).unwrap();
    e.check_invariants();
}

#[test]
fn floor_shares_idempotence_zero_bits_and_late_claims() {
    let mut e = Env::new();
    let owners: Vec<_> = (0..12).map(|_| e.user()).collect();
    for (i, user) in owners.iter().enumerate() {
        let key = pubkey(&user.pubkey());
        e.binder(key, &[], 0, 0);
        spend(&mut e, key, i as u64);
    }
    machine(&mut e, |m| {
        m.stock_sol = 1_000_000_007;
        m.total_spend = 66;
    });
    e.donate_lamports(e.machine, 1_000_000_007 + 123);
    snapshot(&mut e);
    e.warp(params::SEASON_SEAL_DELAY_SECONDS - 1);
    e.send(&[advance(&e)], &[]).unwrap();
    assert_eq!(e.state::<Machine>(e.machine).phase, 5);
    e.warp(1);
    e.send(&[advance(&e)], &[]).unwrap();
    assert_eq!(e.state::<Machine>(e.machine).phase, 6);
    e.warp(365 * 86400);
    pause_all(&mut e);
    let mut paid = 0;
    for (i, user) in owners.iter().enumerate() {
        let key = pubkey(&user.pubkey());
        let before = e.account(key).lamports;
        let receipt = e
            .send(
                &[sol(&e, key, true), sol(&e, key, true), tokens(&e, key)],
                &[user],
            )
            .unwrap();
        let share = 1_000_000_007u128 * i as u128 / 66;
        assert_eq!(e.account(key).lamports - before, share as u64);
        assert_eq!(events::<FinalSolClaimed>(&receipt).len(), 1);
        assert_eq!(events::<FinalTokensClaimed>(&receipt).len(), 1);
        assert_eq!(e.state::<Binder>(binder(key)).flags & 3, 3);
        let repeat = e.send(&[tokens(&e, key)], &[user]).unwrap();
        assert!(events::<FinalTokensClaimed>(&repeat).is_empty());
        paid += share as u64;
    }
    assert_eq!(
        e.state::<Machine>(e.machine).final_pool_sol + paid,
        1_000_000_007
    );
    let zero = pubkey(&owners[0].pubkey());
    e.send(
        &[instruction(
            "close_binder",
            vec![meta(zero, true, true), meta(binder(zero), true, false)],
            &[],
        )],
        &[&owners[0]],
    )
    .unwrap();
    e.check_invariants();
}

#[test]
fn sol_payee_is_bound_and_uncreditable_share_is_backed_owed() {
    for mode in 0..4 {
        let mut e = Env::new();
        let user = e.user();
        let owner = pubkey(&user.pubkey());
        e.binder(owner, &[], 0, 0);
        spend(&mut e, owner, 1);
        machine(&mut e, |m| {
            m.stock_sol = 1;
            m.total_spend = 1;
        });
        e.donate_lamports(e.machine, 1);
        snapshot(&mut e);
        if mode == 0 {
            assert_error(e.send(&[sol(&e, owner, false)], &[]), "AccountMismatch");
        } else if mode == 1 {
            e.mutate(owner, |a| a.lamports = 0);
        } else if mode == 2 {
            e.mutate(owner, |a| a.owner = addr(&vrf()));
        } else {
            let other = e.user();
            let mut wrong = sol(&e, owner, true);
            wrong.accounts[2].pubkey = other.pubkey();
            assert!(e.send(&[wrong], &[]).is_err());
        }
        let before = e.account(binder(owner)).lamports;
        e.send(&[sol(&e, owner, mode != 2)], &[]).unwrap();
        let owed = u64::from(mode == 1 || mode == 2);
        assert_eq!(e.state::<Binder>(binder(owner)).sol_owed, owed);
        assert_eq!(e.account(binder(owner)).lamports, before + owed);
        assert_eq!(e.state::<Machine>(e.machine).final_pool_sol, 0);
        if owed > 0 {
            e.fund(owner, 1_000_000_000);
            e.send(
                &[instruction(
                    "withdraw_owed",
                    vec![meta(owner, true, true), meta(binder(owner), true, false)],
                    &[],
                )],
                &[&user],
            )
            .unwrap();
            assert_eq!(e.state::<Binder>(binder(owner)).sol_owed, 0);
        }
    }
}

#[test]
fn seventeen_final_cards_preserve_ledgers_and_redeem_with_changed_rent() {
    let mut e = Env::new();
    let user = e.user();
    let owner = pubkey(&user.pubkey());
    e.binder(owner, &[], 0, 0);
    spend(&mut e, owner, 1);
    let coin = e.new_pump_mint(false);
    let mut bags = vec![coin.clone()];
    e.token_account(e.vault_auth, &coin, 9);
    e.set_state(
        pda(&[b"ledger", coin.mint.as_ref()]).0,
        &MintLedger {
            mint: coin.mint,
            payer: owner,
            accounted: 9,
        },
        &[],
        0,
    );
    machine(&mut e, |m| {
        m.total_spend = 1;
        m.token_mint = coin.mint;
        m.onepct[0].amount = 7;
        m.onepct[0].state = 0;
        for slot in &mut m.onepct[1..] {
            slot.state = 2;
        }
        m.jackpot_tokens = 2;
    });
    for index in 0..16 {
        let bag = e.new_pump_mint(index % 2 != 0);
        e.seed_bucket(index, &bag, 1, 10 + index as u64, 100);
        bags.push(bag);
    }
    machine(&mut e, |m| m.buckets[3].enabled = 0);
    snapshot(&mut e);
    pause_all(&mut e);
    e.set_rent(6000);
    e.donate_lamports(e.machine, e.rent_min(3808));
    let ledgers: Vec<_> = bags
        .iter()
        .map(|b| e.account(pda(&[b"ledger", b.mint.as_ref()]).0).data)
        .collect();
    let receipt = e.send(&[tokens(&e, owner)], &[&user]).unwrap();
    assert_eq!(events::<FinalTokensClaimed>(&receipt)[0].cards, 17);
    let owned = cards(&e, owner);
    assert_eq!(owned.len(), 17);
    for (index, card) in owned.iter().enumerate() {
        assert_eq!(
            (card.kind, card.value, card.edition, card.flags, card.seq_lo),
            (8, 0, 255, 0, 0)
        );
        assert_eq!(card.mint, bags[index].mint);
        assert_eq!(
            e.account(pda(&[b"ledger", card.mint.as_ref()]).0).data,
            ledgers[index]
        );
    }
    for index in (0..17).rev() {
        let bag = &bags[index];
        e.send(
            &[
                e.create_ata_ix(owner, bag, owner),
                e.redeem_ix(owner, bag, index as u16, owned[index].amount),
            ],
            &[&user],
        )
        .unwrap();
    }
    assert_eq!(e.state::<Binder>(binder(owner)).len, 0);
    assert_eq!(e.state::<Machine>(e.machine).final_pool_1pct, 0);
}

#[test]
fn claim_exec_lock_and_wrong_phase_are_atomic() {
    let mut e = Env::new();
    let user = e.user();
    let owner = pubkey(&user.pubkey());
    e.binder(owner, &[], 0, 0);
    assert_error(e.send(&[sol(&e, owner, true)], &[]), "WrongPhase");
    assert_error(e.send(&[tokens(&e, owner)], &[&user]), "WrongPhase");
    snapshot(&mut e);
    machine(&mut e, |m| m.exec.kind = 3);
    assert_error(e.send(&[sol(&e, owner, true)], &[]), "ExecInFlight");
    assert_error(e.send(&[tokens(&e, owner)], &[&user]), "ExecInFlight");
    assert_eq!(e.state::<Binder>(binder(owner)).flags & 3, 0);
}

#[test]
fn zero_entitlement_with_nonzero_spend_unlocks_binder_close() {
    let mut e = Env::new();
    let user = e.user();
    let owner = pubkey(&user.pubkey());
    e.binder(owner, &[], 0, 0);
    spend(&mut e, owner, 1);
    machine(&mut e, |m| m.total_spend = 1);
    assert_error(
        e.send(&[mycards::close_binder_ix(owner)], &[&user]),
        "FinalNotClaimed",
    );
    snapshot(&mut e);
    pause_all(&mut e);
    e.send(&[sol(&e, owner, false), tokens(&e, owner)], &[&user])
        .unwrap();
    assert_eq!(e.state::<Binder>(binder(owner)).flags & 3, 3);
    e.send(&[mycards::close_binder_ix(owner)], &[&user])
        .unwrap();
    assert!(e.closed(binder(owner)));
}

#[test]
fn higher_machine_rent_preserves_unpaid_entitlement_until_topup() {
    let mut e = Env::new();
    let user = e.user();
    let owner = pubkey(&user.pubkey());
    e.binder(owner, &[], 0, 0);
    spend(&mut e, owner, 1);
    machine(&mut e, |m| {
        m.total_spend = 1;
        m.stock_sol = 1_000_000;
    });
    e.donate_lamports(e.machine, 1_000_000);
    snapshot(&mut e);
    e.set_rent(6000);
    let underfunded = e.rent_min(3808) + 999_999;
    e.mutate(e.machine, |a| a.lamports = underfunded);
    assert_error(e.send(&[sol(&e, owner, true)], &[]), "VaultInvariant");
    assert_eq!(e.state::<Binder>(binder(owner)).flags & 1, 0);
    assert_eq!(e.state::<Machine>(e.machine).final_pool_sol, 1_000_000);
    e.donate_lamports(e.machine, e.rent_min(3808));
    e.send(&[sol(&e, owner, true)], &[]).unwrap();
    assert_eq!(e.state::<Machine>(e.machine).final_pool_sol, 0);
}
