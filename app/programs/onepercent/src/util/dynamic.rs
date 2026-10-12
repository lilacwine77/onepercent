use crate::{constants::*, errors::MachineError, params, state::views::*, state::*, util::*};
use anchor_lang::{__private::bytemuck::Zeroable, prelude::*};
pub fn ensure_binder<'info>(
    binder: &AccountInfo<'info>,
    owner: &Pubkey,
    payer: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> Result<()> {
    let (key, bump) = Pubkey::find_program_address(&[BINDER_SEED, owner.as_ref()], &crate::ID);
    require_keys_eq!(*binder.key, key, MachineError::AccountMismatch);
    if *binder.owner == anchor_lang::system_program::ID {
        create_pda(
            payer,
            binder,
            system,
            binder_size(0),
            &[BINDER_SEED, owner.as_ref(), &[bump]],
        )?;
        let mut value = Binder::zeroed();
        value.owner = *owner;
        value.bump = bump;
        init_header(&mut binder.try_borrow_mut_data()?, value)?;
    } else {
        validate::<Binder>(binder)?;
        require_keys_eq!(
            header::<Binder>(&binder.try_borrow_data()?)?.owner,
            *owner,
            MachineError::AccountMismatch
        );
    }
    Ok(())
}
pub fn ensure_ledger<'info>(
    ledger: &AccountInfo<'info>,
    mint: &Pubkey,
    payer: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> Result<()> {
    let (key, bump) = Pubkey::find_program_address(&[LEDGER_SEED, mint.as_ref()], &crate::ID);
    require_keys_eq!(*ledger.key, key, MachineError::LedgerMismatch);
    if *ledger.owner == anchor_lang::system_program::ID {
        create_pda(
            payer,
            ledger,
            system,
            params::ACCOUNT_SIZES_MINT_LEDGER as usize,
            &[LEDGER_SEED, mint.as_ref(), &[bump]],
        )?;
        init_header(
            &mut ledger.try_borrow_mut_data()?,
            MintLedger {
                mint: *mint,
                payer: *payer.key,
                accounted: 0,
            },
        )?;
    } else {
        validate::<MintLedger>(ledger).map_err(|_| error!(MachineError::LedgerMismatch))?;
        require_keys_eq!(
            header::<MintLedger>(&ledger.try_borrow_data()?)?.mint,
            *mint,
            MachineError::LedgerMismatch
        );
    }
    Ok(())
}
pub fn grow_binder<'info>(
    binder: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    slots: u16,
) -> Result<()> {
    let mut h = *header::<Binder>(&binder.try_borrow_data()?)?;
    let free = h.cap.saturating_sub(h.len).saturating_sub(h.reserved);
    if free < slots {
        let cap = h
            .cap
            .checked_add(slots.saturating_sub(free))
            .ok_or(MachineError::BinderFull)?;
        let floor = rent_min(binder_size(cap))?
            .checked_add(h.sol_owed)
            .ok_or(MachineError::MathOverflow)?;
        transfer(
            payer,
            binder,
            system,
            floor.saturating_sub(binder.lamports()),
        )?;
        binder.resize(binder_size(cap))?;
        h.cap = cap;
    }
    h.reserved = h
        .reserved
        .checked_add(slots)
        .ok_or(MachineError::BinderFull)?;
    *header_mut::<Binder>(&mut binder.try_borrow_mut_data()?)? = h;
    Ok(())
}
pub fn shrink_binder(binder: &AccountInfo<'_>, owner: &AccountInfo<'_>) -> Result<u64> {
    let mut h = *header::<Binder>(&binder.try_borrow_data()?)?;
    let target = h.len.saturating_add(h.reserved);
    if target >= h.cap {
        return Ok(0);
    }
    let floor = rent_min(binder_size(target))?.saturating_add(h.sol_owed);
    if binder.lamports() < floor {
        return Ok(0);
    }
    binder.resize(binder_size(target))?;
    h.cap = target;
    *header_mut::<Binder>(&mut binder.try_borrow_mut_data()?)? = h;
    let refund = binder.lamports().saturating_sub(floor);
    if creditable(owner, refund)? {
        move_lamports(binder, owner, refund)
    } else {
        Ok(0)
    }
}
pub fn release_deck(deck: &AccountInfo<'_>, deposits: &[u32]) -> Result<Vec<u64>> {
    let mut h = *header::<Deck>(&deck.try_borrow_data()?)?;
    if h.len < h.cap && deck.lamports() >= rent_min(deck_size(h.len))? {
        deck.resize(deck_size(h.len))?;
        h.cap = h.len;
        *header_mut::<Deck>(&mut deck.try_borrow_mut_data()?)? = h;
    }
    let mut available = deck.lamports().saturating_sub(rent_min(deck_size(h.cap))?);
    Ok(deposits
        .iter()
        .map(|deposit| {
            let refund = u64::from(*deposit).min(available);
            available = available.saturating_sub(refund);
            refund
        })
        .collect())
}
pub fn live_pull(account: &AccountInfo<'_>) -> Result<Option<Pull>> {
    if *account.owner != crate::ID || account.data_len() < PULL_HEADER {
        return Ok(None);
    }
    let data = account.try_borrow_data()?;
    if data.get(..8) != Some(Pull::DISCRIMINATOR) {
        return Ok(None);
    }
    Ok(Some(*header::<Pull>(&data)?))
}
pub fn checked_pull_address(account: &AccountInfo<'_>, pull: &Pull) -> Result<()> {
    address_with_bump(
        account,
        &[
            PULL_SEED,
            pull.buyer.as_ref(),
            &pull.buyer_nonce.to_le_bytes(),
            &[pull.bump],
        ],
    )
}
pub fn validate_binder_owner(account: &AccountInfo<'_>, owner: &Pubkey) -> Result<()> {
    validate::<Binder>(account)?;
    let data = account.try_borrow_data()?;
    let h = header::<Binder>(&data)?;
    require_keys_eq!(h.owner, *owner, MachineError::AccountMismatch);
    require!(
        data.len() == binder_size(h.cap),
        MachineError::AccountMismatch
    );
    address_with_bump(account, &[BINDER_SEED, owner.as_ref(), &[h.bump]])
}
