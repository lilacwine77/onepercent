use super::{tier_value, BucketInput};
use crate::{constants, params};

pub fn coverage_need(price: u64) -> Option<u64> {
    u64::try_from(
        u128::from(price) * u128::from(params::COVERAGE_PER_PACK_VALUE_BPS)
            / u128::from(params::BPS_DENOMINATOR),
    )
    .ok()
}

/// D12: a backing bucket must deliver at least one base unit of this edition's
/// smallest hit. Reservations preserve this ratio because they change no units
/// or book value. A floor-rounded carve preserves or improves amount / cost:
/// (A - floor(V*A/C)) * C >= A * (C - V).
///
/// M2 stock buys and sells must preserve this predicate for every pending Pull
/// backed by the bucket. This module performs no stock trading.
pub fn coverage_granularity(price: u64, bucket: &BucketInput) -> bool {
    let Some(smallest) = tier_value(price, constants::KIND_SILVER) else {
        return false;
    };
    bucket.cost > 0
        && smallest > 0
        && u128::from(smallest) * u128::from(bucket.amount) >= u128::from(bucket.cost)
}

/// Mutates reservations only after every pack has a valid backing bucket.
pub fn coverage(price: u64, qty: u8, buckets: &mut [BucketInput]) -> Option<Vec<u8>> {
    let need = coverage_need(price)?;
    if need == 0 {
        return None;
    }
    let mut draft = [BucketInput::default(); params::STOCK_MAX_BUCKETS as usize];
    let count = buckets.len().min(draft.len());
    draft
        .get_mut(..count)?
        .copy_from_slice(buckets.get(..count)?);
    let mut backing = Vec::with_capacity(usize::from(qty));
    for _ in 0..qty {
        let mut best = None;
        let mut free = 0u64;
        for (index, bucket) in draft.iter().take(count).enumerate() {
            if bucket.class == constants::BUCKET_MAJOR
                && bucket.enabled
                && bucket.free() >= need
                && coverage_granularity(price, bucket)
                && (best.is_none() || bucket.free() > free)
            {
                best = Some(index);
                free = bucket.free();
            }
        }
        let index = best?;
        let bucket = draft.get_mut(index)?;
        bucket.reserved = bucket.reserved.checked_add(need)?;
        backing.push(u8::try_from(index).ok()?);
    }
    buckets
        .get_mut(..count)?
        .copy_from_slice(draft.get(..count)?);
    Some(backing)
}

pub fn max_qty(edition: u8, deck_len: u32, reserved_dust: u32, buckets: &[BucketInput]) -> u8 {
    let Some(&price) = params::PACK_EDITIONS_PRICE_LAMPORTS.get(usize::from(edition)) else {
        return 0;
    };
    let Some(&max) = params::PACK_EDITIONS_MAX_PER_RIP.get(usize::from(edition)) else {
        return 0;
    };
    let available = deck_len
        .saturating_sub(reserved_dust)
        .saturating_sub(params::COVERAGE_DUST_BUFFER)
        / params::CARDS_PER_PACK_DUST;
    let limit = max.min(available).min(u32::from(u8::MAX));
    let mut draft = [BucketInput::default(); params::STOCK_MAX_BUCKETS as usize];
    for (target, source) in draft.iter_mut().zip(buckets) {
        *target = *source;
    }
    let mut qty = 0u8;
    for _ in 0..limit {
        if coverage(price, 1, &mut draft).is_none() {
            break;
        }
        qty = qty.saturating_add(1);
    }
    qty
}
