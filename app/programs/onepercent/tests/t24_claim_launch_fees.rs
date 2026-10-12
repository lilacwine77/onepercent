mod common;
#[path = "common/launch_cases.rs"]
mod launch;
use anchor_lang::prelude::Pubkey;
use common::{launch_fee_cases::*, pack_cases::events, *};
use launch::*;
use onepercent::{events::LaunchFeesClaimed, params, state::Machine};
use solana_signer::Signer;

#[test]
fn t24_curve_claims_quote_leaves_base_and_unwraps_to_fee_in() {
    let mut case = DbcClaimCase::new(1_000_000_007);
    let before = case.env.account(case.env.fee_in).lamports;
    let base = case.env.account(case.base_vault);
    let tx = case.env.send(&[case.claim(0)], &[]).unwrap();
    let event = events::<LaunchFeesClaimed>(&tx).remove(0);
    assert_eq!(event.quote, 1_000_000_007);
    assert_eq!(
        event.unwrapped_lamports,
        1_000_000_007 + case.env.rent_min(165)
    );
    assert_eq!(
        case.env.account(case.env.fee_in).lamports,
        before + event.unwrapped_lamports
    );
    assert!(case
        .env
        .closed(ata(&case.env.fee_in, &params::WSOL_MINT, &token())));
    let after_base = case.env.account(case.base_vault);
    // Writable venue accounts can receive the runtime's rent-epoch update.
    assert_eq!(
        (after_base.lamports, after_base.owner, after_base.data),
        (base.lamports, base.owner, base.data)
    );
    let pool = case.env.account(case.bag.curve);
    assert_eq!(read_u64(&pool.data, PARTNER_BASE_FEE), 123);
    assert_eq!(read_u64(&pool.data, PARTNER_QUOTE_FEE), 0);
    let state = case.env.state::<Machine>(case.env.machine);
    assert_eq!((state.stock_sol, state.team_sol, state.burn_sol), (0, 0, 0));
    collect(&mut case.env);
    assert_eq!(
        case.env.state::<Machine>(case.env.machine).stock_sol,
        event.unwrapped_lamports
    );
}

#[test]
fn t24_rejects_substitutions_and_never_grants_position_nft_authority() {
    for index in [3, 7, 8, 10, 11, 12, 16, 17, 18, 19] {
        let mut case = DbcClaimCase::new(100);
        let nft_bag = Bag {
            mint: Pubkey::new_unique(),
            token_program: token(),
            curve: Pubkey::default(),
            decimals: 0,
        };
        let mut mint_data = vec![0; 82];
        write_u64(&mut mint_data, 36, 1);
        mint_data[45] = 1;
        case.env.put(
            nft_bag.mint,
            solana_account::Account {
                lamports: case.env.rent_min(82),
                data: mint_data,
                owner: addr(&token()),
                ..Default::default()
            },
        );
        let nft = case.env.token_account(case.env.fee_in, &nft_bag, 1);
        let snapshot = case.env.account(nft);
        let mut instruction = case.claim(0);
        if index == 19 {
            instruction.accounts.push(meta(nft, true, false));
        } else {
            instruction.accounts[index] = meta(nft, index != 17, false);
        }
        assert_error(
            case.env.send(&[instruction], &[]),
            if index == 19 {
                "InvalidArgument"
            } else {
                "AccountMismatch"
            },
        );
        assert_eq!(case.env.account(nft), snapshot);
        assert_eq!(
            read_u64(&case.env.account(case.bag.curve).data, PARTNER_QUOTE_FEE),
            100
        );
    }
    let case = DbcClaimCase::new(100);
    let instruction = case.claim(0);
    assert!(!instruction.accounts[17].is_writable);
    assert!(!instruction.accounts[17].is_signer);
}

#[test]
fn t24_curve_claim_is_live_in_all_season_phases_even_when_paused() {
    for phase in 2..=6 {
        let mut case = DbcClaimCase::new(7);
        machine(&mut case.env, |m| m.phase = phase);
        config(&mut case.env, |c| {
            c.admin_paused = u8::MAX;
            c.guardian_paused = u8::MAX;
        });
        let tx = case.env.send(&[case.claim(0)], &[]).unwrap();
        assert_eq!(events::<LaunchFeesClaimed>(&tx)[0].quote, 7);
    }
}

#[test]
fn t24_surplus_unwraps_once_and_preserves_both_trading_fee_accruals() {
    let mut case = DbcClaimCase::new(1_000);
    // This isolated surplus fixture has a zero threshold. It does not model
    // launch economics or replace the end-to-end migration test.
    case.env
        .mutate(case.bag.curve, |a| write_u64(&mut a.data, 240, 1_000));
    let tx = case.env.send(&[case.claim(2)], &[]).unwrap();
    let event = events::<LaunchFeesClaimed>(&tx).remove(0);
    // The pinned DBC partner-and-creator surplus share is 80%; creator is 0%.
    assert_eq!(event.quote, 800);
    assert_eq!(event.unwrapped_lamports, 800 + case.env.rent_min(165));
    let pool = case.env.account(case.bag.curve);
    assert_eq!(read_u64(&pool.data, PARTNER_BASE_FEE), 123);
    assert_eq!(read_u64(&pool.data, PARTNER_QUOTE_FEE), 1_000);
    assert!(case.env.send(&[case.claim(2)], &[]).is_err());
}

#[test]
fn t24_pool_claims_both_tokens_never_blocks_sol_and_retains_base() {
    for nft_program in [token(), token2022()] {
        for base in [0, 123_456_789] {
            let mut case = PoolClaimCase::new(base, 1_000_000_007, nft_program);
            let nft = case.env.account(case.nft_account);
            let before = case.env.account(case.env.fee_in).lamports;
            let tx = case.env.send(&[case.claim()], &[]).unwrap();
            let event = events::<LaunchFeesClaimed>(&tx).remove(0);
            assert_eq!(
                (event.kind, event.quote, event.base),
                (1, 1_000_000_007, base)
            );
            assert_eq!(
                case.env.account(case.env.fee_in).lamports,
                before + event.unwrapped_lamports
            );
            assert_eq!(
                event.unwrapped_lamports,
                event.quote + case.env.rent_min(165)
            );
            assert_eq!(case.env.account(case.nft_account), nft);
            let base_ata = ata(&case.env.fee_in, &case.bag.mint, &token());
            let base_account = case.env.account(base_ata);
            assert_eq!(read_u64(&base_account.data, 64), base);
            assert_eq!(read_u32(&base_account.data, 72), 0);
            assert_eq!(read_u32(&base_account.data, 129), 0);
            assert_eq!(read_u64(&case.env.account(case.position).data, 136), 0);
            assert_eq!(read_u64(&case.env.account(case.position).data, 144), 0);
            collect(&mut case.env);
            assert_eq!(case.env.account(base_ata), base_account);
            assert_eq!(case.env.account(case.nft_account), nft);
            // A second claim remains live with the canonical base ATA present.
            case.env.warp(1);
            let tx = case.env.send(&[case.claim()], &[]).unwrap();
            let event = events::<LaunchFeesClaimed>(&tx).remove(0);
            assert_eq!((event.quote, event.base), (0, 0));
            assert_eq!(case.env.account(base_ata), base_account);
            assert_eq!(case.env.account(case.nft_account), nft);
        }
    }
}

#[test]
fn t24_pool_is_live_when_paused_and_after_end() {
    for phase in 2..=6 {
        let mut case = PoolClaimCase::new(3, 7, token2022());
        machine(&mut case.env, |m| m.phase = phase);
        config(&mut case.env, |c| {
            c.admin_paused = u8::MAX;
            c.guardian_paused = u8::MAX;
        });
        let tx = case.env.send(&[case.claim()], &[]).unwrap();
        assert_eq!(
            (
                events::<LaunchFeesClaimed>(&tx)[0].quote,
                events::<LaunchFeesClaimed>(&tx)[0].base
            ),
            (7, 3)
        );
    }
}

#[test]
fn t24_pool_rejects_substituted_position_nft_and_destinations_atomically() {
    for index in [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18] {
        let mut case = PoolClaimCase::new(3, 7, token());
        let snapshot = case.env.account(case.nft_account);
        let position = case.env.account(case.position);
        let mut ix = case.claim();
        ix.accounts[index].pubkey = addr(&case.env.fee_in);
        assert!(case.env.send(&[ix], &[]).is_err(), "slot {index}");
        assert_eq!(case.env.account(case.nft_account), snapshot);
        assert_eq!(case.env.account(case.position), position);
    }
    let mut case = PoolClaimCase::new(3, 7, token());
    case.env.mutate(case.nft_account, |a| {
        write_key(&mut a.data, 32, &Pubkey::new_unique())
    });
    assert_error(case.env.send(&[case.claim()], &[]), "AccountMismatch");
}

#[test]
fn t24_only_fee_in_signing_handlers_cannot_debit_base_or_nft() {
    // All authority sites are enumerated, so adding a new FeeIn signer requires
    // an explicit review of its ability to move the retained base or position.
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/instructions");
    let mut signers = Vec::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let entry = entry.unwrap();
        if !entry.path().is_file() {
            continue;
        }
        let source = std::fs::read_to_string(entry.path()).unwrap();
        if source.contains("FEE_IN_SEED")
            && (source.contains("new_with_signer") || source.contains("invoke_signed"))
        {
            signers.push(entry.file_name().to_str().unwrap().to_owned());
        }
    }
    signers.sort();
    assert_eq!(signers, ["claim_launch_fees.rs", "collect_creator_fees.rs"]);
    let mut case = PoolClaimCase::new(123, 7, token());
    case.env.send(&[case.claim()], &[]).unwrap();
    let base_ata = ata(&case.env.fee_in, &case.bag.mint, &token());
    for protected in [base_ata, case.nft_account] {
        let snapshot = case.env.account(protected);
        let mut ix = collect_ix(&case.env, pubkey(&case.env.authority.pubkey()));
        ix.accounts[3].pubkey = addr(&protected);
        assert_error(case.env.send(&[ix], &[]), "AccountMismatch");
        assert_eq!(case.env.account(protected), snapshot);
        for destination in [3, 18] {
            let mut ix = case.claim();
            ix.accounts[destination].pubkey = addr(&protected);
            // The legitimate base destination is always credited, never debited.
            if destination == 18 && protected == base_ata {
                continue;
            }
            assert_error(case.env.send(&[ix], &[]), "AccountMismatch");
            assert_eq!(case.env.account(protected), snapshot);
        }
    }
}

#[test]
fn t24_pool_rejects_corrupt_venue_and_position_identities() {
    for change in 0..12 {
        let mut case = PoolClaimCase::new(3, 7, token2022());
        match change {
            0 => case.env.mutate(case.pool, |a| a.owner = addr(&token())),
            1 => case.env.mutate(case.pool, |a| a.data[0] ^= 1),
            2 => case.env.mutate(case.pool, |a| a.data.truncate(1111)),
            3 => case.env.mutate(case.pool, |a| a.data[168] ^= 1),
            4 => case.env.mutate(case.pool, |a| a.data[200] ^= 1),
            5 => case.env.mutate(case.position, |a| a.owner = addr(&token())),
            6 => case.env.mutate(case.position, |a| a.data[0] ^= 1),
            7 => case.env.mutate(case.position, |a| a.data.truncate(407)),
            8 => case.env.mutate(case.position, |a| a.data[8] ^= 1),
            9 => case.env.mutate(case.position, |a| a.data[40] ^= 1),
            10 => case
                .env
                .mutate(case.nft_account, |a| write_u64(&mut a.data, 64, 0)),
            11 => case
                .env
                .mutate(case.nft_account, |a| a.owner = addr(&system())),
            _ => unreachable!(),
        }
        let nft = case.env.account(case.nft_account);
        let base = case.env.account(case.base_vault);
        let quote = case.env.account(case.quote_vault);
        assert_error(case.env.send(&[case.claim()], &[]), "AccountMismatch");
        assert_eq!(case.env.account(case.nft_account), nft);
        assert_eq!(case.env.account(case.base_vault), base);
        assert_eq!(case.env.account(case.quote_vault), quote);
    }
}
