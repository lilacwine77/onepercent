use anchor_lang::prelude::*;
#[account(zero_copy)]
#[repr(C)]
pub struct MintLedger {
    pub mint: Pubkey,
    pub payer: Pubkey,
    pub accounted: u64,
}
const _: () = assert!(
    8 + core::mem::size_of::<MintLedger>() == crate::params::ACCOUNT_SIZES_MINT_LEDGER as usize
);
