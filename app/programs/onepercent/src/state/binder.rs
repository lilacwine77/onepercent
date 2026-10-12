use anchor_lang::prelude::*;
#[account(zero_copy)]
#[repr(C)]
pub struct Binder {
    pub owner: Pubkey,
    pub referrer: Pubkey,
    pub season_spend: u64,
    pub sol_owed: u64,
    pub feed_nonce_base: u32,
    pub sb_nonce: u32,
    pub pull_nonce: u32,
    pub feed_nonce_bits: u16,
    pub fresh_in_deck: u16,
    pub len: u16,
    pub cap: u16,
    pub reserved: u16,
    pub bump: u8,
    pub flags: u8,
}
#[zero_copy]
#[repr(C)]
pub struct Card {
    pub mint: Pubkey,
    pub amount: u64,
    pub value: u64,
    pub kind: u8,
    pub edition: u8,
    pub flags: u8,
    pub _pad: u8,
    pub seq_lo: u32,
}
const _: () = assert!(
    8 + core::mem::size_of::<Binder>() == crate::params::ACCOUNT_SIZES_BINDER_HEADER as usize
);
const _: () =
    assert!(core::mem::size_of::<Card>() == crate::params::ACCOUNT_SIZES_CARD_SLOT as usize);
