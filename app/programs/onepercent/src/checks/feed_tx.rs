use crate::errors::MachineError;
use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT},
        sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
    },
};
pub fn top_level() -> Result<()> {
    require!(
        get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
        MachineError::NotTopLevel
    );
    Ok(())
}
pub fn single_feed(sysvar: &AccountInfo<'_>, feed_discriminator: &[u8]) -> Result<()> {
    let current = usize::from(load_current_index_checked(sysvar)?);
    let mut index = 0usize;
    while let Ok(ix) = load_instruction_at_checked(index, sysvar) {
        require!(
            index == current
                || ix.program_id != crate::ID
                || !ix.data.starts_with(feed_discriminator),
            MachineError::MultipleFeeds
        );
        index = index.checked_add(1).ok_or(MachineError::MathOverflow)?;
    }
    Ok(())
}
pub fn prior_transfer(
    sysvar: &AccountInfo<'_>,
    mint: &AccountInfo<'_>,
    vault: &Pubkey,
    depositor: &Pubkey,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let current = usize::from(load_current_index_checked(sysvar)?);
    let mut expected = Vec::with_capacity(10);
    expected.push(12);
    expected.extend_from_slice(&amount.to_le_bytes());
    expected.push(decimals);
    for index in 0..current {
        let ix = load_instruction_at_checked(index, sysvar)
            .map_err(|_| error!(MachineError::TokensNotReceived))?;
        if ix.program_id == *mint.owner
            && ix.data == expected
            && ix.accounts.get(1).is_some_and(|a| a.pubkey == *mint.key)
            && ix.accounts.get(2).is_some_and(|a| a.pubkey == *vault)
            && ix.accounts.get(3).is_some_and(|a| a.pubkey == *depositor)
        {
            return Ok(());
        }
    }
    err!(MachineError::TokensNotReceived)
}
