use crate::{
    constants::*,
    errors::MachineError,
    events::{OnePctLive, PhaseAdvanced},
    math, params,
    state::*,
};
use anchor_lang::prelude::*;
#[derive(Accounts)]
pub struct AdvancePhase<'info> {
    #[account(seeds=[CONFIG_SEED],bump=config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut,seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
}
pub fn handler(ctx: Context<AdvancePhase>) -> Result<()> {
    let c = ctx.accounts.config.load()?;
    let mut m = ctx.accounts.machine.load_mut()?;
    require!(m.exec.kind == EXEC_KIND_NONE, MachineError::ExecInFlight);
    let now = Clock::get()?.unix_timestamp;
    m.ensure_keeper_history(now);
    if let Some((index, release_ts)) = math::specials::promote_onepct(&mut m, now) {
        emit!(OnePctLive {
            index,
            release_ts,
            ts: now
        });
    }
    let from = m.phase;
    m.phase = match m.phase {
        0 if c.season_set == 1 && now >= c.stock_up_ts => 1,
        2 if m.on_air_ts != 0 && now >= m.on_air_ts => 3,
        3 if m.end_ts != 0 && now >= m.end_ts => 4,
        PHASE_FINAL_PULL
            if m.final_ts != 0
                && now >= m.final_ts.saturating_add(params::SEASON_SEAL_DELAY_SECONDS) =>
        {
            PHASE_DONE
        }
        p => p,
    };
    if m.phase != from {
        emit!(PhaseAdvanced {
            from,
            to: m.phase,
            ts: now
        });
    }
    Ok(())
}
