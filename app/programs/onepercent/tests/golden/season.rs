use super::{fixture, hex, k};
use onepercent::{
    constants::*,
    math::{creator_fee, specials},
    params,
    state::Machine,
};
use serde_json::{json, Value};

fn random(seed: &mut u64) -> u64 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *seed
}

fn special_case(
    states: [u8; 4],
    on_air_ts: i64,
    now: i64,
    edition: usize,
    tokens: u64,
    cost: u64,
) -> Value {
    let mut machine: Machine = unsafe { std::mem::zeroed() };
    machine.on_air_ts = on_air_ts;
    for (slot, state) in machine.onepct.iter_mut().zip(states) {
        slot.state = state;
    }
    machine.jackpot_tokens = tokens;
    machine.jackpot_cost = cost;
    let price = params::PACK_EDITIONS_PRICE_LAMPORTS[edition];
    let (flags, index) = specials::live_flags(&machine, price, now);
    json!({"input":{"states":states,"onAirTs":on_air_ts.to_string(),"nowTs":now.to_string(),"edition":edition,"jackpotTokens":tokens.to_string(),"jackpotCost":cost.to_string()},"output":{"flags":flags,"onePctIndex":index,"jackpotLive":specials::jackpot_live(&machine,price),"releaseTimes":params::TOKEN_1PCT_ONE_PCT_RELEASE_OFFSETS_SECONDS.map(|offset|on_air_ts.saturating_add(offset).to_string())}})
}

#[test]
fn specials_vectors() {
    let start = 1_793_290_500i64;
    let offsets = params::TOKEN_1PCT_ONE_PCT_RELEASE_OFFSETS_SECONDS;
    let mut rows = vec![
        special_case([0; 4], start, start - 1, 0, 0, 0),
        special_case([0; 4], start, start, 0, 0, 0),
        special_case([2, 0, 0, 0], start, start + offsets[1] - 1, 0, 0, 0),
        special_case([2, 0, 0, 0], start, start + offsets[1], 0, 0, 0),
        special_case([2, 2, 0, 0], start, start + offsets[2] - 1, 0, 0, 0),
        special_case([2, 2, 0, 0], start, start + offsets[2], 0, 0, 0),
        special_case([2, 2, 2, 0], start, start + offsets[3] - 1, 0, 0, 0),
        special_case([2, 2, 2, 0], start, start + offsets[3], 0, 0, 0),
        special_case([0; 4], start, start + offsets[1] + 1, 0, 0, 0),
        special_case([2; 4], start, start, 0, 0, 0),
        special_case([7, 0, 0, 0], start, start, 0, 0, 0),
        special_case(
            [0; 4],
            start,
            start + params::SEASON_DURATION_SECONDS + 5,
            0,
            0,
            0,
        ),
        special_case(
            [3; 4],
            start,
            start + params::SEASON_DURATION_SECONDS + 5,
            0,
            0,
            0,
        ),
        special_case([2; 4], start, start, 0, 1, 1_499_999_999),
        special_case([2; 4], start, start, 0, 1, 1_500_000_000),
        special_case([0; 4], 0, i64::MAX, 0, u64::MAX, u64::MAX),
        special_case([2, 0, 0, 0], i64::MAX - 1, i64::MAX, 3, 1, u64::MAX),
        special_case([0; 4], i64::MIN, i64::MIN, 0, 0, u64::MAX),
    ];
    let mut seed = 41;
    for index in 0..128 {
        let leading = random(&mut seed) as usize % 5;
        let mut states = [0; 4];
        states
            .iter_mut()
            .take(leading)
            .for_each(|state| *state = ONEPCT_PULLED);
        if leading < 4 {
            states[leading] = (random(&mut seed) % 5) as u8;
        }
        let horizon = (params::SEASON_DURATION_SECONDS * 4 / 3) as u64;
        let now = start + (random(&mut seed) % horizon) as i64 - 100;
        let tokens = random(&mut seed);
        let price = params::PACK_EDITIONS_PRICE_LAMPORTS[index % 4];
        let threshold = u64::from(params::JACKPOT_MIN_POT_PRICE_MULTIPLE) * price;
        let cost = match index % 3 {
            0 => threshold - 1,
            1 => threshold,
            _ => random(&mut seed),
        };
        rows.push(special_case(states, start, now, index % 4, tokens, cost));
    }
    fixture("specials", json!(rows));
}

fn fee_case(phase: u8, stock: u64, costs: [u64; 16], amount: u64, hit_out: u64) -> Value {
    let mut machine: Machine = unsafe { std::mem::zeroed() };
    machine.phase = phase;
    machine.stock_sol = stock;
    machine.hit_out_last_hour = hit_out;
    for (bucket, cost) in machine.buckets.iter_mut().zip(costs) {
        bucket.cost = cost;
    }
    let regime = creator_fee::regime(&machine);
    let split = creator_fee::split(amount, regime);
    assert_eq!(
        split.stock as u128 + split.burn as u128 + split.team as u128,
        amount as u128
    );
    json!({"input":{"phase":phase,"stockSol":stock.to_string(),"bucketCosts":costs.map(|cost|cost.to_string()),"hitOutLastHour":hit_out.to_string(),"amount":amount.to_string()},"output":{"regime":regime,"book":creator_fee::book(&machine).to_string(),"target":creator_fee::target(&machine).to_string(),"split":{"stock":split.stock.to_string(),"burn":split.burn.to_string(),"team":split.team.to_string()}}})
}

#[test]
fn creator_fee_vectors() {
    let floor = params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS;
    let mut rows = vec![];
    for phase in [
        PHASE_POWERED_ON,
        PHASE_ON_AIR,
        PHASE_BUYS_CLOSED,
        PHASE_FINAL_PULL,
        PHASE_DONE,
    ] {
        for stock in [
            0,
            floor - 1,
            floor,
            params::STOCK_TARGET_BASE_LAMPORTS + 1,
            u64::MAX,
        ] {
            for amount in [0, 1, 9, 650_240, 1_000_000_007, u64::MAX] {
                rows.push(fee_case(phase, stock, [0; 16], amount, 0));
            }
        }
    }
    let mut boundary = [0; 16];
    boundary[15] = floor - 1;
    rows.push(fee_case(PHASE_ON_AIR, 0, boundary, 1_000_000_007, u64::MAX));
    rows.push(fee_case(PHASE_ON_AIR, 1, boundary, 1_000_000_007, u64::MAX));
    let mut seed = 27;
    for index in 0..128 {
        let mut costs = [0; 16];
        for cost in &mut costs {
            *cost = if index % 3 == 0 {
                random(&mut seed)
            } else {
                random(&mut seed) % (floor / 16)
            };
        }
        let stock = if index % 3 == 0 {
            random(&mut seed)
        } else {
            random(&mut seed) % floor
        };
        let amount = random(&mut seed);
        let hit_out = random(&mut seed);
        rows.push(fee_case(
            2 + (index % 5) as u8,
            stock,
            costs,
            amount,
            hit_out,
        ));
    }
    fixture("creator_fee", json!(rows));
}

#[test]
fn launch_pool_vectors() {
    let fee_in = k(27);
    let mint = k(28);
    let config = k(29);
    let mut pool_template = vec![0; DBC_POOL_MIN_LEN];
    pool_template[..8].copy_from_slice(&DBC_POOL_DISCRIMINATOR);
    pool_template[DBC_POOL_CONFIG_OFFSET..DBC_POOL_CONFIG_OFFSET + 32]
        .copy_from_slice(config.as_ref());
    pool_template[DBC_POOL_BASE_MINT_OFFSET..DBC_POOL_BASE_MINT_OFFSET + 32]
        .copy_from_slice(mint.as_ref());
    let mut config_template = vec![0; DBC_CONFIG_MIN_LEN];
    config_template[..8].copy_from_slice(&DBC_CONFIG_DISCRIMINATOR);
    config_template[DBC_CONFIG_QUOTE_MINT_OFFSET..DBC_CONFIG_QUOTE_MINT_OFFSET + 32]
        .copy_from_slice(params::WSOL_MINT.as_ref());
    config_template[DBC_CONFIG_FEE_CLAIMER_OFFSET..DBC_CONFIG_FEE_CLAIMER_OFFSET + 32]
        .copy_from_slice(fee_in.as_ref());
    let mut rows = vec![];
    let mut record = |name: &str, pool_data: Vec<u8>, config_data: Vec<u8>, expected: bool| {
        let accepted = onepercent::checks::launch_pool_data(&pool_data, &mint, &config).is_ok()
            && onepercent::checks::dbc_config_data(&config_data, &fee_in).is_ok();
        assert_eq!(accepted, expected, "{name}");
        rows.push(json!({"name":name,"feeIn":fee_in.to_string(),"mint":mint.to_string(),"dbcConfig":config.to_string(),"poolData":hex(&pool_data),"configData":hex(&config_data),"accepted":accepted}));
    };
    record(
        "valid",
        pool_template.clone(),
        config_template.clone(),
        true,
    );
    for length in [
        0,
        7,
        DBC_POOL_CONFIG_OFFSET + 31,
        DBC_POOL_BASE_MINT_OFFSET + 31,
        DBC_POOL_MIN_LEN - 1,
    ] {
        record(
            &format!("pool_length_{length}"),
            pool_template[..length].to_vec(),
            config_template.clone(),
            false,
        );
    }
    for length in [
        0,
        7,
        DBC_CONFIG_QUOTE_MINT_OFFSET + 31,
        DBC_CONFIG_FEE_CLAIMER_OFFSET + 31,
        DBC_CONFIG_CREATOR_TRADING_FEE_PERCENTAGE_OFFSET,
        DBC_CONFIG_MIN_LEN - 1,
    ] {
        record(
            &format!("config_length_{length}"),
            pool_template.clone(),
            config_template[..length].to_vec(),
            false,
        );
    }
    for (name, offset) in [
        ("pool_discriminator", 0),
        ("wrong_mint", DBC_POOL_BASE_MINT_OFFSET),
        ("wrong_config", DBC_POOL_CONFIG_OFFSET),
    ] {
        let mut data = pool_template.clone();
        data[offset] ^= 1;
        record(name, data, config_template.clone(), false);
    }
    for (name, offset) in [
        ("config_discriminator", 0),
        ("wrong_quote", DBC_CONFIG_QUOTE_MINT_OFFSET),
        ("wrong_fee_claimer", DBC_CONFIG_FEE_CLAIMER_OFFSET),
        (
            "creator_share",
            DBC_CONFIG_CREATOR_TRADING_FEE_PERCENTAGE_OFFSET,
        ),
    ] {
        let mut data = config_template.clone();
        data[offset] ^= 1;
        record(name, pool_template.clone(), data, false);
    }
    fixture("launch_pool", json!(rows));
}

#[test]
fn final_pull_vectors() {
    let mut inputs = vec![
        (1_000_000_000_000, 4_200_000_000, 4_980_000_000_000),
        (43_000_000_000_000, 4_200_000_000, 4_980_000_000_000),
        (0, 1, 1),
        (1, 0, 1),
        (1, 1, 0),
        (1, 1, 1),
        (1, 1, 2),
        (2, 1, 2),
        (u64::MAX, u64::MAX, u64::MAX),
        (u64::MAX, u64::MAX, 1),
        (1_000, 3, 7),
        (1_000, 7, 7),
    ];
    let mut seed = 7189;
    for _ in 0..128 {
        let pool = random(&mut seed);
        let total = random(&mut seed).max(1);
        let spend = random(&mut seed) % total;
        inputs.push((pool, spend, total));
    }
    let rows:Vec<_>=inputs.into_iter().map(|(pool,spend,total)|{
        let result=onepercent::math::final_pull::final_share(pool,spend,total);
        let reference=if total==0 {0} else {(u128::from(pool)*u128::from(spend)/u128::from(total)).min(u128::from(u64::MAX)) as u64};
        assert_eq!(result,reference);
        json!({"input":{"pool":pool.to_string(),"spend":spend.to_string(),"total":total.to_string()},"output":result.to_string()})
    }).collect();
    fixture("final_pull", json!(rows));
}
