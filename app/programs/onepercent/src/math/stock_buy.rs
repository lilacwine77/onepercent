use crate::{constants::*, errors::MachineError, params, state::Machine};
use anchor_lang::prelude::*;

/// Admission at exec_begin, before any stock SOL leaves the Machine.
pub fn check_stock_buy(m: &Machine, bucket: u8, amount: u64, now: i64) -> Result<()> {
    require!(
        (m.keeper_history_version == 1 || m.last_reveal_ts != 0)
            && m.pending_pulls == 0
            && m.unsettled_reveals == 0,
        MachineError::StockBuyPullInFlight
    );
    let last = m.last_reveal_ts;
    require!(
        last.checked_add(params::POST_REVEAL_BUY_DELAY)
            .is_some_and(|deadline| now >= deadline),
        MachineError::StockBuyRevealDelay
    );
    let b = m
        .buckets
        .get(usize::from(bucket))
        .ok_or(MachineError::BucketInvalid)?;
    if b.class == BUCKET_TRENDING {
        let h = m
            .bucket_history
            .get(usize::from(bucket))
            .ok_or(MachineError::BucketInvalid)?;
        require!(
            h.listed_ts
                .checked_add(params::HIT_LIST_TRENDING_NOTICE_SECONDS)
                .is_some_and(|deadline| now >= deadline),
            MachineError::StockBuyListingNotice
        );
    }
    require!(
        now >= 0 && m.keeper_history_version <= 2,
        MachineError::StockBuyReserve
    );
    let hour = now as u64 / 3_600;
    require!(hour >= m.hour_index, MachineError::StockBuyReserve);
    let window = params::KEEPER_POLICY_SOL_RESERVE_EXTRA_MINUTES.saturating_mul(60);
    let start = now.saturating_sub(window);
    // Existing sb_paid_hour already covers its complete hour on legacy accounts.
    // Only its predecessor is unknown until the first hour transition.
    require!(
        m.phase == PHASE_POWERED_ON || m.keeper_history_version != 0
            || hour != m.hour_index || start >= now / 3_600 * 3_600,
        MachineError::StockBuyReserve
    );
    let (current, previous) = if hour == m.hour_index {
        (m.sb_paid_hour, m.sb_paid_prev_hour)
    } else if m.hour_index.checked_add(1) == Some(hour) {
        (0, m.sb_paid_hour)
    } else {
        (0, 0)
    };
    let payouts = u128::from(current)
        + if start < now / 3_600 * 3_600 {
            u128::from(previous)
        } else {
            0
        };
    let reserve = u128::from(params::SELL_BACK_SOL_FLOOR_LAMPORTS) + payouts;
    require!(
        m.stock_sol
            .checked_sub(amount)
            .is_some_and(|after| u128::from(after) >= reserve),
        MachineError::StockBuyReserve
    );
    Ok(())
}
