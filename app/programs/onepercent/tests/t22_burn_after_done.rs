mod common;
#[path = "common/final_cases.rs"]
mod final_cases;
use anchor_lang::prelude::Pubkey;
use common::{
    exec_cases::*,
    pack_cases::{events, pause_all},
    *,
};
use onepercent::{constants::*, events::ExecEnded, params, state::Machine};
use serde_json::{json, Value};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_signer::Signer;

fn delta(f: &ExecFixture, value: u64) -> u64 {
    let sqrt = if f.oracles[1] == system() {
        128_794_468_968_736_475
    } else {
        125_545_362_027_818_175
    };
    onepercent::math::exec::meteora_buy(value, sqrt, params::BURN_MIN_OUT_SLIP_BPS)
        .unwrap()
        .min_out
}

#[test]
fn permissionless_burn_ignores_disabled_roles_and_pauses_only_after_done() {
    for migrated in [false, true] {
        let mut f = ExecFixture::new(3, 0, migrated, false);
        final_cases::snapshot(&mut f.e);
        config(&mut f.e, |c| c.executor = Pubkey::new_unique());
        let value = 50_000_000;
        let tx = f.transaction(value, delta(&f, value));
        f.reject(&tx, "Unauthorized");
        final_cases::finish(&mut f.e);
        pause_all(&mut f.e);
        let before = f.e.state::<Machine>(f.e.machine);
        let amount = delta(&f, value);
        let receipt = f.execute(value, amount).unwrap();
        let after = f.e.state::<Machine>(f.e.machine);
        assert_eq!(after.burned_total, before.burned_total + amount);
        assert_eq!(after.burn_sol, before.burn_sol - value);
        assert_eq!(after.final_pool_sol, before.final_pool_sol);
        assert_eq!(events::<ExecEnded>(&receipt)[0].delta, amount);
        f.e.check_invariants();
        f.reject(&tx, "TooSoon");
    }
}

#[test]
fn burn_caps_and_pairing_still_bound_every_caller() {
    for case in 0..5 {
        let mut f = ExecFixture::new(3, 0, false, false);
        f.e.inject_phase(PHASE_DONE);
        pause_all(&mut f.e);
        config(&mut f.e, |c| c.executor = Pubkey::new_unique());
        let value = 50_000_000;
        let mut tx = f.transaction(value, delta(&f, value));
        let error = match case {
            0 => {
                machine(&mut f.e, |m| m.burn_sol = value - 1);
                "Tranche"
            }
            1 => {
                machine(&mut f.e, |m| {
                    m.burn_paid_hour = params::BURN_HOURLY_MAX_LAMPORTS
                });
                "HourlyCapReached"
            }
            2 => {
                let now = f.e.now();
                machine(&mut f.e, |m| m.last_burn_ts = now);
                "TooSoon"
            }
            3 => {
                tx = f.transaction(value, delta(&f, value) - 1);
                "SlippageExceeded"
            }
            _ => {
                tx.pop();
                "Exec"
            }
        };
        f.reject(&tx, error);
    }
}

#[test]
fn jackpot_remains_on_air_only_and_final_pull_burn_still_paused() {
    let mut f = ExecFixture::new(4, 0, false, false);
    f.e.inject_phase(PHASE_DONE);
    let tx = f.transaction(50_000_000, 1);
    f.reject(&tx, "WrongPhase");
    let mut f = ExecFixture::new(3, 0, false, false);
    final_cases::snapshot(&mut f.e);
    pause_all(&mut f.e);
    let tx = f.transaction(50_000_000, 1);
    f.reject(&tx, "RoleDisabled|Paused");
}

#[test]
fn done_burn_recreates_closed_empty_ledger_and_vault_without_blocking_exit() {
    for donated in [false, true] {
        let mut f = ExecFixture::new(EXEC_KIND_BURN, 0, false, false);
        f.e.inject_phase(PHASE_DONE);
        pause_all(&mut f.e);
        config(&mut f.e, |c| c.executor = Pubkey::new_unique());
        let ledger = pda(&[b"ledger", f.bag.mint.as_ref()]).0;
        f.e.send(&[common::pack_cases::close_ix(&f.e, &f.bag)], &[])
            .unwrap();
        assert!(f.e.closed(ledger) && f.e.closed(f.vault));
        if donated {
            f.e.donate_lamports(ledger, 177);
        }
        let signer = pubkey(&f.signer.pubkey());
        let before = f.e.state::<Machine>(f.e.machine);
        let value = 50_000_000;
        let burned = delta(&f, value);
        let mut tx = vec![f.e.create_ata_ix(f.e.vault_auth, &f.bag, signer)];
        tx.extend(f.transaction(value, burned));
        f.send(&tx).unwrap();
        let recreated = f.e.state::<onepercent::state::MintLedger>(ledger);
        assert_eq!(recreated.mint, f.bag.mint);
        assert_eq!(recreated.payer, signer);
        assert_eq!(recreated.accounted, 0);
        assert!(f.e.account(ledger).lamports >= f.e.rent_min(MINT_LEDGER_SIZE));
        let after = f.e.state::<Machine>(f.e.machine);
        assert_eq!(after.burned_total, before.burned_total + burned);
        assert_eq!(after.burn_sol, before.burn_sol - value);
        f.e.check_invariants();
    }
}

#[test]
fn ledger_recreation_is_restricted_to_done_burn() {
    for kind in [EXEC_KIND_BURN, EXEC_KIND_JACKPOT_BUY] {
        let mut f = ExecFixture::new(kind, 0, false, false);
        let ledger = pda(&[b"ledger", f.bag.mint.as_ref()]).0;
        f.e.send(&[common::pack_cases::close_ix(&f.e, &f.bag)], &[])
            .unwrap();
        let signer = pubkey(&f.signer.pubkey());
        let mut tx = vec![f.e.create_ata_ix(f.e.vault_auth, &f.bag, signer)];
        tx.extend(f.transaction(50_000_000, 1));
        f.reject(&tx, "LedgerMismatch");
        assert!(f.e.closed(ledger));
    }
}

#[test]
fn absent_ledger_with_remaining_machine_claims_is_never_reset() {
    for liability in 0..3 {
        let mut f = ExecFixture::new(EXEC_KIND_BURN, 0, false, false);
        f.e.inject_phase(PHASE_DONE);
        let ledger = pda(&[b"ledger", f.bag.mint.as_ref()]).0;
        f.e.send(&[common::pack_cases::close_ix(&f.e, &f.bag)], &[])
            .unwrap();
        machine(&mut f.e, |m| match liability {
            0 => m.final_pool_1pct = 1,
            1 => m.jackpot_tokens = 1,
            _ => {
                m.onepct[0].state = ONEPCT_LIVE;
                m.onepct[0].amount = 1;
            }
        });
        let signer = pubkey(&f.signer.pubkey());
        let mut tx = vec![f.e.create_ata_ix(f.e.vault_auth, &f.bag, signer)];
        tx.extend(f.transaction(50_000_000, 1));
        f.reject(&tx, "LedgerMismatch");
        assert!(f.e.closed(ledger));
    }
}

fn configured_cu_limit(name: &str) -> u64 {
    let config = include_str!("../../../packages/config/src/index.ts");
    let limits = config.split("export const CU_LIMITS = {").nth(1).unwrap();
    limits
        .split(&format!("{name}:"))
        .nth(1)
        .unwrap()
        .split(',')
        .next()
        .unwrap()
        .trim()
        .replace('_', "")
        .parse()
        .unwrap()
}

#[test]
fn done_burn_cu_covers_closed_and_prefunded_ledger_recreation() {
    let begin_limit = configured_cu_limit("execBegin");
    let end_limit = configured_cu_limit("execEnd");
    let restore_allowance = configured_cu_limit("restoreBurnVault");
    let mut variants = vec![];
    let mut begin_max = 0;
    let mut end_max = 0;
    let mut existing_transaction_max = 0;
    let mut restoration_transaction_max = 0;
    for mainnet_features in [false, true] {
        for migrated in [false, true] {
            for variant in ["existing", "closed", "prefunded"] {
                let mut local_begin_max = 0;
                let mut local_end_max = 0;
                let mut transaction_max = 0;
                for sample in 0..16 {
                    Env::deterministic_bench_signers(20_261_013 + sample * 1000);
                    let mut f = ExecFixture::new(EXEC_KIND_BURN, 0, migrated, mainnet_features);
                    f.e.inject_phase(PHASE_DONE);
                    pause_all(&mut f.e);
                    config(&mut f.e, |c| c.executor = Pubkey::new_unique());
                    let ledger = pda(&[b"ledger", f.bag.mint.as_ref()]).0;
                    if variant != "existing" {
                        f.e.send(&[common::pack_cases::close_ix(&f.e, &f.bag)], &[])
                            .unwrap();
                        if variant == "prefunded" {
                            f.e.donate_lamports(ledger, 177);
                        }
                    }
                    let signer = pubkey(&f.signer.pubkey());
                    let mut tx = vec![
                        ComputeBudgetInstruction::set_compute_unit_limit(
                            u32::try_from(
                                begin_limit
                                    + end_limit
                                    + if variant == "existing" {
                                        0
                                    } else {
                                        restore_allowance
                                    },
                            )
                            .unwrap(),
                        ),
                        ComputeBudgetInstruction::set_compute_unit_price(1),
                        f.e.create_ata_ix(signer, &native_bag(), signer),
                    ];
                    if variant != "existing" {
                        tx.push(f.e.create_ata_ix(f.e.vault_auth, &f.bag, signer));
                    }
                    let value = 50_000_000;
                    tx.extend(f.transaction(value, delta(&f, value)));
                    let receipt = f.send(&tx).unwrap();
                    let prefix = format!("Program {} consumed ", onepercent::ID);
                    let handlers: Vec<u64> = receipt
                        .logs
                        .iter()
                        .filter_map(|line| line.strip_prefix(&prefix))
                        .map(|line| line.split_whitespace().next().unwrap().parse().unwrap())
                        .collect();
                    assert_eq!(handlers.len(), 2);
                    assert!(
                        handlers[0]
                            <= begin_limit
                                + if variant == "existing" {
                                    0
                                } else {
                                    restore_allowance
                                }
                    );
                    assert!(handlers[1] <= end_limit);
                    local_begin_max = local_begin_max.max(handlers[0]);
                    local_end_max = local_end_max.max(handlers[1]);
                    transaction_max = transaction_max.max(receipt.compute_units_consumed);
                    f.e.check_invariants();
                }
                begin_max = begin_max.max(local_begin_max);
                end_max = end_max.max(local_end_max);
                if variant == "existing" {
                    existing_transaction_max = existing_transaction_max.max(transaction_max);
                } else {
                    restoration_transaction_max = restoration_transaction_max.max(transaction_max);
                }
                variants.push(json!({
                    "variant":variant,
                    "pool":if migrated {"DAMM v2"} else {"DBC"},
                    "featureSet":if mainnet_features {"recorded mainnet fixture"} else {"LiteSVM default"},
                    "samples":16,
                    "execBeginMax":local_begin_max,
                    "execEndMax":local_end_max,
                    "transactionMax":transaction_max,
                }));
            }
        }
    }
    let program_hash: String =
        solana_sha256_hasher::hash(&std::fs::read(Env::artifact("onepercent.so")).unwrap())
            .to_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
    let with_margin = |cu: u64| (cu * 5).div_ceil(4_000) * 1_000;
    let report = json!({
        "runtime":"LiteSVM 0.16.0, sBPFv3; default and recorded mainnet feature sets",
        "programSha256":program_hash,
        "scope":"Done Burn handlers, source ATA preparation, optional restoration of token vault and ledger, atomic token-transfer swap fixture, and both compute budget instructions",
        "limitation":"Synthetic authenticated DBC/DAMM pool state and SPL transfer swaps; production swap routing needs its own simulation budget",
        "limitsSource":"packages/config/src/index.ts CU_LIMITS",
        "limits":{"execBegin":begin_limit,"execEnd":end_limit,"restoreBurnVault":restore_allowance},
        "transactionLimits":{"existing":begin_limit+end_limit,"restoration":begin_limit+end_limit+restore_allowance},
        "measured":{"execBegin":begin_max,"execEnd":end_max,"existingTransaction":existing_transaction_max,"restorationTransaction":restoration_transaction_max},
        "measuredWith25PercentMargin":{"execBegin":with_margin(begin_max),"execEnd":with_margin(end_max)},
        "restorationAllowanceDerivation":{
            "wholeRestorationWith25PercentMargin":with_margin(restoration_transaction_max),
            "baseHandlerBudget":begin_limit+end_limit,
            "additionalRequired":with_margin(restoration_transaction_max).saturating_sub(begin_limit+end_limit),
        },
        "variants":variants,
    });
    println!(
        "Done Burn CU: {} limits: {} margin: {}",
        report["measured"], report["limits"], report["measuredWith25PercentMargin"]
    );
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/reports/final-pull-burn-cu.json");
    if std::env::var_os("UPDATE_REPORT").is_some() {
        std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    } else {
        let stored: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(stored["programSha256"], report["programSha256"]);
        assert_eq!(stored["limits"], report["limits"]);
        // Fixtures use fresh mint addresses, so PDA search costs can vary. Each
        // run checks actual handler and whole-transaction limits independently;
        // restoration has its separate allowance, leaving ordinary calls intact.
    }
}
