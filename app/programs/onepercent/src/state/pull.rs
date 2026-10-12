use anchor_lang::prelude::*;
#[account(zero_copy)]
#[repr(C)]
pub struct Pull {
    pub seq: u64,
    pub buyer: Pubkey,
    pub referrer: Pubkey,
    pub randomness: [u8; 32],
    pub created_ts: i64,
    pub revealed_ts: i64,
    pub price: u64,
    pub buyer_nonce: u32,
    pub settled_mask: u16,
    pub edition: u8,
    pub qty: u8,
    pub status: u8,
    pub holder: u8,
    pub bump: u8,
    pub version: u8,
    pub live_flags: u8,
    pub _pad: [u8; 3],
    pub _reserved: [u8; 24],
}
#[zero_copy]
#[repr(C)]
pub struct Royalty {
    pub depositor: Pubkey,
    pub lamports: u64,
    pub refund: u64,
}
#[zero_copy]
#[repr(C)]
pub struct PackRecord {
    pub royalties: [Royalty; 4],
    pub backing: u8,
    pub tier: u8,
    pub carved_bucket: u8,
    pub house_mask: u8,
    pub fresh_mask: u8,
    pub _pad: [u8; 3],
}
const _: () =
    assert!(8 + core::mem::size_of::<Pull>() == crate::params::ACCOUNT_SIZES_PULL_HEADER as usize);
const _: () = assert!(
    core::mem::size_of::<PackRecord>() == crate::params::ACCOUNT_SIZES_PULL_PER_PACK as usize
);
const _: () = assert!(core::mem::size_of::<Royalty>() == 48);
