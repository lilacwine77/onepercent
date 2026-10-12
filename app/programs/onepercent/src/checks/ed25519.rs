use crate::{errors::MachineError, params};
use anchor_lang::{prelude::*, solana_program::sysvar::instructions::load_instruction_at_checked};
use solana_sha256_hasher::hashv;
fn u16_at(data: &[u8], start: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(
        data.get(start..start.saturating_add(2))
            .ok_or(MachineError::AttestationInvalid)?
            .try_into()
            .map_err(|_| error!(MachineError::AttestationInvalid))?,
    ))
}
pub fn verify_ed25519(
    sysvar: &AccountInfo<'_>,
    index: u8,
    public_key: &Pubkey,
    message: &[u8],
) -> Result<()> {
    let ix = load_instruction_at_checked(usize::from(index), sysvar)
        .map_err(|_| error!(MachineError::AttestationInvalid))?;
    require_keys_eq!(
        ix.program_id,
        params::PROGRAM_IDS_ED25519,
        MachineError::AttestationInvalid
    );
    let data = &ix.data;
    require!(data.first() == Some(&1), MachineError::AttestationInvalid);
    let signature = usize::from(u16_at(data, 2)?);
    let key = usize::from(u16_at(data, 6)?);
    let msg = usize::from(u16_at(data, 10)?);
    let len = usize::from(u16_at(data, 12)?);
    require!(
        u16_at(data, 4)? == u16::MAX
            && u16_at(data, 8)? == u16::MAX
            && u16_at(data, 14)? == u16::MAX,
        MachineError::AttestationInvalid
    );
    require!(
        data.get(signature..signature.saturating_add(64)).is_some(),
        MachineError::AttestationInvalid
    );
    require!(
        data.get(key..key.saturating_add(32)) == Some(public_key.as_ref())
            && data.get(msg..msg.saturating_add(len)) == Some(message),
        MachineError::AttestationInvalid
    );
    Ok(())
}
pub fn validate_expiry(now: i64, expiry: i64, ttl: i64) -> Result<()> {
    require!(
        expiry >= now && expiry <= now.saturating_add(ttl),
        MachineError::AttestationExpired
    );
    Ok(())
}
pub fn feed_message(
    wallet: &Pubkey,
    nonce: u32,
    expiry: i64,
    bags: &[(Pubkey, u64)],
) -> Result<Vec<u8>> {
    let mut body = Vec::with_capacity(bags.len().saturating_mul(40));
    for (mint, amount) in bags {
        body.extend_from_slice(mint.as_ref());
        body.extend_from_slice(&amount.to_le_bytes());
    }
    let hash = hashv(&[&body]).to_bytes();
    let count = u8::try_from(bags.len()).map_err(|_| error!(MachineError::InvalidArgument))?;
    let mut message = Vec::with_capacity(121);
    message.extend_from_slice(params::ATTESTATIONS_FEED_DOMAIN);
    message.extend_from_slice(crate::ID.as_ref());
    message.extend_from_slice(wallet.as_ref());
    message.extend_from_slice(&nonce.to_le_bytes());
    message.extend_from_slice(&expiry.to_le_bytes());
    message.push(count);
    message.extend_from_slice(&hash);
    Ok(message)
}
pub fn hold_message(wallet: &Pubkey, expiry: i64) -> Vec<u8> {
    let mut message = Vec::with_capacity(84);
    message.extend_from_slice(params::ATTESTATIONS_HOLD_DOMAIN);
    message.extend_from_slice(crate::ID.as_ref());
    message.extend_from_slice(wallet.as_ref());
    message.extend_from_slice(&expiry.to_le_bytes());
    message
}
