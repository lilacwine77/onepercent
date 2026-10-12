use crate::{
    checks::mint_is_safe, constants::*, errors::MachineError, events::ConfigChanged, params,
    state::*, util::*,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};
#[derive(Accounts)]
pub struct AdminListMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds=[CONFIG_SEED],bump=config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut,seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Created donation-safely or validated by ensure_ledger.
    #[account(mut,seeds=[LEDGER_SEED,mint.key().as_ref()],bump)]
    pub ledger: UncheckedAccount<'info>,
    /// CHECK: Canonical token account validated in the handler.
    pub vault: UncheckedAccount<'info>,
    /// CHECK: Signer PDA only.
    #[account(seeds=[VAULT_AUTH_SEED],bump)]
    pub vault_auth: UncheckedAccount<'info>,
    #[account(address=*mint.to_account_info().owner)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
pub fn handler(ctx: Context<AdminListMint>, class: u8, cap: u64, oracle: Pubkey) -> Result<()> {
    let c = ctx.accounts.config.load()?;
    require_keys_eq!(
        ctx.accounts.admin.key(),
        c.admin,
        MachineError::Unauthorized
    );
    require!(
        class == BUCKET_MAJOR || class == BUCKET_TRENDING,
        MachineError::InvalidArgument
    );
    let (decimals, token_program) = mint_is_safe(&ctx.accounts.mint.to_account_info())?;
    let mint = ctx.accounts.mint.key();
    require!(
        mint != c.token_mint && mint != params::WSOL_MINT && mint != NATIVE_MINT_2022,
        MachineError::MintForbidden
    );
    let mut machine = ctx.accounts.machine.load_mut()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    require!(
        !machine
            .buckets
            .iter()
            .any(|b| b.class != BUCKET_EMPTY && b.mint == mint),
        MachineError::BucketExists
    );
    require!(
        machine.buckets.iter().any(|b| b.class == BUCKET_EMPTY),
        MachineError::BucketsFull
    );
    require!(
        class != BUCKET_TRENDING
            || machine
                .buckets
                .iter()
                .filter(|b| b.class == BUCKET_TRENDING && b.enabled != 0)
                .count()
                < params::STOCK_TRENDING_MAX_COUNT as usize,
        MachineError::TrendingLimit
    );
    validate_vault(
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.vault_auth.key(),
    )?;
    ensure_ledger(
        &ctx.accounts.ledger.to_account_info(),
        &mint,
        &ctx.accounts.admin.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;
    let now = Clock::get()?.unix_timestamp;
    machine.ensure_keeper_history(now);
    let index = machine
        .buckets
        .iter()
        .position(|b| b.class == BUCKET_EMPTY)
        .ok_or(MachineError::BucketsFull)?;
    let history = machine
        .bucket_history
        .get_mut(index)
        .ok_or(MachineError::BucketInvalid)?;
    history.listed_ts = now;
    history.sb_inflow_hour = 0;
    history.sb_inflow_prev_hour = 0;
    *machine
        .buckets
        .get_mut(index)
        .ok_or(MachineError::BucketInvalid)? = Bucket {
        mint,
        oracle,
        amount: 0,
        cost: 0,
        reserved: 0,
        cap,
        trend_bought_hour: 0,
        trend_hour_index: 0,
        decimals,
        class,
        enabled: 1,
        token_program,
        final_pool: 0,
        trend_sold_hour: 0,
    };
    emit!(crate::events::BucketListed {
        bucket: index as u8,
        mint,
        listed_ts: now
    });
    emit!(ConfigChanged {
        action: 13,
        actor: ctx.accounts.admin.key(),
        key: mint,
        a: u64::from(class),
        b: cap
    });
    Ok(())
}
