use anchor_lang::prelude::*;
#[account(zero_copy)]
#[repr(C)]
pub struct Deck {
    pub len: u32,
    pub cap: u32,
    pub header_rent: u64,
    pub total_fed: u64,
    pub total_pulled: u64,
    pub total_taken_back: u64,
    pub bump: u8,
    pub version: u8,
    pub _pad: [u8; 6],
    pub _reserved: [u8; 8],
}
#[zero_copy]
#[repr(C)]
pub struct DeckEntry {
    pub depositor: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub deposit: u32,
    pub flags: u8,
    pub _pad: [u8; 3],
}
const _: () =
    assert!(8 + core::mem::size_of::<Deck>() == crate::params::ACCOUNT_SIZES_DECK_HEADER as usize);
const _: () =
    assert!(core::mem::size_of::<DeckEntry>() == crate::params::ACCOUNT_SIZES_DECK_ENTRY as usize);
