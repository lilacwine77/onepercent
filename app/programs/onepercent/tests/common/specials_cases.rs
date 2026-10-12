#![allow(dead_code)]
use crate::common::*;
use anchor_lang::prelude::Pubkey;
use onepercent::{constants::*, params, state::*};

pub fn machine(env: &mut Env, edit: impl FnOnce(&mut Machine)) {
    env.mutate(env.machine, |account| {
        let mut value: Machine = bytemuck::pod_read_unaligned(&account.data[8..]);
        edit(&mut value);
        account.data[8..].copy_from_slice(bytemuck::bytes_of(&value));
    });
}
pub fn inject(env: &mut Env, states: [u8; 4], tokens: u64, cost: u64) -> Bag {
    let bag = env.new_pump_mint(true);
    let owner = pubkey(&solana_signer::Signer::pubkey(&env.authority));
    let amount = states.iter().filter(|s| **s <= ONEPCT_LIVE).count() as u64
        * params::TOKEN_1PCT_ONE_PCT_CARD_AMOUNT
        + tokens;
    env.token_account(env.vault_auth, &bag, amount);
    env.mutate(bag.mint, |a| write_u64(&mut a.data, 36, amount));
    env.set_state(
        pda(&[b"ledger", bag.mint.as_ref()]).0,
        &MintLedger {
            mint: bag.mint,
            payer: owner,
            accounted: amount,
        },
        &[],
        0,
    );
    machine(env, |m| {
        m.token_mint = bag.mint;
        m.onepct = states.map(|state| OnePctSlot {
            amount: params::TOKEN_1PCT_ONE_PCT_CARD_AMOUNT,
            state,
            _pad: [0; 7],
        });
        m.jackpot_tokens = tokens;
        m.jackpot_cost = cost;
    });
    bag
}
pub fn advance(env: &Env) -> solana_instruction::Instruction {
    instruction(
        "advance_phase",
        vec![
            meta(env.config, false, false),
            meta(env.machine, true, false),
        ],
        &[],
    )
}
pub fn find_random(seq: u64, pack: u8, edition: u8, live: u8, holder: bool, tier: u8) -> [u8; 32] {
    type DrawKey = (u64, u8, u8, u8, bool, u8);
    static SEEDS: std::sync::OnceLock<
        std::sync::Mutex<std::collections::BTreeMap<DrawKey, [u8; 32]>>,
    > = std::sync::OnceLock::new();
    let cache = SEEDS.get_or_init(Default::default);
    let key = (seq, pack, edition, live, holder, tier);
    if let Some(seed) = cache.lock().unwrap().get(&key) {
        return *seed;
    }
    let seed = (0..10_000_000u64)
        .map(|seed| {
            let mut r = [0; 32];
            r[..8].copy_from_slice(&seed.to_le_bytes());
            r
        })
        .find(|r| {
            crate::reference::draw(r, seq, pack, edition, live, holder)
                .unwrap()
                .tier
                == tier
        })
        .expect("forced special seed");
    cache.lock().unwrap().insert(key, seed);
    seed
}
pub fn set_time(env: &mut Env, now: i64) {
    env.warp(now - env.now());
}
pub fn binder(owner: Pubkey) -> Pubkey {
    pda(&[b"binder", owner.as_ref()]).0
}
