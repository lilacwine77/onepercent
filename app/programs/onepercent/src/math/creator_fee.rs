#![deny(clippy::arithmetic_side_effects)]
use crate::{constants::*, params, state::Machine};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CreatorFeeSplit {
    pub stock: u64,
    pub burn: u64,
    pub team: u64,
}

pub fn book(machine: &Machine) -> u64 {
    machine
        .buckets
        .iter()
        .fold(u128::from(machine.stock_sol), |sum, bucket| {
            sum.saturating_add(u128::from(bucket.cost))
        })
        .min(u128::from(u64::MAX)) as u64
}

pub fn target(machine: &Machine) -> u64 {
    params::STOCK_TARGET_BASE_LAMPORTS.saturating_add(machine.hit_out_last_hour)
}

pub fn regime(machine: &Machine) -> u8 {
    if machine.phase >= PHASE_BUYS_CLOSED {
        REGIME_AFTER_END
    } else if book(machine) < params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS {
        REGIME_BELOW_FLOOR
    } else {
        REGIME_SEASON
    }
}

pub fn split(amount: u64, regime: u8) -> CreatorFeeSplit {
    let team_bps = match regime {
        REGIME_BELOW_FLOOR => params::CREATOR_FEE_SPLIT_BPS_BELOW_FLOOR_TEAM,
        REGIME_SEASON => params::CREATOR_FEE_SPLIT_BPS_SEASON_TEAM,
        _ => params::CREATOR_FEE_SPLIT_BPS_AFTER_END_TEAM,
    };
    let team = u128::from(amount)
        .saturating_mul(u128::from(team_bps))
        .checked_div(u128::from(params::BPS_DENOMINATOR))
        .unwrap_or_default()
        .min(u128::from(u64::MAX)) as u64;
    CreatorFeeSplit {
        stock: amount.saturating_sub(team),
        burn: 0,
        team,
    }
}
