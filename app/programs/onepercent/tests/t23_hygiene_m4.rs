use onepercent::{constants::*, errors::MachineError};

#[test]
fn t23_01_specials_do_not_read_exit_gates() {
    for source in [
        include_str!("../src/instructions/consume_randomness.rs"),
        include_str!("../src/math/specials.rs"),
        include_str!("../src/instructions/collect_creator_fees.rs"),
        include_str!("../src/instructions/claim_final_sol.rs"),
        include_str!("../src/instructions/claim_final_tokens.rs"),
    ] {
        for forbidden in [
            "admin_paused",
            "guardian_paused",
            "disabled_roles",
            "end_ts",
            "Config",
        ] {
            assert!(
                !source.contains(forbidden),
                "forbidden exit dependency {forbidden}"
            );
        }
    }
}
#[test]
fn t23_02_final_exit_structure_and_spotlight_stubs() {
    for source in [
        include_str!("../src/instructions/collect_creator_fees.rs"),
        include_str!("../src/instructions/start_final_pull.rs"),
        include_str!("../src/instructions/claim_final_sol.rs"),
        include_str!("../src/instructions/claim_final_tokens.rs"),
    ] {
        assert!(!source.contains("pub config:"));
        assert!(!source.contains("pub remaining_accounts:"));
        assert!(!source.contains("admin_paused"));
        assert!(!source.contains("guardian_paused"));
        assert!(!source.contains("disabled_roles"));
    }
    let sol = include_str!("../src/instructions/claim_final_sol.rs");
    assert!(!sol.contains("#[account(mut)]\n    pub owner:"));
    let program = include_str!("../src/lib.rs");
    for instruction in ["start_final_pull", "claim_final_sol", "claim_final_tokens"] {
        assert!(program.contains(&format!("instructions::{instruction}::handler(ctx)")));
    }
    assert!(program.contains("spotlight_deposit(ctx: Context<Deferred>)"));
    assert!(program.contains("spotlight_take_back(ctx: Context<Deferred>)"));
}
#[test]
fn t23_03_power_on_top_level_and_callback_no_cpi() {
    assert!(include_str!("../src/instructions/power_on.rs").contains("top_level()?"));
    let callback = include_str!("../src/instructions/consume_randomness.rs");
    assert!(!callback.contains("invoke("));
    assert!(!callback.contains("invoke_signed("));
    let commit = callback
        .find("No Result propagation is allowed below this commit boundary.")
        .unwrap();
    let end = callback[commit..].find("pub fn handler").unwrap() + commit;
    assert!(!callback[commit..end].contains('?'));
}
#[test]
fn t23_04_append_only_error_codes_and_state_values() {
    assert_eq!(
        MachineError::NotLaunchCurve as u32,
        MachineError::FinalNotClaimed as u32 + 1
    );
    assert_eq!(
        MachineError::FinalPullNotDue as u32,
        MachineError::NotLaunchCurve as u32 + 1
    );
    assert_eq!(
        [ONEPCT_LOCKED, ONEPCT_LIVE, ONEPCT_PULLED, ONEPCT_FINAL],
        [0, 1, 2, 3]
    );
    assert_eq!(
        [REGIME_BELOW_FLOOR, REGIME_SEASON, REGIME_AFTER_END],
        [0, 1, 2]
    );
}
#[test]
fn t23_05_no_spotlight_segment_or_slot_writes() {
    let special = include_str!("../src/math/specials.rs");
    assert!(!special.contains("LIVE_SPOTLIGHT"));
    for source in [
        include_str!("../src/instructions/consume_randomness.rs"),
        include_str!("../src/instructions/buy_packs.rs"),
        include_str!("../src/instructions/advance_phase.rs"),
        include_str!("../src/instructions/power_on.rs"),
    ] {
        assert!(!source.contains(".spotlight"));
    }
}
