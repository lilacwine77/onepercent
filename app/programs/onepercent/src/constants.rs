//! Structural values and aliases; economics originate in generated parameters.
use crate::params;
use anchor_lang::{prelude::Pubkey, pubkey};

pub const CONFIG_SEED: &[u8] = b"config";
pub const MACHINE_SEED: &[u8] = b"machine";
pub const DECK_SEED: &[u8] = b"deck";
pub const BINDER_SEED: &[u8] = b"binder";
pub const PULL_SEED: &[u8] = b"pull";
pub const LEDGER_SEED: &[u8] = b"ledger";
pub const VAULT_AUTH_SEED: &[u8] = b"vault_auth";
pub const FEE_IN_SEED: &[u8] = b"fee_in";
pub const IDENTITY_SEED: &[u8] = b"identity";
pub const CONFIG_SIZE: usize = 872;
pub const MACHINE_SIZE: usize = 3_808;
pub const MAX_FEED_BAGS: usize = 6;
pub const DECK_HEADER: usize = params::ACCOUNT_SIZES_DECK_HEADER as usize;
pub const DECK_ENTRY: usize = params::ACCOUNT_SIZES_DECK_ENTRY as usize;
pub const BINDER_HEADER: usize = params::ACCOUNT_SIZES_BINDER_HEADER as usize;
pub const CARD_SLOT: usize = params::ACCOUNT_SIZES_CARD_SLOT as usize;
pub const PULL_HEADER: usize = params::ACCOUNT_SIZES_PULL_HEADER as usize;
pub const PULL_PER_PACK: usize = params::ACCOUNT_SIZES_PULL_PER_PACK as usize;
pub const MINT_LEDGER_SIZE: usize = params::ACCOUNT_SIZES_MINT_LEDGER as usize;
pub const NATIVE_MINT_2022: Pubkey = pubkey!("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");
pub const LEGACY_VRF_IDENTITY: Pubkey = pubkey!("9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw");

pub const PHASE_SETUP: u8 = 0;
pub const PHASE_STOCK_UP: u8 = 1;
pub const PHASE_POWERED_ON: u8 = 2;
pub const PHASE_ON_AIR: u8 = 3;
pub const PHASE_BUYS_CLOSED: u8 = 4;
pub const PHASE_FINAL_PULL: u8 = 5;
pub const PHASE_DONE: u8 = 6;
pub const KIND_DUST: u8 = 0;
pub const KIND_SILVER: u8 = 1;
pub const KIND_BLUE: u8 = 2;
pub const KIND_HOLO: u8 = 3;
pub const KIND_BLACK: u8 = 4;
pub const KIND_JACKPOT: u8 = 5;
pub const KIND_ONE_PCT: u8 = 6;
pub const KIND_SPOTLIGHT: u8 = 7;
pub const KIND_FINAL: u8 = 8;
pub const TIER_NOT_DRAWN: u8 = u8::MAX;
pub const BUCKET_EMPTY: u8 = 0;
pub const BUCKET_MAJOR: u8 = 1;
pub const BUCKET_TRENDING: u8 = 2;
pub const TOKEN_SPL: u8 = 0;
pub const TOKEN_2022: u8 = 1;
pub const PULL_PENDING: u8 = 1;
pub const PULL_REVEALED: u8 = 2;
pub const ENTRY_FRESH: u8 = 1;
pub const ENTRY_REFED: u8 = 2;
pub const LIVE_ONE_PCT: u8 = 1;
pub const LIVE_SPOTLIGHT: u8 = 2;
pub const LIVE_JACKPOT: u8 = 4;

// These economic and structural checks are evaluated entirely at compile time.
const _: () = {
    assert!(params::CARDS_PER_PACK_DUST == 4);
    assert!(params::CARDS_PER_PACK_HIT == 1);
    assert!(params::STOCK_MAX_BUCKETS == 16);
    assert!(params::TOKEN_1PCT_ONE_PCT_CARD_COUNT == 4);
    assert!(params::VRF_MAX_QUEUES == 4);
    assert!(params::GOVERNANCE_MAX_TEAM_WALLETS == 8);
    assert!(params::GOVERNANCE_GUARDIAN_COUNT == 2);
    assert!(params::FEED_RULES_FRESH_CAP_PER_WALLET <= u16::MAX as u32);
    assert!(params::COVERAGE_DECK_MAX as usize * DECK_ENTRY + DECK_HEADER <= 10_485_760);
    let bps = params::BPS_DENOMINATOR as u128;
    let ppb = params::PPB_DENOMINATOR as u128;
    assert!(
        params::PACK_SPLIT_BPS_STOCK
            + params::PACK_SPLIT_BPS_ROYALTY_PER_DUST_CARD * params::CARDS_PER_PACK_DUST
            + params::PACK_SPLIT_BPS_JACKPOT
            + params::PACK_SPLIT_BPS_BURN1PCT
            + params::PACK_SPLIT_BPS_REFERRAL
            + params::PACK_SPLIT_BPS_TEAM
            == params::BPS_DENOMINATOR
    );
    let [silver_value, blue_value, holo_value, black_value] = params::HIT_TIERS_VALUE_BPS;
    let mut prices: &[u64] = &params::PACK_EDITIONS_PRICE_LAMPORTS;
    let mut blues: &[u32] = &params::HIT_ODDS_BLUE_PPB;
    let mut maxima: &[u32] = &params::PACK_EDITIONS_MAX_PER_RIP;
    while let (Some((price, prices_tail)), Some((blue, blues_tail)), Some((maximum, maxima_tail))) = (
        prices.split_first(),
        blues.split_first(),
        maxima.split_first(),
    ) {
        let price = *price as u128;
        let maximum = *maximum;
        let jp = price / params::HIT_ODDS_JACKPOT_PRICE_DIVISOR as u128;
        let one_pct = price / params::HIT_ODDS_ONE_PCT_PRICE_DIVISOR as u128;
        let spotlight = price / params::HIT_ODDS_SPOTLIGHT_PRICE_DIVISOR as u128;
        assert!(price.is_multiple_of(params::HIT_ODDS_JACKPOT_PRICE_DIVISOR as u128));
        assert!(price.is_multiple_of(params::HIT_ODDS_ONE_PCT_PRICE_DIVISOR as u128));
        assert!(price.is_multiple_of(params::HIT_ODDS_SPOTLIGHT_PRICE_DIVISOR as u128));
        assert!(
            (one_pct * params::TOKEN_1PCT_HOLDER_TIER_ONE_PCT_ODDS_MULTIPLIER_BPS as u128)
                .is_multiple_of(bps)
        );
        assert!((jp + one_pct).is_multiple_of(2));
        let blue = *blue as u128;
        assert!(blue == 113_750_000 + (jp + one_pct) / 2);
        let black = params::HIT_ODDS_BLACK_PPB as u128;
        let holo = params::HIT_ODDS_HOLO_PPB as u128;
        let silver = ppb - one_pct - jp - black - holo - blue;
        assert!(
            silver_value as u128 * silver
                + blue_value as u128 * blue
                + holo_value as u128 * holo
                + black_value as u128 * black
                == params::HIT_ODDS_CALIBRATED_STOCK_EV_BPS as u128 * ppb
        );
        assert!(
            ppb > one_pct * params::TOKEN_1PCT_HOLDER_TIER_ONE_PCT_ODDS_MULTIPLIER_BPS as u128
                / bps
                + spotlight
                + jp
                + black
                + holo
                + blue
        );
        assert!(price * maximum as u128 <= params::MAX_LIST_PER_RIP_LAMPORTS as u128);
        assert!(PULL_HEADER + PULL_PER_PACK * maximum as usize <= 10_240);
        assert!((price * params::PACK_SPLIT_BPS_ROYALTY_PER_DUST_CARD as u128).is_multiple_of(bps));
        assert!((price * params::PACK_SPLIT_BPS_JACKPOT as u128).is_multiple_of(bps));
        assert!((price * params::PACK_SPLIT_BPS_BURN1PCT as u128).is_multiple_of(bps));
        assert!((price * params::PACK_SPLIT_BPS_REFERRAL as u128).is_multiple_of(bps));
        assert!((price * params::PACK_SPLIT_BPS_TEAM as u128).is_multiple_of(bps));
        let mut values: &[u32] = &params::HIT_TIERS_VALUE_BPS;
        while let Some((value, tail)) = values.split_first() {
            assert!((price * *value as u128).is_multiple_of(bps));
            values = tail;
        }
        prices = prices_tail;
        blues = blues_tail;
        maxima = maxima_tail;
    }
};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dependency_program_ids_match_generated_parameters() {
        assert_eq!(
            params::PROGRAM_IDS_MAGICBLOCK_VRF.to_bytes(),
            ephemeral_vrf_sdk::consts::VRF_PROGRAM_ID.to_bytes()
        );
        assert_eq!(params::PROGRAM_IDS_SPL_TOKEN, anchor_spl::token::ID);
        assert_eq!(params::PROGRAM_IDS_TOKEN2022, anchor_spl::token_2022::ID);
        assert_eq!(
            params::PROGRAM_IDS_ASSOCIATED_TOKEN,
            anchor_spl::associated_token::ID
        );
        assert_eq!(
            params::PROGRAM_IDS_ED25519,
            solana_sdk_ids::ed25519_program::ID
        );
        assert_eq!(
            params::WSOL_MINT,
            anchor_spl::token::spl_token::native_mint::ID
        );
        assert_eq!(
            NATIVE_MINT_2022,
            anchor_spl::token_2022::spl_token_2022::native_mint::ID
        );
    }
}

// M2 P0 structural ABI values (02-M2-BRIEF.md §4.2 and §6.4).
#[anchor_lang::constant]
pub const MAX_SELL_BACK_CARDS: u8 = 8;
#[anchor_lang::constant]
pub const MAX_FEED_BACK_CARDS: u8 = 8;
pub const EXEC_KIND_NONE: u8 = 0;
pub const EXEC_KIND_STOCK_BUY: u8 = 1;
pub const EXEC_KIND_STOCK_SELL: u8 = 2;
pub const EXEC_KIND_BURN: u8 = 3;
pub const EXEC_KIND_JACKPOT_BUY: u8 = 4;
pub const BUCKET_NONE: u8 = u8::MAX;
pub const POOL_AUTHORITY_SEED: &[u8] = b"pool-authority";
pub const PYTH_PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] =
    [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];
pub const PYTH_PRICE_UPDATE_V2_MIN_LEN: usize = 133;
pub const PYTH_PRICE_UPDATE_V2_VERIFICATION_LEVEL_OFFSET: usize = 40;
pub const PYTH_PRICE_UPDATE_V2_FEED_ID_OFFSET: usize = 41;
pub const PYTH_PRICE_UPDATE_V2_PRICE_OFFSET: usize = 73;
pub const PYTH_PRICE_UPDATE_V2_CONF_OFFSET: usize = 81;
pub const PYTH_PRICE_UPDATE_V2_EXPONENT_OFFSET: usize = 89;
pub const PYTH_PRICE_UPDATE_V2_PUBLISH_TIME_OFFSET: usize = 93;
pub const PUMPSWAP_POOL_DISCRIMINATOR: [u8; 8] = params::PUMP_LAYOUTS_POOL_DISCRIMINATOR;
pub const PUMPSWAP_POOL_MIN_LEN: usize = 261;
pub const PUMPSWAP_POOL_INDEX_OFFSET: usize = 9;
pub const PUMPSWAP_POOL_BASE_MINT_OFFSET: usize = 43;
pub const PUMPSWAP_POOL_QUOTE_MINT_OFFSET: usize = 75;
pub const PUMPSWAP_POOL_BASE_VAULT_OFFSET: usize = 139;
pub const PUMPSWAP_POOL_QUOTE_VAULT_OFFSET: usize = 171;
pub const PUMPSWAP_POOL_IS_MAYHEM_MODE_OFFSET: usize = 243;
pub const PUMPSWAP_POOL_VIRTUAL_QUOTE_RESERVES_OFFSET: usize = 245;
pub const BONDING_CURVE_DISCRIMINATOR: [u8; 8] = params::PUMP_LAYOUTS_BONDING_CURVE_DISCRIMINATOR;
pub const BONDING_CURVE_MIN_LEN: usize = 49;
pub const BONDING_CURVE_VIRTUAL_TOKEN_RESERVES_OFFSET: usize = 8;
pub const BONDING_CURVE_VIRTUAL_SOL_RESERVES_OFFSET: usize = 16;
pub const BONDING_CURVE_REAL_TOKEN_RESERVES_OFFSET: usize = 24;
pub const BONDING_CURVE_COMPLETE_OFFSET: usize = 48;

#[cfg(test)]
mod m2_tests {
    use super::*;

    #[test]
    fn external_discriminators_match_anchor_names() {
        for (name, discriminator) in [
            ("PriceUpdateV2", PYTH_PRICE_UPDATE_V2_DISCRIMINATOR),
            ("Pool", PUMPSWAP_POOL_DISCRIMINATOR),
            ("BondingCurve", BONDING_CURVE_DISCRIMINATOR),
        ] {
            let hash = solana_sha256_hasher::hash(format!("account:{name}").as_bytes());
            assert_eq!(hash.as_ref().get(..8), Some(discriminator.as_slice()));
        }
    }
}

// M4 launch structure; D27 fixes the three creator-fee regime identifiers.
pub const ONEPCT_LOCKED: u8 = 0;
pub const ONEPCT_LIVE: u8 = 1;
pub const ONEPCT_PULLED: u8 = 2;
pub const ONEPCT_FINAL: u8 = 3;
pub const REGIME_BELOW_FLOOR: u8 = 0;
pub const REGIME_SEASON: u8 = 1;
pub const REGIME_AFTER_END: u8 = 2;
pub const EDITION_NONE: u8 = 255;
pub const FINAL_SOL_CLAIMED: u8 = 0b01;
pub const FINAL_TOKENS_CLAIMED: u8 = 0b10;
// Meteora DBC source f552f20, VirtualPool and PoolConfig; offsets include discriminator.
pub const DBC_POOL_DISCRIMINATOR: [u8; 8] = [213, 224, 5, 209, 98, 69, 119, 92];
pub const DBC_POOL_MIN_LEN: usize = 424;
pub const DBC_POOL_CONFIG_OFFSET: usize = 72;
pub const DBC_POOL_BASE_MINT_OFFSET: usize = 136;
pub const DBC_CONFIG_DISCRIMINATOR: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];
pub const DBC_CONFIG_MIN_LEN: usize = 1048;
pub const DBC_CONFIG_QUOTE_MINT_OFFSET: usize = 8;
pub const DBC_CONFIG_FEE_CLAIMER_OFFSET: usize = 40;
pub const DBC_CONFIG_CREATOR_TRADING_FEE_PERCENTAGE_OFFSET: usize = 245;

const _: () = {
    assert!(params::CREATOR_FEE_SPLIT_BPS_BELOW_FLOOR_BURN == 0);
    assert!(params::CREATOR_FEE_SPLIT_BPS_SEASON_BURN == 0);
    assert!(params::CREATOR_FEE_SPLIT_BPS_AFTER_END_BURN == 0);
    assert!(params::CREATOR_FEE_SPLIT_BPS_AFTER_END_TEAM == params::BPS_DENOMINATOR);
    assert!(
        params::CREATOR_FEE_SPLIT_BPS_BELOW_FLOOR_STOCK
            + params::CREATOR_FEE_SPLIT_BPS_BELOW_FLOOR_BURN
            + params::CREATOR_FEE_SPLIT_BPS_BELOW_FLOOR_TEAM
            == params::BPS_DENOMINATOR
    );
    assert!(
        params::CREATOR_FEE_SPLIT_BPS_SEASON_STOCK
            + params::CREATOR_FEE_SPLIT_BPS_SEASON_BURN
            + params::CREATOR_FEE_SPLIT_BPS_SEASON_TEAM
            == params::BPS_DENOMINATOR
    );
    assert!(
        params::CREATOR_FEE_SPLIT_BPS_AFTER_END_STOCK
            + params::CREATOR_FEE_SPLIT_BPS_AFTER_END_BURN
            + params::CREATOR_FEE_SPLIT_BPS_AFTER_END_TEAM
            == params::BPS_DENOMINATOR
    );
    assert!(
        params::TOKEN_1PCT_ONE_PCT_CARD_COUNT as u64 * params::TOKEN_1PCT_ONE_PCT_CARD_AMOUNT
            == params::TOKEN_1PCT_DEV_BUY_AMOUNT
    );
    let [a, b, c, d] = params::TOKEN_1PCT_ONE_PCT_RELEASE_OFFSETS_SECONDS;
    assert!(a == 0 && a < b && b < c && c < d && d < params::SEASON_DURATION_SECONDS);
};
