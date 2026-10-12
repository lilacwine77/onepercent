#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use anchor_lang::prelude::*;
pub mod checks;
pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod params;
pub mod state;
pub mod util;
pub use instructions::*;

#[program]
pub mod onepercent {
    use super::*;
    pub fn ping(ctx: Context<Ping>) -> Result<()> {
        instructions::stubs::ping_handler(ctx)
    }
    pub fn initialize(ctx: Context<Initialize>, params: InitParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }
    pub fn admin_config(ctx: Context<AdminConfig>, action: AdminAction) -> Result<()> {
        instructions::admin_config::handler(ctx, action)
    }
    pub fn guardian(ctx: Context<Guardian>, action: GuardianAction) -> Result<()> {
        instructions::guardian::handler(ctx, action)
    }
    pub fn advance_phase(ctx: Context<AdvancePhase>) -> Result<()> {
        instructions::advance_phase::handler(ctx)
    }
    pub fn admin_list_mint(
        ctx: Context<AdminListMint>,
        class: u8,
        cap: u64,
        oracle: Pubkey,
    ) -> Result<()> {
        instructions::admin_list_mint::handler(ctx, class, cap, oracle)
    }
    pub fn feed<'info>(
        ctx: Context<'_, '_, '_, 'info, Feed<'info>>,
        amounts: Vec<u64>,
        expiry: i64,
        nonce: u32,
        att_ix: u8,
    ) -> Result<()> {
        instructions::feed::handler(ctx, amounts, expiry, nonce, att_ix)
    }
    pub fn take_back(ctx: Context<TakeBack>, deck_index: u32, amount: u64) -> Result<()> {
        instructions::take_back::handler(ctx, deck_index, amount)
    }
    pub fn buy_packs(
        ctx: Context<BuyPacks>,
        edition: u8,
        qty: u8,
        pull_nonce: u32,
        min_live_flags: u8,
        referrer: Option<Pubkey>,
        hold: Option<HoldProof>,
    ) -> Result<()> {
        instructions::buy_packs::handler(
            ctx,
            edition,
            qty,
            pull_nonce,
            min_live_flags,
            referrer,
            hold,
        )
    }
    pub fn consume_randomness(
        ctx: Context<ConsumeRandomness>,
        randomness: [u8; 32],
        seq: u64,
    ) -> Result<()> {
        instructions::consume_randomness::handler(ctx, randomness, seq)
    }
    pub fn settle(ctx: Context<Settle>, seq: u64, pack: u8) -> Result<()> {
        instructions::settle::handler(ctx, seq, pack)
    }
    pub fn refund_pull(ctx: Context<RefundPull>, seq: u64) -> Result<()> {
        instructions::refund_pull::handler(ctx, seq)
    }
    pub fn redeem(ctx: Context<Redeem>, card_index: u16, amount: u64) -> Result<()> {
        instructions::redeem::handler(ctx, card_index, amount)
    }
    pub fn team_withdraw(ctx: Context<TeamWithdraw>) -> Result<()> {
        instructions::team_withdraw::handler(ctx)
    }
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        instructions::close_vault::handler(ctx)
    }
    pub fn power_on(ctx: Context<PowerOn>) -> Result<()> {
        instructions::power_on::handler(ctx)
    }
    pub fn feed_back(ctx: Context<FeedBack>, card_indices: Vec<u16>) -> Result<()> {
        instructions::feed_back::handler(ctx, card_indices)
    }
    pub fn sell_back(
        ctx: Context<SellBack>,
        cards: Vec<SellBackCard>,
        quote_lamports: u64,
        expiry: i64,
        nonce: u32,
        att_ix: u8,
    ) -> Result<()> {
        instructions::sell_back::handler(ctx, cards, quote_lamports, expiry, nonce, att_ix)
    }
    pub fn exec_begin(ctx: Context<ExecBegin>, kind: u8, bucket: u8, amount: u64) -> Result<()> {
        instructions::exec_begin::handler(ctx, kind, bucket, amount)
    }
    pub fn exec_end(ctx: Context<ExecEnd>, kind: u8) -> Result<()> {
        instructions::exec_end::handler(ctx, kind)
    }
    pub fn collect_creator_fees(ctx: Context<CollectCreatorFees>) -> Result<()> {
        instructions::collect_creator_fees::handler(ctx)
    }
    pub fn claim_launch_fees(ctx: Context<ClaimLaunchFees>, kind: LaunchFeeKind) -> Result<()> {
        instructions::claim_launch_fees::handler(ctx, kind)
    }
    pub fn start_final_pull(ctx: Context<Deferred>) -> Result<()> {
        instructions::stubs::handler(ctx)
    }
    pub fn claim_final_sol(ctx: Context<Deferred>) -> Result<()> {
        instructions::stubs::handler(ctx)
    }
    pub fn claim_final_tokens(ctx: Context<Deferred>) -> Result<()> {
        instructions::stubs::handler(ctx)
    }
    pub fn withdraw_owed(ctx: Context<WithdrawOwed>) -> Result<()> {
        instructions::withdraw_owed::handler(ctx)
    }
    pub fn close_binder(ctx: Context<CloseBinder>) -> Result<()> {
        instructions::close_binder::handler(ctx)
    }
    pub fn spotlight_deposit(ctx: Context<Deferred>) -> Result<()> {
        instructions::stubs::handler(ctx)
    }
    pub fn spotlight_take_back(ctx: Context<Deferred>) -> Result<()> {
        instructions::stubs::handler(ctx)
    }
}

// Cluster declarations stay after the program so existing Anchor diagnostic locations remain stable.
// BEGIN GENERATED CLUSTER IDENTITY
#[cfg(all(feature = "devnet", feature = "mainnet"))]
compile_error!("devnet and mainnet features are mutually exclusive");
#[cfg(feature = "mainnet")]
compile_error!("Mainnet program ID is PENDING");
#[cfg(feature = "mainnet")]
compile_error!("Mainnet landing measurements are PENDING");
#[cfg(not(any(feature = "devnet", feature = "mainnet")))]
declare_id!("DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe");
#[cfg(feature = "devnet")]
declare_id!("DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr");
// END GENERATED CLUSTER IDENTITY
