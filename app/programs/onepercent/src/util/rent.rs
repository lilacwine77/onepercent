#![deny(clippy::arithmetic_side_effects)]
use crate::errors::MachineError;
use anchor_lang::prelude::*;
pub fn rent_min(size: usize) -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(size))
}
pub fn move_lamports(from: &AccountInfo<'_>, to: &AccountInfo<'_>, want: u64) -> Result<u64> {
    if from.key == to.key || want == 0 {
        return Ok(0);
    }
    require!(
        from.is_writable && to.is_writable,
        MachineError::AccountMismatch
    );
    let value = want
        .min(from.lamports())
        .min(u64::MAX.saturating_sub(to.lamports()));
    **from.try_borrow_mut_lamports()? = from.lamports().saturating_sub(value);
    **to.try_borrow_mut_lamports()? = to.lamports().saturating_add(value);
    Ok(value)
}
pub fn debit_open(from: &AccountInfo<'_>, to: &AccountInfo<'_>, want: u64) -> Result<u64> {
    let available = from.lamports().saturating_sub(rent_min(from.data_len())?);
    move_lamports(from, to, want.min(available))
}
pub fn close_to(from: &AccountInfo<'_>, to: &AccountInfo<'_>) -> Result<u64> {
    require_keys_neq!(*from.key, *to.key, MachineError::AccountMismatch);
    let amount = move_lamports(from, to, from.lamports())?;
    from.resize(0)?;
    from.assign(&anchor_lang::system_program::ID);
    Ok(amount)
}
pub fn rent_exempt_after_credit(account: &AccountInfo<'_>, amount: u64) -> Result<bool> {
    let minimum = rent_min(account.data_len())?;
    Ok(account
        .lamports()
        .checked_add(amount)
        .is_some_and(|balance| balance >= minimum))
}
// The caller supplies the amount that can actually move after its source cap.
pub fn creditable(account: &AccountInfo<'_>, payable_amount: u64) -> Result<bool> {
    Ok(account.is_writable
        && *account.owner == anchor_lang::system_program::ID
        && !account.executable
        && rent_exempt_after_credit(account, payable_amount)?)
}
pub fn payee_check(account: &AccountInfo<'_>) -> Result<()> {
    require!(
        account.is_writable
            || *account.owner != anchor_lang::system_program::ID
            || account.executable
            || account.lamports() == 0,
        MachineError::AccountMismatch
    );
    Ok(())
}
pub fn payee_check_signer(account: &AccountInfo<'_>) -> Result<()> {
    require!(
        account.is_writable
            || *account.owner != anchor_lang::system_program::ID
            || account.executable,
        MachineError::AccountMismatch
    );
    Ok(())
}
