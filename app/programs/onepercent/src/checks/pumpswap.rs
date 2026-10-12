//! Validate the canonical SOL pool and read signed effective quote reserves.
use crate::{
    constants::*, errors::MachineError, math::exec::PoolReserves, params,
    util::token::token_account,
};
use anchor_lang::prelude::*;

fn oracle_bytes<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N]> {
    let end = offset.checked_add(N).ok_or(MachineError::MathOverflow)?;
    data.get(offset..end)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| error!(MachineError::OracleInvalid))
}

pub fn read_pool(
    mint: &Pubkey,
    pool: &AccountInfo<'_>,
    base: &AccountInfo<'_>,
    quote: &AccountInfo<'_>,
) -> Result<PoolReserves> {
    require_keys_eq!(
        *pool.owner,
        params::PROGRAM_IDS_PUMP_SWAP,
        MachineError::OracleInvalid
    );
    let authority = Pubkey::find_program_address(
        &[POOL_AUTHORITY_SEED, mint.as_ref()],
        &params::PROGRAM_IDS_PUMP_FUN,
    )
    .0;
    require_keys_eq!(
        *pool.key,
        Pubkey::find_program_address(
            &[
                params::PUMP_LAYOUTS_POOL_SEED,
                &0u16.to_le_bytes(),
                authority.as_ref(),
                mint.as_ref(),
                params::WSOL_MINT.as_ref(),
            ],
            &params::PROGRAM_IDS_PUMP_SWAP,
        )
        .0,
        MachineError::OracleInvalid
    );
    let data = pool.try_borrow_data()?;
    require!(
        data.len() >= PUMPSWAP_POOL_MIN_LEN
            && data.get(..8) == Some(PUMPSWAP_POOL_DISCRIMINATOR.as_slice())
            && u16::from_le_bytes(oracle_bytes(&data, PUMPSWAP_POOL_INDEX_OFFSET)?) == 0
            && Pubkey::new_from_array(oracle_bytes(&data, PUMPSWAP_POOL_BASE_MINT_OFFSET)?)
                == *mint
            && Pubkey::new_from_array(oracle_bytes(&data, PUMPSWAP_POOL_QUOTE_MINT_OFFSET)?)
                == params::WSOL_MINT
            && Pubkey::new_from_array(oracle_bytes(&data, PUMPSWAP_POOL_BASE_VAULT_OFFSET)?)
                == *base.key
            && Pubkey::new_from_array(oracle_bytes(&data, PUMPSWAP_POOL_QUOTE_VAULT_OFFSET)?)
                == *quote.key
            && data.get(PUMPSWAP_POOL_IS_MAYHEM_MODE_OFFSET) == Some(&0),
        MachineError::OracleInvalid
    );
    require!(
        *base.owner == params::PROGRAM_IDS_SPL_TOKEN
            || *base.owner == params::PROGRAM_IDS_TOKEN2022,
        MachineError::OracleInvalid
    );
    require_keys_eq!(
        *quote.owner,
        params::PROGRAM_IDS_SPL_TOKEN,
        MachineError::OracleInvalid
    );
    let base_state = token_account(base).map_err(|_| error!(MachineError::OracleInvalid))?;
    let quote_state = token_account(quote).map_err(|_| error!(MachineError::OracleInvalid))?;
    require!(
        base_state.mint == *mint
            && quote_state.mint == params::WSOL_MINT
            && base_state.owner == *pool.key
            && quote_state.owner == *pool.key,
        MachineError::OracleInvalid
    );
    let virtual_quote = i128::from_le_bytes(oracle_bytes(
        &data,
        PUMPSWAP_POOL_VIRTUAL_QUOTE_RESERVES_OFFSET,
    )?);
    let quote_eff = i128::from(quote_state.amount)
        .checked_add(virtual_quote)
        .ok_or(MachineError::MathOverflow)?;
    require!(quote_eff > 0, MachineError::OracleInvalid);
    Ok(PoolReserves {
        base: base_state.amount,
        quote: quote_state.amount,
        quote_eff: u128::try_from(quote_eff).map_err(|_| error!(MachineError::MathOverflow))?,
    })
}
