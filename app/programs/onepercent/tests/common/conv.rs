use anchor_lang::prelude::Pubkey;
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use std::str::FromStr;

pub fn addr(key: &Pubkey) -> Address {
    Address::from(key.to_bytes())
}
pub fn pubkey(key: &Address) -> Pubkey {
    Pubkey::new_from_array(key.to_bytes())
}
pub fn key(value: &str) -> Pubkey {
    Pubkey::from_str(value).unwrap()
}
pub fn ix(value: anchor_lang::solana_program::instruction::Instruction) -> Instruction {
    Instruction {
        program_id: addr(&value.program_id),
        accounts: value
            .accounts
            .into_iter()
            .map(|m| AccountMeta {
                pubkey: addr(&m.pubkey),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
        data: value.data,
    }
}
pub fn meta(key: Pubkey, writable: bool, signer: bool) -> AccountMeta {
    AccountMeta {
        pubkey: addr(&key),
        is_writable: writable,
        is_signer: signer,
    }
}
pub fn pda(seeds: &[&[u8]]) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, &onepercent::ID)
}
pub fn disc(namespace: &str, name: &str) -> Vec<u8> {
    solana_sha256_hasher::hash(format!("{namespace}:{name}").as_bytes()).to_bytes()[..8].to_vec()
}
pub fn instruction(name: &str, accounts: Vec<AccountMeta>, args: &[u8]) -> Instruction {
    let mut data = disc("global", name);
    data.extend_from_slice(args);
    Instruction {
        program_id: addr(&onepercent::ID),
        accounts,
        data,
    }
}
pub fn write_u16(data: &mut [u8], offset: usize, value: u16) {
    data[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}
pub fn write_u32(data: &mut [u8], offset: usize, value: u32) {
    data[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
pub fn write_u64(data: &mut [u8], offset: usize, value: u64) {
    data[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}
pub fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap())
}
pub fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}
pub fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap())
}
pub fn write_key(data: &mut [u8], offset: usize, value: &Pubkey) {
    data[offset..offset + 32].copy_from_slice(value.as_ref());
}
pub fn read_key(data: &[u8], offset: usize) -> Pubkey {
    Pubkey::new_from_array(data[offset..offset + 32].try_into().unwrap())
}
