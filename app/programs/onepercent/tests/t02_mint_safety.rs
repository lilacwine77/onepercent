#[path = "common/intake_cases.rs"]
mod cases;
mod common;
use anchor_lang::prelude::*;
use cases::*;
use common::*;
use onepercent::{checks, params};
use solana_signer::Signer;

fn safety(data: Vec<u8>, owner: Pubkey) -> anchor_lang::Result<(u8, u8)> {
    let mint = Pubkey::new_unique();
    let mut data = data;
    let mut lamports = 1;
    let a = AccountInfo::new(
        &mint,
        false,
        false,
        &mut lamports,
        &mut data,
        &owner,
        false,
        0,
    );
    checks::mint_is_safe(&a)
}
fn unsafe_mint(data: Vec<u8>, owner: Pubkey) {
    assert!(safety(data, owner)
        .unwrap_err()
        .to_string()
        .contains("MintNotSafe"));
}
fn origin(
    mint: Pubkey,
    address: Pubkey,
    owner: Pubkey,
    mut data: Vec<u8>,
) -> anchor_lang::Result<()> {
    let mut lamports = 1;
    let a = AccountInfo::new(
        &address,
        false,
        false,
        &mut lamports,
        &mut data,
        &owner,
        false,
        0,
    );
    checks::pump_origin(&mint, &a)
}

#[test]
fn t02_01_spl_null_authorities_safe() {
    assert_eq!(safety(mint_data(6), token()).unwrap(), (6, 0));
}
#[test]
fn t02_02_authorities_or_decimals_rejected() {
    for offset in [0, 46] {
        let mut data = mint_data(6);
        write_u32(&mut data, offset, 1);
        unsafe_mint(data, token());
    }
    unsafe_mint(mint_data(10), token());
}
#[test]
fn t02_03_t22_metadata_pointer_and_metadata_safe() {
    let mint = Pubkey::new_unique();
    let data = t22_data(mint, &[(18, vec![0; 64]), (19, vec![0; 80])]);
    assert_eq!(safety(data, token2022()).unwrap(), (6, 1));
    let mut env = Env::new();
    let bag = metadata_bag(&mut env);
    let user = env.user_with_bag(&bag, 1000);
    env.feed(&user, &bag, 1000, 0).unwrap();
    check_intake(&env);
}
#[test]
fn t02_04_t22_each_other_extension_rejected() {
    for ty in (1..=28).chain([0x7fff]) {
        if ty == 18 || ty == 19 {
            continue;
        }
        unsafe_mint(
            t22_data(Pubkey::new_unique(), &[(ty, vec![0; 128])]),
            token2022(),
        );
    }
}
#[test]
fn t02_05_t22_malformed_rejected() {
    let mut data = t22_data(Pubkey::new_unique(), &[(18, vec![0; 64])]);
    data[165] = 2;
    unsafe_mint(data, token2022());
    let mut data = mint_data(6);
    data.resize(100, 0);
    unsafe_mint(data, token2022());
    let mut data = t22_data(Pubkey::new_unique(), &[(18, vec![0; 64])]);
    write_u16(&mut data, 168, 1000);
    unsafe_mint(data, token2022());
}
#[test]
fn t02_06_wrong_owner_rejected() {
    for owner in [system(), Pubkey::new_unique()] {
        unsafe_mint(mint_data(6), owner);
    }
}
#[test]
fn t02_07_bonding_curve_lengths_accepted() {
    let mint = Pubkey::new_unique();
    let owner = params::PROGRAM_IDS_PUMP_FUN;
    let address = Pubkey::find_program_address(
        &[params::PUMP_LAYOUTS_BONDING_CURVE_SEED, mint.as_ref()],
        &owner,
    )
    .0;
    for len in [81, 150, 166] {
        let mut data = vec![0; len];
        data[..8].copy_from_slice(&params::PUMP_LAYOUTS_BONDING_CURVE_DISCRIMINATOR);
        origin(mint, address, owner, data).unwrap();
    }
}
#[test]
fn t02_08_bonding_curve_rejections() {
    let mint = Pubkey::new_unique();
    let owner = params::PROGRAM_IDS_PUMP_FUN;
    let address = Pubkey::find_program_address(
        &[params::PUMP_LAYOUTS_BONDING_CURVE_SEED, mint.as_ref()],
        &owner,
    )
    .0;
    let mut data = vec![0; 81];
    data[..8].copy_from_slice(&params::PUMP_LAYOUTS_BONDING_CURVE_DISCRIMINATOR);
    for (addr, own, bytes) in [
        (address, owner, vec![]),
        (address, system(), data.clone()),
        (address, owner, vec![0; 81]),
        (Pubkey::new_unique(), owner, data),
        (address, owner, vec![0; 7]),
    ] {
        assert!(origin(mint, addr, own, bytes)
            .unwrap_err()
            .to_string()
            .contains("NotPumpFun"));
    }
}
#[test]
fn t02_09_forbidden_mints() {
    for forbidden in [
        params::WSOL_MINT,
        onepercent::constants::NATIVE_MINT_2022,
        Pubkey::new_unique(),
    ] {
        let mut env = Env::new();
        let bag = env.new_pump_mint(false);
        let user = env.user_with_bag(&bag, 1000);
        if forbidden != params::WSOL_MINT && forbidden != onepercent::constants::NATIVE_MINT_2022 {
            config(&mut env, |c| c.token_mint = forbidden);
        }
        let mut ixs = env.feed_ixs(pubkey(&user.pubkey()), &[(&bag, 1000)], 0);
        // Transfer a valid bag, then point the authenticated Feed at the forbidden mint.
        let mint_acc = env.account(bag.mint);
        env.put(forbidden, mint_acc);
        let message = checks::feed_message(
            &pubkey(&user.pubkey()),
            0,
            env.now() + 110,
            &[(forbidden, 1000)],
        )
        .unwrap();
        ixs[0] = env.attest_ix(&message);
        ixs.last_mut().unwrap().accounts[7].pubkey = addr(&forbidden);
        assert_error(env.send(&ixs, &[&user]), "MintForbidden");
    }
}
#[test]
fn t02_10_extension_codes() {
    use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
    assert_eq!(ExtensionType::MetadataPointer as u16, 18);
    assert_eq!(ExtensionType::TokenMetadata as u16, 19);
}
