use crate::{
    checks::{launch_pool, mint_is_safe, top_level},
    constants::*,
    errors::MachineError,
    events::PoweredOn,
    params,
    state::{views::header_mut, *},
    util::*,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenInterface;

#[derive(Accounts)]
pub struct PowerOn<'info> {
    #[account(mut)]
    pub launch_wallet: Signer<'info>,
    #[account(seeds=[CONFIG_SEED], bump=config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, seeds=[MACHINE_SEED], bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    /// CHECK: Config identity, mint safety and decimals checked in the handler.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: DBC pool identity and launch fields checked in the handler.
    pub launch_pool: UncheckedAccount<'info>,
    /// CHECK: Pinned DBC config identity and fee destinations checked in the handler.
    pub dbc_config: UncheckedAccount<'info>,
    /// CHECK: Stored-bump PDA, System owner and empty data checked in the handler.
    #[account(mut)]
    pub fee_in: UncheckedAccount<'info>,
    /// CHECK: Created donation-safely or validated by ensure_ledger.
    #[account(mut)]
    pub ledger: UncheckedAccount<'info>,
    /// CHECK: Canonical vault and token ownership checked in the handler.
    pub vault: UncheckedAccount<'info>,
    /// CHECK: Stored-bump signer PDA only.
    #[account(seeds=[VAULT_AUTH_SEED], bump=machine.load()?.vault_auth_bump)]
    pub vault_auth: UncheckedAccount<'info>,
    #[account(address=*mint.owner @ MachineError::AccountMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<PowerOn>) -> Result<()> {
    top_level()?;
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let config = ctx.accounts.config.load()?;
    require!(
        config.launch_wallet != Pubkey::default()
            && config.launch_wallet == ctx.accounts.launch_wallet.key(),
        MachineError::Unauthorized
    );
    let mut machine = ctx.accounts.machine.load_mut()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    require!(
        machine.phase == PHASE_STOCK_UP && machine.power_on_ts == 0,
        MachineError::WrongPhase
    );
    let mint = ctx.accounts.mint.key();
    require!(
        config.token_mint != Pubkey::default() && config.token_mint == mint,
        MachineError::AccountMismatch
    );
    require_keys_eq!(
        *ctx.accounts.mint.owner,
        params::PROGRAM_IDS_SPL_TOKEN,
        MachineError::AccountMismatch
    );
    let (decimals, _) = mint_is_safe(&ctx.accounts.mint.to_account_info())?;
    require!(
        u32::from(decimals) == params::TOKEN_1PCT_DECIMALS,
        MachineError::MintNotSafe
    );
    launch_pool(
        &mint,
        &ctx.accounts.launch_pool.to_account_info(),
        &ctx.accounts.dbc_config.to_account_info(),
        &ctx.accounts.fee_in.key(),
    )?;
    address_with_bump(
        &ctx.accounts.fee_in.to_account_info(),
        &[FEE_IN_SEED, &[machine.fee_in_bump]],
    )?;
    require!(
        *ctx.accounts.fee_in.owner == anchor_lang::system_program::ID
            && ctx.accounts.fee_in.data_is_empty(),
        MachineError::AccountMismatch
    );
    ensure_ledger(
        &ctx.accounts.ledger.to_account_info(),
        &mint,
        &ctx.accounts.launch_wallet.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;
    let vault = validate_vault(
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.vault_auth.key(),
    )?;
    let mut ledger_data = ctx.accounts.ledger.try_borrow_mut_data()?;
    let ledger = header_mut::<MintLedger>(&mut ledger_data)?;
    require!(
        vault.amount.saturating_sub(ledger.accounted) >= params::TOKEN_1PCT_DEV_BUY_AMOUNT,
        MachineError::SlackShort
    );
    ledger.accounted = ledger
        .accounted
        .checked_add(params::TOKEN_1PCT_DEV_BUY_AMOUNT)
        .ok_or(MachineError::MathOverflow)?;
    let accounted = ledger.accounted;
    drop(ledger_data);
    let now = Clock::get()?.unix_timestamp;
    let on_air_ts = now
        .checked_add(params::SEASON_ON_AIR_DELAY_SECONDS)
        .ok_or(MachineError::MathOverflow)?;
    let end_ts = on_air_ts
        .checked_add(params::SEASON_DURATION_SECONDS)
        .ok_or(MachineError::MathOverflow)?;
    let fee_in_topup = rent_min(0)?.saturating_sub(ctx.accounts.fee_in.lamports());
    transfer(
        &ctx.accounts.launch_wallet.to_account_info(),
        &ctx.accounts.fee_in.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        fee_in_topup,
    )?;
    machine.token_mint = mint;
    for slot in &mut machine.onepct {
        *slot = OnePctSlot {
            amount: params::TOKEN_1PCT_ONE_PCT_CARD_AMOUNT,
            state: ONEPCT_LOCKED,
            _pad: [0; 7],
        };
    }
    machine.power_on_ts = now;
    machine.on_air_ts = on_air_ts;
    machine.end_ts = end_ts;
    machine.phase = PHASE_POWERED_ON;
    emit!(PoweredOn {
        mint,
        launch_pool: ctx.accounts.launch_pool.key(),
        fee_in: ctx.accounts.fee_in.key(),
        launch_wallet: ctx.accounts.launch_wallet.key(),
        dev_buy: params::TOKEN_1PCT_DEV_BUY_AMOUNT,
        vault_amount: vault.amount,
        accounted,
        fee_in_topup,
        power_on_ts: now,
        on_air_ts,
        end_ts
    });
    Ok(())
}
