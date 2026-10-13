#![deny(clippy::arithmetic_side_effects)]
use crate::{constants::*, errors::MachineError, events::FinalPullStarted, params, state::*};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct StartFinalPull<'info> {
    #[account(mut, seeds = [MACHINE_SEED], bump = machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
}

pub fn handler(ctx: Context<StartFinalPull>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let event = snapshot(
        &mut *ctx.accounts.machine.load_mut()?,
        Clock::get()?.unix_timestamp,
    )?;
    emit!(event);
    Ok(())
}

fn snapshot(machine: &mut Machine, now: i64) -> Result<FinalPullStarted> {
    require!(machine.phase == PHASE_BUYS_CLOSED, MachineError::WrongPhase);
    require!(
        now >= machine
            .end_ts
            .saturating_add(params::SEASON_FINAL_PULL_DELAY_SECONDS),
        MachineError::FinalPullNotDue
    );
    require!(machine.pending_pulls == 0, MachineError::PullPending);
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );

    let pool_sol = machine.stock_sol.saturating_add(machine.jackpot_sol);
    machine.final_pool_sol = machine.final_pool_sol.saturating_add(pool_sol);
    machine.final_sol_total = pool_sol;
    machine.stock_sol = 0;
    machine.jackpot_sol = 0;
    let mut bucket_pools = [0u64; 16];
    for (bucket, pool) in machine.buckets.iter_mut().zip(&mut bucket_pools) {
        if bucket.class != BUCKET_EMPTY {
            bucket.final_pool = bucket.amount;
            *pool = bucket.amount;
        }
    }
    let jackpot_tokens = machine.jackpot_tokens;
    let mut pool_1pct = jackpot_tokens;
    let mut onepct_final_mask = 0u8;
    for (index, slot) in machine.onepct.iter_mut().enumerate() {
        if slot.state == ONEPCT_LOCKED || slot.state == ONEPCT_LIVE {
            pool_1pct = pool_1pct.saturating_add(slot.amount);
            slot.state = ONEPCT_FINAL;
            onepct_final_mask |= 1u8.checked_shl(index as u32).unwrap_or(0);
        }
    }
    machine.final_pool_1pct = pool_1pct;
    machine.final_1pct_total = pool_1pct;
    machine.jackpot_tokens = 0;
    machine.jackpot_cost = 0;
    machine.final_ts = now;
    machine.phase = PHASE_FINAL_PULL;
    Ok(FinalPullStarted {
        final_ts: now,
        pool_sol,
        pool_1pct,
        jackpot_tokens,
        onepct_final_mask,
        total_spend: machine.total_spend,
        bucket_pools,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod tests {
    use super::*;
    use anchor_lang::__private::bytemuck::Zeroable;

    #[test]
    fn snapshot_gates_then_moves_only_unowned_pools() {
        let mut machine = Machine::zeroed();
        machine.phase = PHASE_ON_AIR;
        machine.end_ts = 1_000;
        assert!(snapshot(&mut machine, 1_600).is_err());
        machine.phase = PHASE_BUYS_CLOSED;
        assert!(snapshot(&mut machine, 1_599).is_err());
        machine.pending_pulls = 1;
        assert!(snapshot(&mut machine, 1_600).is_err());
        machine.pending_pulls = 0;
        machine.exec.kind = EXEC_KIND_STOCK_SELL;
        assert!(snapshot(&mut machine, 1_600).is_err());
        machine.exec.kind = EXEC_KIND_NONE;
        machine.stock_sol = 13;
        machine.jackpot_sol = 7;
        machine.burn_sol = 5;
        machine.team_sol = 3;
        machine.total_spend = 11;
        machine.jackpot_tokens = 19;
        machine.jackpot_cost = 23;
        machine.buckets[0].class = BUCKET_MAJOR;
        machine.buckets[0].amount = 31;
        machine.buckets[0].enabled = 0;
        machine.onepct[0].state = ONEPCT_PULLED;
        machine.onepct[0].amount = 100;
        machine.onepct[1].state = ONEPCT_LIVE;
        machine.onepct[1].amount = 17;
        machine.onepct[2].amount = 29;
        machine.onepct[3].amount = 37;
        let event = snapshot(&mut machine, 1_600).unwrap();
        assert_eq!(machine.phase, PHASE_FINAL_PULL);
        assert_eq!(machine.final_ts, 1_600);
        assert_eq!(machine.final_sol_total, 20);
        assert_eq!(machine.final_pool_sol, 20);
        assert_eq!((machine.stock_sol, machine.jackpot_sol), (0, 0));
        assert_eq!((machine.burn_sol, machine.team_sol), (5, 3));
        assert_eq!((machine.jackpot_tokens, machine.jackpot_cost), (0, 0));
        assert_eq!(machine.final_pool_1pct, 102);
        assert_eq!(machine.final_1pct_total, 102);
        assert_eq!(event.onepct_final_mask, 0b1110);
        assert_eq!(event.jackpot_tokens, 19);
        assert_eq!(machine.onepct[0].state, ONEPCT_PULLED);
        assert_eq!(machine.onepct[1].state, ONEPCT_FINAL);
        assert_eq!(machine.buckets[0].final_pool, 31);
        assert_eq!(event.bucket_pools[0], 31);
        assert!(snapshot(&mut machine, 1_600).is_err());
    }
}
