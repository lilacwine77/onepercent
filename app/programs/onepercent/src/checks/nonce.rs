use crate::{errors::MachineError, state::Binder};
use anchor_lang::prelude::*;
pub fn accept_nonce(binder: &mut Binder, nonce: u32) -> Result<()> {
    require!(
        nonce >= binder.feed_nonce_base,
        MachineError::AttestationReplay
    );
    let delta = nonce.saturating_sub(binder.feed_nonce_base);
    if delta >= 16 {
        let shift = delta.saturating_sub(15);
        binder.feed_nonce_bits = if shift >= 16 {
            0
        } else {
            binder
                .feed_nonce_bits
                .checked_shr(shift)
                .unwrap_or_default()
        };
        binder.feed_nonce_base = binder
            .feed_nonce_base
            .checked_add(shift)
            .ok_or(MachineError::MathOverflow)?;
    }
    let bit = 1u16
        .checked_shl(nonce.saturating_sub(binder.feed_nonce_base))
        .ok_or(MachineError::MathOverflow)?;
    require!(
        binder.feed_nonce_bits & bit == 0,
        MachineError::AttestationReplay
    );
    binder.feed_nonce_bits |= bit;
    while binder.feed_nonce_bits & 1 == 1 {
        binder.feed_nonce_bits >>= 1;
        binder.feed_nonce_base = binder
            .feed_nonce_base
            .checked_add(1)
            .ok_or(MachineError::MathOverflow)?;
    }
    Ok(())
}
