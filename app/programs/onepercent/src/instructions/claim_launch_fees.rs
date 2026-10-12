#![deny(clippy::arithmetic_side_effects)]
use crate::{
    checks::{validate_dbc_config, validate_launch_pool},
    constants::{EXEC_KIND_NONE, FEE_IN_SEED, MACHINE_SEED},
    errors::MachineError,
    events::LaunchFeesClaimed,
    params,
    state::Machine,
    util::address_with_bump,
};
use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
        program_option::COption,
        program_pack::Pack,
    },
    system_program,
};
use anchor_spl::{
    associated_token::{self, get_associated_token_address_with_program_id, AssociatedToken},
    token::{self, spl_token::state::Account as SplAccount, Token},
    token_2022::spl_token_2022::{self, extension::StateWithExtensions},
};

// Discriminators and account orders are pinned in fixtures/meteora/*.json.
const CLAIM_TRADING_FEE: [u8; 8] = [8, 236, 89, 49, 152, 125, 177, 81];
const CLAIM_POSITION_FEE: [u8; 8] = [180, 38, 154, 17, 133, 33, 162, 211];
pub const DAMM_POOL_MIN_LEN: usize = 1112;
pub const DAMM_POOL_BASE_MINT_OFFSET: usize = 168;
pub const DAMM_POOL_QUOTE_MINT_OFFSET: usize = 200;
pub const DAMM_POOL_BASE_VAULT_OFFSET: usize = 232;
pub const DAMM_POOL_QUOTE_VAULT_OFFSET: usize = 264;
pub const DAMM_POSITION_MIN_LEN: usize = 408;
pub const DAMM_POSITION_POOL_OFFSET: usize = 8;
pub const DAMM_POSITION_NFT_MINT_OFFSET: usize = 40;
pub const DAMM_POOL_DISCRIMINATOR: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];
pub const DAMM_POSITION_DISCRIMINATOR: [u8; 8] = [170, 188, 143, 228, 122, 64, 247, 208];
const PARTNER_WITHDRAW_SURPLUS: [u8; 8] = [168, 173, 72, 100, 201, 98, 38, 92];
const BASE_VAULT_OFFSET: usize = 168;
const QUOTE_VAULT_OFFSET: usize = 200;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchFeeKind {
    Curve,
    Pool,
    Surplus,
}

/// Fixed account slots for every kind. Position slots use program-id sentinels
/// for Curve/Surplus; Surplus also omits the base ATA. No trailing accounts.
#[derive(Accounts)]
pub struct ClaimLaunchFees<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds=[MACHINE_SEED], bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    /// CHECK: Stored-bump PDA, empty System account, checked in the handler.
    #[account(mut)]
    pub fee_in: UncheckedAccount<'info>,
    /// CHECK: Canonical native SPL ATA, created idempotently and checked below.
    #[account(mut)]
    pub fee_in_wsol: UncheckedAccount<'info>,
    /// CHECK: Pinned venue owner, PDA and fields checked before signing any CPI.
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: Pinned DBC config, owner and fields checked in the handler.
    pub dbc_config: UncheckedAccount<'info>,
    /// CHECK: The launched SPL mint stored in Machine, validated before CPI.
    pub base_mint: UncheckedAccount<'info>,
    /// CHECK: Pool's exact base vault, validated before CPI.
    #[account(mut)]
    pub base_vault: UncheckedAccount<'info>,
    /// CHECK: Pool's exact native SPL quote vault, validated before CPI.
    #[account(mut)]
    pub quote_vault: UncheckedAccount<'info>,
    /// CHECK: Native SPL mint, checked in the handler.
    pub quote_mint: UncheckedAccount<'info>,
    /// CHECK: Venue's canonical pool-authority PDA, checked before CPI.
    pub pool_authority: UncheckedAccount<'info>,
    /// CHECK: Venue's canonical event-authority PDA, checked before CPI.
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: Exact executable venue program, checked before CPI.
    pub venue_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: DAMM position, its pool and NFT mint are checked before CPI.
    #[account(mut)]
    pub position: Option<UncheckedAccount<'info>>,
    /// CHECK: Never writable, transferred, closed or delegated by this program.
    pub position_nft_account: Option<UncheckedAccount<'info>>,
    /// CHECK: Canonical FeeIn base ATA, created for Curve/Pool and never debited.
    #[account(mut)]
    pub fee_in_base: Option<UncheckedAccount<'info>>,
}

pub fn handler(ctx: Context<ClaimLaunchFees>, kind: LaunchFeeKind) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    if kind != LaunchFeeKind::Pool {
        require!(
            ctx.accounts.position.is_none() && ctx.accounts.position_nft_account.is_none(),
            MachineError::AccountMismatch
        );
    }
    if kind == LaunchFeeKind::Surplus {
        require!(
            ctx.accounts.fee_in_base.is_none(),
            MachineError::AccountMismatch
        );
    }
    let machine = ctx.accounts.machine.load()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    let mint = machine.token_mint;
    let bump = [machine.fee_in_bump];
    drop(machine);
    let seeds: &[&[u8]] = &[FEE_IN_SEED, &bump];
    address_with_bump(&ctx.accounts.fee_in.to_account_info(), seeds)?;
    require!(
        *ctx.accounts.fee_in.owner == system_program::ID && ctx.accounts.fee_in.data_is_empty(),
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        ctx.accounts.base_mint.key(),
        mint,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *ctx.accounts.base_mint.owner,
        token::ID,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        ctx.accounts.quote_mint.key(),
        params::WSOL_MINT,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *ctx.accounts.quote_mint.owner,
        token::ID,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        ctx.accounts.venue_program.key(),
        if kind == LaunchFeeKind::Pool {
            params::PROGRAM_IDS_METEORA_DAMM_V2
        } else {
            params::PROGRAM_IDS_METEORA_DBC
        },
        MachineError::AccountMismatch
    );
    require!(
        ctx.accounts.venue_program.executable,
        MachineError::AccountMismatch
    );
    if kind == LaunchFeeKind::Pool {
        validate_damm(ctx.accounts)?;
    } else {
        validate_launch_pool(&ctx.accounts.pool.to_account_info(), &mint)?;
        validate_dbc_config(
            &ctx.accounts.dbc_config.to_account_info(),
            &ctx.accounts.fee_in.key(),
        )?;
    }
    let venue = ctx.accounts.venue_program.key();
    require_keys_eq!(
        ctx.accounts.pool_authority.key(),
        Pubkey::find_program_address(&[b"pool_authority"], &venue).0,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        ctx.accounts.event_authority.key(),
        Pubkey::find_program_address(&[b"__event_authority"], &venue).0,
        MachineError::AccountMismatch
    );
    let pool_data = ctx.accounts.pool.try_borrow_data()?;
    let (base_offset, quote_offset) = if kind == LaunchFeeKind::Pool {
        (DAMM_POOL_BASE_VAULT_OFFSET, DAMM_POOL_QUOTE_VAULT_OFFSET)
    } else {
        (BASE_VAULT_OFFSET, QUOTE_VAULT_OFFSET)
    };
    for (offset, account) in [
        (base_offset, &ctx.accounts.base_vault),
        (quote_offset, &ctx.accounts.quote_vault),
    ] {
        require!(
            pool_data.get(offset..offset.saturating_add(32)) == Some(account.key().as_ref()),
            MachineError::AccountMismatch
        );
    }
    drop(pool_data);
    validate_token(
        &ctx.accounts.base_vault,
        &mint,
        &ctx.accounts.pool_authority.key(),
        false,
    )?;
    validate_token(
        &ctx.accounts.quote_vault,
        &params::WSOL_MINT,
        &ctx.accounts.pool_authority.key(),
        true,
    )?;
    require_keys_eq!(
        ctx.accounts.fee_in_wsol.key(),
        get_associated_token_address_with_program_id(
            &ctx.accounts.fee_in.key(),
            &params::WSOL_MINT,
            &token::ID
        ),
        MachineError::AccountMismatch
    );
    associated_token::create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        associated_token::Create {
            payer: ctx.accounts.payer.to_account_info(),
            associated_token: ctx.accounts.fee_in_wsol.to_account_info(),
            authority: ctx.accounts.fee_in.to_account_info(),
            mint: ctx.accounts.quote_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;
    let before = validate_token(
        &ctx.accounts.fee_in_wsol,
        &params::WSOL_MINT,
        &ctx.accounts.fee_in.key(),
        true,
    )?;
    let base_before = if kind != LaunchFeeKind::Surplus {
        let destination = ctx
            .accounts
            .fee_in_base
            .as_ref()
            .ok_or(MachineError::AccountMismatch)?;
        require_keys_eq!(
            destination.key(),
            get_associated_token_address_with_program_id(
                &ctx.accounts.fee_in.key(),
                &mint,
                &token::ID
            ),
            MachineError::AccountMismatch
        );
        associated_token::create_idempotent(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            associated_token::Create {
                payer: ctx.accounts.payer.to_account_info(),
                associated_token: destination.to_account_info(),
                authority: ctx.accounts.fee_in.to_account_info(),
                mint: ctx.accounts.base_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
        validate_token(destination, &mint, &ctx.accounts.fee_in.key(), false)?
    } else {
        0
    };
    let (data, infos) = match kind {
        LaunchFeeKind::Curve => {
            let mut data = CLAIM_TRADING_FEE.to_vec();
            data.extend_from_slice(&0u64.to_le_bytes());
            data.extend_from_slice(&u64::MAX.to_le_bytes());
            // DBC computes min(partner_base_fee, max_base_amount). With zero,
            // it neither transfers base tokens nor reduces the base accrual.
            // A distinct canonical destination still satisfies the venue ABI.
            (
                data,
                vec![
                    ctx.accounts.pool_authority.to_account_info(),
                    ctx.accounts.dbc_config.to_account_info(),
                    ctx.accounts.pool.to_account_info(),
                    ctx.accounts
                        .fee_in_base
                        .as_ref()
                        .ok_or(MachineError::AccountMismatch)?
                        .to_account_info(),
                    ctx.accounts.fee_in_wsol.to_account_info(),
                    ctx.accounts.base_vault.to_account_info(),
                    ctx.accounts.quote_vault.to_account_info(),
                    ctx.accounts.base_mint.to_account_info(),
                    ctx.accounts.quote_mint.to_account_info(),
                    ctx.accounts.fee_in.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.event_authority.to_account_info(),
                    ctx.accounts.venue_program.to_account_info(),
                ],
            )
        }
        LaunchFeeKind::Surplus => (
            PARTNER_WITHDRAW_SURPLUS.to_vec(),
            vec![
                ctx.accounts.pool_authority.to_account_info(),
                ctx.accounts.dbc_config.to_account_info(),
                ctx.accounts.pool.to_account_info(),
                ctx.accounts.fee_in_wsol.to_account_info(),
                ctx.accounts.quote_vault.to_account_info(),
                ctx.accounts.quote_mint.to_account_info(),
                ctx.accounts.fee_in.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.event_authority.to_account_info(),
                ctx.accounts.venue_program.to_account_info(),
            ],
        ),
        LaunchFeeKind::Pool => (
            CLAIM_POSITION_FEE.to_vec(),
            vec![
                ctx.accounts.pool_authority.to_account_info(),
                ctx.accounts.pool.to_account_info(),
                ctx.accounts
                    .position
                    .as_ref()
                    .ok_or(MachineError::AccountMismatch)?
                    .to_account_info(),
                ctx.accounts
                    .fee_in_base
                    .as_ref()
                    .ok_or(MachineError::AccountMismatch)?
                    .to_account_info(),
                ctx.accounts.fee_in_wsol.to_account_info(),
                ctx.accounts.base_vault.to_account_info(),
                ctx.accounts.quote_vault.to_account_info(),
                ctx.accounts.base_mint.to_account_info(),
                ctx.accounts.quote_mint.to_account_info(),
                ctx.accounts
                    .position_nft_account
                    .as_ref()
                    .ok_or(MachineError::AccountMismatch)?
                    .to_account_info(),
                ctx.accounts.fee_in.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.event_authority.to_account_info(),
                ctx.accounts.venue_program.to_account_info(),
            ],
        ),
    };
    let writable: &[usize] = if kind != LaunchFeeKind::Surplus {
        &[2, 3, 4, 5, 6]
    } else {
        &[2, 3, 4]
    };
    let accounts = infos
        .iter()
        .enumerate()
        .map(|(index, account)| {
            let signer = account.key == ctx.accounts.fee_in.key;
            if writable.contains(&index) {
                AccountMeta::new(*account.key, signer)
            } else {
                AccountMeta::new_readonly(*account.key, signer)
            }
        })
        .collect();
    invoke_signed(
        &Instruction {
            program_id: venue,
            accounts,
            data,
        },
        &infos,
        &[seeds],
    )?;
    let after = validate_token(
        &ctx.accounts.fee_in_wsol,
        &params::WSOL_MINT,
        &ctx.accounts.fee_in.key(),
        true,
    )?;
    let unwrapped_lamports = ctx.accounts.fee_in_wsol.lamports();
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.fee_in_wsol.to_account_info(),
            destination: ctx.accounts.fee_in.to_account_info(),
            authority: ctx.accounts.fee_in.to_account_info(),
        },
        &[seeds],
    ))?;
    let base = if let Some(destination) = &ctx.accounts.fee_in_base {
        validate_token(destination, &mint, &ctx.accounts.fee_in.key(), false)?
            .saturating_sub(base_before)
    } else {
        0
    };
    emit!(LaunchFeesClaimed {
        kind: kind as u8,
        pool: ctx.accounts.pool.key(),
        quote: after.saturating_sub(before),
        base,
        unwrapped_lamports,
        ts: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

fn validate_token(
    account: &AccountInfo<'_>,
    mint: &Pubkey,
    owner: &Pubkey,
    native: bool,
) -> Result<u64> {
    require_keys_eq!(*account.owner, token::ID, MachineError::AccountMismatch);
    let token = SplAccount::unpack(&account.try_borrow_data()?)
        .map_err(|_| error!(MachineError::AccountMismatch))?;
    require!(
        token.mint == *mint && token.owner == *owner,
        MachineError::AccountMismatch
    );
    if native {
        require!(
            matches!(token.is_native, COption::Some(_)),
            MachineError::AccountMismatch
        );
    }
    Ok(token.amount)
}

// DAMM offsets include the discriminator and are pinned against its raw IDL.
fn validate_damm(accounts: &ClaimLaunchFees<'_>) -> Result<()> {
    require_keys_eq!(
        *accounts.pool.owner,
        params::PROGRAM_IDS_METEORA_DAMM_V2,
        MachineError::AccountMismatch
    );
    // This unused DBC slot stays pinned, keeping every kind's account list fixed.
    require_keys_eq!(
        accounts.dbc_config.key(),
        params::METEORA_DBC_CONFIG,
        MachineError::AccountMismatch
    );
    let pool = accounts.pool.try_borrow_data()?;
    require!(
        pool.len() >= DAMM_POOL_MIN_LEN
            && pool.get(..8) == Some(DAMM_POOL_DISCRIMINATOR.as_slice())
            && pool.get(DAMM_POOL_BASE_MINT_OFFSET..DAMM_POOL_BASE_MINT_OFFSET.saturating_add(32))
                == Some(accounts.base_mint.key().as_ref())
            && pool
                .get(DAMM_POOL_QUOTE_MINT_OFFSET..DAMM_POOL_QUOTE_MINT_OFFSET.saturating_add(32))
                == Some(params::WSOL_MINT.as_ref()),
        MachineError::AccountMismatch
    );
    drop(pool);
    let position = accounts
        .position
        .as_ref()
        .ok_or(MachineError::AccountMismatch)?;
    let nft = accounts
        .position_nft_account
        .as_ref()
        .ok_or(MachineError::AccountMismatch)?;
    require_keys_eq!(
        *position.owner,
        params::PROGRAM_IDS_METEORA_DAMM_V2,
        MachineError::AccountMismatch
    );
    let position_data = position.try_borrow_data()?;
    require!(
        position_data.len() >= DAMM_POSITION_MIN_LEN
            && position_data.get(..8) == Some(DAMM_POSITION_DISCRIMINATOR.as_slice())
            && position_data
                .get(DAMM_POSITION_POOL_OFFSET..DAMM_POSITION_POOL_OFFSET.saturating_add(32))
                == Some(accounts.pool.key().as_ref()),
        MachineError::AccountMismatch
    );
    let nft_data = nft.try_borrow_data()?;
    let (nft_mint, nft_owner, nft_amount) = if *nft.owner == token::ID {
        let state =
            SplAccount::unpack(&nft_data).map_err(|_| error!(MachineError::AccountMismatch))?;
        (state.mint, state.owner, state.amount)
    } else {
        require_keys_eq!(
            *nft.owner,
            spl_token_2022::ID,
            MachineError::AccountMismatch
        );
        let state = StateWithExtensions::<spl_token_2022::state::Account>::unpack(&nft_data)
            .map_err(|_| error!(MachineError::AccountMismatch))?;
        (state.base.mint, state.base.owner, state.base.amount)
    };
    require!(
        position_data
            .get(DAMM_POSITION_NFT_MINT_OFFSET..DAMM_POSITION_NFT_MINT_OFFSET.saturating_add(32))
            == Some(nft_mint.as_ref())
            && nft_owner == accounts.fee_in.key()
            && nft_amount == 1,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        position.key(),
        Pubkey::find_program_address(
            &[b"position", nft_mint.as_ref()],
            &params::PROGRAM_IDS_METEORA_DAMM_V2
        )
        .0,
        MachineError::AccountMismatch
    );
    Ok(())
}
