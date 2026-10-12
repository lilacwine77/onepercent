use crate::{constants::*, errors::MachineError, params};
use anchor_lang::prelude::*;

pub fn launch_pool(
    mint: &Pubkey,
    pool: &AccountInfo<'_>,
    config: &AccountInfo<'_>,
    fee_in: &Pubkey,
) -> Result<()> {
    validate_launch_pool(pool, mint)?;
    validate_dbc_config(config, fee_in)
}

pub fn dbc_pool_address(mint: &Pubkey, config: &Pubkey) -> Pubkey {
    let quote = params::WSOL_MINT;
    let (max_mint, min_mint) = if mint > &quote {
        (mint, &quote)
    } else {
        (&quote, mint)
    };
    Pubkey::find_program_address(
        &[
            b"pool",
            config.as_ref(),
            max_mint.as_ref(),
            min_mint.as_ref(),
        ],
        &params::PROGRAM_IDS_METEORA_DBC,
    )
    .0
}

pub fn validate_launch_pool(pool: &AccountInfo<'_>, mint: &Pubkey) -> Result<()> {
    require_keys_eq!(
        *pool.owner,
        params::PROGRAM_IDS_METEORA_DBC,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *pool.key,
        dbc_pool_address(mint, &params::METEORA_DBC_CONFIG),
        MachineError::AccountMismatch
    );
    launch_pool_data(&pool.try_borrow_data()?, mint, &params::METEORA_DBC_CONFIG)
}

pub fn validate_dbc_config(config: &AccountInfo<'_>, fee_in: &Pubkey) -> Result<()> {
    require_keys_eq!(
        *config.owner,
        params::PROGRAM_IDS_METEORA_DBC,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *config.key,
        params::METEORA_DBC_CONFIG,
        MachineError::AccountMismatch
    );
    dbc_config_data(&config.try_borrow_data()?, fee_in)
}

pub fn launch_pool_data(data: &[u8], mint: &Pubkey, config: &Pubkey) -> Result<()> {
    require!(
        data.len() >= DBC_POOL_MIN_LEN
            && data.get(..8) == Some(DBC_POOL_DISCRIMINATOR.as_slice())
            && data.get(DBC_POOL_BASE_MINT_OFFSET..DBC_POOL_BASE_MINT_OFFSET + 32)
                == Some(mint.as_ref())
            && data.get(DBC_POOL_CONFIG_OFFSET..DBC_POOL_CONFIG_OFFSET + 32)
                == Some(config.as_ref()),
        MachineError::NotLaunchCurve
    );
    Ok(())
}

pub fn dbc_config_data(data: &[u8], fee_in: &Pubkey) -> Result<()> {
    // D29 §3.1 deliberately limits this gate to identity and fee destination.
    // TODO(architect): launch check must verify the exact curve and migration
    // settings recorded by the launch track in PARAMS before mainnet release.
    require!(
        data.len() >= DBC_CONFIG_MIN_LEN
            && data.get(..8) == Some(DBC_CONFIG_DISCRIMINATOR.as_slice())
            && data.get(DBC_CONFIG_QUOTE_MINT_OFFSET..DBC_CONFIG_QUOTE_MINT_OFFSET + 32)
                == Some(params::WSOL_MINT.as_ref())
            && data.get(DBC_CONFIG_FEE_CLAIMER_OFFSET..DBC_CONFIG_FEE_CLAIMER_OFFSET + 32)
                == Some(fee_in.as_ref())
            && data.get(DBC_CONFIG_CREATOR_TRADING_FEE_PERCENTAGE_OFFSET) == Some(&0),
        MachineError::NotLaunchCurve
    );
    Ok(())
}
