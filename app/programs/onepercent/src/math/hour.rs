#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HourState {
    pub hour_index: u64,
    pub hit_out_last_hour: u64,
    pub hit_out_this_hour: u64,
    pub sb_paid_hour: u64,
    pub sol_at_hour_start: u64,
    pub stock_sol: u64,
}

pub fn rotate_hour(state: &mut HourState, now: i64) {
    let hour = now.max(0) as u64 / 3_600;
    if hour != state.hour_index {
        state.hit_out_last_hour = if hour == state.hour_index.saturating_add(1) {
            state.hit_out_this_hour
        } else {
            0
        };
        state.hit_out_this_hour = 0;
        state.sb_paid_hour = 0;
        state.sol_at_hour_start = state.stock_sol;
        state.hour_index = hour;
    }
}
