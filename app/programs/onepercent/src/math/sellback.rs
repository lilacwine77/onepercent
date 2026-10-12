//! Checked Sell back accounting; callers commit the plan only after all checks pass.
use crate::{
    errors::MachineError,
    math::{coverage_granularity, hour::*, BucketInput},
    params,
    state::*,
};
use anchor_lang::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SellBackPayout {
    pub value: u64,
    pub payout: u64,
    pub margin: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SellBackPlan {
    pub hour: HourState,
    pub value: u64,
    pub payout: u64,
    pub to_team: u64,
    pub stock_sol: u64,
    pub team_sol: u64,
    pub sb_paid_hour: u64,
    pub bucket_cost: u64,
}

fn u64_checked(value: u128) -> Result<u64> {
    u64::try_from(value).map_err(|_| error!(MachineError::MathOverflow))
}

/// Preserve every previously payable edition while this bucket backs pending Pulls.
/// Free capacity is not an eligibility filter here: it can be fully reserved.
pub fn check_sell_back_coverage(bucket: &Bucket, new_amount: u64, new_cost: u64) -> Result<()> {
    if bucket.reserved == 0 {
        return Ok(());
    }
    let before = BucketInput {
        class: bucket.class,
        enabled: bucket.enabled != 0,
        amount: bucket.amount,
        cost: bucket.cost,
        reserved: bucket.reserved,
    };
    let after = BucketInput {
        amount: new_amount,
        cost: new_cost,
        ..before
    };
    for price in params::PACK_EDITIONS_PRICE_LAMPORTS {
        require!(
            !coverage_granularity(price, &before) || coverage_granularity(price, &after),
            MachineError::ReservedCapacity
        );
    }
    Ok(())
}

pub fn sell_back_payout(stocked_value: u64, quote_lamports: u64) -> Result<SellBackPayout> {
    require!(quote_lamports > 0, MachineError::InvalidArgument);
    let value = stocked_value.min(quote_lamports);
    let payout = u64_checked(
        u128::from(value)
            .checked_mul(u128::from(params::SELL_BACK_PAYOUT_BPS))
            .and_then(|n| n.checked_div(u128::from(params::BPS_DENOMINATOR)))
            .ok_or(MachineError::MathOverflow)?,
    )?;
    require!(payout > 0, MachineError::InvalidArgument);
    Ok(SellBackPayout {
        value,
        payout,
        margin: value
            .checked_sub(payout)
            .ok_or(MachineError::MathOverflow)?,
    })
}

pub fn sell_back_checks(
    machine: &Machine,
    bucket: &Bucket,
    stocked_value: u64,
    quote_lamports: u64,
    now: i64,
) -> Result<SellBackPlan> {
    let mut hour = HourState {
        hour_index: machine.hour_index,
        hit_out_last_hour: machine.hit_out_last_hour,
        hit_out_this_hour: machine.hit_out_this_hour,
        sb_paid_hour: machine.sb_paid_hour,
        sol_at_hour_start: machine.sol_at_hour_start,
        stock_sol: machine.stock_sol,
    };
    rotate_hour(&mut hour, now);
    let SellBackPayout {
        value,
        payout,
        margin,
    } = sell_back_payout(stocked_value, quote_lamports)?;
    let book = machine
        .buckets
        .iter()
        .try_fold(u128::from(machine.stock_sol), |sum, current| {
            sum.checked_add(u128::from(current.cost))
                .ok_or(MachineError::MathOverflow)
        })?;
    let target = u128::from(params::STOCK_TARGET_BASE_LAMPORTS)
        .checked_add(u128::from(hour.hit_out_last_hour))
        .ok_or(MachineError::MathOverflow)?;
    let to_team = if book < target { 0 } else { margin };
    let debit = u128::from(payout)
        .checked_add(u128::from(to_team))
        .ok_or(MachineError::MathOverflow)?;
    require!(
        u128::from(machine.stock_sol)
            >= debit
                .checked_add(u128::from(params::SELL_BACK_SOL_FLOOR_LAMPORTS))
                .ok_or(MachineError::MathOverflow)?,
        MachineError::SellBackFloor
    );
    let budget = u128::from(params::SELL_BACK_HOURLY_BUDGET_MIN_LAMPORTS).max(
        u128::from(hour.sol_at_hour_start)
            .checked_mul(u128::from(params::SELL_BACK_HOURLY_BUDGET_BPS_OF_STOCK_SOL))
            .and_then(|n| n.checked_div(u128::from(params::BPS_DENOMINATOR)))
            .ok_or(MachineError::MathOverflow)?,
    );
    let sb_paid_hour = u128::from(hour.sb_paid_hour)
        .checked_add(u128::from(payout))
        .ok_or(MachineError::MathOverflow)?;
    require!(sb_paid_hour <= budget, MachineError::SellBackBudget);
    let bucket_cost = u128::from(bucket.cost)
        .checked_add(u128::from(value))
        .ok_or(MachineError::MathOverflow)?;
    require!(
        bucket_cost <= u128::from(bucket.cap),
        MachineError::BucketCapExceeded
    );
    Ok(SellBackPlan {
        hour,
        value,
        payout,
        to_team,
        stock_sol: u64_checked(
            u128::from(machine.stock_sol)
                .checked_sub(debit)
                .ok_or(MachineError::MathOverflow)?,
        )?,
        team_sol: machine
            .team_sol
            .checked_add(to_team)
            .ok_or(MachineError::MathOverflow)?,
        sb_paid_hour: u64_checked(sb_paid_hour)?,
        bucket_cost: u64_checked(bucket_cost)?,
    })
}
