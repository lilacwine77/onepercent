mod common;
#[path = "common/final_cases.rs"]
mod final_cases;
#[path = "common/mycards.rs"]
mod mycards;

use anchor_lang::prelude::Pubkey;
use common::{exec_cases::machine, pack_cases::binder, *};
use final_cases::{due, snapshot, sol, spend, start, tokens};
use onepercent::{constants::*, state::*};
use serde_json::{json, Value};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;

fn seeded(sample: u64) -> (Env, Keypair) {
    Env::deterministic_bench_signers(20261013 + sample * 1000);
    let mut env = Env::new();
    let payer = env.user();
    (env, payer)
}

fn seed_pools(env: &mut Env, sample: u64) {
    machine(env, |m| {
        m.total_spend = 100;
        m.stock_sol = 1_000_000_007;
        m.jackpot_sol = 2_000_000_009;
        m.burn_sol = 3_000_000_011;
        m.team_sol = 4_000_000_013;
        m.jackpot_tokens = 29;
        m.token_mint = Pubkey::new_from_array(
            solana_sha256_hasher::hashv(&[b"final-cu-token", &sample.to_le_bytes()]).to_bytes(),
        );
        for (index, slot) in m.onepct.iter_mut().enumerate() {
            slot.amount = 101 + index as u64;
            slot.state = ONEPCT_LOCKED;
        }
        for (index, bucket) in m.buckets.iter_mut().enumerate() {
            bucket.mint = Pubkey::new_from_array(
                solana_sha256_hasher::hashv(&[
                    b"final-cu-bucket",
                    &sample.to_le_bytes(),
                    &(index as u64).to_le_bytes(),
                ])
                .to_bytes(),
            );
            bucket.class = BUCKET_MAJOR;
            bucket.amount = 1001 + index as u64;
            bucket.cost = 100;
        }
    });
    mycards::fund_machine(env);
}

fn size(env: &Env, payer: &Keypair, instructions: &[Instruction]) -> usize {
    let mut all = vec![
        ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
        ComputeBudgetInstruction::set_compute_unit_price(1),
    ];
    all.extend_from_slice(instructions);
    let message =
        Message::new_with_blockhash(&all, Some(&payer.pubkey()), &env.svm.latest_blockhash());
    1 + 64 * usize::from(message.header.num_required_signatures) + message.serialize().len()
}

fn digest(path: &std::path::Path) -> String {
    solana_sha256_hasher::hash(&std::fs::read(path).unwrap())
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
fn final_pull_cu_sizes() {
    let mut cases = vec![];
    let mut start_max = 0;
    let mut sol_max = 0;
    let mut sol_batch_max = 0;
    let mut tokens_max = 0;
    let mut combined_max = 0;
    let mut start_bytes = 0;
    let mut sol_bytes = 0;
    let mut sol_batch_bytes = 0;
    let mut tokens_bytes = 0;
    let mut combined_bytes = 0;
    let mut largest_batch = 0;
    for sample in 0..32 {
        let (mut env, payer) = seeded(sample);
        seed_pools(&mut env, sample);
        due(&mut env);
        let ix = start(&env);
        let (cu, bytes) = mycards::measure(&mut env, &payer, vec![ix]);
        start_max = start_max.max(cu);
        start_bytes = start_bytes.max(bytes);
        cases.push(json!({"instruction":"startFinalPull","sample":sample,"cu":cu,"bytes":bytes}));

        for mode in ["wallet", "owed", "zero", "idempotent"] {
            let (mut env, payer) = seeded(sample);
            seed_pools(&mut env, sample);
            let recipient = env.user();
            let owner = pubkey(&recipient.pubkey());
            env.binder(owner, &[], 0, 0);
            spend(&mut env, owner, if mode == "zero" { 0 } else { 100 });
            snapshot(&mut env);
            if mode == "owed" {
                env.mutate(owner, |account| account.owner = addr(&vrf()));
            }
            if mode == "idempotent" {
                env.send(&[sol(&env, owner, true)], &[]).unwrap();
            }
            let ix = sol(&env, owner, mode != "owed");
            let (cu, bytes) = mycards::measure(&mut env, &payer, vec![ix]);
            sol_max = sol_max.max(cu);
            sol_bytes = sol_bytes.max(bytes);
            cases.push(json!({"instruction":"claimFinalSol","variant":mode,"sample":sample,"cu":cu,"bytes":bytes}));
        }

        for mode in ["seventeen", "zero", "existingCapacity", "combined"] {
            let (mut env, payer) = seeded(sample);
            seed_pools(&mut env, sample);
            let owner = pubkey(&payer.pubkey());
            env.binder(
                owner,
                &[],
                0,
                if mode == "existingCapacity" { 17 } else { 0 },
            );
            spend(&mut env, owner, if mode == "zero" { 0 } else { 100 });
            snapshot(&mut env);
            let mut instructions = vec![];
            if mode == "combined" {
                instructions.push(sol(&env, owner, true));
            }
            instructions.push(tokens(&env, owner));
            let (cu, bytes) = mycards::measure(&mut env, &payer, instructions);
            assert_eq!(
                env.state::<Binder>(binder(owner)).len,
                if mode == "zero" { 0 } else { 17 }
            );
            if mode == "combined" {
                combined_max = combined_max.max(cu);
                combined_bytes = combined_bytes.max(bytes);
            } else {
                tokens_max = tokens_max.max(cu);
                tokens_bytes = tokens_bytes.max(bytes);
            }
            cases.push(json!({"instruction":"claimFinalTokens","variant":mode,"sample":sample,"cu":cu,"bytes":bytes}));
        }

        for owed in [false, true] {
            let (mut env, payer) = seeded(sample);
            seed_pools(&mut env, sample);
            let mut instructions = vec![];
            let excluded_bytes = loop {
                let recipient = env.user();
                let owner = pubkey(&recipient.pubkey());
                env.binder(owner, &[], 0, 0);
                spend(&mut env, owner, 1);
                if owed {
                    env.mutate(owner, |account| account.owner = addr(&vrf()));
                }
                instructions.push(sol(&env, owner, !owed));
                let bytes = size(&env, &payer, &instructions);
                if bytes > 1232 {
                    instructions.pop();
                    break bytes;
                }
            };
            let count = instructions.len();
            assert!(count > 1);
            assert!(excluded_bytes > 1232);
            machine(&mut env, |m| m.total_spend = count as u64);
            snapshot(&mut env);
            let (cu, bytes) = mycards::measure(&mut env, &payer, instructions);
            largest_batch = largest_batch.max(count);
            sol_batch_max = sol_batch_max.max(cu);
            sol_batch_bytes = sol_batch_bytes.max(bytes);
            cases.push(json!({"instruction":"claimFinalSolBatch","variant":if owed {"owed"} else {"wallet"},"sample":sample,"count":count,"cu":cu,"bytes":bytes,"nextCountBytes":excluded_bytes}));
        }
    }
    let limit = |cu: u64| (cu * 5).div_ceil(4_000) * 1_000;
    let report = json!({
        "runtime":"LiteSVM 0.16.0, sBPFv3, default feature set",
        "fixtureSeed":20261013,
        "samplesPerVariant":32,
        "transactionShape":"legacy transaction with both compute budget instructions",
        "programSha256":digest(&Env::artifact("onepercent.so")),
        "mockVrfSha256":digest(&Env::artifact("mock_vrf.so")),
        "largestSolBatch":largest_batch,
        "measured":{"startFinalPull":start_max,"claimFinalSol":{"x1":sol_max,"xMax":sol_batch_max},"claimFinalTokens":tokens_max,"combinedClaims":combined_max},
        "transactionBytes":{"startFinalPull":start_bytes,"claimFinalSol":{"x1":sol_bytes,"xMax":sol_batch_bytes},"claimFinalTokens":tokens_bytes,"combinedClaims":combined_bytes},
        "limits":{"startFinalPull":limit(start_max),"claimFinalSol":{"x1":limit(sol_max),"xMax":limit(sol_batch_max)},"claimFinalTokens":limit(tokens_max)},
        "cases":cases,
    });
    println!(
        "Final Pull CU: {} sizes: {} limits: {}",
        report["measured"], report["transactionBytes"], report["limits"]
    );
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/reports/final-pull-cu.json");
    if std::env::var_os("UPDATE_REPORT").is_some() {
        std::fs::write(&path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    } else {
        let stored: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            report, stored,
            "Final Pull CU report drift; remeasure and synchronize CU_LIMITS"
        );
    }
}
