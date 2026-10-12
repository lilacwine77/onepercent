use crate::{errors::MachineError, params};
use anchor_lang::prelude::*;
pub fn pump_origin(mint: &Pubkey, curve: &AccountInfo<'_>) -> Result<()> {
    let key = Pubkey::find_program_address(
        &[params::PUMP_LAYOUTS_BONDING_CURVE_SEED, mint.as_ref()],
        &params::PROGRAM_IDS_PUMP_FUN,
    )
    .0;
    require_keys_eq!(*curve.key, key, MachineError::NotPumpFun);
    require_keys_eq!(
        *curve.owner,
        params::PROGRAM_IDS_PUMP_FUN,
        MachineError::NotPumpFun
    );
    require!(
        curve.try_borrow_data()?.get(..8)
            == Some(params::PUMP_LAYOUTS_BONDING_CURVE_DISCRIMINATOR.as_slice()),
        MachineError::NotPumpFun
    );
    Ok(())
}
