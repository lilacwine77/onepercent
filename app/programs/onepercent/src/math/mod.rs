//! Integer-only accounting and deterministic selection, shared with the SDK.
pub mod bucket;
pub mod coverage;
pub mod creator_fee;
pub mod draw;
pub mod hour;
pub mod specials;
pub mod split;
pub use bucket::{bucket_pick, bucket_position, carve, BucketInput, Carve};
pub use coverage::{coverage, coverage_granularity, coverage_need, max_qty};
pub use draw::{caller_seed, draw, dust_index, tier_position, Draw};
pub use hour::{rotate_hour, HourState};
pub use split::{split, tier_value, Split};

#[cfg(test)]
mod tests;

pub mod exec;
pub mod sellback;

pub mod stock_buy;
