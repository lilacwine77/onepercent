#![allow(dead_code)]
use crate::common::*;
use anchor_lang::{prelude::Pubkey, Discriminator};
use onepercent::state::{Config, Deck, DeckEntry};
use solana_instruction::Instruction;

pub fn mint_data(decimals: u8) -> Vec<u8> {
    let mut data = vec![0; 82];
    data[44] = decimals;
    data[45] = 1;
    data
}
pub fn t22_data(mint: Pubkey, extensions: &[(u16, Vec<u8>)]) -> Vec<u8> {
    let mut data = mint_data(6);
    data.resize(166, 0);
    data[165] = 1;
    for (code, bytes) in extensions {
        data.extend_from_slice(&code.to_le_bytes());
        data.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        data.extend_from_slice(bytes);
    }
    let _ = mint;
    data
}
pub fn metadata_bag(env: &mut Env) -> Bag {
    let bag = env.new_pump_mint(true);
    let mut pointer = vec![0; 64];
    pointer[32..].copy_from_slice(bag.mint.as_ref());
    let mut metadata = vec![0; 80];
    metadata[32..64].copy_from_slice(bag.mint.as_ref());
    let data = t22_data(bag.mint, &[(18, pointer), (19, metadata)]);
    let rent = env.rent_min(data.len());
    env.mutate(bag.mint, |a| {
        a.data = data;
        a.lamports = rent;
    });
    bag
}
pub fn edit_state<T: Discriminator + bytemuck::Pod>(
    env: &mut Env,
    at: Pubkey,
    edit: impl FnOnce(&mut T),
) {
    let mut state = env.state::<T>(at);
    edit(&mut state);
    env.mutate(at, |a| {
        a.data[8..8 + std::mem::size_of::<T>()].copy_from_slice(bytemuck::bytes_of(&state))
    });
}
pub fn config(env: &mut Env, edit: impl FnOnce(&mut Config)) {
    edit_state(env, env.config, edit);
}
pub fn entries(env: &Env) -> Vec<DeckEntry> {
    let state = env.state::<Deck>(env.deck);
    let account = env.account(env.deck);
    (0..state.len as usize)
        .map(|i| bytemuck::pod_read_unaligned(&account.data[64 + i * 80..64 + (i + 1) * 80]))
        .collect()
}
pub fn close_user_ix(user: Pubkey, bag: &Bag) -> Instruction {
    Instruction {
        program_id: addr(&bag.token_program),
        accounts: vec![
            meta(ata(&user, &bag.mint, &bag.token_program), true, false),
            meta(user, true, false),
            meta(user, false, true),
        ],
        data: vec![9],
    }
}
pub fn token_amount(env: &Env, at: Pubkey) -> u64 {
    read_u64(&env.account(at).data, 64)
}
pub fn reset_user_bag(env: &mut Env, user: Pubkey, bag: &Bag, amount: u64) {
    env.token_account(user, bag, amount);
    env.mutate(bag.mint, |a| {
        let supply = read_u64(&a.data, 36);
        write_u64(&mut a.data, 36, supply + amount);
    });
}
pub fn assert_no_shortfall(env: &Env) {
    for tx in &env.transactions {
        assert!(event_bytes(&tx.logs, "VaultShortfall").is_empty());
    }
}
pub fn check_intake(env: &Env) {
    use onepercent::state::{Binder, MintLedger};
    let entries = entries(env);
    let deck = env.state::<Deck>(env.deck);
    assert_eq!(deck.len as usize, entries.len());
    assert!(deck.cap >= deck.len);
    let mut per_mint = std::collections::BTreeMap::<Pubkey, u64>::new();
    let mut fresh = std::collections::BTreeMap::<Pubkey, u16>::new();
    for e in &entries {
        *per_mint.entry(e.mint).or_default() += e.amount;
        if e.flags & 1 != 0 {
            *fresh.entry(e.depositor).or_default() += 1;
        }
    }
    for (mint, total) in per_mint {
        let ledger = env.state::<MintLedger>(pda(&[b"ledger", mint.as_ref()]).0);
        assert!(ledger.accounted >= total);
        let mint_acc = env.account(mint);
        let vault = ata(&env.vault_auth, &mint, &pubkey(&mint_acc.owner));
        assert!(token_amount(env, vault) >= ledger.accounted);
    }
    for (owner, count) in fresh {
        let b = env.state::<Binder>(pda(&[b"binder", owner.as_ref()]).0);
        assert_eq!(b.fresh_in_deck, count);
    }
    assert_no_shortfall(env);
}
pub fn event_bytes(logs: &[String], name: &str) -> Vec<Vec<u8>> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let expected = disc("event", name);
    logs.iter()
        .filter_map(|line| line.strip_prefix("Program data: "))
        .filter_map(|text| {
            let mut bytes = Vec::new();
            let mut buffer = 0u32;
            let mut bits = 0;
            for c in text.bytes() {
                if c == b'=' {
                    break;
                }
                let digit = alphabet.iter().position(|x| *x == c)? as u32;
                buffer = (buffer << 6) | digit;
                bits += 6;
                if bits >= 8 {
                    bits -= 8;
                    bytes.push((buffer >> bits) as u8);
                    buffer &= (1u32 << bits) - 1;
                }
            }
            if bytes.starts_with(&expected) {
                Some(bytes)
            } else {
                None
            }
        })
        .collect()
}
