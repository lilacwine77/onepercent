mod common;
#[path = "common/mycards.rs"]
mod mycards;
#[path = "common/property.rs"]
mod property;
#[path = "common/reference.rs"]
mod reference;
use common::{pack_cases::*, *};
use mycards::*;
use onepercent::{math::sellback, params, state::*};
use proptest::prelude::*;
use solana_signer::Signer;

fn math_case(
    values: Vec<(u64, u64, u64, u64, u64, u64, i64)>,
) -> proptest::test_runner::TestCaseResult {
    use bytemuck::Zeroable;
    for (stocked, quote, stock, start, cost, paid, now) in values {
        for (amount, cost, new_amount, new_cost, reserved) in [
            (stocked, cost, stock, quote, paid),
            (
                stocked % 100,
                cost % 50_000_000_000,
                stock % 100,
                quote % 50_000_000_000,
                paid % 2,
            ),
        ] {
            let mut bucket = Bucket::zeroed();
            bucket.amount = amount;
            bucket.cost = cost;
            bucket.reserved = reserved;
            let expected =
                reference::sell_back_coverage(amount, cost, new_amount, new_cost, reserved);
            let actual = sellback::check_sell_back_coverage(&bucket, new_amount, new_cost);
            prop_assert_eq!(actual.is_ok(), expected);
            if !expected {
                prop_assert!(
                    format!("{:?}", actual.err().unwrap()).contains("ReservedCapacity"),
                    "coverage refusal must match"
                );
            }
        }

        let expected = reference::sell_back_payout(stocked, quote);
        let actual = sellback::sell_back_payout(stocked, quote);
        match expected {
            Ok((value, payout, margin)) => {
                let actual = actual.unwrap();
                prop_assert_eq!(
                    (actual.value, actual.payout, actual.margin),
                    (value, payout, margin)
                );
                prop_assert!(
                    u128::from(payout) * u128::from(params::BPS_DENOMINATOR)
                        <= u128::from(stocked) * u128::from(params::SELL_BACK_PAYOUT_BPS)
                );
            }
            Err(error) => prop_assert!(
                format!("{:?}", actual.err().unwrap()).contains(error),
                "refusal must match {error}"
            ),
        }
        let mut machine = Machine::zeroed();
        machine.stock_sol = stock;
        machine.sol_at_hour_start = start;
        machine.sb_paid_hour = paid;
        machine.hour_index = 1;
        machine.hit_out_this_hour = cost;
        machine.hit_out_last_hour = paid;
        machine.buckets[0].class = 1;
        machine.buckets[0].cost = cost;
        machine.buckets[0].cap = u64::MAX;
        let expected =
            reference::sell_back_check(&machine, &machine.buckets[0], stocked, quote, now);
        let actual = sellback::sell_back_checks(&machine, &machine.buckets[0], stocked, quote, now);
        match expected {
            Ok(expected) => {
                let actual = actual.unwrap();
                prop_assert_eq!(
                    (
                        actual.value,
                        actual.payout,
                        actual.to_team,
                        actual.stock_sol,
                        actual.team_sol,
                        actual.bucket_cost,
                        actual.sb_paid_hour
                    ),
                    (
                        expected.value,
                        expected.payout,
                        expected.to_team,
                        expected.stock_sol,
                        expected.team_sol,
                        expected.bucket_cost,
                        expected.sb_paid_hour
                    )
                );
                prop_assert_eq!(
                    (
                        actual.hour.hour_index,
                        actual.hour.sol_at_hour_start,
                        actual.hour.hit_out_last_hour
                    ),
                    (
                        expected.hour_index,
                        expected.sol_at_hour_start,
                        expected.hit_out_last_hour
                    )
                );
            }
            Err(error) => prop_assert!(
                format!("{:?}", actual.err().unwrap()).contains(error),
                "refusal must match {error}"
            ),
        }
    }
    Ok(())
}
#[test]
fn sb1_independent_integer_oracle_extremes() {
    property::parallel_named(
        file!(),
        concat!(file!(), ".math"),
        || {
            prop::collection::vec(
                (
                    any::<u64>(),
                    any::<u64>(),
                    any::<u64>(),
                    any::<u64>(),
                    any::<u64>(),
                    any::<u64>(),
                    any::<i64>(),
                ),
                200,
            )
        },
        math_case,
    );
}

fn transaction_case(
    (quotes, mode, offset): (Vec<u32>, u8, u32),
) -> proptest::test_runner::TestCaseResult {
    let (mut e, u, bag) = fixture(quotes.len());
    let owner = pubkey(&u.pubkey());
    let machine = e.machine;
    let now = e.now();
    edit::<Machine>(&mut e, machine, |m| match mode % 5 {
        0 => m.stock_sol = params::SELL_BACK_SOL_FLOOR_LAMPORTS + u64::from(offset),
        1 => {
            let budget = u128::from(params::SELL_BACK_HOURLY_BUDGET_MIN_LAMPORTS).max(
                u128::from(m.sol_at_hour_start)
                    * u128::from(params::SELL_BACK_HOURLY_BUDGET_BPS_OF_STOCK_SOL)
                    / u128::from(params::BPS_DENOMINATOR),
            );
            m.sb_paid_hour = u64::try_from(budget)
                .unwrap()
                .saturating_sub(u64::from(offset));
        }
        2 => m.buckets[0].cap = m.buckets[0].cost + u64::from(offset),
        3 => m.hour_index = now.max(0) as u64 / 3600 - 1,
        _ => {}
    });
    fund_machine(&mut e);
    for (index, quote) in quotes.into_iter().enumerate().rev() {
        let before = e.state::<Machine>(e.machine);
        let before_binder = e.state::<Binder>(binder(owner));
        let stocked = cards(&e, owner)[index].value;
        let quote = u64::from(quote);
        let expected =
            reference::sell_back_check(&before, &before.buckets[0], stocked, quote, e.now());
        let ixs = sb_ixs(&e, owner, &bag, &[index as u16], quote);
        match expected {
            Ok(expected) => {
                e.send(&ixs, &[&u]).unwrap();
                let after = e.state::<Machine>(e.machine);
                prop_assert_eq!(
                    (
                        after.stock_sol,
                        after.team_sol,
                        after.buckets[0].cost,
                        after.sb_paid_hour
                    ),
                    (
                        expected.stock_sol,
                        expected.team_sol,
                        expected.bucket_cost,
                        expected.sb_paid_hour
                    )
                );
                prop_assert_eq!(
                    e.state::<Binder>(binder(owner)).sb_nonce,
                    before_binder.sb_nonce + 1
                );
            }
            Err(error) => {
                unchanged_on_error(&mut e, &u, &ixs, error);
                e.send(&[e.redeem_ix(owner, &bag, index as u16, 1000)], &[&u])
                    .unwrap();
            }
        }
    }
    Ok(())
}
#[test]
fn sb1_random_quotes_refusals_and_nonces() {
    property::parallel_named(
        file!(),
        concat!(file!(), ".transactions"),
        || {
            (
                prop::collection::vec(any::<u32>(), 1..=8),
                any::<u8>(),
                any::<u32>(),
            )
        },
        transaction_case,
    );
}

#[test]
fn sb1_golden_payouts() {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/vectors/sellback.json")).unwrap();
    let rows = rows["payouts"].as_array().unwrap();
    assert!(rows.len() >= 12);
    for row in rows {
        let stocked = row["stockedValue"].as_str().unwrap().parse().unwrap();
        let quote = row["quoteLamports"].as_str().unwrap().parse().unwrap();
        let actual = sellback::sell_back_payout(stocked, quote);
        if let Some(error) = row["error"].as_str() {
            assert!(format!("{:?}", actual.err().unwrap()).contains(error));
        } else {
            let actual = actual.unwrap();
            for (name, value) in [
                ("value", actual.value),
                ("payout", actual.payout),
                ("margin", actual.margin),
            ] {
                assert_eq!(row[name].as_str().unwrap(), value.to_string());
            }
        }
    }
}

#[test]
fn sb1_golden_checks() {
    use bytemuck::Zeroable;
    let vectors: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/vectors/sellback.json")).unwrap();
    for row in vectors["checks"].as_array().unwrap() {
        let input = &row["input"];
        let number = |name: &str| input[name].as_str().unwrap().parse::<u64>().unwrap();
        let mut machine = Machine::zeroed();
        machine.stock_sol = number("stock_sol");
        machine.team_sol = number("team_sol");
        machine.hour_index = number("hour_index");
        machine.hit_out_this_hour = number("hit_out_this_hour");
        machine.hit_out_last_hour = number("hit_out_last_hour");
        machine.sb_paid_hour = number("sb_paid_hour");
        machine.sol_at_hour_start = number("sol_at_hour_start");
        for (bucket, cost) in machine
            .buckets
            .iter_mut()
            .zip(input["bucket_costs"].as_array().unwrap())
        {
            bucket.class = 1;
            bucket.cost = cost.as_str().unwrap().parse().unwrap();
        }
        let mut bucket = Bucket::zeroed();
        bucket.class = 1;
        bucket.cost = number("bucket_cost");
        bucket.cap = number("bucket_cap");
        let result = sellback::sell_back_checks(
            &machine,
            &bucket,
            number("stocked_value"),
            number("quote_lamports"),
            input["now"].as_str().unwrap().parse().unwrap(),
        );
        let expected = &row["expected"];
        if expected["ok"] == false {
            assert!(
                format!("{:?}", result.err().unwrap())
                    .contains(expected["error"].as_str().unwrap()),
                "{}",
                row["name"]
            );
        } else {
            let actual = result.unwrap();
            for (name, value) in [
                ("value", actual.value),
                ("payout", actual.payout),
                ("to_team", actual.to_team),
                ("stock_sol", actual.stock_sol),
                ("team_sol", actual.team_sol),
                ("sb_paid_hour", actual.sb_paid_hour),
                ("bucket_cost", actual.bucket_cost),
            ] {
                assert_eq!(
                    expected[name].as_str().unwrap(),
                    value.to_string(),
                    "{} {name}",
                    row["name"]
                );
            }
            for (name, value) in [
                ("hour_index", actual.hour.hour_index),
                ("hit_out_this_hour", actual.hour.hit_out_this_hour),
                ("hit_out_last_hour", actual.hour.hit_out_last_hour),
                ("sb_paid_hour", actual.hour.sb_paid_hour),
                ("sol_at_hour_start", actual.hour.sol_at_hour_start),
                ("stock_sol", actual.hour.stock_sol),
            ] {
                assert_eq!(
                    expected["hour"][name].as_str().unwrap(),
                    value.to_string(),
                    "{} hour {name}",
                    row["name"]
                );
            }
        }
    }
}

#[test]
fn sb1_d12_preserves_only_previous_edition_qualifications() {
    use bytemuck::Zeroable;
    let mut bucket = Bucket::zeroed();
    bucket.amount = 1;
    bucket.cost = 500_000_000;
    bucket.reserved = 500_000_000;
    // This ratio qualifies AH only. Keeping AH qualification cannot require OG.
    assert!(sellback::check_sell_back_coverage(&bucket, 2, 1_000_000_000).is_ok());
    assert!(sellback::check_sell_back_coverage(&bucket, 2, 1_000_000_001).is_err());
    bucket.reserved = 0;
    assert!(sellback::check_sell_back_coverage(&bucket, 2, 1_000_000_001).is_ok());
}

/// Rebuilds expected outputs independently while retaining the reviewed input corpus.
/// UPDATE_GOLDEN=1 follows the existing Rust fixture update convention.
#[test]
fn sb1_regenerate_vectors() {
    use bytemuck::Zeroable;
    use serde_json::json;
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/vectors/sellback.json");
    let original: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let mut generated = original.clone();
    for row in generated["payouts"].as_array_mut().unwrap() {
        let stocked = row["stockedValue"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap();
        let quote = row["quoteLamports"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap();
        let value = stocked.min(quote);
        let payout = (u128::from(value) * u128::from(params::SELL_BACK_PAYOUT_BPS)
            / u128::from(params::BPS_DENOMINATOR)) as u64;
        row["value"] = json!(value.to_string());
        row["payout"] = json!(payout.to_string());
        row["margin"] = json!((value - payout).to_string());
        row["error"] = json!(reference::sell_back_payout(stocked, quote).err());
    }
    for row in generated["checks"].as_array_mut().unwrap() {
        let input = &row["input"];
        let number = |name: &str| input[name].as_str().unwrap().parse::<u64>().unwrap();
        let mut machine = Machine::zeroed();
        machine.stock_sol = number("stock_sol");
        machine.team_sol = number("team_sol");
        machine.hour_index = number("hour_index");
        machine.hit_out_this_hour = number("hit_out_this_hour");
        machine.hit_out_last_hour = number("hit_out_last_hour");
        machine.sb_paid_hour = number("sb_paid_hour");
        machine.sol_at_hour_start = number("sol_at_hour_start");
        for (bucket, cost) in machine
            .buckets
            .iter_mut()
            .zip(input["bucket_costs"].as_array().unwrap())
        {
            bucket.class = 1;
            bucket.cost = cost.as_str().unwrap().parse().unwrap();
        }
        let mut bucket = Bucket::zeroed();
        bucket.class = 1;
        bucket.cost = number("bucket_cost");
        bucket.cap = number("bucket_cap");
        let result = reference::sell_back_check(
            &machine,
            &bucket,
            number("stocked_value"),
            number("quote_lamports"),
            input["now"].as_str().unwrap().parse().unwrap(),
        );
        row["expected"] = match result {
            Err(error) => json!({"ok":false,"error":error}),
            Ok(result) => {
                let rotated = result.hour_index != machine.hour_index;
                json!({"ok":true,"value":result.value.to_string(),"payout":result.payout.to_string(),"to_team":result.to_team.to_string(),"stock_sol":result.stock_sol.to_string(),"team_sol":result.team_sol.to_string(),"sb_paid_hour":result.sb_paid_hour.to_string(),"bucket_cost":result.bucket_cost.to_string(),"hour":{"hour_index":result.hour_index.to_string(),"hit_out_this_hour":(if rotated{0}else{machine.hit_out_this_hour}).to_string(),"hit_out_last_hour":result.hit_out_last_hour.to_string(),"sb_paid_hour":(if rotated{0}else{machine.sb_paid_hour}).to_string(),"sol_at_hour_start":result.sol_at_hour_start.to_string(),"stock_sol":machine.stock_sol.to_string()}})
            }
        };
    }
    if std::env::var("UPDATE_GOLDEN").as_deref() == Ok("1") {
        std::fs::write(
            path,
            format!("{}\n", serde_json::to_string_pretty(&generated).unwrap()),
        )
        .unwrap();
    } else {
        assert_eq!(
            original, generated,
            "sellback.json drifted; regenerate with UPDATE_GOLDEN=1"
        );
    }
}
