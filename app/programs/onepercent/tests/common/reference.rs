//! Independent naive specification model; no production math calls.
#![allow(dead_code)]
use onepercent::params;
use solana_sha256_hasher::hashv;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Bucket {
    pub class: u8,
    pub enabled: bool,
    pub amount: u64,
    pub cost: u64,
    pub reserved: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Split {
    pub royalty: u64,
    pub jackpot: u64,
    pub burn: u64,
    pub referral: u64,
    pub team: u64,
    pub stock: u64,
}
pub fn split(price: u64) -> Split {
    let share = |bps: u32| {
        (u128::from(price) * u128::from(bps) / u128::from(params::BPS_DENOMINATOR)) as u64
    };
    let royalty = share(params::PACK_SPLIT_BPS_ROYALTY_PER_DUST_CARD);
    let jackpot = share(params::PACK_SPLIT_BPS_JACKPOT);
    let burn = share(params::PACK_SPLIT_BPS_BURN1PCT);
    let referral = share(params::PACK_SPLIT_BPS_REFERRAL);
    let team = share(params::PACK_SPLIT_BPS_TEAM);
    let stock = (u128::from(price)
        - u128::from(royalty) * u128::from(params::CARDS_PER_PACK_DUST)
        - u128::from(jackpot)
        - u128::from(burn)
        - u128::from(referral)
        - u128::from(team)) as u64;
    Split {
        royalty,
        jackpot,
        burn,
        referral,
        team,
        stock,
    }
}
pub fn tier_value(price: u64, kind: u8) -> Option<u64> {
    if !(1..=4).contains(&kind) {
        return None;
    }
    let value = u128::from(price) * u128::from(params::HIT_TIERS_VALUE_BPS[usize::from(kind - 1)])
        / u128::from(params::BPS_DENOMINATOR);
    if value <= u128::from(u64::MAX) {
        Some(value as u64)
    } else {
        None
    }
}
fn hash_number(tag: &[u8], randomness: &[u8; 32], seq: u64, suffix: &[u8]) -> u64 {
    let mut input = Vec::new();
    input.extend_from_slice(tag);
    input.extend_from_slice(randomness);
    input.extend_from_slice(&seq.to_le_bytes());
    input.extend_from_slice(suffix);
    let digest = hashv(&[input.as_slice()]).to_bytes();
    let mut value = 0u64;
    for (index, byte) in digest.iter().take(8).enumerate() {
        value |= u64::from(*byte) << (8 * index);
    }
    value
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Draw {
    pub t: u32,
    pub tier: u8,
    pub widths: [u32; 6],
}
pub fn draw(
    randomness: &[u8; 32],
    seq: u64,
    pack: u8,
    edition: u8,
    live: u8,
    holder: bool,
) -> Option<Draw> {
    if edition >= 4 {
        return None;
    }
    let price = params::PACK_EDITIONS_PRICE_LAMPORTS[usize::from(edition)];
    let one_pct = if live & 1 == 1 {
        let base = u128::from(price / u64::from(params::HIT_ODDS_ONE_PCT_PRICE_DIVISOR));
        if holder {
            (base * u128::from(params::TOKEN_1PCT_HOLDER_TIER_ONE_PCT_ODDS_MULTIPLIER_BPS)
                / u128::from(params::BPS_DENOMINATOR)) as u32
        } else {
            base as u32
        }
    } else {
        0
    };
    let jackpot = if live & 4 == 4 {
        (price / u64::from(params::HIT_ODDS_JACKPOT_PRICE_DIVISOR)) as u32
    } else {
        0
    };
    let widths = [
        one_pct,
        0,
        jackpot,
        params::HIT_ODDS_BLACK_PPB,
        params::HIT_ODDS_HOLO_PPB,
        params::HIT_ODDS_BLUE_PPB[usize::from(edition)],
    ];
    let t = (u128::from(hash_number(
        params::DRAW_TAGS_TIER,
        randomness,
        seq,
        &[pack],
    )) * u128::from(params::PPB_DENOMINATOR)
        / (1u128 << 64)) as u32;
    let mut remaining = t;
    for (kind, width) in [6, 7, 5, 4, 3, 2].into_iter().zip(widths) {
        if remaining < width {
            return Some(Draw {
                t,
                tier: kind,
                widths,
            });
        }
        remaining -= width;
    }
    Some(Draw { t, tier: 1, widths })
}
pub fn dust_index(randomness: &[u8; 32], seq: u64, pack: u8, k: u8, len: u32) -> u32 {
    (u128::from(hash_number(
        params::DRAW_TAGS_DUST,
        randomness,
        seq,
        &[pack, k],
    )) * u128::from(len)
        / (1u128 << 64)) as u32
}
fn free(b: &Bucket) -> u64 {
    if b.reserved > b.cost {
        0
    } else {
        b.cost - b.reserved
    }
}
#[allow(clippy::too_many_arguments)]
pub fn bucket_pick(
    randomness: &[u8; 32],
    seq: u64,
    pack: u8,
    kind: u8,
    value: u64,
    backing: u8,
    buckets: &[Bucket],
) -> Option<usize> {
    if !(1..=4).contains(&kind) || value == 0 {
        return None;
    }
    let major = params::HIT_TIERS_MAJOR_ONLY[usize::from(kind - 1)];
    let candidates: Vec<usize> = buckets
        .iter()
        .take(params::STOCK_MAX_BUCKETS as usize)
        .enumerate()
        .filter(|(_, b)| {
            b.class != 0
                && b.enabled
                && (!major || b.class == 1)
                && free(b) >= value
                && u128::from(value) * u128::from(b.amount) >= u128::from(b.cost)
        })
        .map(|(index, _)| index)
        .collect();
    if !candidates.is_empty() {
        let total: u128 = candidates
            .iter()
            .map(|i| u128::from(free(&buckets[*i])))
            .sum();
        let cap = total.min(u128::from(u64::MAX));
        let mut remainder = u128::from(hash_number(
            params::DRAW_TAGS_BUCKET,
            randomness,
            seq,
            &[pack],
        )) * cap
            / (1u128 << 64);
        for index in candidates {
            let width = u128::from(free(&buckets[index]));
            if remainder < width {
                return Some(index);
            }
            remainder -= width;
        }
    }
    let index = usize::from(backing);
    if index < params::STOCK_MAX_BUCKETS as usize
        && buckets.get(index).is_some_and(|b| free(b) >= value)
    {
        Some(index)
    } else {
        None
    }
}
pub fn carve(value: u64, amount: u64, cost: u64) -> Option<(u64, u64, u64)> {
    if value == 0 || cost == 0 || value > cost {
        return None;
    }
    let count = (u128::from(value) * u128::from(amount) / u128::from(cost)) as u64;
    if count == 0 {
        None
    } else {
        Some((count, amount - count, cost - value))
    }
}
pub fn coverage(price: u64, qty: u8, buckets: &mut [Bucket]) -> Option<Vec<u8>> {
    let full_need = u128::from(price) * u128::from(params::COVERAGE_PER_PACK_VALUE_BPS)
        / u128::from(params::BPS_DENOMINATOR);
    if full_need == 0 || full_need > u128::from(u64::MAX) {
        return None;
    }
    let smallest = tier_value(price, 1)?;
    let need = full_need as u64;
    let mut working = buckets.to_vec();
    let mut selected = Vec::new();
    for _ in 0..qty {
        let mut possible: Vec<usize> = working
            .iter()
            .take(params::STOCK_MAX_BUCKETS as usize)
            .enumerate()
            .filter(|(_, b)| {
                b.class == 1
                    && b.enabled
                    && free(b) >= need
                    && b.cost > 0
                    && smallest > 0
                    && u128::from(smallest) * u128::from(b.amount) >= u128::from(b.cost)
            })
            .map(|(index, _)| index)
            .collect();
        possible.sort_by(|a, b| free(&working[*b]).cmp(&free(&working[*a])).then(a.cmp(b)));
        let index = *possible.first()?;
        working[index].reserved += need;
        selected.push(index as u8);
    }
    buckets.copy_from_slice(&working);
    Some(selected)
}
pub fn max_qty(edition: u8, deck_len: u32, reserved_dust: u32, buckets: &[Bucket]) -> u8 {
    if edition >= 4 {
        return 0;
    }
    let price = params::PACK_EDITIONS_PRICE_LAMPORTS[usize::from(edition)];
    let maximum = params::PACK_EDITIONS_MAX_PER_RIP[usize::from(edition)] as u8;
    let mut best = 0;
    for quantity in 1..=maximum {
        let required = u64::from(reserved_dust)
            + u64::from(params::CARDS_PER_PACK_DUST) * u64::from(quantity)
            + u64::from(params::COVERAGE_DUST_BUFFER);
        if u64::from(deck_len) < required {
            break;
        }
        let mut candidate = buckets.to_vec();
        if coverage(price, quantity, &mut candidate).is_none() {
            break;
        }
        best = quantity;
    }
    best
}

pub fn live_flags(
    machine: &onepercent::state::Machine,
    price: u64,
    now: i64,
) -> (u8, Option<usize>) {
    let one_pct = if machine.on_air_ts == 0 {
        None
    } else {
        let first = machine.onepct.iter().position(|slot| slot.state != 2);
        first.filter(|index| {
            machine.onepct[*index].state <= 1
                && i128::from(now)
                    >= (i128::from(machine.on_air_ts)
                        + i128::from(params::TOKEN_1PCT_ONE_PCT_RELEASE_OFFSETS_SECONDS[*index]))
                    .min(i128::from(i64::MAX))
        })
    };
    let jackpot = machine.jackpot_tokens != 0
        && u128::from(machine.jackpot_cost)
            >= u128::from(price) * u128::from(params::JACKPOT_MIN_POT_PRICE_MULTIPLE);
    (
        u8::from(one_pct.is_some()) | (u8::from(jackpot) << 2),
        one_pct,
    )
}

pub fn creator_regime(machine: &onepercent::state::Machine) -> u8 {
    let book = u128::from(machine.stock_sol)
        + machine
            .buckets
            .iter()
            .map(|b| u128::from(b.cost))
            .sum::<u128>();
    if machine.phase >= 4 {
        2
    } else if book < u128::from(params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS) {
        0
    } else {
        1
    }
}

pub fn creator_split(amount: u64, regime: u8) -> (u64, u64, u64) {
    let team = match regime {
        0 => 0,
        1 => {
            (u128::from(amount) * u128::from(params::CREATOR_FEE_SPLIT_BPS_SEASON_TEAM)
                / u128::from(params::BPS_DENOMINATOR)) as u64
        }
        _ => amount,
    };
    (amount - team, 0, team)
}

// M2 executor model. Every narrowing is explicit; no implementation helpers.
pub fn exec_book(amount: u64, units: u64, cost: u64) -> Option<u64> {
    if amount == 0 || amount > units || units == 0 {
        return None;
    }
    if amount == units {
        Some(cost)
    } else {
        u64::try_from(u128::from(amount) * u128::from(cost) / u128::from(units)).ok()
    }
}
pub fn exec_cap(previous: u64, current: u64) -> u64 {
    params::STOCK_HOURLY_FLOOR_LAMPORTS.max(
        previous
            .max(current)
            .saturating_mul(u64::from(params::STOCK_HOURLY_HIT_OUT_MULTIPLE)),
    )
}
fn exec_slip(expected: u128, slip: u32) -> Option<(u64, u64)> {
    let out = expected.checked_mul(u128::from(params::BPS_DENOMINATOR.checked_sub(slip)?))?
        / u128::from(params::BPS_DENOMINATOR);
    Some((u64::try_from(expected).ok()?, u64::try_from(out).ok()?))
}
pub fn exec_major(
    value: u64,
    sol_price: i64,
    sol_expo: i32,
    token_price: i64,
    token_expo: i32,
    decimals: u8,
    sell: bool,
) -> Option<(u64, u64)> {
    if sol_price <= 0
        || token_price <= 0
        || !(-18..=0).contains(&sol_expo)
        || !(-18..=0).contains(&token_expo)
    {
        return None;
    }
    let (price_in, price_out, e) = if sell {
        (
            token_price,
            sol_price,
            token_expo - sol_expo + 9 - i32::from(decimals),
        )
    } else {
        (
            sol_price,
            token_price,
            sol_expo - token_expo + i32::from(decimals) - 9,
        )
    };
    let mut top = u128::from(value).checked_mul(price_in as u128)?;
    let mut bottom = price_out as u128;
    if e >= 0 {
        top = top.checked_mul(10u128.checked_pow(e as u32)?)?;
    } else {
        bottom = bottom.checked_mul(10u128.checked_pow(e.unsigned_abs())?)?;
    }
    exec_slip(top / bottom, params::STOCK_MAJOR_MIN_OUT_SLIP_BPS)
}
pub fn exec_pool(
    value: u64,
    base: u64,
    quote: u64,
    virtual_quote: i128,
    slip: u32,
    sell: bool,
) -> Option<(u64, u64)> {
    let total = i128::from(quote).checked_add(virtual_quote)?;
    if total <= 0 {
        return None;
    }
    let bps = u128::from(params::BPS_DENOMINATOR);
    let fee = u128::from(params::BPS_DENOMINATOR - params::STOCK_TRENDING_POOL_FEE_ALLOWANCE_BPS);
    let expected = if sell {
        let gross = (total as u128)
            .checked_mul(u128::from(value))?
            .checked_div(u128::from(base) + u128::from(value))?;
        (gross.checked_mul(fee)? / bps).min(u128::from(quote))
    } else {
        let effective = u128::from(value) * fee / bps;
        u128::from(base)
            .checked_mul(effective)?
            .checked_div((total as u128).checked_add(effective)?)?
    };
    exec_slip(expected, slip)
}
pub fn exec_curve(
    value: u64,
    virtual_token: u64,
    virtual_sol: u64,
    real: u64,
    slip: u32,
) -> Option<(u64, u64)> {
    if virtual_sol == 0 {
        return None;
    }
    let effective = u128::from(value)
        * u128::from(params::BPS_DENOMINATOR - params::STOCK_TRENDING_POOL_FEE_ALLOWANCE_BPS)
        / u128::from(params::BPS_DENOMINATOR);
    let expected = (u128::from(virtual_token) * effective)
        .checked_div(u128::from(virtual_sol) + effective)?
        .min(u128::from(real));
    exec_slip(expected, slip)
}

/// Independent D29 model: binary polynomial multiplication and restoring
/// division use one bit per element, without production limb arithmetic.
pub fn exec_meteora(value: u64, sqrt_price: u128, slip: u32) -> Option<(u64, u64)> {
    if sqrt_price == 0 {
        return None;
    }
    let fee_factor = params::BPS_DENOMINATOR.checked_sub(params::METEORA_FEE_ALLOW_BPS)?;
    let effective =
        u128::from(value) * u128::from(fee_factor) / u128::from(params::BPS_DENOMINATOR);
    let sqrt_bits: [u16; 128] = std::array::from_fn(|index| ((sqrt_price >> index) & 1) as u16);
    let mut coefficients = [0u16; 256];
    for (position, left) in sqrt_bits.iter().enumerate() {
        for (coefficient, right) in coefficients.iter_mut().skip(position).zip(sqrt_bits.iter()) {
            *coefficient += left * right;
        }
    }
    let mut carry = 0u16;
    let denominator: Vec<u8> = coefficients
        .into_iter()
        .map(|coefficient| {
            let total = coefficient + carry;
            carry = total / 2;
            (total % 2) as u8
        })
        .collect();
    let numerator: [u8; 256] = std::array::from_fn(|index| {
        if (128..192).contains(&index) {
            ((effective >> (index - 128)) & 1) as u8
        } else {
            0
        }
    });
    let mut remainder = [0u8; 256];
    let mut quotient = 0u64;
    for (position, next_bit) in numerator.iter().enumerate().rev() {
        remainder.rotate_right(1);
        *remainder.first_mut()? = *next_bit;
        if remainder.iter().rev().cmp(denominator.iter().rev()).is_lt() {
            continue;
        }
        if position >= 64 {
            return None;
        }
        let mut borrow = 0i16;
        for (left, right) in remainder.iter_mut().zip(denominator.iter()) {
            let difference = i16::from(*left) - i16::from(*right) - borrow;
            *left = difference.rem_euclid(2) as u8;
            borrow = i16::from(difference < 0);
        }
        quotient |= 1u64 << position;
    }
    exec_slip(u128::from(quotient), slip)
}

/// M2 P2 oracle. Independent integer equations, without production math calls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SellBackResult {
    pub value: u64,
    pub payout: u64,
    pub margin: u64,
    pub to_team: u64,
    pub stock_sol: u64,
    pub team_sol: u64,
    pub bucket_cost: u64,
    pub sb_paid_hour: u64,
    pub hour_index: u64,
    pub sol_at_hour_start: u64,
    pub hit_out_last_hour: u64,
}

pub fn sell_back_payout(stocked: u64, quote: u64) -> Result<(u64, u64, u64), &'static str> {
    let value = stocked.min(quote);
    let payout = u64::try_from(
        u128::from(value) * u128::from(params::SELL_BACK_PAYOUT_BPS)
            / u128::from(params::BPS_DENOMINATOR),
    )
    .map_err(|_| "MathOverflow")?;
    if quote == 0 || payout == 0 {
        return Err("InvalidArgument");
    }
    Ok((value, payout, value - payout))
}

pub fn sell_back_check(
    machine: &onepercent::state::Machine,
    bucket: &onepercent::state::Bucket,
    stocked: u64,
    quote: u64,
    now: i64,
) -> Result<SellBackResult, &'static str> {
    let (value, payout, margin) = sell_back_payout(stocked, quote)?;
    let hour_index = u64::try_from(now.max(0)).unwrap() / 3600;
    let rotated = hour_index != machine.hour_index;
    let hit_out_last_hour = if rotated {
        if hour_index == machine.hour_index.saturating_add(1) {
            machine.hit_out_this_hour
        } else {
            0
        }
    } else {
        machine.hit_out_last_hour
    };
    let sol_at_hour_start = if rotated {
        machine.stock_sol
    } else {
        machine.sol_at_hour_start
    };
    let paid = if rotated { 0 } else { machine.sb_paid_hour };
    let book = u128::from(machine.stock_sol)
        + machine
            .buckets
            .iter()
            .filter(|b| b.class != 0)
            .map(|b| u128::from(b.cost))
            .sum::<u128>();
    let target = u128::from(params::STOCK_TARGET_BASE_LAMPORTS) + u128::from(hit_out_last_hour);
    let to_team = if book < target { 0 } else { margin };
    if u128::from(machine.stock_sol)
        < u128::from(payout)
            + u128::from(to_team)
            + u128::from(params::SELL_BACK_SOL_FLOOR_LAMPORTS)
    {
        return Err("SellBackFloor");
    }
    let budget = u128::from(params::SELL_BACK_HOURLY_BUDGET_MIN_LAMPORTS).max(
        u128::from(sol_at_hour_start)
            * u128::from(params::SELL_BACK_HOURLY_BUDGET_BPS_OF_STOCK_SOL)
            / u128::from(params::BPS_DENOMINATOR),
    );
    let sb_paid_hour = u128::from(paid) + u128::from(payout);
    if sb_paid_hour > budget {
        return Err("SellBackBudget");
    }
    let bucket_cost = u128::from(bucket.cost) + u128::from(value);
    if bucket_cost > u128::from(bucket.cap) {
        return Err("BucketCapExceeded");
    }
    Ok(SellBackResult {
        value,
        payout,
        margin,
        to_team,
        stock_sol: machine.stock_sol - payout - to_team,
        team_sol: machine
            .team_sol
            .checked_add(to_team)
            .ok_or("MathOverflow")?,
        bucket_cost: u64::try_from(bucket_cost).map_err(|_| "MathOverflow")?,
        sb_paid_hour: u64::try_from(sb_paid_hour).map_err(|_| "MathOverflow")?,
        hour_index,
        sol_at_hour_start,
        hit_out_last_hour,
    })
}

pub fn sell_back_coverage(
    amount: u64,
    cost: u64,
    new_amount: u64,
    new_cost: u64,
    reserved: u64,
) -> bool {
    reserved == 0
        || params::PACK_EDITIONS_PRICE_LAMPORTS.iter().all(|price| {
            let smallest = u128::from(*price) * u128::from(params::HIT_TIERS_VALUE_BPS[0])
                / u128::from(params::BPS_DENOMINATOR);
            let before = cost > 0 && smallest * u128::from(amount) >= u128::from(cost);
            let after = new_cost > 0 && smallest * u128::from(new_amount) >= u128::from(new_cost);
            !before || after
        })
}
