//! Authenticated D29 prices and recorded trading reserves for executor caps.
use crate::{errors::MachineError, params, util::token::token_account};
use anchor_lang::{prelude::*, pubkey};

const DBC_DISCRIMINATOR: [u8; 8] = [0xd5, 0xe0, 0x05, 0xd1, 0x62, 0x45, 0x77, 0x5c];
const DAMM_DISCRIMINATOR: [u8; 8] = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
// The pinned IDLs' program-wide pool authorities.
const DBC_AUTHORITY: Pubkey = pubkey!("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
const DAMM_AUTHORITY: Pubkey = pubkey!("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MeteoraPrice {
    pub sqrt_price: u128,
    /// The pool's recorded liquidity reserve, distinct from vault donations.
    pub recorded_quote: u64,
    pub actual_quote: u64,
}

fn bytes<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N]> {
    data.get(offset..offset.saturating_add(N))
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| error!(MachineError::OracleInvalid))
}

fn key_at(data: &[u8], offset: usize) -> Result<Pubkey> {
    Ok(Pubkey::new_from_array(bytes(data, offset)?))
}

fn pool_address(mint: &Pubkey, config: &Pubkey, program: &Pubkey) -> Pubkey {
    let quote = params::WSOL_MINT;
    let (max, min) = if mint > &quote {
        (mint, &quote)
    } else {
        (&quote, mint)
    };
    Pubkey::find_program_address(
        &[b"pool", config.as_ref(), max.as_ref(), min.as_ref()],
        program,
    )
    .0
}

/// Fixed oracle map: DBC, DAMM-or-System, active base vault, active quote vault.
/// The instruction must pass its trusted compiled launch-config pin here.
pub fn read_price(
    mint: &Pubkey,
    dbc_config: &Pubkey,
    dbc: &AccountInfo<'_>,
    damm: &AccountInfo<'_>,
    base: &AccountInfo<'_>,
    quote: &AccountInfo<'_>,
) -> Result<MeteoraPrice> {
    read_price_with_config(mint, dbc_config, dbc, damm, base, quote)
}

fn read_price_with_config(
    mint: &Pubkey,
    dbc_config: &Pubkey,
    dbc: &AccountInfo<'_>,
    damm: &AccountInfo<'_>,
    base: &AccountInfo<'_>,
    quote: &AccountInfo<'_>,
) -> Result<MeteoraPrice> {
    require_keys_neq!(
        *dbc_config,
        Pubkey::default(),
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *dbc.owner,
        params::PROGRAM_IDS_METEORA_DBC,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *dbc.key,
        pool_address(mint, dbc_config, &params::PROGRAM_IDS_METEORA_DBC),
        MachineError::AccountMismatch
    );
    let dbc_data = dbc.try_borrow_data()?;
    require!(
        dbc_data.len() >= 424 && dbc_data.get(..8) == Some(DBC_DISCRIMINATOR.as_slice()),
        MachineError::OracleInvalid
    );
    require_keys_eq!(
        key_at(&dbc_data, 72)?,
        *dbc_config,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        key_at(&dbc_data, 136)?,
        *mint,
        MachineError::AccountMismatch
    );

    let (sqrt_price, recorded_quote, base_key, quote_key, authority) = match dbc_data.get(305) {
        Some(0) => {
            require_keys_eq!(
                *damm.key,
                anchor_lang::system_program::ID,
                MachineError::AccountMismatch
            );
            (
                u128::from_le_bytes(bytes(&dbc_data, 280)?),
                u64::from_le_bytes(bytes(&dbc_data, 240)?),
                key_at(&dbc_data, 168)?,
                key_at(&dbc_data, 200)?,
                DBC_AUTHORITY,
            )
        }
        Some(1) => {
            require_keys_eq!(
                *damm.owner,
                params::PROGRAM_IDS_METEORA_DAMM_V2,
                MachineError::AccountMismatch
            );
            require_keys_eq!(
                *damm.key,
                pool_address(
                    mint,
                    &params::METEORA_DAMM_V2_CONFIG,
                    &params::PROGRAM_IDS_METEORA_DAMM_V2
                ),
                MachineError::AccountMismatch
            );
            let data = damm.try_borrow_data()?;
            // The pinned initializer writes V1 for every fee mode. Historical V0
            // pools do not track these reserve fields and cannot supply this read.
            require!(
                data.len() >= 1112
                    && data.get(..8) == Some(DAMM_DISCRIMINATOR.as_slice())
                    && data.get(481) == Some(&0)
                    && data.get(696) == Some(&1),
                MachineError::OracleInvalid
            );
            require_keys_eq!(key_at(&data, 168)?, *mint, MachineError::AccountMismatch);
            require_keys_eq!(
                key_at(&data, 200)?,
                params::WSOL_MINT,
                MachineError::AccountMismatch
            );
            (
                u128::from_le_bytes(bytes(&data, 456)?),
                u64::from_le_bytes(bytes(&data, 688)?),
                key_at(&data, 232)?,
                key_at(&data, 264)?,
                DAMM_AUTHORITY,
            )
        }
        _ => return err!(MachineError::OracleInvalid),
    };
    require!(sqrt_price > 0, MachineError::OracleInvalid);
    require_keys_eq!(*base.key, base_key, MachineError::AccountMismatch);
    require_keys_eq!(*quote.key, quote_key, MachineError::AccountMismatch);
    require_keys_eq!(
        *base.owner,
        params::PROGRAM_IDS_SPL_TOKEN,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *quote.owner,
        params::PROGRAM_IDS_SPL_TOKEN,
        MachineError::AccountMismatch
    );
    let base_state = token_account(base).map_err(|_| error!(MachineError::OracleInvalid))?;
    let quote_state = token_account(quote).map_err(|_| error!(MachineError::OracleInvalid))?;
    require_keys_eq!(base_state.mint, *mint, MachineError::AccountMismatch);
    require_keys_eq!(
        quote_state.mint,
        params::WSOL_MINT,
        MachineError::AccountMismatch
    );
    require_keys_eq!(base_state.owner, authority, MachineError::AccountMismatch);
    require_keys_eq!(quote_state.owner, authority, MachineError::AccountMismatch);
    require!(quote_state.is_native.is_some(), MachineError::OracleInvalid);
    Ok(MeteoraPrice {
        sqrt_price,
        recorded_quote,
        actual_quote: quote_state.amount,
    })
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

    struct Captured {
        key: Pubkey,
        owner: Pubkey,
        lamports: u64,
        data: Vec<u8>,
    }

    impl Captured {
        fn from_json(json: &str) -> Self {
            let value: serde_json::Value = serde_json::from_str(json).unwrap();
            Self {
                key: Pubkey::from_str(value["pubkey"].as_str().unwrap()).unwrap(),
                owner: Pubkey::from_str(value["account"]["owner"].as_str().unwrap()).unwrap(),
                lamports: value["account"]["lamports"].as_u64().unwrap(),
                data: STANDARD
                    .decode(value["account"]["data"][0].as_str().unwrap())
                    .unwrap(),
            }
        }

        fn info(&mut self) -> AccountInfo<'_> {
            AccountInfo::new(
                &self.key,
                false,
                false,
                &mut self.lamports,
                &mut self.data,
                &self.owner,
                false,
                0,
            )
        }
    }

    struct Scenario {
        mint: Pubkey,
        config: Pubkey,
        dbc: Captured,
        damm: Captured,
        base: Captured,
        quote: Captured,
    }

    impl Scenario {
        fn new(migrated: bool) -> Self {
            let dbc = Captured::from_json(if migrated {
                include_str!("../../../../fixtures/meteora/accounts/dbc-migrated.json")
            } else {
                include_str!("../../../../fixtures/meteora/accounts/dbc-active.json")
            });
            let damm = if migrated {
                Captured::from_json(include_str!(
                    "../../../../fixtures/meteora/accounts/damm-migrated.json"
                ))
            } else {
                Captured {
                    key: anchor_lang::system_program::ID,
                    owner: anchor_lang::system_program::ID,
                    lamports: 1,
                    data: Vec::new(),
                }
            };
            let base = Captured::from_json(if migrated {
                include_str!("../../../../fixtures/meteora/accounts/damm-migrated-base-vault.json")
            } else {
                include_str!("../../../../fixtures/meteora/accounts/dbc-active-base-vault.json")
            });
            let quote = Captured::from_json(if migrated {
                include_str!("../../../../fixtures/meteora/accounts/damm-migrated-quote-vault.json")
            } else {
                include_str!("../../../../fixtures/meteora/accounts/dbc-active-quote-vault.json")
            });
            Self {
                mint: key_at(&dbc.data, 136).unwrap(),
                config: key_at(&dbc.data, 72).unwrap(),
                dbc,
                damm,
                base,
                quote,
            }
        }

        fn read(&mut self) -> Result<MeteoraPrice> {
            read_price_with_config(
                &self.mint,
                &self.config,
                &self.dbc.info(),
                &self.damm.info(),
                &self.base.info(),
                &self.quote.info(),
            )
        }
    }

    fn assert_error(result: Result<MeteoraPrice>, expected: MachineError) {
        let Error::AnchorError(actual) = result.unwrap_err() else {
            panic!("expected a machine error");
        };
        assert_eq!(actual.error_code_number, u32::from(expected));
    }

    #[test]
    fn captures_authenticate_dbc_and_damm_prices_and_distinct_reserves() {
        assert_eq!(
            Scenario::new(false).read().unwrap(),
            MeteoraPrice {
                sqrt_price: 128_794_468_968_736_475,
                recorded_quote: 11_718_439_597,
                actual_quote: 18_919_831_183,
            }
        );
        assert_eq!(
            Scenario::new(true).read().unwrap(),
            MeteoraPrice {
                sqrt_price: 125_545_362_027_818_175,
                recorded_quote: 173_933_382_992,
                actual_quote: 174_079_781_792,
            }
        );
        // A pool belonging to another config cannot substitute for the trusted pin.
        let mut fixture = Scenario::new(false);
        assert_error(
            read_price(
                &fixture.mint,
                &Pubkey::new_unique(),
                &fixture.dbc.info(),
                &fixture.damm.info(),
                &fixture.base.info(),
                &fixture.quote.info(),
            ),
            MachineError::AccountMismatch,
        );
    }

    #[test]
    fn recorded_reserve_check_values_exclude_fees_and_donations() {
        for (migrated, burn_cap, jackpot_cap) in [
            (false, 29_296_098, 117_184_395),
            (true, 434_833_457, 1_739_333_829),
        ] {
            let mut scenario = Scenario::new(migrated);
            let before = scenario.read().unwrap();
            assert_eq!(
                crate::math::exec::reserve_tranche(
                    u128::from(before.recorded_quote),
                    params::BURN_TRANCHE_MAX_BPS_OF_QUOTE_RESERVES
                )
                .unwrap(),
                burn_cap,
            );
            assert_eq!(
                crate::math::exec::reserve_tranche(
                    u128::from(before.recorded_quote),
                    params::JACKPOT_TRANCHE_MAX_BPS_OF_QUOTE_RESERVES
                )
                .unwrap(),
                jackpot_cap,
            );
            scenario.quote.data[64..72]
                .copy_from_slice(&(before.actual_quote + 10_000_000_000).to_le_bytes());
            let after = scenario.read().unwrap();
            assert_eq!(after.recorded_quote, before.recorded_quote);
            assert_eq!(after.sqrt_price, before.sqrt_price);
            assert_eq!(after.actual_quote, before.actual_quote + 10_000_000_000);
        }
    }

    #[test]
    fn only_the_selected_canonical_pool_is_accepted() {
        for migrated in [false, true] {
            for mutate in [
                (|s: &mut Scenario| s.dbc.key = Pubkey::new_unique()) as fn(&mut Scenario),
                |s| s.dbc.owner = Pubkey::new_unique(),
                |s| s.config = Pubkey::new_unique(),
                |s| s.mint = Pubkey::new_unique(),
                |s| s.dbc.data[72..104].fill(7),
                |s| s.dbc.data[136..168].fill(7),
                |s| s.damm.key = Pubkey::new_unique(),
            ] {
                let mut scenario = Scenario::new(migrated);
                mutate(&mut scenario);
                assert_error(scenario.read(), MachineError::AccountMismatch);
            }
        }
        for mutate in [
            (|s: &mut Scenario| s.damm.owner = Pubkey::new_unique()) as fn(&mut Scenario),
            |s| s.damm.data[168..200].fill(7),
            |s| s.damm.data[200..232].fill(7),
        ] {
            let mut scenario = Scenario::new(true);
            mutate(&mut scenario);
            assert_error(scenario.read(), MachineError::AccountMismatch);
        }
    }

    #[test]
    fn vault_addresses_program_owners_mints_and_authorities_are_bound() {
        for migrated in [false, true] {
            for mutate in [
                (|s: &mut Scenario| s.base.key = Pubkey::new_unique()) as fn(&mut Scenario),
                |s| s.quote.key = Pubkey::new_unique(),
                |s| s.base.owner = Pubkey::new_unique(),
                |s| s.quote.owner = Pubkey::new_unique(),
                |s| s.base.data[..32].fill(7),
                |s| s.quote.data[..32].fill(7),
                |s| s.base.data[32..64].fill(7),
                |s| s.quote.data[32..64].fill(7),
            ] {
                let mut scenario = Scenario::new(migrated);
                mutate(&mut scenario);
                assert_error(scenario.read(), MachineError::AccountMismatch);
            }
            let mut malformed = Scenario::new(migrated);
            malformed.quote.data.truncate(64);
            assert_error(malformed.read(), MachineError::OracleInvalid);
            let mut non_native = Scenario::new(migrated);
            non_native.quote.data[109..113].fill(0);
            assert_error(non_native.read(), MachineError::OracleInvalid);
        }
    }

    #[test]
    fn migrated_flag_requires_the_damm_pool_and_ignores_old_dbc_price() {
        let mut migrated = Scenario::new(true);
        let expected = migrated.read().unwrap();
        migrated.dbc.data[240..248].fill(0);
        migrated.dbc.data[280..296].fill(0);
        assert_eq!(migrated.read().unwrap(), expected);
        migrated.damm.key = anchor_lang::system_program::ID;
        assert_error(migrated.read(), MachineError::AccountMismatch);
        let mut active = Scenario::new(false);
        active.dbc.data[305] = 1;
        assert_error(active.read(), MachineError::AccountMismatch);
    }

    #[test]
    fn malformed_layouts_migration_flags_and_prices_fail_closed() {
        for migrated in [false, true] {
            for mutate in [
                (|s: &mut Scenario| s.dbc.data.truncate(423)) as fn(&mut Scenario),
                |s| s.dbc.data[0] ^= 1,
                |s| s.dbc.data[305] = 2,
            ] {
                let mut scenario = Scenario::new(migrated);
                mutate(&mut scenario);
                assert_error(scenario.read(), MachineError::OracleInvalid);
            }
        }
        let mut active = Scenario::new(false);
        active.dbc.data[280..296].fill(0);
        assert_error(active.read(), MachineError::OracleInvalid);
        for mutate in [
            (|s: &mut Scenario| s.damm.data.truncate(1111)) as fn(&mut Scenario),
            |s| s.damm.data[0] ^= 1,
            |s| s.damm.data[456..472].fill(0),
            |s| s.damm.data[481] = 1,
            |s| s.damm.data[696] = 0,
            |s| s.damm.data[696] = 2,
        ] {
            let mut scenario = Scenario::new(true);
            mutate(&mut scenario);
            assert_error(scenario.read(), MachineError::OracleInvalid);
        }
    }
}
