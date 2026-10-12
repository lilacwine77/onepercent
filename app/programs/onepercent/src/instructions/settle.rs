#![deny(clippy::arithmetic_side_effects)]
use crate::{
    constants::*, errors::MachineError, events::*, math, state::views::*, state::*, util::*,
};
use anchor_lang::prelude::*;
#[derive(Accounts)]
pub struct Settle<'info> {
    /// CHECK: Closed Pulls are an idempotent no-op; live Pulls are validated below.
    #[account(mut)]
    pub pull: UncheckedAccount<'info>,
    #[account(mut,seeds=[MACHINE_SEED],bump=machine.load()?.bump)]
    pub machine: AccountLoader<'info, Machine>,
    /// CHECK: Matched to the stored buyer; payee checks handle runtime demotion.
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: Matched to the stored referrer when present.
    pub referrer: UncheckedAccount<'info>,
    /// CHECK: Matched to royalty slot zero when not a House slot.
    pub wallet_0: UncheckedAccount<'info>,
    /// CHECK: Matched to royalty slot one when not a House slot.
    pub wallet_1: UncheckedAccount<'info>,
    /// CHECK: Matched to royalty slot two when not a House slot.
    pub wallet_2: UncheckedAccount<'info>,
    /// CHECK: Matched to royalty slot three when not a House slot.
    pub wallet_3: UncheckedAccount<'info>,
    /// CHECK: Validated when slot zero carries a fresh entry.
    pub binder_0: UncheckedAccount<'info>,
    /// CHECK: Validated when slot one carries a fresh entry.
    pub binder_1: UncheckedAccount<'info>,
    /// CHECK: Validated when slot two carries a fresh entry.
    pub binder_2: UncheckedAccount<'info>,
    /// CHECK: Validated when slot three carries a fresh entry.
    pub binder_3: UncheckedAccount<'info>,
}
fn payable(pull: &AccountInfo<'_>, amount: u64, last: bool) -> Result<u64> {
    let floor = if last { 0 } else { rent_min(pull.data_len())? };
    Ok(amount.min(pull.lamports().saturating_sub(floor)))
}
pub fn handler(ctx: Context<Settle>, seq: u64, pack: u8) -> Result<()> {
    let machine = ctx.accounts.machine.load()?;
    require!(
        machine.exec.kind == EXEC_KIND_NONE,
        MachineError::ExecInFlight
    );
    drop(machine);
    require!(
        ctx.remaining_accounts.is_empty(),
        MachineError::InvalidArgument
    );
    let pull = ctx.accounts.pull.to_account_info();
    let Some(p) = live_pull(&pull)? else {
        return Ok(());
    };
    require!(p.seq == seq, MachineError::PullMismatch);
    checked_pull_address(&pull, &p)?;
    require!(p.status == PULL_REVEALED, MachineError::PullNotRevealed);
    require!(pack < p.qty && p.qty <= 10, MachineError::InvalidArgument);
    let bit = 1u16.checked_shl(u32::from(pack)).unwrap_or_default();
    if p.settled_mask & bit != 0 {
        return Ok(());
    }
    require_keys_eq!(
        ctx.accounts.buyer.key(),
        p.buyer,
        MachineError::AccountMismatch
    );
    if p.referrer != Pubkey::default() {
        require_keys_eq!(
            ctx.accounts.referrer.key(),
            p.referrer,
            MachineError::AccountMismatch
        );
    }
    let all = 1u16
        .checked_shl(u32::from(p.qty))
        .unwrap_or_default()
        .saturating_sub(1);
    let mask = p.settled_mask | bit;
    let last = mask == all;
    let record = {
        let data = pull.try_borrow_data()?;
        *tail::<PackRecord>(&data, PULL_HEADER)?
            .get(usize::from(pack))
            .ok_or(MachineError::AccountMismatch)?
    };
    let wallets = [
        ctx.accounts.wallet_0.to_account_info(),
        ctx.accounts.wallet_1.to_account_info(),
        ctx.accounts.wallet_2.to_account_info(),
        ctx.accounts.wallet_3.to_account_info(),
    ];
    let binders = [
        ctx.accounts.binder_0.to_account_info(),
        ctx.accounts.binder_1.to_account_info(),
        ctx.accounts.binder_2.to_account_info(),
        ctx.accounts.binder_3.to_account_info(),
    ];
    let machine = ctx.accounts.machine.to_account_info();
    let mut paid = [0u64; 4];
    let mut redirected_mask = 0u8;
    for (slot, ((wallet, binder), royalty)) in wallets
        .iter()
        .zip(binders.iter())
        .zip(record.royalties.iter())
        .enumerate()
    {
        let slot = u8::try_from(slot).unwrap_or_default();
        let slot_bit = 1u8.checked_shl(u32::from(slot)).unwrap_or_default();
        if record.house_mask & slot_bit != 0 {
            continue;
        }
        require_keys_eq!(
            *wallet.key,
            royalty.depositor,
            MachineError::AccountMismatch
        );
        let amount = payable(&pull, royalty.lamports.saturating_add(royalty.refund), last)?;
        payee_check_signer(wallet)?;
        let moved = if creditable(wallet, amount)? {
            move_lamports(&pull, wallet, amount)?
        } else {
            let moved = move_lamports(&pull, &machine, amount)?;
            ctx.accounts.machine.load_mut()?.credit_stock(moved);
            redirected_mask |= slot_bit;
            emit!(RoyaltyRedirected {
                seq,
                pack,
                slot,
                depositor: royalty.depositor,
                amount: moved
            });
            moved
        };
        if let Some(value) = paid.get_mut(usize::from(slot)) {
            *value = moved;
        }
        if record.fresh_mask & slot_bit != 0 {
            if *binder.owner == anchor_lang::system_program::ID && binder.data_is_empty() {
                let expected = Pubkey::find_program_address(
                    &[BINDER_SEED, royalty.depositor.as_ref()],
                    &crate::ID,
                )
                .0;
                require_keys_eq!(*binder.key, expected, MachineError::AccountMismatch);
                continue;
            }
            require!(binder.is_writable, MachineError::AccountMismatch);
            validate_binder_owner(binder, &royalty.depositor)?;
            let mut data = binder.try_borrow_mut_data()?;
            let h = header_mut::<Binder>(&mut data)?;
            h.fresh_in_deck = h.fresh_in_deck.saturating_sub(1);
        }
    }
    let mut referral_paid = 0u64;
    if p.referrer != Pubkey::default() {
        let amount = payable(&pull, math::split(p.price).referral, last)?;
        let referrer = ctx.accounts.referrer.to_account_info();
        payee_check(&referrer)?;
        if creditable(&referrer, amount)? {
            referral_paid = move_lamports(&pull, &referrer, amount)?;
        } else {
            let redirected = move_lamports(&pull, &machine, amount)?;
            ctx.accounts.machine.load_mut()?.credit_stock(redirected);
            emit!(ReferralRedirected {
                seq,
                pack,
                referrer: p.referrer,
                amount: redirected,
            });
        }
    }
    header_mut::<Pull>(&mut pull.try_borrow_mut_data()?)?.settled_mask = mask;
    emit!(PackSettled {
        pull: *pull.key,
        seq,
        pack,
        paid,
        redirected_mask,
        referral_paid,
        referral_to_team: 0
    });
    if last {
        {
            let mut m = ctx.accounts.machine.load_mut()?;
            m.unsettled_reveals = m.unsettled_reveals.saturating_sub(1);
        }
        let buyer = ctx.accounts.buyer.to_account_info();
        payee_check_signer(&buyer)?;
        let to_stock = !creditable(&buyer, pull.lamports())?;
        let to = if to_stock { &machine } else { &buyer };
        let lamports = close_to(&pull, to)?;
        if to_stock {
            ctx.accounts.machine.load_mut()?.credit_stock(lamports);
        }
        emit!(PullClosed {
            pull: *pull.key,
            seq,
            to: *to.key,
            lamports,
            to_stock
        });
    }
    Ok(())
}
