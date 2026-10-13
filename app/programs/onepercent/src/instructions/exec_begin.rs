use crate::{constants::*, errors::MachineError, state::*};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::Token,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[derive(Accounts)]
pub struct ExecBegin<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, seeds = [MACHINE_SEED], bump = machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Canonical MintLedger is checked below; Done Burn can recreate an empty closed ledger.
    #[account(mut, seeds = [LEDGER_SEED, mint.key().as_ref()], bump)]
    pub ledger: UncheckedAccount<'info>,
    #[account(mut,
        address = get_associated_token_address_with_program_id(&vault_auth.key(), &mint.key(), &token_program.key()) @ MachineError::VaultMismatch,
        constraint = vault.mint == mint.key() && vault.owner == vault_auth.key() @ MachineError::VaultMismatch)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Canonical token authority; the handler signs token operations with its seeds.
    #[account(seeds = [VAULT_AUTH_SEED], bump = machine.load()?.vault_auth_bump)]
    pub vault_auth: UncheckedAccount<'info>,
    /// CHECK: M2 P1 validates the signer's native wSOL ATA or mint ATA according to kind.
    #[account(mut)]
    pub src: UncheckedAccount<'info>,
    /// CHECK: StockSell requires writable; M2 P1 validates the canonical wSOL destination or System sentinel.
    pub sol_dest: UncheckedAccount<'info>,
    /// CHECK: M2 P1 validates oracle slot 0 by kind or requires the System sentinel.
    pub oracle_0: UncheckedAccount<'info>,
    /// CHECK: M2 P1 validates oracle slot 1 by kind or requires the System sentinel.
    pub oracle_1: UncheckedAccount<'info>,
    /// CHECK: M2 P1 validates oracle slot 2 by kind or requires the System sentinel.
    pub oracle_2: UncheckedAccount<'info>,
    /// CHECK: M2 P1 validates oracle slot 3 by kind or requires the System sentinel.
    pub oracle_3: UncheckedAccount<'info>,
    #[account(address = *mint.to_account_info().owner @ MachineError::AccountMismatch)]
    pub token_program: Interface<'info, TokenInterface>,
    pub spl_token_program: Program<'info, Token>,
    /// CHECK: Canonical instructions sysvar for M2 P1 transaction pairing checks.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ExecBegin>, kind: u8, bucket: u8, amount: u64) -> Result<()> {
    crate::checks::top_level()?;
    require!(
        (EXEC_KIND_STOCK_BUY..=EXEC_KIND_JACKPOT_BUY).contains(&kind),
        MachineError::InvalidArgument
    );
    let clock = Clock::get()?;
    let config = ctx.accounts.config.load()?;
    let phase = ctx.accounts.machine.load()?.phase;
    check_role(&config, kind, &ctx.accounts.signer.key(), phase)?;
    let pause = if is_stock(kind) {
        crate::params::PAUSE_BITS_STOCK_BUY
    } else {
        crate::params::PAUSE_BITS_BURN
    };
    require!(
        permissionless_burn(kind, phase)
            || (config.admin_paused | config.guardian_paused) & pause == 0,
        MachineError::Paused
    );
    let mut machine = ctx.accounts.machine.load_mut()?;
    check_phase(&machine, kind, clock.unix_timestamp)?;
    crate::checks::exec_tx::check_exec_pairing(&ctx.accounts.instructions.to_account_info(), kind)?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    check_mint(&config, &machine, kind, bucket, &ctx.accounts.mint.key())?;
    crate::util::validate_vault(
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.vault_auth.key(),
    )?;
    crate::util::validate_exec_src(
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.src.to_account_info(),
        &ctx.accounts.signer.key(),
        kind == EXEC_KIND_STOCK_SELL,
    )?;
    let sol_dest = crate::util::validate_sol_dest(
        &ctx.accounts.sol_dest.to_account_info(),
        &ctx.accounts.vault_auth.key(),
        kind == EXEC_KIND_STOCK_SELL,
    )?;
    let ledger_info = ctx.accounts.ledger.to_account_info();
    if permissionless_burn(kind, phase) && *ledger_info.owner == anchor_lang::system_program::ID {
        // A ledger closes only with zero accounted claims. Recreate it from the
        // caller's rent so closing accounts never strands the remaining burn SOL.
        // For Burn, validate_sol_dest has authenticated this System sentinel.
        require!(
            ledger_info.data_is_empty() && !ledger_info.executable,
            MachineError::LedgerMismatch
        );
        require!(
            machine.final_pool_1pct == 0
                && machine.jackpot_tokens == 0
                && machine.onepct.iter().all(|slot| {
                    slot.amount == 0 || (slot.state != ONEPCT_LOCKED && slot.state != ONEPCT_LIVE)
                }),
            MachineError::LedgerMismatch
        );
        crate::util::ensure_ledger(
            &ledger_info,
            &ctx.accounts.mint.key(),
            &ctx.accounts.signer.to_account_info(),
            &ctx.accounts.sol_dest.to_account_info(),
        )?;
    }
    crate::state::views::validate::<MintLedger>(&ledger_info)
        .map_err(|_| error!(MachineError::LedgerMismatch))?;
    require_keys_eq!(
        crate::state::views::header::<MintLedger>(&ledger_info.try_borrow_data()?)?.mint,
        ctx.accounts.mint.key(),
        MachineError::LedgerMismatch
    );
    if kind == EXEC_KIND_STOCK_BUY {
        let b = machine
            .buckets
            .get(usize::from(bucket))
            .ok_or(MachineError::BucketInvalid)?;
        require!(b.enabled == 1, MachineError::BucketDisabled);
        crate::checks::mint_is_safe(&ctx.accounts.mint.to_account_info())?;
    }
    if kind == EXEC_KIND_STOCK_BUY {
        crate::math::stock_buy::check_stock_buy(&machine, bucket, amount, clock.unix_timestamp)?;
    }
    rotate_hours(&mut machine, kind, bucket, clock.unix_timestamp)?;
    let book = check_caps(&mut machine, kind, bucket, amount, clock.unix_timestamp)?;
    let quote = read_quote(&ctx, &machine, kind, bucket, amount, clock.unix_timestamp)?;
    require!(quote.min_out > 0, MachineError::OracleInvalid);
    let (v0, target) = if kind == EXEC_KIND_STOCK_SELL {
        let b = machine
            .buckets
            .get_mut(usize::from(bucket))
            .ok_or(MachineError::BucketInvalid)?;
        let next_amount = b
            .amount
            .checked_sub(amount)
            .ok_or(MachineError::MathOverflow)?;
        let next_cost = b.cost.checked_sub(book).ok_or(MachineError::MathOverflow)?;
        crate::math::exec::preserve_granularity(b, next_amount, next_cost)?;
        b.amount = next_amount;
        b.cost = next_cost;
        {
            let mut data = ledger_info.try_borrow_mut_data()?;
            let ledger = crate::state::views::header_mut::<MintLedger>(&mut data)?;
            ledger.accounted = ledger
                .accounted
                .checked_sub(amount)
                .ok_or(MachineError::MathOverflow)?;
        }
        crate::util::vault_transfer(
            &ctx.accounts.mint.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.src.to_account_info(),
            &ctx.accounts.vault_auth.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            machine.vault_auth_bump,
            amount,
            ctx.accounts.mint.decimals,
        )?;
        (
            sol_dest.ok_or(MachineError::AccountMismatch)?.amount,
            ctx.accounts.sol_dest.key(),
        )
    } else {
        let tracked = match kind {
            EXEC_KIND_STOCK_BUY => &mut machine.stock_sol,
            EXEC_KIND_BURN => &mut machine.burn_sol,
            _ => &mut machine.jackpot_sol,
        };
        *tracked = tracked
            .checked_sub(amount)
            .ok_or(MachineError::MathOverflow)?;
        let machine_info = ctx.accounts.machine.to_account_info();
        let src_info = ctx.accounts.src.to_account_info();
        let next_machine = machine_info
            .lamports()
            .checked_sub(amount)
            .ok_or(MachineError::TrancheTooLarge)?;
        require!(
            next_machine >= Rent::get()?.minimum_balance(MACHINE_SIZE),
            MachineError::TrancheTooLarge
        );
        let next_src = src_info
            .lamports()
            .checked_add(amount)
            .ok_or(MachineError::MathOverflow)?;
        **machine_info.try_borrow_mut_lamports()? = next_machine;
        **src_info.try_borrow_mut_lamports()? = next_src;
        (ctx.accounts.vault.amount, ctx.accounts.vault.key())
    };
    machine.exec = ExecRecord {
        kind,
        bucket,
        _pad: [0; 6],
        amount,
        v0,
        min_out: quote.min_out,
        slot: clock.slot,
        target,
        aux: book,
    };
    drop(machine);
    if kind != EXEC_KIND_STOCK_SELL {
        crate::util::sync_native(
            &ctx.accounts.src.to_account_info(),
            &ctx.accounts.machine.to_account_info(),
            &ctx.accounts.signer.to_account_info(),
            &ctx.accounts.sol_dest.to_account_info(),
            &ctx.accounts.spl_token_program.to_account_info(),
        )?;
    }
    emit!(crate::events::ExecBegun {
        kind,
        bucket,
        mint: ctx.accounts.mint.key(),
        signer: ctx.accounts.signer.key(),
        amount,
        min_out: quote.min_out,
        v0,
        book,
        expected: quote.expected,
        ts: clock.unix_timestamp,
    });
    Ok(())
}

pub(crate) fn is_stock(kind: u8) -> bool {
    kind == EXEC_KIND_STOCK_BUY || kind == EXEC_KIND_STOCK_SELL
}

pub(crate) fn permissionless_burn(kind: u8, phase: u8) -> bool {
    kind == EXEC_KIND_BURN && phase == PHASE_DONE
}

pub(crate) fn check_role(config: &Config, kind: u8, signer: &Pubkey, phase: u8) -> Result<()> {
    if permissionless_burn(kind, phase) {
        return Ok(());
    }
    let (expected, bit) = if is_stock(kind) {
        (config.keeper, 3)
    } else {
        (config.executor, 4)
    };
    require_keys_eq!(*signer, expected, MachineError::Unauthorized);
    require!(
        config.disabled_roles & (1 << bit) == 0,
        MachineError::RoleDisabled
    );
    Ok(())
}

pub(crate) fn check_mint(
    config: &Config,
    machine: &Machine,
    kind: u8,
    bucket: u8,
    mint: &Pubkey,
) -> Result<()> {
    if is_stock(kind) {
        let b = machine
            .buckets
            .get(usize::from(bucket))
            .ok_or(MachineError::BucketInvalid)?;
        require!(
            b.class != BUCKET_EMPTY && b.mint == *mint,
            MachineError::BucketInvalid
        );
    } else {
        require!(
            bucket == BUCKET_NONE
                && *mint == config.token_mint
                && config.token_mint != Pubkey::default(),
            MachineError::AccountMismatch
        );
    }
    Ok(())
}

fn check_phase(machine: &Machine, kind: u8, now: i64) -> Result<()> {
    match kind {
        EXEC_KIND_STOCK_BUY => {
            require!(
                machine.phase == PHASE_POWERED_ON || machine.phase == PHASE_ON_AIR,
                MachineError::WrongPhase
            );
            require!(
                machine.end_ts == 0 || now < machine.end_ts,
                MachineError::SeasonOver
            );
        }
        EXEC_KIND_STOCK_SELL => require!(
            machine.phase == PHASE_ON_AIR || machine.phase == PHASE_BUYS_CLOSED,
            MachineError::WrongPhase
        ),
        EXEC_KIND_BURN => require!(
            (PHASE_POWERED_ON..=PHASE_DONE).contains(&machine.phase),
            MachineError::WrongPhase
        ),
        EXEC_KIND_JACKPOT_BUY => {
            require!(machine.phase == PHASE_ON_AIR, MachineError::WrongPhase);
            require!(now < machine.end_ts, MachineError::SeasonOver);
        }
        _ => return err!(MachineError::InvalidArgument),
    }
    Ok(())
}

fn rotate_hours(machine: &mut Machine, kind: u8, bucket: u8, now: i64) -> Result<()> {
    let mut hour = crate::math::HourState {
        hour_index: machine.hour_index,
        hit_out_last_hour: machine.hit_out_last_hour,
        hit_out_this_hour: machine.hit_out_this_hour,
        sb_paid_hour: machine.sb_paid_hour,
        sol_at_hour_start: machine.sol_at_hour_start,
        stock_sol: machine.stock_sol,
    };
    crate::math::rotate_hour(&mut hour, now);
    machine.rotate_keeper_history(now);
    machine.hour_index = hour.hour_index;
    machine.hit_out_last_hour = hour.hit_out_last_hour;
    machine.hit_out_this_hour = hour.hit_out_this_hour;
    machine.sb_paid_hour = hour.sb_paid_hour;
    machine.sol_at_hour_start = hour.sol_at_hour_start;
    if is_stock(kind) {
        if machine.stock_hour_index != hour.hour_index {
            machine.stock_bought_hour = 0;
            machine.stock_sold_hour = 0;
            machine.stock_hour_index = hour.hour_index;
        }
        let b = machine
            .buckets
            .get_mut(usize::from(bucket))
            .ok_or(MachineError::BucketInvalid)?;
        let index = u32::try_from(hour.hour_index).unwrap_or(u32::MAX);
        if b.trend_hour_index != index {
            b.trend_bought_hour = 0;
            b.trend_sold_hour = 0;
            b.trend_hour_index = index;
        }
    } else if kind == EXEC_KIND_BURN && machine.burn_hour_index != hour.hour_index {
        machine.burn_paid_hour = 0;
        machine.burn_hour_index = hour.hour_index;
    }
    Ok(())
}

fn spaced(last: i64, spacing: i64, now: i64) -> Result<()> {
    require!(
        last.checked_add(spacing)
            .ok_or(MachineError::MathOverflow)?
            <= now,
        MachineError::TooSoon
    );
    Ok(())
}

fn check_caps(machine: &mut Machine, kind: u8, bucket: u8, amount: u64, now: i64) -> Result<u64> {
    use crate::{math::exec, params};
    if is_stock(kind) {
        spaced(
            machine.last_stock_trade_ts,
            params::STOCK_TRADE_MIN_SPACING_SECONDS,
            now,
        )?;
        let b = *machine
            .buckets
            .get(usize::from(bucket))
            .ok_or(MachineError::BucketInvalid)?;
        let tranche = if b.class == BUCKET_MAJOR {
            params::STOCK_MAJOR_TRANCHE_MAX_LAMPORTS
        } else {
            params::STOCK_TRENDING_TRANCHE_MAX_LAMPORTS
        };
        let cap = exec::stock_hourly_cap(machine.hit_out_last_hour, machine.hit_out_this_hour);
        let book = if kind == EXEC_KIND_STOCK_SELL {
            exec::removed_book(amount, b.amount, b.cost)?
        } else {
            0
        };
        if kind == EXEC_KIND_STOCK_BUY {
            require!(
                amount > 0 && amount <= tranche && amount <= machine.stock_sol,
                MachineError::TrancheTooLarge
            );
            require!(
                b.cost
                    .checked_add(amount)
                    .ok_or(MachineError::MathOverflow)?
                    <= b.cap,
                MachineError::BucketCapExceeded
            );
            let gross = machine
                .stock_bought_hour
                .checked_add(amount)
                .ok_or(MachineError::MathOverflow)?;
            require!(gross <= cap, MachineError::HourlyCapReached);
            if b.class == BUCKET_TRENDING {
                let per_mint = b
                    .trend_bought_hour
                    .checked_add(amount)
                    .ok_or(MachineError::MathOverflow)?;
                require!(
                    per_mint <= params::STOCK_TRENDING_HOURLY_MAX_LAMPORTS,
                    MachineError::HourlyCapReached
                );
                let mut total = u128::from(machine.stock_sol);
                let mut trending = u128::from(amount);
                for candidate in &machine.buckets {
                    total = total
                        .checked_add(u128::from(candidate.cost))
                        .ok_or(MachineError::MathOverflow)?;
                    if candidate.class == BUCKET_TRENDING {
                        trending = trending
                            .checked_add(u128::from(candidate.cost))
                            .ok_or(MachineError::MathOverflow)?;
                    }
                }
                require!(
                    trending
                        .checked_mul(u128::from(params::BPS_DENOMINATOR))
                        .ok_or(MachineError::MathOverflow)?
                        <= total
                            .checked_mul(u128::from(params::STOCK_TRENDING_SHARE_MAX_BPS))
                            .ok_or(MachineError::MathOverflow)?,
                    MachineError::TrendingShareExceeded
                );
                machine
                    .buckets
                    .get_mut(usize::from(bucket))
                    .ok_or(MachineError::BucketInvalid)?
                    .trend_bought_hour = per_mint;
            }
            machine.stock_bought_hour = gross;
        } else {
            require!(book <= tranche, MachineError::TrancheTooLarge);
            require!(
                b.cost.checked_sub(book).ok_or(MachineError::MathOverflow)? >= b.reserved,
                MachineError::ReservedCapacity
            );
            if !(b.class == BUCKET_MAJOR && machine.phase == PHASE_BUYS_CLOSED) {
                let gross = machine
                    .stock_sold_hour
                    .checked_add(book)
                    .ok_or(MachineError::MathOverflow)?;
                require!(gross <= cap, MachineError::HourlyCapReached);
                machine.stock_sold_hour = gross;
            }
            if b.class == BUCKET_TRENDING {
                let per_mint = b
                    .trend_sold_hour
                    .checked_add(book)
                    .ok_or(MachineError::MathOverflow)?;
                require!(
                    per_mint <= params::STOCK_TRENDING_HOURLY_MAX_LAMPORTS,
                    MachineError::HourlyCapReached
                );
                machine
                    .buckets
                    .get_mut(usize::from(bucket))
                    .ok_or(MachineError::BucketInvalid)?
                    .trend_sold_hour = per_mint;
            }
        }
        machine.last_stock_trade_ts = now;
        Ok(book)
    } else {
        let (last, spacing, tranche, tracked) = if kind == EXEC_KIND_BURN {
            (
                machine.last_burn_ts,
                params::BURN_MIN_SPACING_SECONDS,
                params::BURN_TRANCHE_MAX_LAMPORTS,
                machine.burn_sol,
            )
        } else {
            (
                machine.last_jackpot_buy_ts,
                params::JACKPOT_TRANCHE_MIN_SPACING_SECONDS,
                params::JACKPOT_TRANCHE_MAX_LAMPORTS,
                machine.jackpot_sol,
            )
        };
        spaced(last, spacing, now)?;
        require!(
            amount > 0 && amount <= tranche && amount <= tracked,
            MachineError::TrancheTooLarge
        );
        if kind == EXEC_KIND_BURN {
            let paid = machine
                .burn_paid_hour
                .checked_add(amount)
                .ok_or(MachineError::MathOverflow)?;
            require!(
                paid <= params::BURN_HOURLY_MAX_LAMPORTS,
                MachineError::HourlyCapReached
            );
            machine.burn_paid_hour = paid;
            machine.last_burn_ts = now;
        } else {
            machine.last_jackpot_buy_ts = now;
        }
        Ok(0)
    }
}

fn system_sentinel(account: &UncheckedAccount<'_>) -> Result<()> {
    require_keys_eq!(
        account.key(),
        anchor_lang::system_program::ID,
        MachineError::OracleInvalid
    );
    Ok(())
}

fn read_quote(
    ctx: &Context<ExecBegin>,
    machine: &Machine,
    kind: u8,
    bucket: u8,
    amount: u64,
    now: i64,
) -> Result<crate::math::exec::Quote> {
    use crate::{checks, math::exec, params};
    let a = &ctx.accounts;
    if is_stock(kind) {
        let b = machine
            .buckets
            .get(usize::from(bucket))
            .ok_or(MachineError::BucketInvalid)?;
        if b.class == BUCKET_MAJOR {
            system_sentinel(&a.oracle_2)?;
            system_sentinel(&a.oracle_3)?;
            let token = checks::pyth::read_price(&a.oracle_0.to_account_info(), &b.oracle, now)?;
            let sol = checks::pyth::read_price(
                &a.oracle_1.to_account_info(),
                &Pubkey::new_from_array(params::HIT_LIST_SOL_USD_PYTH_FEED_ID),
                now,
            )?;
            let quote = if kind == EXEC_KIND_STOCK_BUY {
                exec::major_buy(amount, token, sol, a.mint.decimals)?
            } else {
                exec::major_sell(amount, token, sol, a.mint.decimals)?
            };
            Ok(quote)
        } else {
            require!(b.class == BUCKET_TRENDING, MachineError::BucketInvalid);
            system_sentinel(&a.oracle_3)?;
            require_keys_eq!(a.oracle_0.key(), b.oracle, MachineError::OracleInvalid);
            let pool = checks::pumpswap::read_pool(
                &a.mint.key(),
                &a.oracle_0.to_account_info(),
                &a.oracle_1.to_account_info(),
                &a.oracle_2.to_account_info(),
            )?;
            let quote = if kind == EXEC_KIND_STOCK_BUY {
                exec::pool_buy(amount, pool, params::STOCK_TRENDING_MIN_OUT_SLIP_BPS)?
            } else {
                exec::pool_sell(amount, pool, params::STOCK_TRENDING_MIN_OUT_SLIP_BPS)?
            };
            Ok(quote)
        }
    } else {
        let pool = checks::meteora::read_price(
            &a.mint.key(),
            &params::METEORA_DBC_CONFIG,
            &a.oracle_0.to_account_info(),
            &a.oracle_1.to_account_info(),
            &a.oracle_2.to_account_info(),
            &a.oracle_3.to_account_info(),
        )?;
        let slip = if kind == EXEC_KIND_BURN {
            params::BURN_MIN_OUT_SLIP_BPS
        } else {
            params::JACKPOT_MIN_OUT_SLIP_BPS
        };
        // D29 caps use recorded trading reserves, excluding fees and donations.
        check_reserve_tranche(kind, amount, u128::from(pool.recorded_quote))?;
        exec::meteora_buy(amount, pool.sqrt_price, slip)
    }
}

// Parse the authenticated reserves first, then apply their tranche bound before
// quote arithmetic so a too-large input cannot select a later formula error.
fn check_reserve_tranche(kind: u8, amount: u64, quote_eff: u128) -> Result<()> {
    let bps = if kind == EXEC_KIND_BURN {
        crate::params::BURN_TRANCHE_MAX_BPS_OF_QUOTE_RESERVES
    } else {
        crate::params::JACKPOT_TRANCHE_MAX_BPS_OF_QUOTE_RESERVES
    };
    require!(
        u128::from(amount) <= crate::math::exec::reserve_tranche(quote_eff, bps)?,
        MachineError::TrancheTooLarge
    );
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod final_burn_tests {
    use super::*;
    use anchor_lang::__private::bytemuck::Zeroable;

    #[test]
    fn only_done_burn_bypasses_executor_role() {
        let mut config = Config::zeroed();
        config.executor = Pubkey::new_unique();
        config.disabled_roles = u8::MAX;
        config.admin_paused = u8::MAX;
        config.guardian_paused = u8::MAX;
        let caller = Pubkey::new_unique();
        for phase in PHASE_SETUP..=PHASE_DONE {
            let allowed = phase == PHASE_DONE;
            assert_eq!(permissionless_burn(EXEC_KIND_BURN, phase), allowed);
            assert_eq!(
                check_role(&config, EXEC_KIND_BURN, &caller, phase).is_ok(),
                allowed
            );
            assert!(!permissionless_burn(EXEC_KIND_JACKPOT_BUY, phase));
            assert!(check_role(&config, EXEC_KIND_JACKPOT_BUY, &caller, phase).is_err());
            let mut machine = Machine::zeroed();
            machine.phase = phase;
            machine.end_ts = i64::MAX;
            assert_eq!(
                check_phase(&machine, EXEC_KIND_BURN, 1).is_ok(),
                phase >= PHASE_POWERED_ON
            );
            if allowed {
                assert!(check_phase(&machine, EXEC_KIND_JACKPOT_BUY, 1).is_err());
            }
        }
        assert!(check_role(&config, EXEC_KIND_BURN, &config.executor, PHASE_FINAL_PULL).is_err());
        config.disabled_roles = 0;
        assert!(check_role(&config, EXEC_KIND_BURN, &config.executor, PHASE_FINAL_PULL).is_ok());
    }

    #[test]
    fn done_burn_keeps_spacing_tranche_reserve_and_hour_limits() {
        use crate::params;
        let mut machine = Machine::zeroed();
        machine.phase = PHASE_DONE;
        machine.burn_sol = params::BURN_HOURLY_MAX_LAMPORTS.saturating_mul(2);
        machine.last_burn_ts = 1_000;
        let due = machine
            .last_burn_ts
            .saturating_add(params::BURN_MIN_SPACING_SECONDS);
        let tranche = params::BURN_TRANCHE_MAX_LAMPORTS;
        assert!(check_caps(
            &mut machine,
            EXEC_KIND_BURN,
            BUCKET_NONE,
            tranche,
            due.saturating_sub(1)
        )
        .is_err());
        assert!(check_caps(
            &mut machine,
            EXEC_KIND_BURN,
            BUCKET_NONE,
            tranche.saturating_add(1),
            due
        )
        .is_err());
        check_caps(&mut machine, EXEC_KIND_BURN, BUCKET_NONE, tranche, due).unwrap();
        assert_eq!(machine.burn_paid_hour, tranche);
        machine.burn_paid_hour = params::BURN_HOURLY_MAX_LAMPORTS;
        assert!(check_caps(
            &mut machine,
            EXEC_KIND_BURN,
            BUCKET_NONE,
            tranche,
            due.saturating_add(params::BURN_MIN_SPACING_SECONDS)
        )
        .is_err());
        let reserves = u128::from(tranche).saturating_mul(u128::from(params::BPS_DENOMINATOR));
        let cap = crate::math::exec::reserve_tranche(
            reserves,
            params::BURN_TRANCHE_MAX_BPS_OF_QUOTE_RESERVES,
        )
        .unwrap();
        assert!(
            check_reserve_tranche(EXEC_KIND_BURN, u64::try_from(cap).unwrap(), reserves).is_ok()
        );
        assert!(check_reserve_tranche(
            EXEC_KIND_BURN,
            u64::try_from(cap).unwrap().saturating_add(1),
            reserves
        )
        .is_err());
    }
}
