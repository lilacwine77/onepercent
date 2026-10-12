//! Timestamp-based special segments. No phase or service is needed to reveal.
#![deny(clippy::arithmetic_side_effects)]
use crate::{constants::*, params, state::Machine};

pub fn onepct_live_index(machine: &Machine, now: i64) -> Option<usize> {
    if machine.on_air_ts == 0 {
        return None;
    }
    for (index, (slot, offset)) in machine
        .onepct
        .iter()
        .zip(params::TOKEN_1PCT_ONE_PCT_RELEASE_OFFSETS_SECONDS)
        .enumerate()
    {
        match slot.state {
            ONEPCT_PULLED => continue,
            ONEPCT_LOCKED | ONEPCT_LIVE => {
                return (now >= machine.on_air_ts.saturating_add(offset)).then_some(index);
            }
            _ => return None,
        }
    }
    None
}

pub fn jackpot_live(machine: &Machine, price: u64) -> bool {
    machine.jackpot_tokens > 0
        && u128::from(machine.jackpot_cost)
            >= u128::from(params::JACKPOT_MIN_POT_PRICE_MULTIPLE).saturating_mul(u128::from(price))
}

pub fn live_flags(machine: &Machine, price: u64, now: i64) -> (u8, Option<usize>) {
    let index = onepct_live_index(machine, now);
    let flags = if index.is_some() { LIVE_ONE_PCT } else { 0 }
        | if jackpot_live(machine, price) {
            LIVE_JACKPOT
        } else {
            0
        };
    (flags, index)
}

/// Returns the newly promoted index and release timestamp for the caller's event.
pub fn promote_onepct(machine: &mut Machine, now: i64) -> Option<(u8, i64)> {
    let index = onepct_live_index(machine, now)?;
    let offset = *params::TOKEN_1PCT_ONE_PCT_RELEASE_OFFSETS_SECONDS.get(index)?;
    let slot = machine.onepct.get_mut(index)?;
    if slot.state != ONEPCT_LOCKED {
        return None;
    }
    slot.state = ONEPCT_LIVE;
    Some((
        u8::try_from(index).unwrap_or_default(),
        machine.on_air_ts.saturating_add(offset),
    ))
}
