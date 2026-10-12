use crate::{errors::MachineError, params};
use anchor_lang::{
    prelude::*,
    solana_program::{program_option::COption, program_pack::Pack},
};
use anchor_spl::token_2022::spl_token_2022::{extension::ExtensionType, state::Mint};
pub fn mint_is_safe(account: &AccountInfo<'_>) -> Result<(u8, u8)> {
    let token_program = if *account.owner == params::PROGRAM_IDS_SPL_TOKEN {
        0
    } else if *account.owner == params::PROGRAM_IDS_TOKEN2022 {
        1
    } else {
        return err!(MachineError::MintNotSafe);
    };
    let data = account.try_borrow_data()?;
    require!(
        data.len() == Mint::LEN || (token_program == 1 && data.len() >= 166),
        MachineError::MintNotSafe
    );
    let mint = Mint::unpack(data.get(..Mint::LEN).ok_or(MachineError::MintNotSafe)?)
        .map_err(|_| error!(MachineError::MintNotSafe))?;
    require!(
        mint.is_initialized
            && mint.mint_authority == COption::None
            && mint.freeze_authority == COption::None
            && u32::from(mint.decimals) <= params::FEED_RULES_MAX_MINT_DECIMALS,
        MachineError::MintNotSafe
    );
    if data.len() > Mint::LEN {
        require!(data.get(165) == Some(&1), MachineError::MintNotSafe);
        let mut pos = 166usize;
        while pos < data.len() {
            let head = data
                .get(pos..pos.saturating_add(4))
                .ok_or(MachineError::MintNotSafe)?;
            let ty = u16::from_le_bytes(
                head.get(..2)
                    .ok_or(MachineError::MintNotSafe)?
                    .try_into()
                    .map_err(|_| error!(MachineError::MintNotSafe))?,
            );
            let len = u16::from_le_bytes(
                head.get(2..4)
                    .ok_or(MachineError::MintNotSafe)?
                    .try_into()
                    .map_err(|_| error!(MachineError::MintNotSafe))?,
            );
            if ty == 0 && len == 0 {
                break;
            }
            require!(
                ty == ExtensionType::MetadataPointer as u16
                    || ty == ExtensionType::TokenMetadata as u16,
                MachineError::MintNotSafe
            );
            pos = pos
                .checked_add(4)
                .and_then(|x| x.checked_add(usize::from(len)))
                .ok_or(MachineError::MintNotSafe)?;
            require!(pos <= data.len(), MachineError::MintNotSafe);
        }
    }
    Ok((mint.decimals, token_program))
}
