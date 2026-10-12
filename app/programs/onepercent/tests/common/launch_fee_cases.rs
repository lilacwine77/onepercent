#![allow(dead_code)]
use crate::common::launch_cases::*;
use crate::common::*;
use anchor_lang::prelude::Pubkey;
use onepercent::params;
use solana_instruction::Instruction;
use solana_signer::Signer;

pub const PARTNER_BASE_FEE: usize = 264;
pub const PARTNER_QUOTE_FEE: usize = 272;

pub struct DbcClaimCase {
    pub env: Env,
    pub bag: Bag,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub pool_authority: Pubkey,
}

impl DbcClaimCase {
    pub fn new(quote_fee: u64) -> Self {
        let (mut env, bag) = setup();
        env.send(&[power_ix(&env, &bag)], &[]).unwrap();
        let binary = std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/meteora/dbc.so"),
        )
        .unwrap();
        env.svm
            .add_program(addr(&params::PROGRAM_IDS_METEORA_DBC), &binary)
            .unwrap();
        let pool_authority =
            Pubkey::find_program_address(&[b"pool_authority"], &params::PROGRAM_IDS_METEORA_DBC).0;
        let base_vault = env.token_account(pool_authority, &bag, 123);
        let quote_bag = Bag {
            mint: params::WSOL_MINT,
            token_program: token(),
            curve: Pubkey::default(),
            decimals: 9,
        };
        let mut native_mint = vec![0; 82];
        native_mint[44] = 9;
        native_mint[45] = 1;
        env.put(
            params::WSOL_MINT,
            solana_account::Account {
                lamports: env.rent_min(82),
                data: native_mint,
                owner: addr(&token()),
                ..Default::default()
            },
        );
        let quote_vault = env.token_account(pool_authority, &quote_bag, quote_fee);
        let rent = env.rent_min(165);
        env.mutate(quote_vault, |a| {
            a.lamports += quote_fee;
            write_u32(&mut a.data, 109, 1);
            write_u64(&mut a.data, 113, rent);
        });
        env.mutate(bag.curve, |a| {
            write_key(&mut a.data, 168, &base_vault);
            write_key(&mut a.data, 200, &quote_vault);
            write_u64(&mut a.data, PARTNER_BASE_FEE, 123);
            write_u64(&mut a.data, PARTNER_QUOTE_FEE, quote_fee);
        });
        Self {
            env,
            bag,
            base_vault,
            quote_vault,
            pool_authority,
        }
    }
    pub fn claim(&self, kind: u8) -> Instruction {
        let program = params::PROGRAM_IDS_METEORA_DBC;
        instruction(
            "claim_launch_fees",
            vec![
                meta(pubkey(&self.env.authority.pubkey()), true, true),
                meta(self.env.machine, false, false),
                meta(self.env.fee_in, true, false),
                meta(
                    ata(&self.env.fee_in, &params::WSOL_MINT, &token()),
                    true,
                    false,
                ),
                meta(self.bag.curve, true, false),
                meta(params::METEORA_DBC_CONFIG, false, false),
                meta(self.bag.mint, false, false),
                meta(self.base_vault, true, false),
                meta(self.quote_vault, true, false),
                meta(params::WSOL_MINT, false, false),
                meta(self.pool_authority, false, false),
                meta(
                    Pubkey::find_program_address(&[b"__event_authority"], &program).0,
                    false,
                    false,
                ),
                meta(program, false, false),
                meta(token(), false, false),
                meta(anchor_spl::associated_token::ID, false, false),
                meta(system(), false, false),
                meta(onepercent::ID, false, false),
                meta(onepercent::ID, false, false),
                if kind == 0 {
                    meta(ata(&self.env.fee_in, &self.bag.mint, &token()), true, false)
                } else {
                    meta(onepercent::ID, false, false)
                },
            ],
            &[kind],
        )
    }
}

pub struct PoolClaimCase {
    pub env: Env,
    pub bag: Bag,
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub pool: Pubkey,
    pub position: Pubkey,
    pub nft_account: Pubkey,
}
impl PoolClaimCase {
    pub fn new(base_fee: u64, quote_fee: u64, nft_token_program: Pubkey) -> Self {
        let dbc = DbcClaimCase::new(0);
        let mut env = dbc.env;
        let bag = dbc.bag;
        let binary = std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/meteora/damm-v2.so"),
        )
        .unwrap();
        env.svm
            .add_program(addr(&params::PROGRAM_IDS_METEORA_DAMM_V2), &binary)
            .unwrap();
        let authority = Pubkey::find_program_address(
            &[b"pool_authority"],
            &params::PROGRAM_IDS_METEORA_DAMM_V2,
        )
        .0;
        let base_vault = env.token_account(authority, &bag, base_fee);
        let quote_bag = Bag {
            mint: params::WSOL_MINT,
            token_program: token(),
            curve: Pubkey::default(),
            decimals: 9,
        };
        let quote_vault = env.token_account(authority, &quote_bag, quote_fee);
        let rent = env.rent_min(165);
        env.mutate(quote_vault, |a| {
            a.lamports += quote_fee;
            write_u32(&mut a.data, 109, 1);
            write_u64(&mut a.data, 113, rent);
        });
        let pool = Pubkey::new_unique();
        let mut data = vec![0; 1112];
        data[..8].copy_from_slice(&[241, 154, 109, 4, 17, 177, 109, 188]);
        write_key(&mut data, 168, &bag.mint);
        write_key(&mut data, 200, &params::WSOL_MINT);
        write_key(&mut data, 232, &base_vault);
        write_key(&mut data, 264, &quote_vault);
        env.put(
            pool,
            solana_account::Account {
                lamports: env.rent_min(data.len()),
                data,
                owner: addr(&params::PROGRAM_IDS_METEORA_DAMM_V2),
                ..Default::default()
            },
        );
        let nft_mint = Pubkey::new_unique();
        let nft_bag = Bag {
            mint: nft_mint,
            token_program: nft_token_program,
            curve: Pubkey::default(),
            decimals: 0,
        };
        let nft_account = env.token_account(env.fee_in, &nft_bag, 1);
        let position = Pubkey::find_program_address(
            &[b"position", nft_mint.as_ref()],
            &params::PROGRAM_IDS_METEORA_DAMM_V2,
        )
        .0;
        let mut data = vec![0; 408];
        data[..8].copy_from_slice(&[170, 188, 143, 228, 122, 64, 247, 208]);
        write_key(&mut data, 8, &pool);
        write_key(&mut data, 40, &nft_mint);
        write_u64(&mut data, 136, base_fee);
        write_u64(&mut data, 144, quote_fee);
        env.put(
            position,
            solana_account::Account {
                lamports: env.rent_min(data.len()),
                data,
                owner: addr(&params::PROGRAM_IDS_METEORA_DAMM_V2),
                ..Default::default()
            },
        );
        env.track_token_account(ata(&env.fee_in, &bag.mint, &token()));
        Self {
            env,
            bag,
            base_vault,
            quote_vault,
            pool,
            position,
            nft_account,
        }
    }
    pub fn claim(&self) -> Instruction {
        let program = params::PROGRAM_IDS_METEORA_DAMM_V2;
        instruction(
            "claim_launch_fees",
            vec![
                meta(pubkey(&self.env.authority.pubkey()), true, true),
                meta(self.env.machine, false, false),
                meta(self.env.fee_in, true, false),
                meta(
                    ata(&self.env.fee_in, &params::WSOL_MINT, &token()),
                    true,
                    false,
                ),
                meta(self.pool, true, false),
                meta(params::METEORA_DBC_CONFIG, false, false),
                meta(self.bag.mint, false, false),
                meta(self.base_vault, true, false),
                meta(self.quote_vault, true, false),
                meta(params::WSOL_MINT, false, false),
                meta(
                    Pubkey::find_program_address(&[b"pool_authority"], &program).0,
                    false,
                    false,
                ),
                meta(
                    Pubkey::find_program_address(&[b"__event_authority"], &program).0,
                    false,
                    false,
                ),
                meta(program, false, false),
                meta(token(), false, false),
                meta(anchor_spl::associated_token::ID, false, false),
                meta(system(), false, false),
                meta(self.position, true, false),
                meta(self.nft_account, false, false),
                meta(ata(&self.env.fee_in, &self.bag.mint, &token()), true, false),
            ],
            &[1],
        )
    }
}
