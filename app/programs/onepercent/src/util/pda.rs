use crate::{errors::MachineError, util::rent_min};
use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke_signed, system_instruction},
    system_program::{self, Transfer},
};
pub fn transfer<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount > 0 {
        system_program::transfer(
            CpiContext::new(
                system.clone(),
                Transfer {
                    from: from.clone(),
                    to: to.clone(),
                },
            ),
            amount,
        )?;
    }
    Ok(())
}
pub fn create_pda<'info>(
    payer: &AccountInfo<'info>,
    target: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    space: usize,
    seeds: &[&[u8]],
) -> Result<()> {
    require_keys_eq!(
        *target.owner,
        system_program::ID,
        MachineError::AccountMismatch
    );
    require!(target.data_is_empty(), MachineError::AccountMismatch);
    let floor = rent_min(space)?;
    let size = u64::try_from(space).map_err(|_| error!(MachineError::MathOverflow))?;
    if target.lamports() == 0 {
        invoke_signed(
            &system_instruction::create_account(payer.key, target.key, floor, size, &crate::ID),
            &[payer.clone(), target.clone(), system.clone()],
            &[seeds],
        )?;
    } else {
        transfer(
            payer,
            target,
            system,
            floor.saturating_sub(target.lamports()),
        )?;
        invoke_signed(
            &system_instruction::allocate(target.key, size),
            &[target.clone(), system.clone()],
            &[seeds],
        )?;
        invoke_signed(
            &system_instruction::assign(target.key, &crate::ID),
            &[target.clone(), system.clone()],
            &[seeds],
        )?;
    }
    Ok(())
}
pub fn address_with_bump(account: &AccountInfo<'_>, seeds: &[&[u8]]) -> Result<()> {
    let expected = Pubkey::create_program_address(seeds, &crate::ID)
        .map_err(|_| error!(MachineError::AccountMismatch))?;
    require_keys_eq!(*account.key, expected, MachineError::AccountMismatch);
    Ok(())
}
