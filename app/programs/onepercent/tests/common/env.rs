use super::conv::*;
use agave_feature_set::FeatureSet;
use anchor_lang::prelude::Pubkey;
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_rent::Rent;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{collections::BTreeSet, path::PathBuf, str::FromStr};

thread_local! {
    static BENCH_SIGNER_SEED: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

fn fixture_signer() -> Keypair {
    BENCH_SIGNER_SEED.with(|state| match state.get() {
        Some(counter) => {
            state.set(Some(counter.checked_add(1).unwrap()));
            let seed =
                solana_sha256_hasher::hashv(&[b"onepercent-cu-fixture", &counter.to_le_bytes()]);
            Keypair::new_from_array(seed.to_bytes())
        }
        None => Keypair::new(),
    })
}

pub struct Env {
    pub svm: LiteSVM,
    pub authority: Keypair,
    pub intake: Keypair,
    pub guardian: Keypair,
    pub config: Pubkey,
    pub machine: Pubkey,
    pub deck: Pubkey,
    pub fee_in: Pubkey,
    pub vault_auth: Pubkey,
    pub queue: Pubkey,
    pub program_data: Pubkey,
    pub token_mint: Pubkey,
    pub tracked: BTreeSet<Pubkey>,
    token_tracked: BTreeSet<Pubkey>,
    pub transactions: Vec<TransactionMetadata>,
}

#[derive(Clone, Debug)]
pub struct Bag {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub curve: Pubkey,
    pub decimals: u8,
}
pub fn system() -> Pubkey {
    Pubkey::default()
}
pub fn token() -> Pubkey {
    anchor_spl::token::ID
}
pub fn token2022() -> Pubkey {
    anchor_spl::token_2022::ID
}
pub fn vrf() -> Pubkey {
    onepercent::params::PROGRAM_IDS_MAGICBLOCK_VRF
}
pub fn loader() -> Pubkey {
    key("BPFLoaderUpgradeab1e11111111111111111111111")
}
pub fn instructions_sysvar() -> Pubkey {
    anchor_lang::solana_program::sysvar::instructions::ID
}
pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address_with_program_id(
        owner,
        mint,
        token_program,
    )
}

impl Env {
    /// Repeatable local CU samples; never enabled by an exporter or devnet runner.
    pub fn deterministic_bench_signers(seed: u64) {
        BENCH_SIGNER_SEED.with(|state| state.set(Some(seed)));
    }
    pub fn new() -> Self {
        Self::with_mainnet(false)
    }
    pub fn with_mainnet(mainnet: bool) -> Self {
        let mut env = Self::empty(mainnet);
        let init = env.initialize_ix();
        env.send(&[init], &[]).unwrap();
        let now = env.now();
        let slot = env.svm.get_sysvar::<Clock>().slot;
        let mut args = vec![2];
        args.extend_from_slice(&slot.to_le_bytes());
        args.extend_from_slice(&(now - 10).to_le_bytes());
        args.extend_from_slice(&(now + 1).to_le_bytes());
        env.send(&[env.admin_ix(args)], &[]).unwrap();
        env.warp(2);
        env.send(
            &[instruction(
                "advance_phase",
                vec![
                    meta(env.config, false, false),
                    meta(env.machine, true, false),
                ],
                &[],
            )],
            &[],
        )
        .unwrap();
        env
    }
    pub fn empty(mainnet: bool) -> Self {
        let mut svm = if mainnet {
            let snapshot: serde_json::Value =
                serde_json::from_str(include_str!("../../../../fixtures/mainnet/features.json"))
                    .unwrap();
            let mut features = FeatureSet::default();
            for feature in snapshot["features"].as_array().unwrap() {
                if let Some(slot) = feature["activatedAt"].as_u64() {
                    features.activate(
                        &solana_address::Address::from_str(feature["pubkey"].as_str().unwrap())
                            .unwrap(),
                        slot,
                    );
                }
            }
            LiteSVM::default()
                .with_feature_set(features)
                .with_builtins()
                .with_sysvars()
                .with_default_programs()
                .with_precompiles()
                .with_sigverify(true)
                .with_blockhash_check(true)
        } else {
            LiteSVM::new().with_sigverify(true)
        };
        let authority = fixture_signer();
        let intake = fixture_signer();
        let guardian = fixture_signer();
        let mut rent = Rent::default();
        rent.lamports_per_byte = 5080;
        svm.set_sysvar(&rent);
        svm.set_sysvar(&Clock {
            slot: 500_000_000,
            unix_timestamp: 1_800_000_000,
            ..Default::default()
        });
        let program_data = Pubkey::find_program_address(&[onepercent::ID.as_ref()], &loader()).0;
        let mut env = Self {
            svm,
            authority,
            intake,
            guardian,
            config: pda(&[b"config"]).0,
            machine: pda(&[b"machine"]).0,
            deck: pda(&[b"deck"]).0,
            fee_in: pda(&[b"fee_in"]).0,
            vault_auth: pda(&[b"vault_auth"]).0,
            queue: Pubkey::new_unique(),
            program_data,
            token_mint: Pubkey::new_unique(),
            tracked: BTreeSet::new(),
            token_tracked: BTreeSet::new(),
            transactions: Vec::new(),
        };
        env.fund(pubkey(&env.authority.pubkey()), 100_000_000_000_000);
        env.fund(pubkey(&env.guardian.pubkey()), 10_000_000_000);
        let so = std::fs::read(Self::artifact("onepercent.so"))
            .expect("build the sBPFv3 artifact with pnpm program:build");
        assert_eq!(&so[48..52], &3u32.to_le_bytes());
        env.install_program(onepercent::ID, &so, pubkey(&env.authority.pubkey()));
        let mock = std::fs::read(Self::artifact("mock_vrf.so"))
            .expect("build the mock with pnpm mockvrf:build");
        assert_eq!(&mock[48..52], &3u32.to_le_bytes());
        env.svm.add_program(addr(&vrf()), &mock).unwrap();
        env.put(
            env.queue,
            Account {
                lamports: env.rent_min(65536),
                data: vec![0; 65536],
                owner: addr(&vrf()),
                ..Default::default()
            },
        );
        env.tracked.extend([
            env.config,
            env.machine,
            env.deck,
            env.fee_in,
            env.vault_auth,
        ]);
        env
    }
    pub fn artifact(file: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/deploy")
            .join(file)
    }
    pub fn rent_min(&self, size: usize) -> u64 {
        self.svm.get_sysvar::<Rent>().minimum_balance(size)
    }
    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }
    pub fn set_rent(&mut self, per_byte: u64) {
        let mut rent = Rent::default();
        rent.lamports_per_byte = per_byte;
        self.svm.set_sysvar(&rent);
    }
    pub fn warp(&mut self, seconds: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += seconds;
        clock.slot += seconds.max(0) as u64 * 2;
        self.svm.set_sysvar(&clock);
        self.svm.expire_blockhash();
    }
    pub fn account(&self, at: Pubkey) -> Account {
        self.svm.get_account(&addr(&at)).unwrap()
    }
    pub fn put(&mut self, at: Pubkey, account: Account) {
        self.tracked.insert(at);
        if account.owner == addr(&token()) || account.owner == addr(&token2022()) {
            self.token_tracked.insert(at);
        }
        self.svm.set_account(addr(&at), account).unwrap();
    }
    pub fn fund(&mut self, at: Pubkey, lamports: u64) {
        self.put(
            at,
            Account {
                lamports,
                owner: addr(&system()),
                ..Default::default()
            },
        );
    }
    pub fn user(&mut self) -> Keypair {
        let user = fixture_signer();
        self.fund(pubkey(&user.pubkey()), 1_000_000_000_000);
        user
    }
    pub fn mutate(&mut self, at: Pubkey, edit: impl FnOnce(&mut Account)) {
        let mut account = self.account(at);
        edit(&mut account);
        self.put(at, account);
    }
    pub fn donate_lamports(&mut self, at: Pubkey, amount: u64) {
        let mut account = self.svm.get_account(&addr(&at)).unwrap_or_default();
        account.lamports += amount;
        self.put(at, account);
    }
    pub fn donate_tokens(&mut self, vault: Pubkey, amount: u64) {
        self.mutate(vault, |a| {
            let old = read_u64(&a.data, 64);
            write_u64(&mut a.data, 64, old + amount);
        });
    }
    pub fn inject_phase(&mut self, phase: u8) {
        let now = self.now();
        self.mutate(self.machine, |a| {
            a.data[10] = phase;
            write_u64(&mut a.data, 48, (now - 60) as u64);
            write_u64(&mut a.data, 56, (now + 604800) as u64);
            let mut m: onepercent::state::Machine = bytemuck::pod_read_unaligned(&a.data[8..]);
            if m.token_mint == Pubkey::default() {
                // A pre-M4 fixture has no backed special claims.
                for slot in &mut m.onepct {
                    slot.state = onepercent::constants::ONEPCT_PULLED;
                }
                a.data[8..].copy_from_slice(bytemuck::bytes_of(&m));
            }
        });
    }
    pub fn install_program(&mut self, at: Pubkey, so: &[u8], authority: Pubkey) {
        let pd = Pubkey::find_program_address(&[at.as_ref()], &loader()).0;
        let mut data = 3u32.to_le_bytes().to_vec();
        data.extend_from_slice(&0u64.to_le_bytes());
        data.push(1);
        data.extend_from_slice(authority.as_ref());
        data.extend_from_slice(so);
        self.put(
            pd,
            Account {
                lamports: self.rent_min(data.len()),
                data,
                owner: addr(&loader()),
                ..Default::default()
            },
        );
        let mut data = 2u32.to_le_bytes().to_vec();
        data.extend_from_slice(pd.as_ref());
        self.put(
            at,
            Account {
                lamports: self.rent_min(data.len()),
                data,
                owner: addr(&loader()),
                executable: true,
                ..Default::default()
            },
        );
    }
    pub fn make_program(&mut self, at: Pubkey) {
        let so = std::fs::read(Self::artifact("onepercent.so")).unwrap();
        self.install_program(at, &so, at);
    }
    pub fn send(
        &mut self,
        instructions: &[Instruction],
        signers: &[&Keypair],
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let payer = self.authority.insecure_clone();
        self.send_with_payer(instructions, &payer, signers)
    }
    pub fn send_with_payer(
        &mut self,
        instructions: &[Instruction],
        fee_payer: &Keypair,
        signers: &[&Keypair],
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let mut all = vec![fee_payer];
        for signer in signers {
            if !all.iter().any(|s| s.pubkey() == signer.pubkey()) {
                all.push(*signer);
            }
        }
        self.tracked.insert(pubkey(&fee_payer.pubkey()));
        for instruction in instructions {
            for account in &instruction.accounts {
                self.tracked.insert(pubkey(&account.pubkey));
                if instruction.program_id == addr(&token())
                    || instruction.program_id == addr(&token2022())
                    || instruction.program_id == addr(&anchor_spl::associated_token::ID)
                {
                    self.token_tracked.insert(pubkey(&account.pubkey));
                }
            }
        }
        let (tokens_before, supply_before) = self.token_quantities();
        let payer_before = self.svm.get_balance(&fee_payer.pubkey()).unwrap_or(0);
        let mut total_before: u128 = self
            .tracked
            .iter()
            .filter_map(|at| self.svm.get_balance(&addr(at)))
            .map(u128::from)
            .sum();
        let message =
            Message::new_with_blockhash(instructions, Some(&fee_payer.pubkey()), &blockhash);
        let tx = Transaction::new(&all, message, blockhash);
        let legacy_size = 1 + 64 * tx.signatures.len() + tx.message.serialize().len();
        let result = if legacy_size <= 1232 {
            self.svm.send_transaction(tx)
        } else {
            // The measured multi-bag shapes use a real v0 lookup account when legacy does not fit.
            let table = Pubkey::new_unique();
            let addresses: Vec<_> = tx
                .message
                .account_keys
                .iter()
                .copied()
                .filter(|k| !all.iter().any(|s| s.pubkey() == *k))
                .collect();
            let mut data = vec![0; 56];
            write_u32(&mut data, 0, 1);
            write_u64(&mut data, 4, u64::MAX);
            for address in &addresses {
                data.extend_from_slice(address.as_ref());
            }
            let lamports = self.rent_min(data.len());
            // set_account is a fixture operation, outside the transaction conservation boundary.
            total_before += u128::from(lamports);
            let lookup = solana_message::AddressLookupTableAccount {
                key: addr(&table),
                addresses,
            };
            let message = solana_message::v0::Message::try_compile(
                &fee_payer.pubkey(),
                instructions,
                &[lookup],
                blockhash,
            )
            .unwrap();
            let versioned = solana_message::VersionedMessage::V0(message);
            assert!(
                1 + 64 * all.len() + versioned.serialize().len() <= 1232,
                "v0 packet size"
            );
            let tx = solana_transaction::versioned::VersionedTransaction::try_new(versioned, &all)
                .unwrap();
            self.put(
                table,
                Account {
                    lamports,
                    data,
                    owner: addr(&key("AddressLookupTab1e1111111111111111111111111")),
                    ..Default::default()
                },
            );
            self.svm.send_transaction(tx)
        };
        if let Ok(meta) = &result {
            let total_after: u128 = self
                .tracked
                .iter()
                .filter_map(|at| self.svm.get_balance(&addr(at)))
                .map(u128::from)
                .sum();
            assert_eq!(
                total_before,
                total_after + u128::from(meta.fee),
                "lamport conservation"
            );
            let (tokens_after, supply_after) = self.token_quantities();
            let mints: BTreeSet<_> = tokens_before
                .keys()
                .chain(tokens_after.keys())
                .copied()
                .collect();
            for mint in mints {
                let before = *tokens_before.get(&mint).unwrap_or(&0);
                let after = *tokens_after.get(&mint).unwrap_or(&0);
                let supply_delta = supply_before.get(&mint).copied().unwrap_or(0) as i128
                    - supply_after.get(&mint).copied().unwrap_or(0) as i128;
                assert_eq!(
                    before as i128 - after as i128,
                    supply_delta,
                    "token conservation {mint}"
                );
            }
            self.transactions.push(meta.clone());
        } else if let Err(error) = &result {
            // Rejections before execution may report a calculated fee without charging it.
            let charged = payer_before
                .checked_sub(self.svm.get_balance(&fee_payer.pubkey()).unwrap_or(0))
                .expect("a rejected transaction cannot credit its fee payer");
            assert!(charged == 0 || charged == error.meta.fee);
            let total_after: u128 = self
                .tracked
                .iter()
                .filter_map(|at| self.svm.get_balance(&addr(at)))
                .map(u128::from)
                .sum();
            assert_eq!(total_before, total_after + u128::from(charged));
            assert_eq!(self.token_quantities(), (tokens_before, supply_before));
        }
        result
    }
    fn token_quantities(
        &self,
    ) -> (
        std::collections::BTreeMap<Pubkey, u128>,
        std::collections::BTreeMap<Pubkey, u64>,
    ) {
        let mut tokens = std::collections::BTreeMap::new();
        let mut supply = std::collections::BTreeMap::new();
        // Fixtures register every token owner in put(); transaction-created
        // ATAs and direct token instructions register their metas in send().
        // M1 token CPIs only transfer/burn/close these registered accounts.
        // Avoid cloning unrelated Deck and executable data for C2 snapshots.
        for at in &self.token_tracked {
            let Some(a) = self.svm.get_account(&addr(at)) else {
                continue;
            };
            if a.owner != addr(&token()) && a.owner != addr(&token2022()) {
                continue;
            }
            if a.data.len() == 82 || (a.data.len() > 165 && a.data[165] == 1) {
                supply.insert(*at, read_u64(&a.data, 36));
            } else if a.data.len() >= 165 && read_key(&a.data, 0) != onepercent::params::WSOL_MINT {
                // Native SOL wrapping changes token units without changing mint supply.
                // The transaction-wide lamport invariant covers these native accounts.
                *tokens.entry(read_key(&a.data, 0)).or_insert(0) +=
                    u128::from(read_u64(&a.data, 64));
            }
        }
        (tokens, supply)
    }
    pub fn snapshot(&self) -> std::collections::BTreeMap<Pubkey, Account> {
        self.tracked
            .iter()
            .filter_map(|at| self.svm.get_account(&addr(at)).map(|a| (*at, a)))
            .collect()
    }
    pub fn initialize_ix(&self) -> Instruction {
        let authority = pubkey(&self.authority.pubkey());
        let guardian = pubkey(&self.guardian.pubkey());
        let intake = pubkey(&self.intake.pubkey());
        let mut args = Vec::new();
        for key in [
            authority,
            guardian,
            Pubkey::new_unique(),
            authority,
            authority,
            intake,
            intake,
            authority,
            authority,
        ] {
            args.extend_from_slice(key.as_ref());
        }
        for _ in 0..8 {
            args.extend_from_slice(Pubkey::default().as_ref());
        }
        args.extend_from_slice(self.token_mint.as_ref());
        args.extend_from_slice(self.queue.as_ref());
        args.extend_from_slice(&50_000_000u64.to_le_bytes());
        instruction(
            "initialize",
            vec![
                meta(authority, true, true),
                meta(onepercent::ID, false, false),
                meta(self.program_data, false, false),
                meta(self.config, true, false),
                meta(self.machine, true, false),
                meta(self.deck, true, false),
                meta(self.fee_in, true, false),
                meta(self.queue, false, false),
                meta(system(), false, false),
            ],
            &args,
        )
    }
    pub fn admin_ix(&self, args: Vec<u8>) -> Instruction {
        instruction(
            "admin_config",
            vec![
                meta(pubkey(&self.authority.pubkey()), false, true),
                meta(self.config, true, false),
                meta(self.machine, true, false),
            ],
            &args,
        )
    }
    pub fn guardian_ix(&self, args: Vec<u8>) -> Instruction {
        instruction(
            "guardian",
            vec![
                meta(pubkey(&self.guardian.pubkey()), false, true),
                meta(self.config, true, false),
                meta(self.machine, true, false),
            ],
            &args,
        )
    }
    pub fn new_pump_mint(&mut self, t22: bool) -> Bag {
        let mint = Pubkey::new_unique();
        let token_program = if t22 { token2022() } else { token() };
        let decimals = 6;
        let mut data = vec![0; 82];
        data[44] = decimals;
        data[45] = 1;
        self.put(
            mint,
            Account {
                lamports: self.rent_min(data.len()),
                data,
                owner: addr(&token_program),
                ..Default::default()
            },
        );
        let pump = onepercent::params::PROGRAM_IDS_PUMP_FUN;
        let curve = Pubkey::find_program_address(&[b"bonding-curve", mint.as_ref()], &pump).0;
        let mut data = vec![0; 81];
        data[..8].copy_from_slice(&disc("account", "BondingCurve"));
        self.put(
            curve,
            Account {
                lamports: self.rent_min(data.len()),
                data,
                owner: addr(&pump),
                ..Default::default()
            },
        );
        Bag {
            mint,
            token_program,
            curve,
            decimals,
        }
    }
    /// Register a canonical destination created inside a tested CPI.
    pub fn track_token_account(&mut self, address: Pubkey) {
        self.token_tracked.insert(address);
    }
    pub fn token_account(&mut self, owner: Pubkey, bag: &Bag, amount: u64) -> Pubkey {
        let at = ata(&owner, &bag.mint, &bag.token_program);
        let t22 = bag.token_program == token2022();
        let mut data = vec![0; if t22 { 170 } else { 165 }];
        write_key(&mut data, 0, &bag.mint);
        write_key(&mut data, 32, &owner);
        write_u64(&mut data, 64, amount);
        data[108] = 1;
        if t22 {
            data[165] = 2;
            write_u16(&mut data, 166, 7);
        }
        self.put(
            at,
            Account {
                lamports: self.rent_min(data.len()),
                data,
                owner: addr(&bag.token_program),
                ..Default::default()
            },
        );
        at
    }
    pub fn user_with_bag(&mut self, bag: &Bag, amount: u64) -> Keypair {
        let user = self.user();
        self.token_account(pubkey(&user.pubkey()), bag, amount);
        self.mutate(bag.mint, |a| {
            let supply = read_u64(&a.data, 36);
            write_u64(&mut a.data, 36, supply + amount);
        });
        user
    }
    pub fn create_ata_ix(&self, owner: Pubkey, bag: &Bag, payer: Pubkey) -> Instruction {
        ix(anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(&payer,&owner,&bag.mint,&bag.token_program))
    }
    pub fn transfer_ix(&self, user: Pubkey, bag: &Bag, amount: u64) -> Instruction {
        let mut data = vec![12];
        data.extend_from_slice(&amount.to_le_bytes());
        data.push(bag.decimals);
        Instruction {
            program_id: addr(&bag.token_program),
            accounts: vec![
                meta(ata(&user, &bag.mint, &bag.token_program), true, false),
                meta(bag.mint, false, false),
                meta(
                    ata(&self.vault_auth, &bag.mint, &bag.token_program),
                    true,
                    false,
                ),
                meta(user, false, true),
            ],
            data,
        }
    }
    pub fn attest_ix(&self, message: &[u8]) -> Instruction {
        let mut data = vec![1, 0];
        for value in [
            48,
            u16::MAX,
            16,
            u16::MAX,
            112,
            message.len() as u16,
            u16::MAX,
        ] {
            data.extend_from_slice(&value.to_le_bytes());
        }
        data.extend_from_slice(self.intake.pubkey().as_ref());
        data.extend_from_slice(self.intake.sign_message(message).as_ref());
        data.extend_from_slice(message);
        Instruction {
            program_id: addr(&key("Ed25519SigVerify111111111111111111111111111")),
            accounts: vec![],
            data,
        }
    }
    pub fn feed_ixs(&self, user: Pubkey, bags: &[(&Bag, u64)], nonce: u32) -> Vec<Instruction> {
        let expiry = self.now() + 110;
        let mut body = Vec::new();
        for (bag, amount) in bags {
            body.extend_from_slice(bag.mint.as_ref());
            body.extend_from_slice(&amount.to_le_bytes());
        }
        let hash = solana_sha256_hasher::hash(&body);
        let mut message = b"1PCT-FEED-v1".to_vec();
        message.extend_from_slice(onepercent::ID.as_ref());
        message.extend_from_slice(user.as_ref());
        message.extend_from_slice(&nonce.to_le_bytes());
        message.extend_from_slice(&expiry.to_le_bytes());
        message.push(bags.len() as u8);
        message.extend_from_slice(hash.as_ref());
        let mut out = vec![self.attest_ix(&message)];
        for (bag, amount) in bags {
            out.push(self.create_ata_ix(self.vault_auth, bag, user));
            out.push(self.transfer_ix(user, bag, *amount));
        }
        let mut args = (bags.len() as u32).to_le_bytes().to_vec();
        for (_, amount) in bags {
            args.extend_from_slice(&amount.to_le_bytes());
        }
        args.extend_from_slice(&expiry.to_le_bytes());
        args.extend_from_slice(&nonce.to_le_bytes());
        args.push(0);
        let mut accounts = vec![
            meta(user, true, true),
            meta(self.config, false, false),
            meta(self.machine, false, false),
            meta(self.deck, true, false),
            meta(pda(&[b"binder", user.as_ref()]).0, true, false),
            meta(instructions_sysvar(), false, false),
            meta(system(), false, false),
        ];
        for (bag, _) in bags {
            accounts.extend([
                meta(bag.mint, false, false),
                meta(
                    ata(&self.vault_auth, &bag.mint, &bag.token_program),
                    false,
                    false,
                ),
                meta(pda(&[b"ledger", bag.mint.as_ref()]).0, true, false),
                meta(bag.curve, false, false),
            ]);
        }
        out.push(instruction("feed", accounts, &args));
        out
    }
    pub fn feed(
        &mut self,
        user: &Keypair,
        bag: &Bag,
        amount: u64,
        nonce: u32,
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        self.send(
            &self.feed_ixs(pubkey(&user.pubkey()), &[(bag, amount)], nonce),
            &[user],
        )
    }
    pub fn take_back_ix(&self, user: Pubkey, bag: &Bag, index: u32, amount: u64) -> Instruction {
        let mut args = index.to_le_bytes().to_vec();
        args.extend_from_slice(&amount.to_le_bytes());
        instruction(
            "take_back",
            vec![
                meta(user, true, true),
                meta(self.deck, true, false),
                meta(pda(&[b"binder", user.as_ref()]).0, true, false),
                meta(bag.mint, false, false),
                meta(pda(&[b"ledger", bag.mint.as_ref()]).0, true, false),
                meta(
                    ata(&self.vault_auth, &bag.mint, &bag.token_program),
                    true,
                    false,
                ),
                meta(self.vault_auth, false, false),
                meta(ata(&user, &bag.mint, &bag.token_program), true, false),
                meta(bag.token_program, false, false),
                meta(self.machine, false, false),
            ],
            &args,
        )
    }
    pub fn state<T: anchor_lang::Discriminator + bytemuck::Pod>(&self, at: Pubkey) -> T {
        let account = self.account(at);
        assert!(account.data.starts_with(T::DISCRIMINATOR));
        bytemuck::pod_read_unaligned(&account.data[8..8 + std::mem::size_of::<T>()])
    }
    pub fn set_state<T: anchor_lang::Discriminator + bytemuck::Pod>(
        &mut self,
        at: Pubkey,
        state: &T,
        tail: &[u8],
        extra: u64,
    ) {
        let mut data = T::DISCRIMINATOR.to_vec();
        data.extend_from_slice(bytemuck::bytes_of(state));
        data.extend_from_slice(tail);
        self.put(
            at,
            Account {
                lamports: self.rent_min(data.len()) + extra,
                data,
                owner: addr(&onepercent::ID),
                ..Default::default()
            },
        );
    }
    pub fn binder(
        &mut self,
        owner: Pubkey,
        cards: &[onepercent::state::Card],
        reserved: u16,
        capacity: u16,
    ) -> Pubkey {
        use bytemuck::Zeroable;
        let (at, bump) = pda(&[b"binder", owner.as_ref()]);
        let mut value = onepercent::state::Binder::zeroed();
        value.owner = owner;
        value.bump = bump;
        value.len = cards.len() as u16;
        value.cap = capacity;
        value.reserved = reserved;
        let mut tail = vec![0; 56 * usize::from(capacity)];
        let bytes = bytemuck::cast_slice(cards);
        tail[..bytes.len()].copy_from_slice(bytes);
        self.set_state(at, &value, &tail, 0);
        at
    }
    pub fn list_ix(&self, bag: &Bag, class: u8, cap: u64) -> Instruction {
        let mut args = vec![class];
        args.extend_from_slice(&cap.to_le_bytes());
        args.extend_from_slice(Pubkey::new_unique().as_ref());
        instruction(
            "admin_list_mint",
            vec![
                meta(pubkey(&self.authority.pubkey()), true, true),
                meta(self.config, false, false),
                meta(self.machine, true, false),
                meta(bag.mint, false, false),
                meta(pda(&[b"ledger", bag.mint.as_ref()]).0, true, false),
                meta(
                    ata(&self.vault_auth, &bag.mint, &bag.token_program),
                    false,
                    false,
                ),
                meta(self.vault_auth, false, false),
                meta(bag.token_program, false, false),
                meta(system(), false, false),
            ],
            &args,
        )
    }
    pub fn seed_bucket(&mut self, index: usize, bag: &Bag, class: u8, amount: u64, cost: u64) {
        let vault = self.token_account(self.vault_auth, bag, amount);
        let mut m = self.state::<onepercent::state::Machine>(self.machine);
        m.buckets[index] = onepercent::state::Bucket {
            mint: bag.mint,
            oracle: Pubkey::new_unique(),
            amount,
            cost,
            reserved: 0,
            cap: u64::MAX,
            trend_bought_hour: 0,
            trend_hour_index: 0,
            decimals: bag.decimals,
            class,
            enabled: 1,
            token_program: u8::from(bag.token_program == token2022()),
            final_pool: 0,
            trend_sold_hour: 0,
        };
        self.mutate(self.machine, |a| {
            a.data[8..].copy_from_slice(bytemuck::bytes_of(&m))
        });
        let at = pda(&[b"ledger", bag.mint.as_ref()]).0;
        self.set_state(
            at,
            &onepercent::state::MintLedger {
                mint: bag.mint,
                payer: pubkey(&self.authority.pubkey()),
                accounted: amount,
            },
            &[],
            0,
        );
        self.mutate(bag.mint, |a| write_u64(&mut a.data, 36, amount));
        self.tracked.insert(vault);
    }
    pub fn inject_deck(&mut self, count: u32) -> Bag {
        use bytemuck::Zeroable;
        let bag = self.new_pump_mint(false);
        let depositor = Pubkey::new_unique();
        self.fund(depositor, 1_000_000);
        let amount = 1000u64;
        self.token_account(self.vault_auth, &bag, amount * u64::from(count));
        self.mutate(bag.mint, |a| {
            write_u64(&mut a.data, 36, amount * u64::from(count))
        });
        self.set_state(
            pda(&[b"ledger", bag.mint.as_ref()]).0,
            &onepercent::state::MintLedger {
                mint: bag.mint,
                payer: depositor,
                accounted: amount * u64::from(count),
            },
            &[],
            0,
        );
        let mut header = self.state::<onepercent::state::Deck>(self.deck);
        header.len = count;
        header.cap = count;
        header.total_fed = u64::from(count);
        let mut entry = onepercent::state::DeckEntry::zeroed();
        entry.depositor = depositor;
        entry.mint = bag.mint;
        entry.amount = amount;
        entry.deposit = (self.rent_min(80) - self.rent_min(0)) as u32;
        entry.flags = 2;
        let entries = vec![entry; count as usize];
        self.set_state(self.deck, &header, bytemuck::cast_slice(&entries), 0);
        bag
    }
    pub fn buy_ix(
        &self,
        buyer: Pubkey,
        edition: u8,
        qty: u8,
        nonce: u32,
        referrer: Option<Pubkey>,
    ) -> Instruction {
        let mut args = vec![edition, qty];
        args.extend_from_slice(&nonce.to_le_bytes());
        args.push(0);
        if let Some(r) = referrer {
            args.push(1);
            args.extend_from_slice(r.as_ref());
        } else {
            args.push(0);
        }
        args.push(0);
        let pull = pda(&[b"pull", buyer.as_ref(), &nonce.to_le_bytes()]).0;
        instruction(
            "buy_packs",
            vec![
                meta(buyer, true, true),
                meta(self.config, false, false),
                meta(self.machine, true, false),
                meta(self.deck, false, false),
                meta(pda(&[b"binder", buyer.as_ref()]).0, true, false),
                meta(pull, true, false),
                meta(self.queue, true, false),
                meta(instructions_sysvar(), false, false),
                meta(system(), false, false),
                meta(pda(&[b"identity"]).0, false, false),
                meta(vrf(), false, false),
                meta(
                    anchor_lang::solana_program::sysvar::slot_hashes::ID,
                    false,
                    false,
                ),
            ],
            &args,
        )
    }
    pub fn buy(
        &mut self,
        buyer: &Keypair,
        edition: u8,
        qty: u8,
    ) -> Result<(Pubkey, TransactionMetadata), FailedTransactionMetadata> {
        let payer = self.authority.insecure_clone();
        self.buy_with_payer(buyer, edition, qty, None, &payer)
    }
    pub fn buy_with_payer(
        &mut self,
        buyer: &Keypair,
        edition: u8,
        qty: u8,
        referrer: Option<Pubkey>,
        fee_payer: &Keypair,
    ) -> Result<(Pubkey, TransactionMetadata), FailedTransactionMetadata> {
        let user = pubkey(&buyer.pubkey());
        let binder = pda(&[b"binder", user.as_ref()]).0;
        let nonce = self
            .svm
            .get_account(&addr(&binder))
            .filter(|a| a.data.len() >= 112)
            .map_or(0, |a| read_u32(&a.data, 96));
        let instruction = self.buy_ix(user, edition, qty, nonce, referrer);
        let pull = pda(&[b"pull", user.as_ref(), &nonce.to_le_bytes()]).0;
        self.send_with_payer(&[instruction], fee_payer, &[buyer])
            .map(|meta| (pull, meta))
    }
    pub fn raw_fulfill_ix(
        &self,
        pull: Pubkey,
        randomness: [u8; 32],
        seq: u64,
        global: bool,
    ) -> Instruction {
        let data = self.account(pull).data;
        let buyer = read_key(&data, 16);
        let identity = if global {
            Pubkey::find_program_address(&[b"identity"], &vrf()).0
        } else {
            Pubkey::find_program_address(&[b"identity", onepercent::ID.as_ref()], &vrf()).0
        };
        let discriminator = disc("global", "consume_randomness");
        let mut data = vec![if global { 0xF2 } else { 0xF1 }, discriminator.len() as u8];
        data.extend_from_slice(&discriminator);
        data.extend_from_slice(&randomness);
        data.extend_from_slice(&8u16.to_le_bytes());
        data.extend_from_slice(&seq.to_le_bytes());
        Instruction {
            program_id: addr(&vrf()),
            accounts: vec![
                meta(identity, false, false),
                meta(onepercent::ID, false, false),
                meta(pull, true, false),
                meta(self.machine, true, false),
                meta(self.deck, true, false),
                meta(pda(&[b"binder", buyer.as_ref()]).0, true, false),
            ],
            data,
        }
    }
    pub fn fulfill(
        &mut self,
        pull: Pubkey,
        randomness: [u8; 32],
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let data = self.account(pull).data;
        let seq = read_u64(&data, 8);
        let buyer = read_key(&data, 16);
        let identity =
            Pubkey::find_program_address(&[b"identity", onepercent::ID.as_ref()], &vrf()).0;
        let mut data = vec![0xF0];
        data.extend_from_slice(&u32::try_from(seq - 1).unwrap().to_le_bytes());
        data.extend_from_slice(&randomness);
        let ix = Instruction {
            program_id: addr(&vrf()),
            accounts: vec![
                meta(self.queue, true, false),
                meta(identity, false, false),
                meta(onepercent::ID, false, false),
                meta(pull, true, false),
                meta(self.machine, true, false),
                meta(self.deck, true, false),
                meta(pda(&[b"binder", buyer.as_ref()]).0, true, false),
            ],
            data,
        };
        self.send(&[ix], &[])
    }
    pub fn settle_ix(&self, pull: Pubkey, pack: u8) -> Instruction {
        let data = self.account(pull).data;
        let buyer = read_key(&data, 16);
        let referrer = read_key(&data, 48);
        let offset = 176 + usize::from(pack) * 200;
        let house = data[offset + 195];
        let mut args = read_u64(&data, 8).to_le_bytes().to_vec();
        args.push(pack);
        let payee = |key: Pubkey| {
            let account = self.svm.get_account(&addr(&key));
            let writable = account.as_ref().is_none_or(|a| !a.executable)
                && key != anchor_lang::solana_program::sysvar::rent::ID;
            meta(key, writable, false)
        };
        let mut accounts = vec![
            meta(pull, true, false),
            meta(self.machine, true, false),
            payee(buyer),
            payee(if referrer == Pubkey::default() {
                buyer
            } else {
                referrer
            }),
        ];
        for k in 0..4 {
            accounts.push(payee(if house & (1 << k) == 0 {
                read_key(&data, offset + k * 48)
            } else {
                buyer
            }));
        }
        for k in 0..4 {
            accounts.push(if house & (1 << k) == 0 {
                meta(
                    pda(&[b"binder", read_key(&data, offset + k * 48).as_ref()]).0,
                    true,
                    false,
                )
            } else {
                payee(buyer)
            });
        }
        instruction("settle", accounts, &args)
    }
    pub fn settle(
        &mut self,
        pull: Pubkey,
        pack: u8,
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        self.send(&[self.settle_ix(pull, pack)], &[])
    }
    pub fn refund_ix(&self, pull: Pubkey) -> Instruction {
        let data = self.account(pull).data;
        let buyer = read_key(&data, 16);
        let writable = self
            .svm
            .get_account(&addr(&buyer))
            .is_none_or(|a| !a.executable);
        instruction(
            "refund_pull",
            vec![
                meta(pull, true, false),
                meta(self.machine, true, false),
                meta(pda(&[b"binder", buyer.as_ref()]).0, true, false),
                meta(buyer, writable, false),
            ],
            &read_u64(&data, 8).to_le_bytes(),
        )
    }
    pub fn redeem_ix(&self, owner: Pubkey, bag: &Bag, index: u16, amount: u64) -> Instruction {
        let mut args = index.to_le_bytes().to_vec();
        args.extend_from_slice(&amount.to_le_bytes());
        instruction(
            "redeem",
            vec![
                meta(owner, true, true),
                meta(pda(&[b"binder", owner.as_ref()]).0, true, false),
                meta(bag.mint, false, false),
                meta(pda(&[b"ledger", bag.mint.as_ref()]).0, true, false),
                meta(
                    ata(&self.vault_auth, &bag.mint, &bag.token_program),
                    true,
                    false,
                ),
                meta(self.vault_auth, false, false),
                meta(ata(&owner, &bag.mint, &bag.token_program), true, false),
                meta(bag.token_program, false, false),
                meta(self.machine, false, false),
            ],
            &args,
        )
    }
    pub fn closed(&self, at: Pubkey) -> bool {
        self.svm
            .get_account(&addr(&at))
            .is_none_or(|a| a.lamports == 0 || a.data.is_empty())
    }
}

pub fn assert_error(result: Result<TransactionMetadata, FailedTransactionMetadata>, name: &str) {
    let error = result.expect_err("transaction unexpectedly succeeded");
    assert!(
        error.meta.logs.iter().any(|l| l.contains(name)),
        "expected {name}, got {error:?}"
    );
}
