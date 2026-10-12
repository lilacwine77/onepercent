#[path = "common/callback.rs"]
mod callback;
mod common;
#[path = "common/reference.rs"]
mod reference;
#[path = "common/specials_cases.rs"]
mod specials;
use anchor_lang::prelude::Pubkey;
use callback::*;
use common::*;
use onepercent::{events::CallbackSkipped, state::Machine};
use proptest::prelude::*;
use solana_signer::Signer;
use std::cell::RefCell;

struct Fixture {
    env: Env,
    pull: Pubkey,
    binder: Pubkey,
    accounts: [Pubkey; 4],
    baseline: [solana_account::Account; 4],
    instruction: solana_instruction::Instruction,
}
impl Fixture {
    fn new(mainnet: bool) -> Self {
        let (mut env, user, _, _) = setup(mainnet, 100);
        specials::inject(&mut env, [0; 4], 10_000_000, 15_000_000_000);
        let (pull, _) = env.buy(&user, 0, 1).unwrap();
        let binder = pda(&[b"binder", pubkey(&user.pubkey()).as_ref()]).0;
        let accounts = [pull, env.machine, env.deck, binder];
        let baseline = accounts.map(|at| env.account(at));
        let instruction = raw(&env, pull, [0; 32]);
        Self {
            env,
            pull,
            binder,
            accounts,
            baseline,
            instruction,
        }
    }
}
thread_local! {
    static FIXTURES: RefCell<[Option<Fixture>; 2]> = const { RefCell::new([None, None]) };
}

fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000)
}
fn next(value: &mut u64) -> u64 {
    *value = value
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *value
}
fn run_case(seed: u64, mainnet: bool) -> Result<(), TestCaseError> {
    FIXTURES.with(|fixtures| -> Result<(), TestCaseError> {
        let mut fixtures = fixtures.borrow_mut();
        let fixture = fixtures[usize::from(mainnet)].get_or_insert_with(|| Fixture::new(mainnet));
        let Fixture {
            env: e,
            pull,
            binder,
            accounts,
            baseline,
            instruction: base_ix,
        } = fixture;
        let (pull, binder) = (*pull, *binder);
        e.transactions.clear();
        let mut generator = seed;
        let mut skipped_count = 0;
        let mut accepted_count = 0;
        let mut locked_count = 0;
        for step in 0..200 {
            for (at, value) in accounts.iter().zip(baseline.iter()) {
                e.put(*at, value.clone());
            }
            e.set_rent([5080, 2575, 1322, 696, 6960][step % 5]);
            let mut instruction = base_ix.clone();
            let random_bytes = random(next(&mut generator));
            instruction.data[10..42].copy_from_slice(&random_bytes);
            let mode = (next(&mut generator) % 27) as usize;
            let value = next(&mut generator);
            match mode {
                0 => e.mutate(pull, |a| a.owner = addr(&system())),
                1 => e.mutate(pull, |a| a.data[0] ^= 0xff),
                2 => e.mutate(pull, |a| {
                    a.data[146] ^= 0xff;
                }),
                3 => e.mutate(pull, |a| write_u64(&mut a.data, 8, value.saturating_add(2))),
                4 => e.mutate(pull, |a| a.data[144] = 2),
                5 => {
                    let expired = e.now() - 301;
                    e.mutate(pull, |a| write_u64(&mut a.data, 112, expired as u64));
                }
                6 => e.mutate(e.machine, |a| a.owner = addr(&token())),
                7 => e.mutate(e.deck, |a| a.data[0] ^= 0xff),
                8 => e.mutate(binder, |a| write_key(&mut a.data, 8, &Pubkey::new_unique())),
                9 => instruction.accounts[2 + (value as usize % 4)].is_writable = false,
                10 => e.mutate(e.machine, |a| {
                    for byte in &mut a.data[16..] {
                        *byte = next(&mut generator) as u8;
                    }
                    write_u64(&mut a.data, 224 + 64, 0);
                    write_u64(&mut a.data, 224 + 72, 0);
                    write_u64(&mut a.data, 224 + 80, u64::MAX);
                }),
                11 => {
                    let cap = (value % 10_001) as u32;
                    let length = ((value >> 16) % 10_001) as u32;
                    e.mutate(e.deck, |a| {
                        a.data.resize(64 + 80 * cap as usize, 0);
                        write_u32(&mut a.data, 8, length);
                        write_u32(&mut a.data, 12, cap);
                    });
                }
                12 => e.mutate(binder, |a| {
                    write_u16(&mut a.data, 104, value as u16);
                    write_u16(&mut a.data, 108, (value >> 16) as u16);
                }),
                13 => {
                    let qty = (value % 10 + 1) as u8;
                    e.mutate(pull, |a| {
                        a.data.resize(176 + 200 * usize::from(qty), 0);
                        a.data[143] = qty;
                        for record in a.data[176..].chunks_exact_mut(200) {
                            record[192] = (value >> 8) as u8;
                        }
                    });
                }
                14 => {
                    let selected = (value as usize) % 4;
                    let length = ((value >> 16) % 176) as usize;
                    e.mutate(accounts[selected], |a| a.data.truncate(length));
                }
                15 => {
                    e.mutate(e.machine, |a| {
                        let mut m: Machine = bytemuck::pod_read_unaligned(&a.data[8..]);
                        for b in &mut m.buckets {
                            b.enabled = 0;
                        }
                        a.data[8..].copy_from_slice(bytemuck::bytes_of(&m));
                    });
                    e.mutate(binder, |a| write_u16(&mut a.data, 108, 0));
                }
                16..=19 => {
                    let selected = mode - 16;
                    e.mutate(accounts[selected], |a| {
                        for byte in &mut a.data {
                            *byte = next(&mut generator) as u8;
                        }
                    });
                }
                20 => e.mutate(pull, |a| {
                    for span in [48..112, 120..128, 140..142, 145..146, 147..176, 176..376] {
                        for byte in &mut a.data[span] {
                            *byte = next(&mut generator) as u8;
                        }
                    }
                }),
                21 => e.mutate(e.deck, |a| {
                    for byte in &mut a.data[64..] {
                        *byte = next(&mut generator) as u8;
                    }
                }),
                22 => e.mutate(binder, |a| {
                    for span in [40..104, 111..112, 112..392] {
                        for byte in &mut a.data[span] {
                            *byte = next(&mut generator) as u8;
                        }
                    }
                }),
                24 => specials::machine(e, |m| {
                    for slot in &mut m.onepct {
                        slot.state = next(&mut generator) as u8;
                        slot.amount = next(&mut generator);
                    }
                    m.jackpot_tokens = next(&mut generator);
                    m.jackpot_cost = next(&mut generator);
                    m.on_air_ts = next(&mut generator) as i64;
                    m.end_ts = next(&mut generator) as i64;
                    m.final_ts = next(&mut generator) as i64;
                    m.final_pool_1pct = next(&mut generator);
                    m.final_sol_total = next(&mut generator);
                    m.final_1pct_total = next(&mut generator);
                    m.token_mint = Pubkey::new_from_array(random(next(&mut generator)));
                }),
                25 | 26 => {
                    let now = e.now();
                    specials::machine(e, |m| {
                        m.on_air_ts = now - 453_600;
                        m.onepct.iter_mut().for_each(|slot| {
                            slot.state = 0;
                            slot.amount = value;
                        });
                        m.jackpot_tokens = value;
                        m.jackpot_cost = u64::MAX;
                        if mode == 26 {
                            m.token_mint = Pubkey::default();
                        }
                    });
                    let tier = if value % 2 == 0 { 6 } else { 5 };
                    instruction.data[10..42]
                        .copy_from_slice(&specials::find_random(1, 0, 0, 5, false, tier));
                }
                _ => {
                    e.mutate(pull, |a| {
                        a.data.resize(2176, 0);
                        a.data[143] = 10;
                    });
                    e.mutate(binder, |a| {
                        write_u16(&mut a.data, 104, 5);
                        write_u16(&mut a.data, 108, 0);
                    });
                }
            }
            // Mode 10 preserves Machine identity but randomizes the exec lock.
            // A live pair must reject the callback and preserve all callback accounts.
            let locked = mode == 10 && e.state::<Machine>(e.machine).exec.kind != 0;
            let before = locked.then(|| accounts.map(|key| e.account(key)));
            let result = e.send(&[instruction], &[]);
            if let Some(before) = before {
                assert_error(result, "ExecInFlight");
                for (key, account) in (*accounts).into_iter().zip(before) {
                    prop_assert_eq!(e.account(key), account);
                }
                locked_count += 1;
                continue;
            }
            prop_assert!(
                result.is_ok(),
                "features={} step={} mode={} result={:?}",
                mainnet,
                step,
                mode,
                result
            );
            let metadata = result.unwrap();
            let skipped = events::<CallbackSkipped>(&metadata);
            if skipped.is_empty() {
                accepted_count += 1;
            } else {
                skipped_count += 1;
                prop_assert!((1..=9).contains(&skipped[0].reason));
            }
        }
        prop_assert_eq!(skipped_count + accepted_count + locked_count, 200);
        prop_assert!(skipped_count > 0);
        Ok(())
    })
}

#[test]
fn cr1_total_callback_for_arbitrary_non_identity_state() {
    use proptest::test_runner::{Config, RngSeed, TestRunner};
    let total = cases();
    assert!(total > 0);
    let workers = std::env::var("M1_PROPTEST_THREADS")
        .ok()
        .map(|value| {
            value
                .parse::<usize>()
                .expect("M1_PROPTEST_THREADS must be positive")
        })
        .unwrap_or(8);
    assert!(workers > 0);
    let shards = workers.min(total as usize);
    let jobs: Vec<_> = (0..shards)
        .map(|shard| {
            let count = total / shards as u32 + u32::from((shard as u32) < total % shards as u32);
            std::thread::spawn(move || {
                let mut runner = TestRunner::new(Config {
                    cases: count,
                    max_shrink_iters: 128,
                    rng_seed: RngSeed::Fixed(0x4352315f4d31u64 + shard as u64),
                    failure_persistence: None,
                    ..Config::default()
                });
                runner
                    .run(&(any::<u64>(), any::<bool>()), |(seed, mainnet)| {
                        run_case(seed, mainnet)
                    })
                    .unwrap_or_else(|failure| {
                        panic!("CR1 shard {shard}, {count} cases: {failure}")
                    });
                count
            })
        })
        .collect();
    let completed: u32 = jobs.into_iter().map(|job| job.join().unwrap()).sum();
    assert_eq!(completed, total);
    println!("CR1 {completed} cases x 200 steps, {shards} deterministic shards, both feature sets sampled");
}
