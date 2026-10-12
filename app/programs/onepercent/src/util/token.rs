use crate::{constants::VAULT_AUTH_SEED, errors::MachineError};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, TokenAccount},
};
pub fn token_account(account: &AccountInfo<'_>) -> Result<TokenAccount> {
    TokenAccount::try_deserialize(&mut account.try_borrow_data()?.as_ref())
        .map_err(|_| error!(MachineError::VaultMismatch))
}
pub fn validate_vault(
    mint: &AccountInfo<'_>,
    vault: &AccountInfo<'_>,
    auth: &Pubkey,
) -> Result<TokenAccount> {
    require_keys_eq!(
        *vault.key,
        get_associated_token_address_with_program_id(auth, mint.key, mint.owner),
        MachineError::VaultMismatch
    );
    require_keys_eq!(*vault.owner, *mint.owner, MachineError::VaultMismatch);
    let state = token_account(vault)?;
    require_keys_eq!(state.mint, *mint.key, MachineError::VaultMismatch);
    require_keys_eq!(state.owner, *auth, MachineError::VaultMismatch);
    Ok(state)
}
#[allow(clippy::too_many_arguments)]
pub fn vault_transfer<'info>(
    mint: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    dest: &AccountInfo<'info>,
    auth: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    bump: u8,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    require_keys_eq!(*token_program.key, *mint.owner, MachineError::VaultMismatch);
    let bumps = [bump];
    let signer: &[&[u8]] = &[VAULT_AUTH_SEED, &bumps];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.clone(),
            token_interface::TransferChecked {
                from: vault.clone(),
                mint: mint.clone(),
                to: dest.clone(),
                authority: auth.clone(),
            },
            &[signer],
        ),
        amount,
        decimals,
    )
}
pub fn vault_burn<'info>(
    mint: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    auth: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    bump: u8,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    require_keys_eq!(*token_program.key, *mint.owner, MachineError::VaultMismatch);
    let bumps = [bump];
    let signer: &[&[u8]] = &[VAULT_AUTH_SEED, &bumps];
    let ix = anchor_spl::token_2022::spl_token_2022::instruction::burn_checked(
        token_program.key,
        vault.key,
        mint.key,
        auth.key,
        &[],
        amount,
        decimals,
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            vault.clone(),
            mint.clone(),
            auth.clone(),
            token_program.clone(),
        ],
        &[signer],
    )?;
    Ok(())
}
pub fn vault_close<'info>(
    vault: &AccountInfo<'info>,
    dest: &AccountInfo<'info>,
    auth: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    bump: u8,
) -> Result<()> {
    let bumps = [bump];
    let signer: &[&[u8]] = &[VAULT_AUTH_SEED, &bumps];
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.clone(),
        token_interface::CloseAccount {
            account: vault.clone(),
            destination: dest.clone(),
            authority: auth.clone(),
        },
        &[signer],
    ))
}

/// The executor funds only the signer's canonical input account.
pub fn validate_exec_src(
    mint: &AccountInfo<'_>,
    src: &AccountInfo<'_>,
    signer: &Pubkey,
    is_sell: bool,
) -> Result<TokenAccount> {
    let (source_mint, source_program) = if is_sell {
        (*mint.key, *mint.owner)
    } else {
        (
            crate::params::WSOL_MINT,
            crate::params::PROGRAM_IDS_SPL_TOKEN,
        )
    };
    require_keys_eq!(*src.owner, source_program, MachineError::AccountMismatch);
    require_keys_eq!(
        *src.key,
        get_associated_token_address_with_program_id(signer, &source_mint, &source_program),
        MachineError::AccountMismatch
    );
    let state = token_account(src).map_err(|_| error!(MachineError::AccountMismatch))?;
    require!(
        state.mint == source_mint
            && state.owner == *signer
            && (is_sell || state.is_native.is_some()),
        MachineError::AccountMismatch
    );
    Ok(state)
}

/// A StockSell measures only the program-controlled native destination.
pub fn validate_sol_dest(
    sol_dest: &AccountInfo<'_>,
    auth: &Pubkey,
    is_sell: bool,
) -> Result<Option<TokenAccount>> {
    if !is_sell {
        require_keys_eq!(
            *sol_dest.key,
            anchor_lang::system_program::ID,
            MachineError::AccountMismatch
        );
        return Ok(None);
    }
    require!(sol_dest.is_writable, MachineError::AccountMismatch);
    require_keys_eq!(
        *sol_dest.owner,
        crate::params::PROGRAM_IDS_SPL_TOKEN,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *sol_dest.key,
        get_associated_token_address_with_program_id(
            auth,
            &crate::params::WSOL_MINT,
            &crate::params::PROGRAM_IDS_SPL_TOKEN,
        ),
        MachineError::AccountMismatch
    );
    let state = token_account(sol_dest).map_err(|_| error!(MachineError::AccountMismatch))?;
    require!(
        state.mint == crate::params::WSOL_MINT && state.owner == *auth && state.is_native.is_some(),
        MachineError::AccountMismatch
    );
    Ok(Some(state))
}

pub fn sync_native<'info>(
    src: &AccountInfo<'info>,
    funding_account: &AccountInfo<'info>,
    signer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
) -> Result<()> {
    require_keys_eq!(
        *token_program.key,
        crate::params::PROGRAM_IDS_SPL_TOKEN,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *system_program.key,
        anchor_lang::system_program::ID,
        MachineError::AccountMismatch
    );
    // The runtime must synchronize both sides of the preceding direct lamport
    // transfer before a CPI. A zero system transfer flushes both balances while
    // leaving SyncNative's account list compatible with SPL Token and p-token,
    // whose second account is reserved for an optional Rent sysvar.
    let mut ix = anchor_lang::solana_program::system_instruction::transfer(signer.key, src.key, 0);
    ix.accounts
        .push(anchor_lang::solana_program::instruction::AccountMeta::new(
            *funding_account.key,
            false,
        ));
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            signer.clone(),
            src.clone(),
            funding_account.clone(),
            system_program.clone(),
        ],
    )?;
    anchor_spl::token::sync_native(CpiContext::new(
        token_program.clone(),
        anchor_spl::token::SyncNative {
            account: src.clone(),
        },
    ))
}
