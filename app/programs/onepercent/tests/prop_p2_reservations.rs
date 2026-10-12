#[path = "common/intake_cases.rs"]
mod cases;
mod common;
#[path = "common/history.rs"]
mod history;
use history::History;
#[path = "common/property.rs"]
mod property;
use anchor_lang::{prelude::Pubkey, AnchorSerialize};
use cases::*;
use common::*;
use onepercent::{
    instructions::GuardianAction,
    params,
    state::{Binder, Machine, PackRecord, Pull},
};
use proptest::prelude::*;
use solana_signer::Signer;

fn pending_model(
    env: &Env,
    pulls: &[Pubkey],
    buyers: &[solana_keypair::Keypair],
    checked_transactions: &mut usize,
) {
    env.check_invariants();
    let machine = env.state::<Machine>(env.machine);
    let mut reserved = [0u64; 16];
    let mut dust = 0;
    let mut count = 0;
    let mut slots = std::collections::BTreeMap::<Pubkey, u16>::new();
    for at in pulls {
        if env.closed(*at) {
            continue;
        }
        let pull = env.state::<Pull>(*at);
        if pull.status != 1 {
            continue;
        }
        count += 1;
        dust += u64::from(pull.qty) * u64::from(params::CARDS_PER_PACK_DUST);
        *slots.entry(pull.buyer).or_default() += u16::from(pull.qty) * 5;
        let data = env.account(*at).data;
        let need = (u128::from(pull.price) * u128::from(params::COVERAGE_PER_PACK_VALUE_BPS)
            / u128::from(params::BPS_DENOMINATOR)) as u64;
        let smallest = u128::from(pull.price) * u128::from(params::HIT_TIERS_VALUE_BPS[0])
            / u128::from(params::BPS_DENOMINATOR);
        for i in 0..usize::from(pull.qty) {
            let pack: PackRecord =
                bytemuck::pod_read_unaligned(&data[176 + i * 200..176 + (i + 1) * 200]);
            let index = usize::from(pack.backing);
            assert!(index < 16);
            reserved[index] += need;
            let bucket = &machine.buckets[index];
            assert_eq!(bucket.class, 1);
            assert!(bucket.cost > 0);
            assert!(
                smallest * u128::from(bucket.amount) >= u128::from(bucket.cost),
                "D12 pending Pull lost its smallest unit"
            );
        }
    }
    assert_eq!(machine.pending_pulls, count);
    assert_eq!(machine.reserved_dust, dust);
    for (index, bucket) in machine.buckets.iter().enumerate() {
        assert_eq!(bucket.reserved, reserved[index]);
        assert!(bucket.cost >= bucket.reserved);
    }
    for buyer in buyers {
        let key = pubkey(&buyer.pubkey());
        let at = pda(&[b"binder", key.as_ref()]).0;
        if !env.closed(at) {
            assert_eq!(
                env.state::<Binder>(at).reserved,
                *slots.get(&key).unwrap_or(&0)
            );
        }
    }
    for tx in env.transactions.iter().skip(*checked_transactions) {
        for name in ["HitSkipped", "CardDropped", "VaultShortfall"] {
            assert!(
                event_bytes(&tx.logs, name).is_empty(),
                "{name} on a valid covered state"
            );
        }
    }
    *checked_transactions = env.transactions.len();
}
fn run_case(steps: Vec<(u8, u16, [u8; 32])>) -> proptest::test_runner::TestCaseResult {
    let mut env = Env::new();
    let mut checked_transactions = 0;
    env.inject_deck(1000);
    let coarse = env.new_pump_mint(false);
    env.seed_bucket(0, &coarse, 1, 1, 2 * params::LAMPORTS_PER_SOL);
    let granular = env.new_pump_mint(false);
    env.seed_bucket(1, &granular, 1, 600, 30 * params::LAMPORTS_PER_SOL);
    let larger = env.new_pump_mint(false);
    env.seed_bucket(2, &larger, 1, 100, 30 * params::LAMPORTS_PER_SOL);
    env.inject_phase(3);
    let buyers = [env.user(), env.user(), env.user()];
    let guard = env.guardian.insecure_clone();
    let mut pulls = Vec::new();
    let mut history = History::new(&env);
    for buyer in &buyers {
        let (at, _) = env.buy(buyer, 0, 1).unwrap();
        pulls.push(at);
    }
    pending_model(&env, &pulls, &buyers, &mut checked_transactions);
    history.check(&env);
    // The first Silver carve occurs while two other Pulls remain backed.
    env.fulfill(pulls[0], [0; 32]).unwrap();
    let first: PackRecord = bytemuck::pod_read_unaligned(&env.account(pulls[0]).data[176..376]);
    assert_eq!((first.tier, first.backing, first.carved_bucket), (1, 1, 1));
    assert_eq!(env.state::<Machine>(env.machine).buckets[0].amount, 1);
    assert_eq!(env.state::<Machine>(env.machine).buckets[1].amount, 599);
    env.settle(pulls[0], 0).unwrap();
    pending_model(&env, &pulls, &buyers, &mut checked_transactions);
    history.check(&env);
    for (op, arg, randomness) in steps {
        let index = usize::from(arg);
        match op {
            0 => {
                let buyer = &buyers[index % 3];
                match env.buy(buyer, (arg % 4) as u8, 1) {
                    Ok((at, _)) => pulls.push(at),
                    Err(e) => prop_assert!(
                        e.meta
                            .logs
                            .iter()
                            .any(|l| l.contains("Refilling") || l.contains("MachineHungry")),
                        "unexpected purchase failure: {e:?}"
                    ),
                }
            }
            1 | 2 => {
                let pending: Vec<_> = pulls
                    .iter()
                    .copied()
                    .filter(|at| !env.closed(*at) && env.state::<Pull>(*at).status == 1)
                    .collect();
                if !pending.is_empty() {
                    let at = pending[index % pending.len()];
                    let p = env.state::<Pull>(at);
                    if env.now() > p.created_ts + params::VRF_TIMEOUT_SECONDS {
                        env.send(&[env.refund_ix(at)], &[]).unwrap();
                    } else {
                        env.fulfill(at, randomness).unwrap();
                        env.settle(at, 0).unwrap();
                    }
                }
            }
            3 => env.warp(i64::from(arg % 401)),
            _ => {
                let action = GuardianAction::DisableBucket {
                    index: (arg % 3) as u8,
                };
                env.send(&[env.guardian_ix(action.try_to_vec().unwrap())], &[&guard])
                    .unwrap();
            }
        }
        pending_model(&env, &pulls, &buyers, &mut checked_transactions);
        history.check(&env);
    }
    env.warp(params::VRF_TIMEOUT_SECONDS + 1);
    for at in &pulls {
        if !env.closed(*at) {
            let p = env.state::<Pull>(*at);
            if p.status == 1 {
                env.send(&[env.refund_ix(*at)], &[]).unwrap();
            } else {
                env.settle(*at, 0).unwrap();
            }
        }
    }
    pending_model(&env, &pulls, &buyers, &mut checked_transactions);
    history.check(&env);
    prop_assert_eq!(env.state::<Machine>(env.machine).pending_pulls, 0);
    Ok(())
}

#[test]
fn p2_d12_exact_pending_reservations_under_interleaved_reveal_refund_disable() {
    property::parallel(
        file!(),
        || prop::collection::vec((0u8..5, any::<u16>(), any::<[u8; 32]>()), 200),
        run_case,
    );
}
