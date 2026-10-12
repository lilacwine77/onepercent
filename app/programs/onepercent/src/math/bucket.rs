pub use super::draw::bucket_position;
use crate::{constants, params};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BucketInput {
    pub class: u8,
    pub enabled: bool,
    pub amount: u64,
    pub cost: u64,
    pub reserved: u64,
}

impl BucketInput {
    pub fn free(&self) -> u64 {
        self.cost.saturating_sub(self.reserved)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Carve {
    pub tokens: u64,
    pub amount: u64,
    pub cost: u64,
}

pub fn carve(value: u64, amount: u64, cost: u64) -> Option<Carve> {
    if cost == 0 || value == 0 || value > cost {
        return None;
    }
    let tokens = if value == cost {
        amount
    } else {
        u64::try_from(u128::from(value) * u128::from(amount) / u128::from(cost)).ok()?
    };
    if tokens == 0 {
        return None;
    }
    Some(Carve {
        tokens,
        amount: amount.saturating_sub(tokens),
        cost: cost.saturating_sub(value),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn bucket_pick(
    randomness: &[u8; 32],
    seq: u64,
    pack: u8,
    kind: u8,
    value: u64,
    backing: u8,
    buckets: &[BucketInput],
) -> Option<usize> {
    let major_only = *params::HIT_TIERS_MAJOR_ONLY.get(usize::from(kind.checked_sub(1)?))?;
    if value == 0 {
        return None;
    }
    let eligible = |b: &BucketInput| {
        b.class != constants::BUCKET_EMPTY
            && b.enabled
            && (!major_only || b.class == constants::BUCKET_MAJOR)
            && b.free() >= value
            && u128::from(value) * u128::from(b.amount) >= u128::from(b.cost)
    };
    let bounded = buckets.iter().take(params::STOCK_MAX_BUCKETS as usize);
    let total = bounded
        .clone()
        .filter(|b| eligible(b))
        .fold(0u128, |sum, b| sum.saturating_add(u128::from(b.free())))
        .min(u128::from(u64::MAX)) as u64;
    if total != 0 {
        let y = u128::from(bucket_position(randomness, seq, pack, total));
        let mut accumulated = 0u128;
        for (index, bucket) in bounded.enumerate() {
            if eligible(bucket) {
                accumulated = accumulated.saturating_add(u128::from(bucket.free()));
                if y < accumulated {
                    return Some(index);
                }
            }
        }
    }
    let index = usize::from(backing);
    if index >= params::STOCK_MAX_BUCKETS as usize {
        return None;
    }
    buckets
        .get(index)
        .filter(|b| b.free() >= value)
        .map(|_| index)
}
