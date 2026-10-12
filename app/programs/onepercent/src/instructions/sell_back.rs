use crate::{
    checks::{mint_is_safe, validate_expiry, verify_ed25519},
    constants::*,
    errors::MachineError,
    events::SoldBack,
    math::sellback::{check_sell_back_coverage, sell_back_checks},
    params,
    state::views::*,
    state::*,
    util::{move_lamports, shrink_binder, validate_vault},
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SellBackCard {
    pub index: u16,
    pub amount: u64,
}

#[derive(Accounts)]
pub struct SellBack<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.load()?.bump)]
    pub config: AccountLoader<'info, Config>,
    #[account(mut, seeds = [MACHINE_SEED], bump = machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    #[account(mut, seeds = [BINDER_SEED, owner.key().as_ref()], bump = binder.load()?.bump,
        constraint = binder.load()?.owner == owner.key() @ MachineError::AccountMismatch)]
    pub binder: AccountLoader<'info, Binder>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [LEDGER_SEED, mint.key().as_ref()], bump,
        constraint = ledger.load()?.mint == mint.key() @ MachineError::LedgerMismatch)]
    pub ledger: AccountLoader<'info, MintLedger>,
    // The handler validates the vault with the stored Machine authority bump.
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Canonical instructions sysvar for the SB attestation verifier.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<SellBack>,
    cards: Vec<SellBackCard>,
    quote_lamports: u64,
    expiry: i64,
    nonce: u32,
    att_ix: u8,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let config = ctx.accounts.config.load()?;
    let machine = ctx.accounts.machine.load()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        (config.admin_paused | config.guardian_paused) & params::PAUSE_BITS_SELL_BACK == 0,
        MachineError::Paused
    );
    require!(machine.phase == PHASE_ON_AIR, MachineError::WrongPhase);
    require!(now < machine.end_ts, MachineError::SeasonOver);
    require!(
        config.disabled_roles & (1 << 6) == 0,
        MachineError::RoleDisabled
    );
    require!(
        (1..=usize::from(MAX_SELL_BACK_CARDS)).contains(&cards.len())
            && cards
                .iter()
                .zip(cards.iter().skip(1))
                .all(|(previous, next)| previous.index > next.index)
            && quote_lamports > 0,
        MachineError::InvalidArgument
    );
    let binder = ctx.accounts.binder.to_account_info();
    let mut stocked_value = 0u128;
    let mut total_amount = 0u128;
    {
        let data = binder.try_borrow_data()?;
        let h = header::<Binder>(&data)?;
        let stored = tail::<Card>(&data, BINDER_HEADER)?;
        for requested in &cards {
            require!(requested.index < h.len, MachineError::CardMoved);
            let card = stored
                .get(usize::from(requested.index))
                .ok_or(MachineError::CardMoved)?;
            require!(
                card.mint == ctx.accounts.mint.key() && card.amount == requested.amount,
                MachineError::CardMoved
            );
            require!(
                (KIND_SILVER..=KIND_BLACK).contains(&card.kind)
                    && params::HIT_TIERS_SELL_BACK
                        .get(usize::from(card.kind.saturating_sub(KIND_SILVER)))
                        .copied()
                        .unwrap_or(false),
                MachineError::NotSellBackable
            );
            stocked_value = stocked_value
                .checked_add(u128::from(card.value))
                .ok_or(MachineError::MathOverflow)?;
            total_amount = total_amount
                .checked_add(u128::from(card.amount))
                .ok_or(MachineError::MathOverflow)?;
        }
    }
    let bucket_index = machine
        .buckets
        .iter()
        .position(|b| b.class != BUCKET_EMPTY && b.mint == ctx.accounts.mint.key())
        .ok_or(MachineError::BucketInvalid)?;
    let bucket = machine
        .buckets
        .get(bucket_index)
        .ok_or(MachineError::BucketInvalid)?;
    require!(bucket.enabled == 1, MachineError::BucketDisabled);
    mint_is_safe(&ctx.accounts.mint.to_account_info())?;
    let auth =
        Pubkey::create_program_address(&[VAULT_AUTH_SEED, &[machine.vault_auth_bump]], &crate::ID)
            .map_err(|_| error!(MachineError::VaultMismatch))?;
    let vault = validate_vault(
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.vault.to_account_info(),
        &auth,
    )?;
    require!(
        vault.amount >= ctx.accounts.ledger.load()?.accounted,
        MachineError::VaultInvariant
    );
    let total_amount =
        u64::try_from(total_amount).map_err(|_| error!(MachineError::MathOverflow))?;
    verify_ed25519(
        &ctx.accounts.instructions.to_account_info(),
        att_ix,
        &config.quote_signer,
        &sell_back_message(
            &ctx.accounts.owner.key(),
            &ctx.accounts.mint.key(),
            &cards,
            total_amount,
            quote_lamports,
            expiry,
            nonce,
        )?,
    )?;
    let ttl = match bucket.class {
        BUCKET_MAJOR => params::SELL_BACK_QUOTE_TTL_SECONDS_MAJOR,
        BUCKET_TRENDING => params::SELL_BACK_QUOTE_TTL_SECONDS_TRENDING,
        _ => return err!(MachineError::BucketInvalid),
    };
    validate_expiry(now, expiry, ttl)?;
    let next_nonce = {
        let h = ctx.accounts.binder.load()?;
        require!(nonce == h.sb_nonce, MachineError::AttestationReplay);
        h.sb_nonce
            .checked_add(1)
            .ok_or(MachineError::MathOverflow)?
    };
    let stocked_value =
        u64::try_from(stocked_value).map_err(|_| error!(MachineError::MathOverflow))?;
    let plan = sell_back_checks(&machine, bucket, stocked_value, quote_lamports, now)?;
    let bucket_amount = bucket
        .amount
        .checked_add(total_amount)
        .ok_or(MachineError::MathOverflow)?;
    check_sell_back_coverage(bucket, bucket_amount, plan.bucket_cost)?;
    drop(machine);
    drop(config);

    {
        let mut machine = ctx.accounts.machine.load_mut()?;
        machine.rotate_keeper_history(now);
        machine.hour_index = plan.hour.hour_index;
        machine.hit_out_last_hour = plan.hour.hit_out_last_hour;
        machine.hit_out_this_hour = plan.hour.hit_out_this_hour;
        machine.sol_at_hour_start = plan.hour.sol_at_hour_start;
        machine.stock_sol = plan.stock_sol;
        machine.team_sol = plan.team_sol;
        machine.sb_paid_hour = plan.sb_paid_hour;
        let bucket = machine
            .buckets
            .get_mut(bucket_index)
            .ok_or(MachineError::BucketInvalid)?;
        bucket.amount = bucket_amount;
        bucket.cost = plan.bucket_cost;
        let history = machine
            .bucket_history
            .get_mut(bucket_index)
            .ok_or(MachineError::BucketInvalid)?;
        // MAX is an explicit overflow sentinel for off-chain readers, not a
        // new rejection condition for an otherwise valid Sell.
        history.sb_inflow_hour = history.sb_inflow_hour.saturating_add(plan.value);
        let inflow = history.sb_inflow_hour;
        let previous = history.sb_inflow_prev_hour;
        emit!(crate::events::SellHistoryUpdated {
            bucket: bucket_index as u8,
            hour_index: machine.hour_index,
            sb_paid_hour: machine.sb_paid_hour,
            sb_paid_prev_hour: machine.sb_paid_prev_hour,
            sb_inflow_hour: inflow,
            sb_inflow_prev_hour: previous,
        });
    }
    ctx.accounts.binder.load_mut()?.sb_nonce = next_nonce;
    let paid = move_lamports(
        &ctx.accounts.machine.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        plan.payout,
    )?;
    require!(paid == plan.payout, MachineError::VaultInvariant);
    let mut slot_refund = 0u64;
    for requested in &cards {
        binder_remove(&mut binder.try_borrow_mut_data()?, requested.index)?;
        slot_refund = slot_refund
            .checked_add(shrink_binder(
                &binder,
                &ctx.accounts.owner.to_account_info(),
            )?)
            .ok_or(MachineError::MathOverflow)?;
    }
    emit!(SoldBack {
        owner: ctx.accounts.owner.key(),
        mint: ctx.accounts.mint.key(),
        bucket: u8::try_from(bucket_index).map_err(|_| error!(MachineError::MathOverflow))?,
        n: u8::try_from(cards.len()).map_err(|_| error!(MachineError::MathOverflow))?,
        total_amount,
        stocked_value,
        quote_lamports,
        value: plan.value,
        payout: plan.payout,
        to_team: plan.to_team,
        nonce,
        sb_paid_hour: plan.sb_paid_hour,
        slot_refund,
    });
    Ok(())
}

pub fn sell_back_message(
    owner: &Pubkey,
    mint: &Pubkey,
    cards: &[SellBackCard],
    total_amount: u64,
    quote_lamports: u64,
    expiry: i64,
    nonce: u32,
) -> Result<Vec<u8>> {
    let mut message = Vec::with_capacity(135usize.saturating_add(cards.len().saturating_mul(10)));
    message.extend_from_slice(params::ATTESTATIONS_SELL_BACK_DOMAIN);
    message.extend_from_slice(crate::ID.as_ref());
    message.extend_from_slice(owner.as_ref());
    message.extend_from_slice(mint.as_ref());
    message.push(u8::try_from(cards.len()).map_err(|_| error!(MachineError::InvalidArgument))?);
    for card in cards {
        message.extend_from_slice(&card.index.to_le_bytes());
        message.extend_from_slice(&card.amount.to_le_bytes());
    }
    message.extend_from_slice(&total_amount.to_le_bytes());
    message.extend_from_slice(&quote_lamports.to_le_bytes());
    message.extend_from_slice(&expiry.to_le_bytes());
    message.extend_from_slice(&nonce.to_le_bytes());
    Ok(message)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod p0_abi_tests {
    use super::SellBackCard;
    use anchor_lang::{prelude::Pubkey, InstructionData, ToAccountMetas};
    use serde_json::{json, Value};

    fn k(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn number(value: &Value) -> u64 {
        value
            .as_u64()
            .unwrap_or_else(|| value.as_str().unwrap().parse().unwrap())
    }

    fn check<D: InstructionData, A: ToAccountMetas>(row: &Value, data: D, accounts: A) {
        let bytes: String = data
            .data()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert_eq!(row["data"], bytes, "{} data", row["name"]);
        let metas: Vec<_> = accounts
            .to_account_metas(None)
            .iter()
            .map(|meta| {
                json!({
                    "pubkey": meta.pubkey.to_string(),
                    "isSigner": meta.is_signer,
                    "isWritable": meta.is_writable,
                })
            })
            .collect();
        assert_eq!(row["accounts"], json!(metas), "{} accounts", row["name"]);
    }

    #[test]
    fn six_m2_instruction_bytes_and_account_metas_match_vectors() {
        let rows: Vec<Value> =
            serde_json::from_str(include_str!("../../../../fixtures/vectors/ix.json")).unwrap();
        let mut names = std::collections::BTreeSet::new();
        for row in &rows {
            let args = &row["args"];
            match row["name"].as_str().unwrap() {
                "exec_begin" => check(
                    row,
                    crate::instruction::ExecBegin {
                        kind: u8::try_from(number(&args["kind"])).unwrap(),
                        bucket: u8::try_from(number(&args["bucket"])).unwrap(),
                        amount: number(&args["amount"]),
                    },
                    crate::accounts::ExecBegin {
                        signer: k(1),
                        config: k(2),
                        machine: k(3),
                        mint: k(4),
                        ledger: k(5),
                        vault: k(6),
                        vault_auth: k(7),
                        src: k(8),
                        sol_dest: k(9),
                        oracle_0: k(10),
                        oracle_1: k(11),
                        oracle_2: k(12),
                        oracle_3: k(13),
                        token_program: k(14),
                        spl_token_program: k(15),
                        instructions: k(16),
                    },
                ),
                "exec_end" => check(
                    row,
                    crate::instruction::ExecEnd {
                        kind: u8::try_from(number(&args["kind"])).unwrap(),
                    },
                    crate::accounts::ExecEnd {
                        signer: k(1),
                        config: k(2),
                        machine: k(3),
                        mint: k(4),
                        ledger: k(5),
                        vault: k(6),
                        vault_auth: k(7),
                        sol_dest: k(8),
                        token_program: k(9),
                        spl_token_program: k(10),
                        system_program: k(11),
                    },
                ),
                "sell_back" => check(
                    row,
                    crate::instruction::SellBack {
                        cards: args["cards"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|card| SellBackCard {
                                index: u16::try_from(number(&card["index"])).unwrap(),
                                amount: number(&card["amount"]),
                            })
                            .collect(),
                        quote_lamports: number(&args["quote_lamports"]),
                        expiry: args["expiry"].as_str().unwrap().parse().unwrap(),
                        nonce: u32::try_from(number(&args["nonce"])).unwrap(),
                        att_ix: u8::try_from(number(&args["att_ix"])).unwrap(),
                    },
                    crate::accounts::SellBack {
                        owner: k(1),
                        config: k(2),
                        machine: k(3),
                        binder: k(4),
                        mint: k(5),
                        ledger: k(6),
                        vault: k(7),
                        instructions: k(8),
                    },
                ),
                "feed_back" => check(
                    row,
                    crate::instruction::FeedBack {
                        card_indices: args["card_indices"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|index| u16::try_from(number(index)).unwrap())
                            .collect(),
                    },
                    crate::accounts::FeedBack {
                        owner: k(1),
                        config: k(2),
                        machine: k(3),
                        deck: k(4),
                        binder: k(5),
                        system_program: k(6),
                    },
                ),
                "withdraw_owed" => check(
                    row,
                    crate::instruction::WithdrawOwed {},
                    crate::accounts::WithdrawOwed {
                        owner: k(1),
                        binder: k(2),
                    },
                ),
                "close_binder" => check(
                    row,
                    crate::instruction::CloseBinder {},
                    crate::accounts::CloseBinder {
                        owner: k(1),
                        binder: k(2),
                    },
                ),
                _ => continue,
            }
            names.insert(row["name"].as_str().unwrap());
        }
        assert_eq!(names.len(), 6);
    }

    #[test]
    fn sb_attestation_vectors_use_exact_domain_order_and_integer_widths() {
        use std::str::FromStr;
        let rows: Vec<Value> =
            serde_json::from_str(include_str!("../../../../fixtures/vectors/attest.json")).unwrap();
        let mut count = 0;
        for row in rows.iter().filter(|row| row["kind"] == "sell_back") {
            let cards = row["cards"].as_array().unwrap();
            let mut bytes = crate::params::ATTESTATIONS_SELL_BACK_DOMAIN.to_vec();
            for name in ["programId", "owner", "mint"] {
                bytes.extend_from_slice(
                    Pubkey::from_str(row[name].as_str().unwrap())
                        .unwrap()
                        .as_ref(),
                );
            }
            bytes.push(u8::try_from(cards.len()).unwrap());
            let mut total = 0u64;
            for card in cards {
                let index = u16::try_from(number(&card["index"])).unwrap();
                let amount = number(&card["amount"]);
                bytes.extend_from_slice(&index.to_le_bytes());
                bytes.extend_from_slice(&amount.to_le_bytes());
                total = total.checked_add(amount).unwrap();
            }
            assert_eq!(number(&row["totalAmount"]), total);
            bytes.extend_from_slice(&total.to_le_bytes());
            bytes.extend_from_slice(&number(&row["quoteLamports"]).to_le_bytes());
            bytes.extend_from_slice(
                &row["expiry"]
                    .as_str()
                    .unwrap()
                    .parse::<i64>()
                    .unwrap()
                    .to_le_bytes(),
            );
            bytes.extend_from_slice(&u32::try_from(number(&row["nonce"])).unwrap().to_le_bytes());
            assert_eq!(bytes.len(), 135 + 10 * cards.len());
            let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
            assert_eq!(row["message"], hex);
            let digest: String = solana_sha256_hasher::hash(&bytes)
                .as_ref()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            assert_eq!(row["sha256"], digest);
            count += 1;
        }
        assert!(count >= 20);
    }
}
