#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use super::*;
use crate::{params, state::Binder};
use anchor_lang::{
    __private::bytemuck::Zeroable,
    prelude::*,
    solana_program::{
        instruction::BorrowedInstruction, program_option::COption, program_pack::Pack,
        sysvar::instructions::construct_instructions_data,
    },
};
use anchor_spl::token_2022::spl_token_2022::{extension::ExtensionType, state::Mint};

fn mint_bytes() -> Vec<u8> {
    let mut data = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: COption::None,
            supply: 1,
            decimals: 0,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    data
}
fn check_mint(data: &mut [u8], owner: &Pubkey) -> Result<(u8, u8)> {
    let key = Pubkey::new_unique();
    let mut lamports = 1;
    mint_is_safe(&AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        data,
        owner,
        false,
        0,
    ))
}
#[test]
fn mint_authorities_and_uninitialized_are_rejected() {
    let mut data = mint_bytes();
    assert_eq!(
        check_mint(&mut data, &params::PROGRAM_IDS_SPL_TOKEN).unwrap(),
        (0, 0)
    );
    for mint in [
        Mint {
            mint_authority: COption::Some(Pubkey::new_unique()),
            supply: 1,
            decimals: 0,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        Mint {
            mint_authority: COption::None,
            supply: 1,
            decimals: 0,
            is_initialized: true,
            freeze_authority: COption::Some(Pubkey::new_unique()),
        },
        Mint {
            mint_authority: COption::None,
            supply: 1,
            decimals: 0,
            is_initialized: false,
            freeze_authority: COption::None,
        },
    ] {
        Mint::pack(mint, &mut data).unwrap();
        assert!(check_mint(&mut data, &params::PROGRAM_IDS_SPL_TOKEN).is_err());
    }
}
#[test]
fn token_2022_extensions_are_explicitly_allowlisted() {
    assert_eq!(ExtensionType::MetadataPointer as u16, 18);
    assert_eq!(ExtensionType::TokenMetadata as u16, 19);
    for extension in [18u16, 19, 1, 2, 4000] {
        let mut data = mint_bytes();
        data.resize(170, 0);
        data[165] = 1;
        data[166..168].copy_from_slice(&extension.to_le_bytes());
        assert_eq!(
            check_mint(&mut data, &params::PROGRAM_IDS_TOKEN2022).is_ok(),
            matches!(extension, 18 | 19)
        );
        assert!(check_mint(&mut data, &params::PROGRAM_IDS_SPL_TOKEN).is_err());
    }
}
#[test]
fn token_2022_tlv_bounds_and_account_type_checked() {
    for length in [83usize, 100, 165] {
        let mut data = mint_bytes();
        data.resize(length, 0);
        assert!(check_mint(&mut data, &params::PROGRAM_IDS_TOKEN2022).is_err());
    }
    let mut data = mint_bytes();
    data.resize(170, 0);
    data[165] = 2;
    assert!(check_mint(&mut data, &params::PROGRAM_IDS_TOKEN2022).is_err());
    data[165] = 1;
    data[166..168].copy_from_slice(&18u16.to_le_bytes());
    data[168..170].copy_from_slice(&100u16.to_le_bytes());
    assert!(check_mint(&mut data, &params::PROGRAM_IDS_TOKEN2022).is_err());
}
#[test]
fn nonce_window_accepts_out_of_order_once() {
    let mut binder = Binder::zeroed();
    for nonce in [3u32, 7, 2, 1, 6, 5, 4, 0] {
        accept_nonce(&mut binder, nonce).unwrap();
        assert!(accept_nonce(&mut binder, nonce).is_err());
    }
    assert_eq!((binder.feed_nonce_base, binder.feed_nonce_bits), (8, 0));
    accept_nonce(&mut binder, 40).unwrap();
    assert_eq!(binder.feed_nonce_base, 25);
    assert!(accept_nonce(&mut binder, 24).is_err());
    for nonce in 25..40 {
        accept_nonce(&mut binder, nonce).unwrap();
    }
    assert_eq!((binder.feed_nonce_base, binder.feed_nonce_bits), (41, 0));
}
fn attestation_bytes(key: &Pubkey, message: &[u8]) -> Vec<u8> {
    let mut bytes = vec![1, 0];
    for value in [
        48u16,
        u16::MAX,
        16,
        u16::MAX,
        112,
        u16::try_from(message.len()).unwrap(),
        u16::MAX,
    ] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes.extend_from_slice(key.as_ref());
    bytes.extend_from_slice(&[0; 64]);
    bytes.extend_from_slice(message);
    bytes
}
fn inspect_attestation(bytes: &[u8], key: &Pubkey, message: &[u8]) -> Result<()> {
    let ix = BorrowedInstruction {
        program_id: &params::PROGRAM_IDS_ED25519,
        accounts: vec![],
        data: bytes,
    };
    let mut data = construct_instructions_data(&[ix]);
    let mut lamports = 1;
    let owner = anchor_lang::solana_program::sysvar::ID;
    let account_key = anchor_lang::solana_program::sysvar::instructions::ID;
    verify_ed25519(
        &AccountInfo::new(
            &account_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        ),
        0,
        key,
        message,
    )
}
#[test]
fn ed25519_cross_instruction_offsets_are_rejected() {
    let key = Pubkey::new_unique();
    let message = hold_message(&Pubkey::new_unique(), 100);
    let expected = attestation_bytes(&key, &message);
    inspect_attestation(&expected, &key, &message).unwrap();
    for offset in [4, 8, 14] {
        let mut data = expected.clone();
        data[offset..offset + 2].copy_from_slice(&0u16.to_le_bytes());
        assert!(inspect_attestation(&data, &key, &message).is_err());
    }
}
#[test]
fn ed25519_signature_key_message_bounds_checked() {
    let key = Pubkey::new_unique();
    let message = hold_message(&Pubkey::new_unique(), 100);
    let expected = attestation_bytes(&key, &message);
    for offset in [2, 6, 10, 12] {
        let mut data = expected.clone();
        data[offset..offset + 2].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(inspect_attestation(&data, &key, &message).is_err());
    }
    let mut data = expected.clone();
    data[0] = 2;
    assert!(inspect_attestation(&data, &key, &message).is_err());
    assert!(inspect_attestation(&expected, &Pubkey::new_unique(), &message).is_err());
    let mut changed = message.clone();
    changed[0] ^= 1;
    assert!(inspect_attestation(&expected, &key, &changed).is_err());
}
#[test]
fn messages_bind_order_amount_wallet_and_expiry() {
    let wallet = Pubkey::new_unique();
    let a = (Pubkey::new_unique(), 1);
    let b = (Pubkey::new_unique(), 2);
    let first = feed_message(&wallet, 1, 100, &[a, b]).unwrap();
    assert_eq!(first.len(), 121);
    for other in [
        feed_message(&wallet, 1, 100, &[b, a]).unwrap(),
        feed_message(&wallet, 2, 100, &[a, b]).unwrap(),
        feed_message(&wallet, 1, 101, &[a, b]).unwrap(),
        feed_message(&Pubkey::new_unique(), 1, 100, &[a, b]).unwrap(),
        feed_message(&wallet, 1, 100, &[(a.0, 2), b]).unwrap(),
    ] {
        assert_ne!(first, other);
    }
    assert_eq!(hold_message(&wallet, 100).len(), 84);
}
#[test]
fn expiry_is_inclusive_and_ttl_bounded() {
    let now = 100;
    let ttl = params::ATTESTATIONS_FEED_TTL_SECONDS;
    assert!(validate_expiry(now, now, ttl).is_ok());
    assert!(validate_expiry(now, now + ttl, ttl).is_ok());
    assert!(validate_expiry(now, now - 1, ttl).is_err());
    assert!(validate_expiry(now, now + ttl + 1, ttl).is_err());
}
