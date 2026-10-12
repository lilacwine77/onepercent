//! Bind a top-level executor entry to its sole later completion.
use crate::{errors::MachineError, instruction::ExecEnd};
use anchor_lang::{
    prelude::*,
    solana_program::sysvar::instructions::{
        load_current_index_checked, load_instruction_at_checked,
    },
    Discriminator,
};

pub fn check_exec_pairing(instructions: &AccountInfo<'_>, kind: u8) -> Result<()> {
    let current = usize::from(
        load_current_index_checked(instructions).map_err(|_| error!(MachineError::ExecPairing))?,
    );
    let mut index = 0usize;
    let mut paired = false;
    while let Ok(ix) = load_instruction_at_checked(index, instructions) {
        if index != current && ix.program_id == crate::ID {
            require!(
                !paired
                    && index > current
                    && ix.data.starts_with(ExecEnd::DISCRIMINATOR)
                    && ix.data.get(8) == Some(&kind),
                MachineError::ExecPairing
            );
            paired = true;
        }
        index = index.checked_add(1).ok_or(MachineError::MathOverflow)?;
    }
    require!(paired, MachineError::ExecPairing);
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::{
        instruction::BorrowedInstruction,
        sysvar::instructions::{construct_instructions_data, store_current_index_checked},
    };

    fn check(sequence: &[(Pubkey, Vec<u8>)], current: u16) -> Result<()> {
        let borrowed: Vec<_> = sequence
            .iter()
            .map(|(program, data)| BorrowedInstruction {
                program_id: program,
                accounts: vec![],
                data,
            })
            .collect();
        let mut data = construct_instructions_data(&borrowed);
        store_current_index_checked(&mut data, current).unwrap();
        let mut lamports = 1;
        check_exec_pairing(
            &AccountInfo::new(
                &anchor_lang::solana_program::sysvar::instructions::ID,
                false,
                false,
                &mut lamports,
                &mut data,
                &anchor_lang::solana_program::sysvar::ID,
                false,
                0,
            ),
            crate::constants::EXEC_KIND_STOCK_BUY,
        )
    }

    #[test]
    fn pairing_counts_every_program_instruction_before_and_after() {
        let begin = (crate::ID, vec![0; 18]);
        let mut end_data = ExecEnd::DISCRIMINATOR.to_vec();
        end_data.push(crate::constants::EXEC_KIND_STOCK_BUY);
        let end = (crate::ID, end_data);
        let external = (Pubkey::new_unique(), vec![]);
        let valid = [
            external.clone(),
            begin.clone(),
            external.clone(),
            end.clone(),
            external,
        ];
        check(&valid, 1).unwrap();
        for index in 0..=valid.len() {
            let mut extra = valid.to_vec();
            extra.insert(index, (crate::ID, vec![99]));
            assert!(check(&extra, if index <= 1 { 2 } else { 1 }).is_err());
        }
        assert!(check(std::slice::from_ref(&begin), 0).is_err());
        assert!(check(&[end.clone(), begin.clone()], 1).is_err());
        assert!(check(&[begin.clone(), end.clone(), end], 0).is_err());
        for bytes in [vec![], ExecEnd::DISCRIMINATOR.to_vec(), {
            let mut bytes = ExecEnd::DISCRIMINATOR.to_vec();
            bytes.push(crate::constants::EXEC_KIND_STOCK_SELL);
            bytes
        }] {
            assert!(check(&[begin.clone(), (crate::ID, bytes)], 0).is_err());
        }
    }
}
