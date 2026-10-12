use crate::params;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Split {
    pub royalty: u64,
    pub jackpot: u64,
    pub burn: u64,
    pub referral: u64,
    pub team: u64,
    pub stock: u64,
}

pub fn split(price: u64) -> Split {
    let part = |bps: u32| {
        ((u128::from(price) * u128::from(bps)) / u128::from(params::BPS_DENOMINATOR)) as u64
    };
    let royalty = part(params::PACK_SPLIT_BPS_ROYALTY_PER_DUST_CARD);
    let jackpot = part(params::PACK_SPLIT_BPS_JACKPOT);
    let burn = part(params::PACK_SPLIT_BPS_BURN1PCT);
    let referral = part(params::PACK_SPLIT_BPS_REFERRAL);
    let team = part(params::PACK_SPLIT_BPS_TEAM);
    let stock = price
        .saturating_sub(royalty.saturating_mul(u64::from(params::CARDS_PER_PACK_DUST)))
        .saturating_sub(jackpot)
        .saturating_sub(burn)
        .saturating_sub(referral)
        .saturating_sub(team);
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
    let index = usize::from(kind.checked_sub(1)?);
    let bps = *params::HIT_TIERS_VALUE_BPS.get(index)?;
    u64::try_from(u128::from(price) * u128::from(bps) / u128::from(params::BPS_DENOMINATOR)).ok()
}
