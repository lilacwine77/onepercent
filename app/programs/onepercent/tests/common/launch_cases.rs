#![allow(dead_code)]
use crate::common::*;
use anchor_lang::prelude::Pubkey;
use onepercent::{
    constants::*,
    params,
    state::{Config, Machine},
};
use solana_instruction::Instruction;
use solana_signer::Signer;

pub fn machine(env: &mut Env, edit: impl FnOnce(&mut Machine)) {
    let mut state = env.state::<Machine>(env.machine);
    edit(&mut state);
    env.mutate(env.machine, |a| {
        a.data[8..].copy_from_slice(bytemuck::bytes_of(&state))
    });
}
pub fn config(env: &mut Env, edit: impl FnOnce(&mut Config)) {
    let mut state = env.state::<Config>(env.config);
    edit(&mut state);
    env.mutate(env.config, |a| {
        a.data[8..].copy_from_slice(bytemuck::bytes_of(&state))
    });
}
pub fn setup() -> (Env, Bag) {
    let mut env = Env::new();
    let mint = Pubkey::new_unique();
    let bag = Bag {
        mint,
        token_program: token(),
        curve: onepercent::checks::dbc_pool_address(&mint, &params::METEORA_DBC_CONFIG),
        decimals: params::TOKEN_1PCT_DECIMALS as u8,
    };
    let signer = pubkey(&env.authority.pubkey());
    config(&mut env, |c| {
        c.token_mint = bag.mint;
        c.launch_wallet = signer;
    });
    env.token_mint = bag.mint;
    let mut data = vec![0; 82];
    write_u64(&mut data, 36, params::TOKEN_1PCT_DEV_BUY_AMOUNT);
    data[44] = bag.decimals;
    data[45] = 1;
    env.put(
        bag.mint,
        solana_account::Account {
            lamports: env.rent_min(data.len()),
            data,
            owner: addr(&token()),
            ..Default::default()
        },
    );
    let mut data = vec![0; DBC_POOL_MIN_LEN];
    data[..8].copy_from_slice(&DBC_POOL_DISCRIMINATOR);
    write_key(
        &mut data,
        DBC_POOL_CONFIG_OFFSET,
        &params::METEORA_DBC_CONFIG,
    );
    write_key(&mut data, DBC_POOL_BASE_MINT_OFFSET, &bag.mint);
    env.put(
        bag.curve,
        solana_account::Account {
            lamports: env.rent_min(data.len()),
            data,
            owner: addr(&params::PROGRAM_IDS_METEORA_DBC),
            ..Default::default()
        },
    );
    let mut data = vec![0; DBC_CONFIG_MIN_LEN];
    data[..8].copy_from_slice(&DBC_CONFIG_DISCRIMINATOR);
    write_key(&mut data, DBC_CONFIG_QUOTE_MINT_OFFSET, &params::WSOL_MINT);
    write_key(&mut data, DBC_CONFIG_FEE_CLAIMER_OFFSET, &env.fee_in);
    env.put(
        params::METEORA_DBC_CONFIG,
        solana_account::Account {
            lamports: env.rent_min(data.len()),
            data,
            owner: addr(&params::PROGRAM_IDS_METEORA_DBC),
            ..Default::default()
        },
    );
    env.token_account(env.vault_auth, &bag, params::TOKEN_1PCT_DEV_BUY_AMOUNT);
    (env, bag)
}
pub fn power_ix(env: &Env, bag: &Bag) -> Instruction {
    instruction(
        "power_on",
        vec![
            meta(pubkey(&env.authority.pubkey()), true, true),
            meta(env.config, false, false),
            meta(env.machine, true, false),
            meta(bag.mint, false, false),
            meta(bag.curve, false, false),
            meta(params::METEORA_DBC_CONFIG, false, false),
            meta(env.fee_in, true, false),
            meta(pda(&[b"ledger", bag.mint.as_ref()]).0, true, false),
            meta(
                ata(&env.vault_auth, &bag.mint, &bag.token_program),
                false,
                false,
            ),
            meta(env.vault_auth, false, false),
            meta(bag.token_program, false, false),
            meta(system(), false, false),
        ],
        &[],
    )
}
pub fn collect_ix(env: &Env, payer: Pubkey) -> Instruction {
    instruction(
        "collect_creator_fees",
        vec![
            meta(payer, true, true),
            meta(env.machine, true, false),
            meta(env.fee_in, true, false),
            meta(ata(&env.fee_in, &params::WSOL_MINT, &token()), true, false),
            meta(token(), false, false),
            meta(system(), false, false),
        ],
        &[],
    )
}
pub fn advance_ix(env: &Env) -> Instruction {
    instruction(
        "advance_phase",
        vec![
            meta(env.config, false, false),
            meta(env.machine, true, false),
        ],
        &[],
    )
}
pub fn via_cpi(inner: Instruction) -> Instruction {
    let mut data = vec![0xf3];
    data.extend(inner.data);
    let mut accounts = vec![meta(onepercent::ID, false, false)];
    accounts.extend(inner.accounts);
    Instruction {
        program_id: addr(&vrf()),
        accounts,
        data,
    }
}
pub fn collect(env: &mut Env) -> litesvm::types::TransactionMetadata {
    let payer = pubkey(&env.authority.pubkey());
    env.send(&[collect_ix(env, payer)], &[]).unwrap()
}

pub fn seed_fee_wsol(env: &mut Env, amount: u64) -> anchor_lang::prelude::Pubkey {
    let account = ata(&env.fee_in, &params::WSOL_MINT, &token());
    let rent = env.rent_min(165);
    let mut data = vec![0; 165];
    write_key(&mut data, 0, &params::WSOL_MINT);
    write_key(&mut data, 32, &env.fee_in);
    write_u64(&mut data, 64, amount);
    data[108] = 1;
    write_u32(&mut data, 109, 1);
    write_u64(&mut data, 113, rent);
    env.put(
        account,
        solana_account::Account {
            lamports: rent + amount,
            data,
            owner: addr(&token()),
            ..Default::default()
        },
    );
    account
}
