//! Test-only oracle endpoint loaded at the real provider's program address.
pub use borsh;
pub use solana_program::program_error;
mod codec;
pub use codec::{decode_request, CallbackMeta, Request};
#[allow(deprecated)]
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction, system_program,
};
entrypoint!(process_instruction);
/// Provider fee from M1 section 10.6; this test program is never deployed.
pub const REQUEST_FEE_LAMPORTS: u64 = 500_000;
fn bad() -> ProgramError {
    ProgramError::InvalidInstructionData
}
fn read_u32(data: &[u8], pos: usize) -> Result<u32, ProgramError> {
    Ok(u32::from_le_bytes(
        data.get(pos..pos.saturating_add(4))
            .ok_or_else(bad)?
            .try_into()
            .map_err(|_| bad())?,
    ))
}
fn request(program_id: &Pubkey, accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    let payer = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let identity = accounts.get(1).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let queue = accounts.get(2).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let system = accounts.get(3).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let request = decode_request(data)?;
    let callback = Pubkey::new_from_array(request.callback_program_id);
    if !payer.is_signer
        || !identity.is_signer
        || *identity.key != Pubkey::find_program_address(&[b"identity"], &callback).0
    {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if queue.owner != program_id || *system.key != system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (count, end) = {
        let contents = queue.try_borrow_data()?;
        let count = read_u32(&contents, 0)?;
        let mut position = 4usize;
        for _ in 0..count {
            let length = read_u32(&contents, position)? as usize;
            position = position
                .checked_add(4)
                .and_then(|x| x.checked_add(length))
                .ok_or_else(bad)?;
            if position > contents.len() {
                return Err(bad());
            }
        }
        (count, position)
    };
    let size = u32::try_from(data.len()).map_err(|_| bad())?;
    let next = end
        .checked_add(4)
        .and_then(|x| x.checked_add(data.len()))
        .ok_or_else(bad)?;
    if next > queue.data_len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    invoke(
        &system_instruction::transfer(payer.key, queue.key, REQUEST_FEE_LAMPORTS),
        &[payer.clone(), queue.clone(), system.clone()],
    )?;
    let mut contents = queue.try_borrow_mut_data()?;
    contents
        .get_mut(..4)
        .ok_or_else(bad)?
        .copy_from_slice(&count.checked_add(1).ok_or_else(bad)?.to_le_bytes());
    contents
        .get_mut(end..end.saturating_add(4))
        .ok_or_else(bad)?
        .copy_from_slice(&size.to_le_bytes());
    contents
        .get_mut(end.saturating_add(4)..next)
        .ok_or_else(bad)?
        .copy_from_slice(data);
    Ok(())
}
fn callback<'info>(
    program_id: &Pubkey,
    identity: &AccountInfo<'info>,
    program: &AccountInfo<'info>,
    metas: Vec<AccountMeta>,
    infos: &[AccountInfo<'info>],
    data: Vec<u8>,
    global: bool,
) -> ProgramResult {
    let (expected, bump) = if global {
        Pubkey::find_program_address(&[b"identity"], program_id)
    } else {
        Pubkey::find_program_address(&[b"identity", program.key.as_ref()], program_id)
    };
    if *identity.key != expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let mut accounts = Vec::with_capacity(metas.len().saturating_add(1));
    accounts.push(AccountMeta::new_readonly(expected, true));
    accounts.extend(metas);
    let ix = Instruction {
        program_id: *program.key,
        accounts,
        data,
    };
    let mut all = Vec::with_capacity(infos.len().saturating_add(2));
    all.push(identity.clone());
    all.extend_from_slice(infos);
    all.push(program.clone());
    let bumps = [bump];
    let seeds: Vec<&[u8]> = if global {
        vec![b"identity", &bumps]
    } else {
        vec![b"identity", program.key.as_ref(), &bumps]
    };
    invoke_signed(&ix, &all, &[&seeds])
}
fn fulfill(program_id: &Pubkey, accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    if data.len() != 37 {
        return Err(bad());
    }
    let index = read_u32(data, 1)?;
    let queue = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let identity = accounts.get(1).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let program = accounts.get(2).ok_or(ProgramError::NotEnoughAccountKeys)?;
    if queue.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let request = {
        let mut contents = queue.try_borrow_mut_data()?;
        let count = read_u32(&contents, 0)?;
        if index >= count {
            return Err(bad());
        }
        let mut position = 4usize;
        for _ in 0..index {
            position = position
                .checked_add(4)
                .and_then(|x| {
                    read_u32(&contents, position)
                        .ok()
                        .and_then(|len| x.checked_add(len as usize))
                })
                .ok_or_else(bad)?;
        }
        let length = read_u32(&contents, position)? as usize;
        let start = position.checked_add(4).ok_or_else(bad)?;
        let end = start.checked_add(length).ok_or_else(bad)?;
        let raw = contents.get_mut(start..end).ok_or_else(bad)?;
        if !matches!(raw.first(), Some(10 | 11)) {
            return Err(bad());
        }
        let request = decode_request(raw)?;
        *raw.first_mut().ok_or_else(bad)? = 0;
        request
    };
    if request.callback_program_id != program.key.to_bytes() {
        return Err(ProgramError::IncorrectProgramId);
    }
    let mut body = request.callback_discriminator;
    body.extend_from_slice(data.get(5..37).ok_or_else(bad)?);
    body.extend_from_slice(&request.callback_args);
    let metas = request
        .callback_accounts_metas
        .into_iter()
        .map(|a| AccountMeta {
            pubkey: Pubkey::new_from_array(a.pubkey),
            is_signer: a.is_signer,
            is_writable: a.is_writable,
        })
        .collect();
    callback(
        program_id,
        identity,
        program,
        metas,
        accounts
            .get(3..)
            .ok_or(ProgramError::NotEnoughAccountKeys)?,
        body,
        false,
    )
}
fn raw(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
    global: bool,
) -> ProgramResult {
    let identity = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let program = accounts.get(1).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let infos = accounts
        .get(2..)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let disc_len = usize::from(*data.get(1).ok_or_else(bad)?);
    let disc_end = 2usize.checked_add(disc_len).ok_or_else(bad)?;
    let random_end = disc_end.checked_add(32).ok_or_else(bad)?;
    let len_end = random_end.checked_add(2).ok_or_else(bad)?;
    let args_len = usize::from(u16::from_le_bytes(
        data.get(random_end..len_end)
            .ok_or_else(bad)?
            .try_into()
            .map_err(|_| bad())?,
    ));
    let end = len_end.checked_add(args_len).ok_or_else(bad)?;
    if end != data.len() {
        return Err(bad());
    }
    let mut body = data.get(2..random_end).ok_or_else(bad)?.to_vec();
    body.extend_from_slice(data.get(len_end..end).ok_or_else(bad)?);
    let metas = infos
        .iter()
        .map(|a| AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer,
            is_writable: a.is_writable,
        })
        .collect();
    callback(program_id, identity, program, metas, infos, body, global)
}
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    match data.first().copied() {
        Some(10 | 11) => request(program_id, accounts, data),
        Some(0xf0) => fulfill(program_id, accounts, data),
        Some(0xf1) => raw(program_id, accounts, data, false),
        Some(0xf2) => raw(program_id, accounts, data, true),
        Some(0xf3) => {
            let target = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
            let infos = accounts
                .get(1..)
                .ok_or(ProgramError::NotEnoughAccountKeys)?;
            let metas = infos
                .iter()
                .map(|a| AccountMeta {
                    pubkey: *a.key,
                    is_signer: a.is_signer,
                    is_writable: a.is_writable,
                })
                .collect();
            invoke(
                &Instruction {
                    program_id: *target.key,
                    accounts: metas,
                    data: data.get(1..).ok_or_else(bad)?.to_vec(),
                },
                accounts,
            )
        }
        _ => Err(bad()),
    }
}
