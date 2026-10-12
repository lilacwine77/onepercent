use anchor_lang::prelude::*;
#[account(zero_copy)]
#[repr(C)]
pub struct Config {
    pub admin: Pubkey,
    pub guardians: [Pubkey; 2],
    pub keeper: Pubkey,
    pub executor: Pubkey,
    pub intake_signer: Pubkey,
    pub quote_signer: Pubkey,
    pub launch_wallet: Pubkey,
    pub team_wallet: Pubkey,
    pub team_wallets: [Pubkey; 8],
    pub token_mint: Pubkey,
    pub vrf_queues: [Pubkey; 4],
    pub snapshot_slot: u64,
    pub snapshot_ts: i64,
    pub stock_up_ts: i64,
    pub version: u8,
    pub bump: u8,
    pub active_queue: u8,
    pub season_set: u8,
    pub admin_paused: u8,
    pub guardian_paused: u8,
    pub disabled_roles: u8,
    pub _pad: u8,
    pub vrf_program: Pubkey,
    pub _reserved: [u8; 96],
}
impl Config {
    pub fn is_team(&self, key: &Pubkey) -> bool {
        *key == self.team_wallet || (*key != Pubkey::default() && self.team_wallets.contains(key))
    }
}
const _: () = assert!(8 + core::mem::size_of::<Config>() == crate::constants::CONFIG_SIZE);
