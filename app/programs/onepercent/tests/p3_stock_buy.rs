use bytemuck::Zeroable;
use onepercent::{constants::*, math::stock_buy::check_stock_buy, params, state::Machine};

fn machine(now: i64) -> Machine {
    let mut m = Machine::zeroed();
    m.next_seq = 1;
    m.keeper_history_version = 1;
    m.phase = PHASE_ON_AIR;
    m.hour_index = now as u64 / 3_600;
    m.stock_sol = 10_000_000_000;
    m.buckets[0].class = BUCKET_MAJOR;
    m
}
fn refused(m: &Machine, now: i64, error: &str) {
    assert!(check_stock_buy(m, 0, 1_000_000_000, now)
        .unwrap_err()
        .to_string()
        .contains(error));
}

#[test]
fn pending_unsettled_and_unverified_history_block_only_until_resolved() {
    let now = 180_010;
    let mut m = machine(now);
    m.pending_pulls = 1;
    refused(&m, now, "StockBuyPullInFlight");
    m.pending_pulls = 0;
    m.unsettled_reveals = 1;
    refused(&m, now, "StockBuyPullInFlight");
    m.unsettled_reveals = 0;
    check_stock_buy(&m, 0, 1_000_000_000, now).unwrap();
    m.keeper_history_version = 0;
    refused(&m, now, "StockBuyPullInFlight");
    m.ensure_keeper_history(now);
    refused(&m, now + 29, "StockBuyRevealDelay");
    // Activation does not invent a previous payout hour.
    refused(&m, now + 30, "StockBuyReserve");
    check_stock_buy(&m, 0, 1_000_000_000, 180_900).unwrap();
}

#[test]
fn reveal_minimum_is_thirty_seconds_with_an_inclusive_boundary() {
    assert_eq!(params::POST_REVEAL_BUY_DELAY, 30);
    let now = 180_010;
    let mut m = machine(now);
    m.last_reveal_ts = now;
    refused(&m, now + 29, "StockBuyRevealDelay");
    check_stock_buy(&m, 0, 1_000_000_000, now + 30).unwrap();
    m.last_reveal_ts = i64::MAX;
    refused(&m, now, "StockBuyRevealDelay");
}

#[test]
fn admission_errors_append_without_changing_existing_codes() {
    use onepercent::errors::MachineError;
    assert_eq!(u32::from(MachineError::FinalPullNotDue), 6070);
    assert_eq!(u32::from(MachineError::StockBuyPullInFlight), 6071);
    assert_eq!(u32::from(MachineError::StockBuyRevealDelay), 6072);
    assert_eq!(u32::from(MachineError::StockBuyListingNotice), 6073);
    assert_eq!(u32::from(MachineError::StockBuyReserve), 6074);
}

#[test]
fn listing_notice_uses_the_configured_boundary_for_trending_only() {
    let now = 180_010;
    let mut m = machine(now);
    m.bucket_history[0].listed_ts = now;
    check_stock_buy(&m, 0, 1_000_000_000, now).unwrap();
    m.buckets[0].class = BUCKET_TRENDING;
    refused(
        &m,
        now + params::HIT_LIST_TRENDING_NOTICE_SECONDS - 1,
        "StockBuyListingNotice",
    );
    check_stock_buy(
        &m,
        0,
        1_000_000_000,
        now + params::HIT_LIST_TRENDING_NOTICE_SECONDS,
    )
    .unwrap();
}

#[test]
fn reserve_covers_both_hours_exactly_at_the_spending_boundary() {
    let now = 180_010;
    let mut m = machine(now);
    m.sb_paid_hour = 3_000_000_000;
    m.sb_paid_prev_hour = 5_000_000_001;
    refused(&m, now, "StockBuyReserve");
    m.stock_sol += 1;
    check_stock_buy(&m, 0, 1_000_000_000, now).unwrap();
    m.stock_sol -= 1;
    check_stock_buy(&m, 0, 1_000_000_000, 180_900).unwrap();
    m.sb_paid_hour = u64::MAX;
    m.sb_paid_prev_hour = u64::MAX;
    refused(&m, now, "StockBuyReserve");
    check_stock_buy(&m, 0, 1_000_000_000, now + 7_200).unwrap();
}
