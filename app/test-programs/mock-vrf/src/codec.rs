//! Exact provider request payload, shared with the host conformance test.
use crate::{borsh, program_error::ProgramError};
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct CallbackMeta {
    pub pubkey: [u8; 32],
    pub is_signer: bool,
    pub is_writable: bool,
}
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub caller_seed: [u8; 32],
    pub callback_program_id: [u8; 32],
    pub callback_discriminator: Vec<u8>,
    pub callback_accounts_metas: Vec<CallbackMeta>,
    pub callback_args: Vec<u8>,
}
pub fn decode_request(data: &[u8]) -> Result<Request, ProgramError> {
    Request::try_from_slice(data.get(8..).ok_or(ProgramError::InvalidInstructionData)?)
        .map_err(|_| ProgramError::InvalidInstructionData)
}
