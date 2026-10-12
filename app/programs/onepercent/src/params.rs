// GENERATED from packages/config — do not edit
use anchor_lang::{constant, prelude::Pubkey, pubkey};

#[constant]
pub const LAMPORTS_PER_SOL: u64 = 1000000000u64;

#[constant]
pub const BPS_DENOMINATOR: u32 = 10000u32;

#[constant]
pub const PPB_DENOMINATOR: u32 = 1000000000u32;

#[constant]
pub const PACK_EDITIONS_PRICE_LAMPORTS: [u64; 4] =
    [100000000u64, 250000000u64, 500000000u64, 1000000000u64];

#[constant]
pub const PACK_EDITIONS_MAX_PER_RIP: [u32; 4] = [10u32, 10u32, 10u32, 5u32];

#[constant]
pub const MAX_LIST_PER_RIP_LAMPORTS: u64 = 5000000000u64;

#[constant]
pub const CARDS_PER_PACK_DUST: u32 = 4u32;

#[constant]
pub const CARDS_PER_PACK_HIT: u32 = 1u32;

#[constant]
pub const PACK_SPLIT_BPS_STOCK: u32 = 7200u32;

#[constant]
pub const PACK_SPLIT_BPS_ROYALTY_PER_DUST_CARD: u32 = 200u32;

#[constant]
pub const PACK_SPLIT_BPS_JACKPOT: u32 = 500u32;

#[constant]
pub const PACK_SPLIT_BPS_BURN1PCT: u32 = 500u32;

#[constant]
pub const PACK_SPLIT_BPS_REFERRAL: u32 = 200u32;

#[constant]
pub const PACK_SPLIT_BPS_TEAM: u32 = 800u32;

#[constant]
pub const HIT_TIERS_VALUE_BPS: [u32; 4] = [5000u32, 15000u32, 40000u32, 150000u32];

#[constant]
pub const HIT_TIERS_MAJOR_ONLY: [bool; 4] = [false, false, true, true];

#[constant]
pub const HIT_TIERS_SELL_BACK: [bool; 4] = [true, true, true, true];

#[constant]
pub const HIT_ODDS_BLACK_PPB: u32 = 2500000u32;

#[constant]
pub const HIT_ODDS_HOLO_PPB: u32 = 20000000u32;

#[constant]
pub const HIT_ODDS_JACKPOT_PRICE_DIVISOR: u32 = 400u32;

#[constant]
pub const HIT_ODDS_ONE_PCT_PRICE_DIVISOR: u32 = 1000u32;

#[constant]
pub const HIT_ODDS_SPOTLIGHT_PRICE_DIVISOR: u32 = 500u32;

#[constant]
pub const HIT_ODDS_CALIBRATED_STOCK_EV_BPS: u32 = 7200u32;

#[constant]
pub const HIT_ODDS_BLUE_PPB: [u32; 4] = [113925000u32, 114187500u32, 114625000u32, 115500000u32];

#[constant]
pub const DRAW_TAGS_TIER: &[u8] = b"1pct:tier:v1";

#[constant]
pub const DRAW_TAGS_DUST: &[u8] = b"1pct:dust:v1";

#[constant]
pub const DRAW_TAGS_BUCKET: &[u8] = b"1pct:bucket:v1";

#[constant]
pub const DRAW_TAGS_VRF_SEED: &[u8] = b"1pct:vrf:v1";

#[constant]
pub const DRAW_TAGS_ROYALTY_MEMO_PREFIX: &[u8] = b"1pct:roy:";

#[constant]
pub const COVERAGE_PER_PACK_VALUE_BPS: u32 = 150000u32;

#[constant]
pub const COVERAGE_DUST_BUFFER: u32 = 50u32;

#[constant]
pub const COVERAGE_DECK_MAX: u32 = 120000u32;

#[constant]
pub const FEED_RULES_FRESH_CAP_PER_WALLET: u32 = 25u32;

#[constant]
pub const FEED_RULES_MAX_MINT_DECIMALS: u32 = 9u32;

#[constant]
pub const ATTESTATIONS_FEED_TTL_SECONDS: i64 = 120i64;

#[constant]
pub const ATTESTATIONS_HOLD_TTL_SECONDS: i64 = 600i64;

#[constant]
pub const ATTESTATIONS_FEED_DOMAIN: &[u8] = b"1PCT-FEED-v1";

#[constant]
pub const ATTESTATIONS_HOLD_DOMAIN: &[u8] = b"1PCT-HOLD-v1";

#[constant]
pub const ATTESTATIONS_SELL_BACK_DOMAIN: &[u8] = b"1PCT-SB-v1";

#[constant]
pub const STOCK_MAX_BUCKETS: u32 = 16u32;

#[constant]
pub const STOCK_TRENDING_MAX_COUNT: u32 = 4u32;

#[constant]
pub const STOCK_MAJOR_MIN_OUT_SLIP_BPS: u32 = 150u32;

#[constant]
pub const STOCK_TRENDING_SHARE_MAX_BPS: u32 = 1500u32;

#[constant]
pub const STOCK_TRENDING_POOL_FEE_ALLOWANCE_BPS: u32 = 125u32;

#[constant]
pub const STOCK_TRENDING_MIN_OUT_SLIP_BPS: u32 = 100u32;

#[constant]
pub const STOCK_PYTH_MAX_CONF_BPS: u32 = 100u32;

#[constant]
pub const STOCK_TARGET_BASE_LAMPORTS: u64 = 30000000000u64;

#[constant]
pub const STOCK_CREATOR_FEE_FLOOR_LAMPORTS: u64 = 2000000000u64;

#[constant]
pub const STOCK_MAJOR_TRANCHE_MAX_LAMPORTS: u64 = 5000000000u64;

#[constant]
pub const STOCK_TRENDING_TRANCHE_MAX_LAMPORTS: u64 = 1500000000u64;

#[constant]
pub const STOCK_TRENDING_HOURLY_MAX_LAMPORTS: u64 = 10000000000u64;

#[constant]
pub const STOCK_PYTH_MAX_AGE_SECONDS: i64 = 60i64;

#[constant]
pub const SELL_BACK_PAYOUT_BPS: u32 = 8700u32;

#[constant]
pub const SELL_BACK_HOURLY_BUDGET_BPS_OF_STOCK_SOL: u32 = 2500u32;

#[constant]
pub const SELL_BACK_SOL_FLOOR_LAMPORTS: u64 = 1000000000u64;

#[constant]
pub const POST_REVEAL_BUY_DELAY: i64 = 30i64;

#[constant]
pub const HIT_LIST_TRENDING_NOTICE_SECONDS: i64 = 86400i64;

#[constant]
pub const KEEPER_POLICY_SOL_RESERVE_EXTRA_MINUTES: i64 = 15i64;

#[constant]
pub const SELL_BACK_HOURLY_BUDGET_MIN_LAMPORTS: u64 = 5000000000u64;

#[constant]
pub const SELL_BACK_QUOTE_TTL_SECONDS_MAJOR: i64 = 60i64;

#[constant]
pub const SELL_BACK_QUOTE_TTL_SECONDS_TRENDING: i64 = 20i64;

#[constant]
pub const JACKPOT_MIN_POT_PRICE_MULTIPLE: u32 = 15u32;

#[constant]
pub const JACKPOT_TRANCHE_MAX_BPS_OF_QUOTE_RESERVES: u32 = 100u32;

#[constant]
pub const JACKPOT_MIN_OUT_SLIP_BPS: u32 = 100u32;

#[constant]
pub const JACKPOT_TRANCHE_MAX_LAMPORTS: u64 = 2000000000u64;

#[constant]
pub const JACKPOT_TRANCHE_MIN_SPACING_SECONDS: i64 = 20i64;

#[constant]
pub const TOKEN_1PCT_DECIMALS: u32 = 6u32;

#[constant]
pub const TOKEN_1PCT_ONE_PCT_CARD_COUNT: u32 = 4u32;

#[constant]
pub const TOKEN_1PCT_HOLDER_TIER_ONE_PCT_ODDS_MULTIPLIER_BPS: u32 = 15000u32;

#[constant]
pub const TOKEN_1PCT_DEV_BUY_AMOUNT: u64 = 40000000000000u64;

#[constant]
pub const TOKEN_1PCT_ONE_PCT_CARD_AMOUNT: u64 = 10000000000000u64;

#[constant]
pub const TOKEN_1PCT_ONE_PCT_RELEASE_OFFSETS_SECONDS: [i64; 4] =
    [0i64, 151200i64, 302400i64, 453600i64];

#[constant]
pub const SPOTLIGHT_WINDOW_SECONDS: i64 = 86400i64;

#[constant]
pub const SPOTLIGHT_MIN_DEPOSIT_BPS_OF_SUPPLY: u32 = 100u32;

#[constant]
pub const BURN_TRANCHE_MAX_BPS_OF_QUOTE_RESERVES: u32 = 25u32;

#[constant]
pub const BURN_MIN_OUT_SLIP_BPS: u32 = 150u32;

#[constant]
pub const BURN_TRANCHE_MAX_LAMPORTS: u64 = 1000000000u64;

#[constant]
pub const BURN_HOURLY_MAX_LAMPORTS: u64 = 10000000000u64;

#[constant]
pub const BURN_MIN_SPACING_SECONDS: i64 = 20i64;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_BELOW_FLOOR_STOCK: u32 = 10000u32;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_BELOW_FLOOR_BURN: u32 = 0u32;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_BELOW_FLOOR_TEAM: u32 = 0u32;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_SEASON_STOCK: u32 = 5000u32;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_SEASON_BURN: u32 = 0u32;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_SEASON_TEAM: u32 = 5000u32;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_AFTER_END_STOCK: u32 = 0u32;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_AFTER_END_BURN: u32 = 0u32;

#[constant]
pub const CREATOR_FEE_SPLIT_BPS_AFTER_END_TEAM: u32 = 10000u32;

#[constant]
pub const SEASON_DURATION_SECONDS: i64 = 604800i64;

#[constant]
pub const SEASON_ON_AIR_DELAY_SECONDS: i64 = 900i64;

#[constant]
pub const SEASON_FINAL_PULL_DELAY_SECONDS: i64 = 600i64;

#[constant]
pub const SEASON_SEAL_DELAY_SECONDS: i64 = 259200i64;

#[constant]
pub const VRF_TIMEOUT_SECONDS: i64 = 300i64;

#[constant]
pub const VRF_MAX_QUEUES: u32 = 4u32;

#[constant]
pub const ACCOUNT_SIZES_DECK_HEADER: u32 = 64u32;

#[constant]
pub const ACCOUNT_SIZES_DECK_ENTRY: u32 = 80u32;

#[constant]
pub const ACCOUNT_SIZES_BINDER_HEADER: u32 = 112u32;

#[constant]
pub const ACCOUNT_SIZES_CARD_SLOT: u32 = 56u32;

#[constant]
pub const ACCOUNT_SIZES_PULL_HEADER: u32 = 176u32;

#[constant]
pub const ACCOUNT_SIZES_PULL_PER_PACK: u32 = 200u32;

#[constant]
pub const ACCOUNT_SIZES_MINT_LEDGER: u32 = 80u32;

#[constant]
pub const PAUSE_BITS_RIP: u8 = 1u8;

#[constant]
pub const PAUSE_BITS_FEED: u8 = 2u8;

#[constant]
pub const PAUSE_BITS_SELL_BACK: u8 = 4u8;

#[constant]
pub const PAUSE_BITS_STOCK_BUY: u8 = 8u8;

#[constant]
pub const PAUSE_BITS_BURN: u8 = 16u8;

#[constant]
pub const GOVERNANCE_MAX_TEAM_WALLETS: u32 = 8u32;

#[constant]
pub const GOVERNANCE_GUARDIAN_COUNT: u32 = 2u32;

#[constant]
pub const PROGRAM_IDS_PUMP_FUN: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

#[constant]
pub const PROGRAM_IDS_PUMP_SWAP: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

#[constant]
pub const PROGRAM_IDS_MAGICBLOCK_VRF: Pubkey =
    pubkey!("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");

#[constant]
pub const PROGRAM_IDS_SPL_TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

#[constant]
pub const PROGRAM_IDS_TOKEN2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

#[constant]
pub const PROGRAM_IDS_ASSOCIATED_TOKEN: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

#[constant]
pub const PROGRAM_IDS_ED25519: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

#[constant]
pub const PROGRAM_IDS_MEMO: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

#[constant]
pub const PROGRAM_IDS_COMPUTE_BUDGET: Pubkey =
    pubkey!("ComputeBudget111111111111111111111111111111");

#[constant]
pub const PROGRAM_IDS_SQUADS_V4: Pubkey = pubkey!("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

#[constant]
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

#[constant]
pub const PUMP_LAYOUTS_BONDING_CURVE_SEED: &[u8] = b"bonding-curve";

#[constant]
pub const PUMP_LAYOUTS_POOL_SEED: &[u8] = b"pool";

#[constant]
pub const PUMP_LAYOUTS_BONDING_CURVE_DISCRIMINATOR: [u8; 8] =
    [23u8, 183u8, 248u8, 55u8, 96u8, 216u8, 172u8, 96u8];

#[constant]
pub const PUMP_LAYOUTS_POOL_DISCRIMINATOR: [u8; 8] =
    [241u8, 154u8, 109u8, 4u8, 17u8, 177u8, 109u8, 188u8];

#[constant]
pub const STOCK_TRADE_MIN_SPACING_SECONDS: i64 = 20i64;

#[constant]
pub const STOCK_HOURLY_FLOOR_LAMPORTS: u64 = 30000000000u64;

#[constant]
pub const STOCK_HOURLY_HIT_OUT_MULTIPLE: u32 = 2u32;

#[constant]
pub const HIT_LIST_SOL_USD_PYTH_FEED_ID: [u8; 32] = [
    239u8, 13u8, 139u8, 111u8, 218u8, 44u8, 235u8, 164u8, 29u8, 161u8, 93u8, 64u8, 149u8, 209u8,
    218u8, 57u8, 42u8, 13u8, 47u8, 142u8, 208u8, 198u8, 199u8, 188u8, 15u8, 76u8, 250u8, 200u8,
    194u8, 128u8, 181u8, 109u8,
];

#[constant]
pub const PROGRAM_IDS_PYTH_RECEIVER: Pubkey =
    pubkey!("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp");

#[constant]
pub const PROGRAM_IDS_METEORA_DBC: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

#[constant]
pub const PROGRAM_IDS_METEORA_DAMM_V2: Pubkey =
    pubkey!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

#[cfg(not(any(feature = "devnet", feature = "mainnet")))]
#[constant]
pub const METEORA_DBC_CONFIG: Pubkey = pubkey!("AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k");

#[cfg(feature = "devnet")]
#[constant]
pub const METEORA_DBC_CONFIG: Pubkey = pubkey!("AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k");

#[cfg(feature = "mainnet")]
compile_error!("METEORA_DBC_CONFIG is PENDING for mainnet");

#[constant]
pub const METEORA_FEE_ALLOW_BPS: u32 = 300u32;

#[constant]
pub const METEORA_DAMM_V2_CONFIG: Pubkey = pubkey!("A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck");
