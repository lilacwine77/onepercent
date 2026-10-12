mod common;
#[path = "common/mycards.rs"]
mod mycards;
use common::{exec_cases::ExecFixture, pack_cases::*, *};
use onepercent::state::Binder;
use solana_signer::Signer;

#[test]
fn t16_01_pause_reads_and_service_free_exits() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/instructions");
    for file in std::fs::read_dir(&root).unwrap() {
        let file = file.unwrap();
        let path = file.path();
        if path.extension().is_none_or(|e| e != "rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        if text.contains("admin_paused") || text.contains("guardian_paused") {
            assert!(
                [
                    "admin_config",
                    "guardian",
                    "buy_packs",
                    "feed",
                    "feed_back",
                    "sell_back",
                    "exec_begin"
                ]
                .contains(&path.file_stem().unwrap().to_str().unwrap()),
                "{} reads pause state",
                path.display()
            );
        }
    }
    for name in ["withdraw_owed", "close_binder"] {
        let text = std::fs::read_to_string(root.join(format!("{name}.rs"))).unwrap();
        let accounts = text.split("pub fn handler").next().unwrap();
        assert!(!accounts.contains("Config>"));
        assert!(text.contains("ctx.remaining_accounts.is_empty()"));
        for token in [
            "admin_paused",
            "guardian_paused",
            "disabled_roles",
            "end_ts",
            "verify_ed25519",
            "intake_signer",
            "vrf_queues",
        ] {
            assert!(!text.contains(token), "{name} references {token}");
        }
    }
}

#[test]
fn t16_02_top_level_checks_remain_in_place() {
    for name in ["exec_begin", "exec_end", "feed"] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("src/instructions/{name}.rs"));
        assert!(std::fs::read_to_string(path)
            .unwrap()
            .contains("top_level()?"));
    }
}

fn donate_and_fund_rent(e: &mut Env) {
    for key in e.tracked.iter().copied().collect::<Vec<_>>() {
        if let Some(account) = e.svm.get_account(&addr(&key)) {
            if !account.executable {
                e.donate_lamports(key, e.rent_min(account.data.len()) + 12345);
            }
        }
    }
}

#[test]
fn t16_04_dg1_and_t11_rent_matrix_cover_all_m2_instructions() {
    for rate in [5080, 2575, 1322, 696, 6960] {
        for mainnet in [false, true] {
            for kind in 1..=4 {
                let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, mainnet);
                let owner = pubkey(&f.signer.pubkey());
                f.e.binder(owner, &[], 0, 0);
                f.e.set_rent(rate);
                donate_and_fund_rent(&mut f.e);
                let value = 1_000_000;
                let delta = common::exec_cases::expected(&f, value).1;
                let before = f.e.state(f.e.machine);
                f.execute(value, delta).unwrap();
                common::exec_cases::check_success(&f, &before, value, delta);
                f.e.check_invariants();
            }
        }
        let (mut e, user, bag) = mycards::fixture(2);
        let owner = pubkey(&user.pubkey());
        let at = binder(owner);
        e.set_rent(rate);
        donate_and_fund_rent(&mut e);
        e.send(
            &mycards::sb_ixs(&e, owner, &bag, &[1], 50_000_000),
            &[&user],
        )
        .unwrap();
        donate_and_fund_rent(&mut e);
        e.send(&[mycards::fb_ix(&e, owner, &[0])], &[&user])
            .unwrap();
        mycards::edit::<Binder>(&mut e, at, |b| b.sol_owed = 100_000);
        e.donate_lamports(at, 100_000);
        donate_and_fund_rent(&mut e);
        let wallet = e.account(owner).lamports;
        e.send(&[mycards::owed_ix(owner)], &[&user]).unwrap();
        assert_eq!(e.account(owner).lamports - wallet, 100_000);
        donate_and_fund_rent(&mut e);
        let refund = e.account(at).lamports;
        let wallet = e.account(owner).lamports;
        e.send(&[mycards::close_binder_ix(owner)], &[&user])
            .unwrap();
        assert_eq!(e.account(owner).lamports - wallet, refund);
        assert!(e.closed(at));
        e.check_invariants();
    }
}

#[test]
fn t16_03_m1_error_codes_remain_frozen() {
    use onepercent::errors::MachineError::*;
    let golden = [
        (Unauthorized, 6000, "Unauthorized"),
        (RoleDisabled, 6001, "RoleDisabled"),
        (Paused, 6002, "Paused"),
        (WrongPhase, 6003, "WrongPhase"),
        (SeasonOver, 6004, "SeasonOver"),
        (InvalidArgument, 6005, "InvalidArgument"),
        (InvalidEdition, 6006, "InvalidEdition"),
        (InvalidQuantity, 6007, "InvalidQuantity"),
        (TeamWallet, 6008, "TeamWallet"),
        (NotWallet, 6009, "NotWallet"),
        (MintNotSafe, 6010, "MintNotSafe"),
        (MintForbidden, 6011, "MintForbidden"),
        (NotPumpFun, 6012, "NotPumpFun"),
        (DuplicateMint, 6013, "DuplicateMint"),
        (TokensNotReceived, 6014, "TokensNotReceived"),
        (AttestationInvalid, 6015, "AttestationInvalid"),
        (AttestationExpired, 6016, "AttestationExpired"),
        (AttestationReplay, 6017, "AttestationReplay"),
        (FreshCapReached, 6018, "FreshCapReached"),
        (DeckFull, 6019, "DeckFull"),
        (DeckUnderfunded, 6020, "DeckUnderfunded"),
        (VaultMismatch, 6021, "VaultMismatch"),
        (LedgerMismatch, 6022, "LedgerMismatch"),
        (AccountMismatch, 6023, "AccountMismatch"),
        (CardMoved, 6024, "CardMoved"),
        (CardNotRedeemable, 6025, "CardNotRedeemable"),
        (Refilling, 6026, "Refilling"),
        (MachineHungry, 6027, "MachineHungry"),
        (LiveFlagsChanged, 6028, "LiveFlagsChanged"),
        (QueueNotAllowed, 6029, "QueueNotAllowed"),
        (BinderFull, 6030, "BinderFull"),
        (PullNotRevealed, 6031, "PullNotRevealed"),
        (PullMismatch, 6032, "PullMismatch"),
        (TooEarlyToRefund, 6033, "TooEarlyToRefund"),
        (BucketsFull, 6034, "BucketsFull"),
        (BucketExists, 6035, "BucketExists"),
        (BucketInvalid, 6036, "BucketInvalid"),
        (TrendingLimit, 6037, "TrendingLimit"),
        (VaultNotEmpty, 6038, "VaultNotEmpty"),
        (MintListed, 6039, "MintListed"),
        (SeasonAlreadySet, 6040, "SeasonAlreadySet"),
        (InvalidRole, 6041, "InvalidRole"),
        (MathOverflow, 6042, "MathOverflow"),
        (VaultInvariant, 6043, "VaultInvariant"),
        (MultipleFeeds, 6044, "MultipleFeeds"),
        (NotImplemented, 6045, "NotImplemented"),
        (NotTopLevel, 6046, "NotTopLevel"),
        (PayeeBelowRent, 6047, "PayeeBelowRent"),
    ];
    let idl: serde_json::Value = serde_json::from_str(include_str!(
        "../../../packages/sdk/src/idl/onepercent.json"
    ))
    .unwrap();
    for (error, code, name) in golden {
        assert_eq!(u32::from(error), code);
        let entry = &idl["errors"][(code - 6000) as usize];
        assert_eq!(entry["code"], code);
        assert_eq!(entry["name"], name);
    }
}
