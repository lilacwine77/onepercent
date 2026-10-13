mod common;
#[path = "common/final_cases.rs"]
mod final_cases;
use anchor_lang::prelude::Pubkey;
use common::{
    exec_cases::{config, ExecFixture},
    pack_cases::{binder, cards, pause_all},
    *,
};
use final_cases::*;
use onepercent::{constants::*, params, state::*};
use solana_signer::Signer;

const PRIOR: &[u8] = include_bytes!("../../../fixtures/upgrade/pre-final-pull.so");

#[test]
fn legacy_initialized_accounts_accept_all_claims_without_layout_migration() {
    let provenance: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/upgrade/provenance.json")).unwrap();
    let hash: String = solana_sha256_hasher::hash(PRIOR)
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(hash, provenance["sha256"].as_str().unwrap());
    assert_eq!(PRIOR.len(), provenance["bytes"].as_u64().unwrap() as usize);
    assert_eq!(&PRIOR[48..52], &3u32.to_le_bytes());
    let mut e = Env::with_legacy_program(PRIOR);
    e.inject_phase(PHASE_ON_AIR);
    e.inject_deck(100);
    let hit = e.new_pump_mint(false);
    e.seed_bucket(0, &hit, 1, 1_000_000_000_000, 300_000_000_000);
    let user = e.user();
    let owner = pubkey(&user.pubkey());
    let (pull, _) = e.buy(&user, 0, 1).unwrap();
    e.fulfill(pull, [1; 32]).unwrap();
    e.settle(pull, 0).unwrap();
    let before = e.account(e.machine);
    let config_before = e.account(e.config);
    assert_eq!(before.data.len(), 3808);
    assert_eq!(read_u64(&before.data, 2640), 0);
    assert_eq!(read_u64(&before.data, 2648), 0);
    let program = std::fs::read(Env::artifact("onepercent.so")).unwrap();
    assert_ne!(program, PRIOR);
    e.install_program(onepercent::ID, &program, pubkey(&e.authority.pubkey()));
    assert_eq!(e.account(e.machine), before);
    assert_eq!(e.account(e.config), config_before);
    let end = e.state::<Machine>(e.machine).end_ts;
    e.warp(end + params::SEASON_FINAL_PULL_DELAY_SECONDS - e.now());
    e.send(
        &[
            advance(&e),
            start(&e),
            sol(&e, owner, true),
            tokens(&e, owner),
        ],
        &[&user],
    )
    .unwrap();
    assert_eq!(e.account(e.machine).data.len(), 3808);
    assert_eq!(e.account(e.config), config_before);
    assert_eq!(e.state::<Binder>(binder(owner)).flags & 3, 3);
    e.check_invariants();
}

#[test]
fn full_legacy_season_to_claims_done_and_permissionless_burn() {
    for migrated in [false, true] {
        let mut f = ExecFixture::new(EXEC_KIND_BURN, 0, migrated, false);
        // The prior artifact processes the purchase, callback and settlement,
        // writing the exact serialized account layout used by the live season.
        let authority = pubkey(&f.e.authority.pubkey());
        f.e.install_program(onepercent::ID, PRIOR, authority);
        let dust = f.e.inject_deck(100);
        let hit = f.e.new_pump_mint(false);
        f.e.seed_bucket(0, &hit, 1, 1_000_000_000_000, 300_000_000_000);
        let user = f.e.user();
        let owner = pubkey(&user.pubkey());
        let user2 = f.e.user();
        let owner2 = pubkey(&user2.pubkey());
        let (pull, _) = f.e.buy(&user, 0, 2).unwrap();
        f.e.fulfill(pull, [7; 32]).unwrap();
        f.e.settle(pull, 0).unwrap();
        f.e.settle(pull, 1).unwrap();
        let (pull2, _) = f.e.buy(&user2, 0, 1).unwrap();
        // Refunds must not contribute to either spend denominator.
        f.e.warp(params::VRF_TIMEOUT_SECONDS + 1);
        f.e.send(&[f.e.refund_ix(pull2)], &[]).unwrap();
        assert_eq!(f.e.state::<Binder>(binder(owner2)).season_spend, 0);
        let serialized = f.e.account(f.e.machine);
        let config_serialized = f.e.account(f.e.config);
        assert_eq!(serialized.data.len(), 3808);
        let current = std::fs::read(Env::artifact("onepercent.so")).unwrap();
        f.e.install_program(onepercent::ID, &current, authority);
        assert_eq!(f.e.account(f.e.machine), serialized);
        assert_eq!(f.e.account(f.e.config), config_serialized);
        let end = f.e.state::<Machine>(f.e.machine).end_ts;
        f.e.warp(end - f.e.now());
        f.e.send(&[advance(&f.e)], &[]).unwrap();
        assert_eq!(f.e.state::<Machine>(f.e.machine).phase, PHASE_BUYS_CLOSED);
        f.e.warp(params::SEASON_FINAL_PULL_DELAY_SECONDS);
        pause_all(&mut f.e);
        let before = f.e.state::<Machine>(f.e.machine);
        f.e.send(&[start(&f.e)], &[]).unwrap();
        f.e.send(&[sol(&f.e, owner, true), tokens(&f.e, owner)], &[&user])
            .unwrap();
        f.e.send(&[sol(&f.e, owner2, true), tokens(&f.e, owner2)], &[&user2])
            .unwrap();
        assert_eq!(
            f.e.state::<Machine>(f.e.machine).final_sol_total,
            before.stock_sol + before.jackpot_sol
        );
        assert_eq!(f.e.state::<Machine>(f.e.machine).final_pool_sol, 0);
        loop {
            let owned = cards(&f.e, owner);
            let Some(card) = owned.last() else { break };
            let bag = if card.mint == hit.mint { &hit } else { &dust };
            f.e.send(
                &[
                    f.e.create_ata_ix(owner, bag, owner),
                    f.e.redeem_ix(owner, bag, (owned.len() - 1) as u16, card.amount),
                ],
                &[&user],
            )
            .unwrap();
        }
        finish(&mut f.e);
        assert_eq!(f.e.state::<Machine>(f.e.machine).phase, PHASE_DONE);
        config(&mut f.e, |c| c.executor = Pubkey::new_unique());
        let sqrt = if migrated {
            125_545_362_027_818_175
        } else {
            128_794_468_968_736_475
        };
        let delta =
            onepercent::math::exec::meteora_buy(50_000_000, sqrt, params::BURN_MIN_OUT_SLIP_BPS)
                .unwrap()
                .min_out;
        let before = f.e.state::<Machine>(f.e.machine);
        f.execute(50_000_000, delta).unwrap();
        let after = f.e.state::<Machine>(f.e.machine);
        assert_eq!(after.burned_total, before.burned_total + delta);
        assert_eq!(after.burn_sol, before.burn_sol - 50_000_000);
        assert_eq!(after.final_pool_sol, 0);
        f.e.check_invariants();
    }
}
