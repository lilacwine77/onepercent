#![allow(dead_code)]
use crate::common::{exec_cases::machine, pack_cases::binder, *};
use anchor_lang::prelude::Pubkey;
use onepercent::{
    params,
    state::{Binder, Machine},
};
use solana_instruction::Instruction;

pub fn start(e: &Env) -> Instruction {
    instruction("start_final_pull", vec![meta(e.machine, true, false)], &[])
}
pub fn sol(e: &Env, owner: Pubkey, writable: bool) -> Instruction {
    instruction(
        "claim_final_sol",
        vec![
            meta(e.machine, true, false),
            meta(binder(owner), true, false),
            meta(owner, writable, false),
        ],
        &[],
    )
}
pub fn tokens(e: &Env, owner: Pubkey) -> Instruction {
    instruction(
        "claim_final_tokens",
        vec![
            meta(owner, true, true),
            meta(e.machine, true, false),
            meta(binder(owner), true, false),
            meta(system(), false, false),
        ],
        &[],
    )
}
pub fn advance(e: &Env) -> Instruction {
    instruction(
        "advance_phase",
        vec![meta(e.config, false, false), meta(e.machine, true, false)],
        &[],
    )
}
pub fn spend(e: &mut Env, owner: Pubkey, value: u64) {
    crate::common::exec_cases::edit::<Binder>(e, binder(owner), |b| b.season_spend = value);
}
pub fn due(e: &mut Env) {
    let now = e.now();
    machine(e, |m| {
        m.phase = 4;
        m.end_ts = now - params::SEASON_FINAL_PULL_DELAY_SECONDS;
    });
}
pub fn snapshot(e: &mut Env) {
    due(e);
    e.send(&[start(e)], &[]).unwrap();
}
pub fn finish(e: &mut Env) {
    let m = e.state::<Machine>(e.machine);
    e.warp(m.final_ts + params::SEASON_SEAL_DELAY_SECONDS - e.now());
    e.send(&[advance(e)], &[]).unwrap();
}
