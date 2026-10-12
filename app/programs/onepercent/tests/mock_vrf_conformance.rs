use anchor_lang::{
    prelude::{borsh, Pubkey},
    solana_program::program_error,
};
use borsh::BorshSerialize;
use ephemeral_vrf_sdk::{
    instructions::{
        create_request_high_priority_scoped_randomness_ix, create_request_randomness_ix,
        RequestRandomnessParams,
    },
    types::SerializableAccountMeta,
};
#[path = "../../../test-programs/mock-vrf/src/codec.rs"]
mod codec;

#[test]
fn mock_decodes_real_sdk_request_byte_for_byte() {
    let payer = Pubkey::new_unique();
    let queue = Pubkey::new_unique();
    let program = Pubkey::new_unique();
    let accounts: Vec<_> = (0..4)
        .map(|i| SerializableAccountMeta {
            pubkey: Pubkey::new_unique(),
            is_signer: i == 2,
            is_writable: i % 2 == 0,
        })
        .collect();
    let seed = [17u8; 32];
    let discriminator = vec![3, 9, 5, 4, 6, 8, 2, 7];
    let args = u64::MAX.to_le_bytes().to_vec();
    for high_priority in [false, true] {
        let input = RequestRandomnessParams {
            payer,
            oracle_queue: queue,
            callback_program_id: program,
            callback_discriminator: discriminator.clone(),
            accounts_metas: Some(accounts.clone()),
            caller_seed: seed,
            callback_args: Some(args.clone()),
        };
        let instruction = if high_priority {
            create_request_high_priority_scoped_randomness_ix(input)
        } else {
            create_request_randomness_ix(input)
        };
        assert_eq!(instruction.data[0], if high_priority { 11 } else { 10 });
        let decoded = codec::decode_request(&instruction.data).unwrap();
        assert_eq!(decoded.caller_seed, seed);
        assert_eq!(decoded.callback_program_id, program.to_bytes());
        assert_eq!(decoded.callback_discriminator, discriminator);
        assert_eq!(decoded.callback_args, args);
        assert_eq!(
            decoded.callback_accounts_metas,
            accounts
                .iter()
                .map(|a| codec::CallbackMeta {
                    pubkey: a.pubkey.to_bytes(),
                    is_signer: a.is_signer,
                    is_writable: a.is_writable
                })
                .collect::<Vec<_>>()
        );
        assert_eq!(decoded.try_to_vec().unwrap(), instruction.data[8..]);
        assert!(codec::decode_request(&instruction.data[..instruction.data.len() - 1]).is_err());
        let mut trailing = instruction.data.clone();
        trailing.push(0);
        assert!(codec::decode_request(&trailing).is_err());
    }
}
