mod common;
use common::{pack_cases::*, *};
use onepercent::events::VaultShortfall;
use onepercent::state::{Binder, Deck, MintLedger};
use solana_signer::Signer;
fn donations(e: &mut Env) {
    let accounts: Vec<_> = e.tracked.iter().copied().collect();
    for at in accounts {
        if e.svm.get_account(&addr(&at)).is_some_and(|a| !a.executable) {
            e.donate_lamports(at, 12345)
        }
    }
}
#[test]
fn t11_01_donate_everywhere_then_all_exits() {
    for mainnet in [false, true] {
        let (mut e, u, _, _) = setup(mainnet);
        let owner = pubkey(&u.pubkey());
        e.donate_lamports(
            pda(&[b"pull", owner.as_ref(), &0u32.to_le_bytes()]).0,
            12345,
        );
        let (p, _) = e.buy(&u, 0, 1).unwrap();
        donations(&mut e);
        e.warp(300);
        e.send(&[e.refund_ix(p)], &[]).unwrap();
        e.check_invariants();
        let (mut e, u, _, _) = setup(mainnet);
        let (p, _) = e.buy(&u, 0, 1).unwrap();
        donations(&mut e);
        e.fulfill(p, [1; 32]).unwrap();
        e.settle(p, 0).unwrap();
        e.send(&[team_ix(&e)], &[]).unwrap();
        e.check_invariants();
        for t22 in [false, true] {
            let (mut e, u, bag) = card_fixture_for(mainnet, t22, 1);
            let who = pubkey(&u.pubkey());
            donations(&mut e);
            let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
            e.donate_tokens(vault, 17);
            e.mutate(bag.mint, |a| {
                let n = read_u64(&a.data, 36);
                write_u64(&mut a.data, 36, n + 17)
            });
            e.send(&[e.redeem_ix(who, &bag, 0, 1000)], &[&u]).unwrap();
            e.send(&[close_ix(&e, &bag)], &[]).unwrap();
            e.check_invariants();
            let next = pda(&[b"ledger", bag.mint.as_ref()]).0;
            e.donate_lamports(next, 1);
            e.donate_lamports(vault, 1);
            e.feed(&u, &bag, 1000, 0).unwrap();
            e.send(&[e.take_back_ix(who, &bag, 0, 1000)], &[&u])
                .unwrap();
            e.check_invariants();
        }
    }
}
#[test]
fn t11_02_rent_switch_matrix() {
    for mainnet in [false, true] {
        for rate in [5080, 2575, 1322, 696, 6960] {
            let (mut e, u, _, _) = setup(mainnet);
            let (p, _) = e.buy(&u, 0, 1).unwrap();
            e.set_rent(rate);
            e.warp(300);
            e.send(&[e.refund_ix(p)], &[]).unwrap();
            e.check_invariants();
            let (mut e, u, _, _) = setup(mainnet);
            let (p, _) = e.buy(&u, 0, 1).unwrap();
            e.set_rent(rate);
            e.fulfill(p, [1; 32]).unwrap();
            e.settle(p, 0).unwrap();
            e.send(&[team_ix(&e)], &[]).unwrap();
            e.check_invariants();
            let (mut e, u, bag) = card_fixture_for(mainnet, false, 1);
            let who = pubkey(&u.pubkey());
            e.set_rent(rate);
            e.send(&[e.redeem_ix(who, &bag, 0, 1000)], &[&u]).unwrap();
            e.send(&[close_ix(&e, &bag)], &[]).unwrap();
            let result = e.feed(&u, &bag, 1000, 0);
            if result.is_err() {
                assert_eq!(rate, 6960);
                assert_error(result, "DeckUnderfunded");
                e.donate_lamports(e.deck, e.rent_min(64));
                e.feed(&u, &bag, 1000, 0).unwrap();
            }
            e.send(&[e.take_back_ix(who, &bag, 0, 1000)], &[&u])
                .unwrap();
            e.check_invariants();
        }
    }
}
#[test]
fn t11_03_token_donations_never_deposits() {
    let mut e = Env::new();
    let bag = e.new_pump_mint(false);
    let u = e.user_with_bag(&bag, 1000);
    let vault = e.token_account(e.vault_auth, &bag, 19);
    e.feed(&u, &bag, 1000, 0).unwrap();
    e.donate_tokens(vault, 23);
    assert_eq!(e.state::<Deck>(e.deck).len, 1);
    assert_eq!(
        e.state::<MintLedger>(pda(&[b"ledger", bag.mint.as_ref()]).0)
            .accounted,
        1000
    );
    assert_eq!(e.state::<Binder>(binder(pubkey(&u.pubkey()))).len, 0);
    e.send(&[e.take_back_ix(pubkey(&u.pubkey()), &bag, 0, 1000)], &[&u])
        .unwrap();
    assert_eq!(read_u64(&e.account(vault).data, 64), 42);
    e.check_invariants();
}
#[test]
fn t11_04_pause_bits_grep() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/instructions");
    let forbidden = [
        "admin_paused",
        "guardian_paused",
        "PAUSE_BITS",
        "disabled_roles",
        "end_ts",
        "vrf_queues",
        "active_queue",
        "intake_signer",
        "verify_ed25519",
    ];
    for name in [
        "take_back",
        "settle",
        "refund_pull",
        "redeem",
        "team_withdraw",
        "close_vault",
    ] {
        let text = std::fs::read_to_string(root.join(format!("{name}.rs"))).unwrap();
        let accounts = text.split("pub fn handler").next().unwrap();
        for token in forbidden {
            assert!(
                !text.contains(token),
                "exit {name} references forbidden {token}"
            );
        }
        assert!(
            !text.contains("check_pause")
                && !text.contains("pause_check")
                && !text.contains("require_active")
        );
        assert!(text.contains("ctx.remaining_accounts.is_empty()"));
        if name != "team_withdraw" {
            assert!(!accounts.contains("Config>"));
        }
        if name == "settle" || name == "refund_pull" {
            for field in [
                "buyer", "referrer", "wallet_0", "wallet_1", "wallet_2", "wallet_3", "binder_0",
                "binder_1", "binder_2", "binder_3",
            ] {
                let needle = format!("pub {field}:");
                if let Some(pos) = accounts.find(&needle) {
                    let prior = &accounts[..pos];
                    assert!(
                        !prior
                            .lines()
                            .rev()
                            .take(2)
                            .any(|line| line.contains("#[account(mut")),
                        "{name} {field}"
                    );
                }
            }
        }
    }
}
#[test]
fn t11_05_release_has_no_test_code() {
    let so = std::fs::read(Env::artifact("onepercent.so")).unwrap();
    assert_eq!(&so[48..52], &3u32.to_le_bytes());
    for word in [
        b"mock_vrf".as_slice(),
        b"fulfill_raw_global",
        b"test-vrf",
        b"inject_deck",
    ] {
        assert!(!so.windows(word.len()).any(|v| v == word));
    }
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/idl/onepercent.json");
    let idl: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    for ix in idl["instructions"].as_array().unwrap() {
        let name = ix["name"].as_str().unwrap();
        assert!(
            !name.starts_with("test_")
                && !name.starts_with("mock_")
                && !name.starts_with("inject_")
        );
    }
}
#[test]
fn t11_06_exit_vault_shortfall_emits() {
    let (mut e, u, bag) = card_fixture(false, 1);
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    e.mutate(ledger, |a| write_u64(&mut a.data, 72, 2000));
    let meta = e
        .send(&[e.redeem_ix(pubkey(&u.pubkey()), &bag, 0, 1000)], &[&u])
        .unwrap();
    let decoded = events::<VaultShortfall>(&meta);
    assert_eq!(decoded.len(), 1);
    assert_eq!(decoded[0].accounted, 1000);
    assert_eq!(decoded[0].vault_amount, 0);
    let mut e = Env::new();
    let bag = e.new_pump_mint(false);
    let u = e.user_with_bag(&bag, 2000);
    e.feed(&u, &bag, 1000, 0).unwrap();
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    e.mutate(ledger, |a| write_u64(&mut a.data, 72, 2000));
    assert_error(e.feed(&u, &bag, 1000, 1), "TokensNotReceived");
    let meta = e
        .send(&[e.take_back_ix(pubkey(&u.pubkey()), &bag, 0, 1000)], &[&u])
        .unwrap();
    assert_eq!(events::<VaultShortfall>(&meta).len(), 1);
}
