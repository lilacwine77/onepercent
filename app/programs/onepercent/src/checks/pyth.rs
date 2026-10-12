//! Full-verified PriceUpdateV2 reads, checked against captured push-feed accounts.
use crate::{constants::*, errors::MachineError, math::exec::Price, params};
use anchor_lang::prelude::*;

fn bytes<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N]> {
    data.get(offset..offset.saturating_add(N))
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| error!(MachineError::OracleInvalid))
}

/// Accept either a sponsored account or a keeper-posted Full update.
/// The authenticated owner and feed id bind the price; the account address is not fixed.
pub fn read_price(account: &AccountInfo<'_>, feed: &Pubkey, now: i64) -> Result<Price> {
    require_keys_eq!(
        *account.owner,
        params::PROGRAM_IDS_PYTH_RECEIVER,
        MachineError::OracleInvalid
    );
    let data = account.try_borrow_data()?;
    require!(
        data.len() >= PYTH_PRICE_UPDATE_V2_MIN_LEN
            && data.get(..8) == Some(PYTH_PRICE_UPDATE_V2_DISCRIMINATOR.as_slice())
            && data.get(PYTH_PRICE_UPDATE_V2_VERIFICATION_LEVEL_OFFSET) == Some(&1),
        MachineError::OracleInvalid
    );
    require!(
        bytes::<32>(&data, PYTH_PRICE_UPDATE_V2_FEED_ID_OFFSET)? == feed.to_bytes(),
        MachineError::OracleInvalid
    );
    let price = i64::from_le_bytes(bytes(&data, PYTH_PRICE_UPDATE_V2_PRICE_OFFSET)?);
    let conf = u64::from_le_bytes(bytes(&data, PYTH_PRICE_UPDATE_V2_CONF_OFFSET)?);
    let exponent = i32::from_le_bytes(bytes(&data, PYTH_PRICE_UPDATE_V2_EXPONENT_OFFSET)?);
    let publish_time = i64::from_le_bytes(bytes(&data, PYTH_PRICE_UPDATE_V2_PUBLISH_TIME_OFFSET)?);
    require!(
        price > 0 && (-18..=0).contains(&exponent),
        MachineError::OracleInvalid
    );
    require!(
        now.saturating_sub(publish_time) <= params::STOCK_PYTH_MAX_AGE_SECONDS,
        MachineError::OracleStale
    );
    let price = u64::try_from(price).map_err(|_| error!(MachineError::OracleInvalid))?;
    require!(
        u128::from(conf) * u128::from(params::BPS_DENOMINATOR)
            <= u128::from(params::STOCK_PYTH_MAX_CONF_BPS) * u128::from(price),
        MachineError::OracleWide
    );
    Ok(Price { price, exponent })
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )]
    use super::*;
    use anchor_lang::__private::base64::{engine::general_purpose::STANDARD, Engine};
    use std::str::FromStr;

    const FIXTURES: [(&str, i64, u64, i32, i64); 6] = [
        (
            include_str!("../../../../fixtures/mainnet/pyth/sol-usd.json"),
            10_947_583_462,
            3_153_335,
            -8,
            1_791_543_222,
        ),
        (
            include_str!("../../../../fixtures/mainnet/pyth/wif-usd.json"),
            21_025_749,
            5_828,
            -8,
            1_791_543_195,
        ),
        (
            include_str!("../../../../fixtures/mainnet/pyth/bonk-usd.json"),
            33_190,
            33,
            -10,
            1_791_543_195,
        ),
        (
            include_str!("../../../../fixtures/mainnet/pyth/popcat-usd.json"),
            4_681_263,
            3_237,
            -8,
            1_791_543_153,
        ),
        (
            include_str!("../../../../fixtures/mainnet/pyth/fartcoin-usd.json"),
            16_299_830,
            6_328,
            -8,
            1_791_543_736,
        ),
        (
            include_str!("../../../../fixtures/mainnet/pyth/pnut-usd.json"),
            4_943_355,
            3_996,
            -8,
            1_791_414_145,
        ),
    ];

    fn fixture(json: &str) -> (serde_json::Value, Vec<u8>, Pubkey) {
        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let data = STANDARD
            .decode(
                value["response"]["result"]["value"]["data"][0]
                    .as_str()
                    .unwrap(),
            )
            .unwrap();
        let id = value["feedId"].as_str().unwrap();
        let feed = Pubkey::new_from_array(std::array::from_fn(|i| {
            u8::from_str_radix(&id[i * 2..i * 2 + 2], 16).unwrap()
        }));
        (value, data, feed)
    }

    fn read(data: &mut [u8], owner: &Pubkey, feed: &Pubkey, now: i64) -> Result<Price> {
        let key = Pubkey::new_unique();
        let mut lamports = 1;
        read_price(
            &AccountInfo::new(&key, false, false, &mut lamports, data, owner, false, 0),
            feed,
            now,
        )
    }

    fn assert_error(result: Result<Price>, expected: MachineError) {
        let Error::AnchorError(actual) = result.unwrap_err() else {
            panic!("expected a machine error");
        };
        assert_eq!(actual.error_code_number, u32::from(expected));
    }

    #[test]
    fn captured_sponsored_accounts_confirm_every_m2_offset_and_shard_zero_pda() {
        let push_oracle = Pubkey::from_str("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou").unwrap();
        for (json, price, conf, exponent, publish_time) in FIXTURES {
            let (record, mut data, feed) = fixture(json);
            let address = Pubkey::from_str(record["address"].as_str().unwrap()).unwrap();
            let owner = Pubkey::from_str(
                record["response"]["result"]["value"]["owner"]
                    .as_str()
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(record["shard"], 0);
            assert_eq!(owner, params::PROGRAM_IDS_PYTH_RECEIVER);
            assert_eq!(
                address,
                Pubkey::find_program_address(&[&0u16.to_le_bytes(), feed.as_ref()], &push_oracle).0
            );
            assert_eq!(data.len(), 134);
            assert_eq!(data[..8], [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]);
            assert_eq!(data[40], 1);
            assert_eq!(&data[41..73], feed.as_ref());
            assert_eq!(i64::from_le_bytes(data[73..81].try_into().unwrap()), price);
            assert_eq!(u64::from_le_bytes(data[81..89].try_into().unwrap()), conf);
            assert_eq!(
                i32::from_le_bytes(data[89..93].try_into().unwrap()),
                exponent
            );
            assert_eq!(
                i64::from_le_bytes(data[93..101].try_into().unwrap()),
                publish_time
            );
            assert_eq!(
                read(&mut data, &owner, &feed, publish_time).unwrap(),
                Price {
                    price: price as u64,
                    exponent
                }
            );
        }
    }

    #[test]
    fn captured_update_rejects_partial_wrong_owner_and_wrong_feed() {
        let (_, data, feed) = fixture(FIXTURES[0].0);
        let owner = params::PROGRAM_IDS_PYTH_RECEIVER;
        let now = FIXTURES[0].4;
        for tag in [0, 2, u8::MAX] {
            let mut malformed = data.clone();
            malformed[40] = tag;
            assert_error(
                read(&mut malformed, &owner, &feed, now),
                MachineError::OracleInvalid,
            );
        }
        assert_error(
            read(&mut data.clone(), &Pubkey::new_unique(), &feed, now),
            MachineError::OracleInvalid,
        );
        assert_error(
            read(&mut data.clone(), &owner, &Pubkey::new_unique(), now),
            MachineError::OracleInvalid,
        );
    }

    #[test]
    fn captured_update_enforces_structural_and_numeric_bounds() {
        let (_, data, feed) = fixture(FIXTURES[0].0);
        let owner = params::PROGRAM_IDS_PYTH_RECEIVER;
        let now = FIXTURES[0].4;
        for length in [0, 8, 40, 41, 73, 101, 132] {
            assert_error(
                read(&mut data[..length].to_vec(), &owner, &feed, now),
                MachineError::OracleInvalid,
            );
        }
        assert!(read(&mut data[..133].to_vec(), &owner, &feed, now).is_ok());
        let mut malformed = data.clone();
        malformed[0] ^= 1;
        assert_error(
            read(&mut malformed, &owner, &feed, now),
            MachineError::OracleInvalid,
        );
        for price in [0i64, -1, i64::MIN] {
            let mut malformed = data.clone();
            malformed[73..81].copy_from_slice(&price.to_le_bytes());
            assert_error(
                read(&mut malformed, &owner, &feed, now),
                MachineError::OracleInvalid,
            );
        }
        for exponent in [-19i32, 1, i32::MIN, i32::MAX] {
            let mut malformed = data.clone();
            malformed[89..93].copy_from_slice(&exponent.to_le_bytes());
            assert_error(
                read(&mut malformed, &owner, &feed, now),
                MachineError::OracleInvalid,
            );
        }
        for exponent in [-18i32, 0] {
            let mut valid = data.clone();
            valid[89..93].copy_from_slice(&exponent.to_le_bytes());
            assert_eq!(
                read(&mut valid, &owner, &feed, now).unwrap().exponent,
                exponent
            );
        }
    }

    #[test]
    fn captured_update_accepts_age_and_confidence_boundaries_and_rejects_beyond() {
        let (_, mut data, feed) = fixture(FIXTURES[0].0);
        let owner = params::PROGRAM_IDS_PYTH_RECEIVER;
        let published = FIXTURES[0].4;
        assert!(read(&mut data, &owner, &feed, published + 60).is_ok());
        assert!(read(&mut data, &owner, &feed, published - 1).is_ok());
        assert_error(
            read(&mut data, &owner, &feed, published + 61),
            MachineError::OracleStale,
        );
        data[73..81].copy_from_slice(&10_000i64.to_le_bytes());
        data[81..89].copy_from_slice(&100u64.to_le_bytes());
        assert!(read(&mut data, &owner, &feed, published).is_ok());
        for conf in [101u64, u64::MAX] {
            data[81..89].copy_from_slice(&conf.to_le_bytes());
            assert_error(
                read(&mut data, &owner, &feed, published),
                MachineError::OracleWide,
            );
            assert_error(
                read(&mut data, &owner, &feed, published + 61),
                MachineError::OracleStale,
            );
        }
        data[93..101].copy_from_slice(&i64::MIN.to_le_bytes());
        assert_error(
            read(&mut data, &owner, &feed, i64::MAX),
            MachineError::OracleStale,
        );
    }
}
