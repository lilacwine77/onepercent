use anchor_lang::prelude::*;
#[zero_copy]
#[repr(C)]
pub struct Bucket {
    pub mint: Pubkey,
    pub oracle: Pubkey,
    pub amount: u64,
    pub cost: u64,
    pub reserved: u64,
    pub cap: u64,
    pub trend_bought_hour: u64,
    pub trend_hour_index: u32,
    pub decimals: u8,
    pub class: u8,
    pub enabled: u8,
    pub token_program: u8,
    pub final_pool: u64,
    pub trend_sold_hour: u64,
}
/// Parallel to Machine.buckets; preserves the deployed 128-byte Bucket stride.
#[zero_copy]
#[repr(C)]
pub struct BucketHistory {
    pub listed_ts: i64,
    /// SOL book value returned by Sell, never token units or the payout.
    pub sb_inflow_hour: u64,
    pub sb_inflow_prev_hour: u64,
}
#[zero_copy]
#[repr(C)]
pub struct OnePctSlot {
    pub amount: u64,
    pub state: u8,
    pub _pad: [u8; 7],
}
#[zero_copy]
#[repr(C)]
pub struct SpotlightSlot {
    pub mint: Pubkey,
    pub sponsor: Pubkey,
    pub window_start: i64,
    pub amount: u64,
    pub state: u8,
    pub _pad: [u8; 15],
}
#[zero_copy]
#[repr(C)]
pub struct ExecRecord {
    pub kind: u8,
    pub bucket: u8,
    pub _pad: [u8; 6],
    pub amount: u64,
    pub v0: u64,
    pub min_out: u64,
    pub slot: u64,
    pub target: Pubkey,
    pub aux: u64,
}
#[account(zero_copy)]
#[repr(C)]
pub struct Machine {
    pub version: u8,
    pub bump: u8,
    pub phase: u8,
    pub vault_auth_bump: u8,
    pub deck_bump: u8,
    pub config_bump: u8,
    pub fee_in_bump: u8,
    pub _pad0: u8,
    pub next_seq: u64,
    pub pending_pulls: u64,
    pub reserved_dust: u64,
    pub power_on_ts: i64,
    pub on_air_ts: i64,
    pub end_ts: i64,
    pub final_ts: i64,
    pub stock_sol: u64,
    pub jackpot_sol: u64,
    pub burn_sol: u64,
    pub team_sol: u64,
    pub final_pool_sol: u64,
    pub total_spend: u64,
    pub hour_index: u64,
    pub hit_out_this_hour: u64,
    pub hit_out_last_hour: u64,
    pub sb_paid_hour: u64,
    pub sol_at_hour_start: u64,
    pub packs_revealed: [u64; 4],
    pub hit_value_out: [u64; 4],
    pub buckets: [Bucket; 16],
    pub jackpot_tokens: u64,
    pub jackpot_cost: u64,
    pub burned_total: u64,
    pub last_burn_ts: i64,
    pub burn_hour_index: u64,
    pub burn_paid_hour: u64,
    pub last_jackpot_buy_ts: i64,
    pub final_pool_1pct: u64,
    pub onepct: [OnePctSlot; 4],
    pub spotlight: SpotlightSlot,
    pub exec: ExecRecord,
    pub last_stock_trade_ts: i64,
    pub stock_hour_index: u64,
    pub stock_bought_hour: u64,
    pub stock_sold_hour: u64,
    pub token_mint: Pubkey,
    pub final_sol_total: u64,
    pub final_1pct_total: u64,
    pub last_reveal_ts: i64,
    pub sb_paid_prev_hour: u64,
    pub keeper_history_version: u64,
    pub keeper_history_started_ts: i64,
    pub bucket_history: [BucketHistory; 16],
    pub unsettled_reveals: u64,
    pub _reserved0: [[u8; 24]; 25],
    pub _reserved1: [u8; 128],
}
impl Machine {
    /// Devnet activation consumes zeroed padding. Only the conservative reveal
    /// timestamp is initialized; repeating this can never reset any counter.
    /// Fresh Machines set history version 1 directly in initialize.
    pub fn ensure_keeper_history(&mut self, now: i64) {
        if self.keeper_history_version == 0 && self.last_reveal_ts == 0 {
            self.last_reveal_ts = now;
            emit!(crate::events::KeeperHistoryStarted { ts: now });
        }
    }

    /// Call immediately before every write of the existing Machine.hour_index.
    /// Updates are total; StockBuy admission reads the retained payout bound.
    pub fn rotate_keeper_history(&mut self, now: i64) {
        self.ensure_keeper_history(now);
        let hour = now.max(0) as u64 / 3_600;
        if hour != self.hour_index {
            let adjacent = self.hour_index.checked_add(1) == Some(hour);
            // Version 0: legacy inflow for the current hour is incomplete.
            // Version 2: one rotation, previous inflow remains incomplete.
            // Version 1: both retained inflow hours are complete.
            self.keeper_history_version = if adjacent && self.keeper_history_version == 0 {
                2
            } else {
                1
            };
            self.sb_paid_prev_hour = if adjacent { self.sb_paid_hour } else { 0 };
            for history in &mut self.bucket_history {
                history.sb_inflow_prev_hour = if adjacent { history.sb_inflow_hour } else { 0 };
                history.sb_inflow_hour = 0;
            }
        }
    }

    pub fn credit_stock(&mut self, amount: u64) {
        if self.phase >= 5 {
            self.burn_sol = self.burn_sol.saturating_add(amount);
        } else {
            self.stock_sol = self.stock_sol.saturating_add(amount);
        }
    }
}
const _: () = assert!(8 + core::mem::size_of::<Machine>() == crate::constants::MACHINE_SIZE);
const _: () = assert!(core::mem::size_of::<Bucket>() == 128);
const _: () = assert!(core::mem::size_of::<OnePctSlot>() == 16);
const _: () = assert!(core::mem::size_of::<SpotlightSlot>() == 96);
const _: () = assert!(core::mem::size_of::<ExecRecord>() == 80);

// M4 consumes 48 reserved bytes after M2 B6; Final Pull uses the deployed totals.
const _: () = {
    assert!(core::mem::offset_of!(Bucket, trend_sold_hour) == 120);
    assert!(core::mem::offset_of!(ExecRecord, aux) == 72);
    assert!(8 + core::mem::offset_of!(Machine, exec) == 2_496);
    assert!(8 + core::mem::offset_of!(Machine, last_stock_trade_ts) == 2_576);
    assert!(8 + core::mem::offset_of!(Machine, stock_hour_index) == 2_584);
    assert!(8 + core::mem::offset_of!(Machine, stock_bought_hour) == 2_592);
    assert!(8 + core::mem::offset_of!(Machine, stock_sold_hour) == 2_600);
    assert!(8 + core::mem::offset_of!(Machine, token_mint) == 2_608);
    assert!(8 + core::mem::offset_of!(Machine, final_sol_total) == 2_640);
    assert!(8 + core::mem::offset_of!(Machine, final_1pct_total) == 2_648);
    assert!(8 + core::mem::offset_of!(Machine, last_reveal_ts) == 2_656);
    assert!(8 + core::mem::offset_of!(Machine, sb_paid_prev_hour) == 2_664);
    assert!(8 + core::mem::offset_of!(Machine, keeper_history_version) == 2_672);
    assert!(8 + core::mem::offset_of!(Machine, keeper_history_started_ts) == 2_680);
    assert!(8 + core::mem::offset_of!(Machine, bucket_history) == 2_688);
    assert!(core::mem::size_of::<BucketHistory>() == 24);
    assert!(8 + core::mem::offset_of!(Machine, unsettled_reveals) == 3_072);
    assert!(8 + core::mem::offset_of!(Machine, _reserved0) == 3_080);
    assert!(8 + core::mem::offset_of!(Machine, _reserved1) == 3_680);
};

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod m2_layout_tests {
    use super::*;
    use core::mem::{offset_of, size_of};

    #[test]
    fn carved_fields_match_layout_vectors_and_reserved_tail() {
        let layouts: serde_json::Value =
            serde_json::from_str(include_str!("../../../../fixtures/vectors/layouts.json"))
                .unwrap();
        for (account, field, offset) in [
            (
                "Bucket",
                "trend_sold_hour",
                offset_of!(Bucket, trend_sold_hour),
            ),
            ("ExecRecord", "aux", offset_of!(ExecRecord, aux)),
            (
                "Machine",
                "last_stock_trade_ts",
                8 + offset_of!(Machine, last_stock_trade_ts),
            ),
            (
                "Machine",
                "stock_hour_index",
                8 + offset_of!(Machine, stock_hour_index),
            ),
            (
                "Machine",
                "stock_bought_hour",
                8 + offset_of!(Machine, stock_bought_hour),
            ),
            (
                "Machine",
                "stock_sold_hour",
                8 + offset_of!(Machine, stock_sold_hour),
            ),
            ("Machine", "token_mint", 8 + offset_of!(Machine, token_mint)),
            (
                "Machine",
                "final_sol_total",
                8 + offset_of!(Machine, final_sol_total),
            ),
            (
                "Machine",
                "final_1pct_total",
                8 + offset_of!(Machine, final_1pct_total),
            ),
            ("Machine", "_reserved0", 8 + offset_of!(Machine, _reserved0)),
            ("Machine", "_reserved1", 8 + offset_of!(Machine, _reserved1)),
        ] {
            assert_eq!(
                layouts[account]["fields"][field], offset,
                "{account}.{field}"
            );
        }
        assert_eq!(layouts["Machine"]["size"], 8 + size_of::<Machine>());
        assert_eq!(layouts["Bucket"]["size"], size_of::<Bucket>());
        assert_eq!(layouts["ExecRecord"]["size"], size_of::<ExecRecord>());
    }
}
