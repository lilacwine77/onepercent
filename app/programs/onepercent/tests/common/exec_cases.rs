//! Executor fixtures. The swap slot is ordinary SPL transfers by a test market.
use super::*;
use anchor_lang::__private::base64::{engine::general_purpose::STANDARD, Engine};
use anchor_lang::prelude::Pubkey;
use onepercent::{params, state::*};
use solana_account::Account;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_signer::Signer;

pub fn edit<T: anchor_lang::Discriminator + bytemuck::Pod>(
    e: &mut Env,
    at: Pubkey,
    f: impl FnOnce(&mut T),
) {
    let mut state = e.state::<T>(at);
    f(&mut state);
    e.mutate(at, |a| {
        a.data[8..8 + std::mem::size_of::<T>()].copy_from_slice(bytemuck::bytes_of(&state))
    });
}
pub fn machine(e: &mut Env, f: impl FnOnce(&mut Machine)) {
    let at = e.machine;
    edit(e, at, f)
}
pub fn config(e: &mut Env, f: impl FnOnce(&mut Config)) {
    let at = e.config;
    edit(e, at, f)
}
pub fn amount(e: &Env, at: Pubkey) -> u64 {
    read_u64(&e.account(at).data, 64)
}
pub fn native_bag() -> Bag {
    Bag {
        mint: params::WSOL_MINT,
        token_program: token(),
        curve: system(),
        decimals: 9,
    }
}
pub fn native(e: &mut Env, owner: Pubkey, value: u64) -> Pubkey {
    let at = e.token_account(owner, &native_bag(), value);
    let rent = e.rent_min(165);
    e.mutate(at, |a| {
        write_u32(&mut a.data, 109, 1);
        write_u64(&mut a.data, 113, rent);
        a.lamports = rent + value;
    });
    at
}
pub fn token_transfer(
    bag: &Bag,
    owner: Pubkey,
    source: Pubkey,
    destination: Pubkey,
    value: u64,
) -> Instruction {
    let mut data = vec![12];
    data.extend_from_slice(&value.to_le_bytes());
    data.push(bag.decimals);
    Instruction {
        program_id: addr(&bag.token_program),
        accounts: vec![
            meta(source, true, false),
            meta(bag.mint, false, false),
            meta(destination, true, false),
            meta(owner, false, true),
        ],
        data,
    }
}
pub fn cpi(inner: Instruction) -> Instruction {
    let mut data = vec![0xf3];
    data.extend_from_slice(&inner.data);
    let mut accounts = vec![meta(pubkey(&inner.program_id), false, false)];
    accounts.extend(inner.accounts);
    Instruction {
        program_id: addr(&vrf()),
        accounts,
        data,
    }
}
fn captured(json: &str) -> Vec<u8> {
    let value: serde_json::Value = serde_json::from_str(json).unwrap();
    STANDARD
        .decode(
            value["response"]["body"]["result"]["value"]["data"][0]
                .as_str()
                .unwrap(),
        )
        .unwrap()
}
pub fn oracle_account(e: &mut Env, key: Pubkey, owner: Pubkey, data: Vec<u8>) {
    e.put(
        key,
        Account {
            lamports: e.rent_min(data.len()),
            data,
            owner: addr(&owner),
            ..Default::default()
        },
    );
}
pub fn pyth(e: &mut Env, feed: [u8; 32], price: i64, expo: i32) -> Pubkey {
    let at = Pubkey::new_unique();
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../fixtures/mainnet/pyth/sol-usd.json"
    ))
    .unwrap();
    let mut data = STANDARD
        .decode(
            fixture["response"]["result"]["value"]["data"][0]
                .as_str()
                .unwrap(),
        )
        .unwrap();
    data[41..73].copy_from_slice(&feed);
    data[73..81].copy_from_slice(&price.to_le_bytes());
    write_u64(&mut data, 81, 1);
    data[89..93].copy_from_slice(&expo.to_le_bytes());
    data[93..101].copy_from_slice(&e.now().to_le_bytes());
    oracle_account(e, at, params::PROGRAM_IDS_PYTH_RECEIVER, data);
    at
}
pub fn pool(e: &mut Env, bag: &Bag) -> [Pubkey; 3] {
    let authority = Pubkey::find_program_address(
        &[b"pool-authority", bag.mint.as_ref()],
        &params::PROGRAM_IDS_PUMP_FUN,
    )
    .0;
    let at = Pubkey::find_program_address(
        &[
            b"pool",
            &0u16.to_le_bytes(),
            authority.as_ref(),
            bag.mint.as_ref(),
            params::WSOL_MINT.as_ref(),
        ],
        &params::PROGRAM_IDS_PUMP_SWAP,
    )
    .0;
    let base = e.token_account(at, bag, 500_000_000_000_000);
    let quote = native(e, at, 400_000_000_000);
    let mut data = captured(include_str!(
        "../../../../packages/market/tests/fixtures/rpc/pool-pqc.json"
    ));
    write_u16(&mut data, 9, 0);
    write_key(&mut data, 43, &bag.mint);
    write_key(&mut data, 75, &params::WSOL_MINT);
    write_key(&mut data, 139, &base);
    write_key(&mut data, 171, &quote);
    data[243] = 0;
    data[245..261].copy_from_slice(&(-2_000_000_000i128).to_le_bytes());
    oracle_account(e, at, params::PROGRAM_IDS_PUMP_SWAP, data);
    [at, base, quote]
}
/// Synthetic canonical pools use the pinned layouts and recorded prices. The
/// mint/config/vault bindings are rebuilt for the fixture's local test accounts.
pub fn meteora(e: &mut Env, bag: &Bag, migrated: bool) -> [Pubkey; 4] {
    let pool_address = |config: &Pubkey, program: &Pubkey| {
        let (max, min) = if bag.mint > params::WSOL_MINT {
            (bag.mint, params::WSOL_MINT)
        } else {
            (params::WSOL_MINT, bag.mint)
        };
        Pubkey::find_program_address(
            &[b"pool", config.as_ref(), max.as_ref(), min.as_ref()],
            program,
        )
        .0
    };
    let raw = |json: &str| {
        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        STANDARD
            .decode(value["account"]["data"][0].as_str().unwrap())
            .unwrap()
    };
    let dbc = pool_address(
        &params::METEORA_DBC_CONFIG,
        &params::PROGRAM_IDS_METEORA_DBC,
    );
    let damm = if migrated {
        pool_address(
            &params::METEORA_DAMM_V2_CONFIG,
            &params::PROGRAM_IDS_METEORA_DAMM_V2,
        )
    } else {
        system()
    };
    let authority = if migrated {
        anchor_lang::pubkey!("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC")
    } else {
        anchor_lang::pubkey!("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM")
    };
    let base = e.token_account(authority, bag, 500_000_000_000_000);
    let quote = native(
        e,
        authority,
        if migrated {
            400_000_000_000
        } else {
            37_000_000_000
        },
    );
    let mut data = raw(include_str!(
        "../../../../fixtures/meteora/accounts/dbc-active.json"
    ));
    write_key(&mut data, 72, &params::METEORA_DBC_CONFIG);
    write_key(&mut data, 136, &bag.mint);
    write_key(&mut data, 168, &base);
    write_key(&mut data, 200, &quote);
    write_u64(&mut data, 240, 30_000_000_000);
    data[305] = u8::from(migrated);
    oracle_account(e, dbc, params::PROGRAM_IDS_METEORA_DBC, data);
    if migrated {
        let mut data = raw(include_str!(
            "../../../../fixtures/meteora/accounts/damm-migrated.json"
        ));
        write_key(&mut data, 168, &bag.mint);
        write_key(&mut data, 200, &params::WSOL_MINT);
        write_key(&mut data, 232, &base);
        write_key(&mut data, 264, &quote);
        write_u64(&mut data, 688, 398_000_000_000);
        oracle_account(e, damm, params::PROGRAM_IDS_METEORA_DAMM_V2, data);
    }
    [dbc, damm, base, quote]
}
pub struct ExecFixture {
    pub e: Env,
    pub signer: Keypair,
    pub market: Keypair,
    pub bag: Bag,
    pub kind: u8,
    pub bucket: u8,
    pub source: Pubkey,
    pub vault: Pubkey,
    pub sol_dest: Pubkey,
    pub oracles: [Pubkey; 4],
    pub market_token: Pubkey,
    pub market_native: Pubkey,
}
impl ExecFixture {
    pub fn new(kind: u8, class: u8, graduated: bool, mainnet: bool) -> Self {
        let mut e = Env::with_mainnet(mainnet);
        e.inject_phase(3);
        let signer = e.user();
        let market = e.user();
        let signer_key = pubkey(&signer.pubkey());
        let market_key = pubkey(&market.pubkey());
        config(&mut e, |c| {
            c.keeper = signer_key;
            c.executor = signer_key;
        });
        let bag = e.new_pump_mint(false);
        let bucket = if kind <= 2 { 0 } else { 255 };
        let mut native_mint = vec![0; 82];
        native_mint[44] = 9;
        native_mint[45] = 1;
        oracle_account(&mut e, params::WSOL_MINT, token(), native_mint);
        let vault = if kind <= 2 {
            e.seed_bucket(0, &bag, class, 10_000_000_000_000, 10_000_000_000);
            ata(&e.vault_auth, &bag.mint, &bag.token_program)
        } else {
            e.token_mint = bag.mint;
            config(&mut e, |c| c.token_mint = bag.mint);
            machine(&mut e, |m| m.token_mint = bag.mint);
            let vault = e.token_account(e.vault_auth, &bag, 0);
            e.set_state(
                pda(&[b"ledger", bag.mint.as_ref()]).0,
                &MintLedger {
                    mint: bag.mint,
                    payer: signer_key,
                    accounted: 0,
                },
                &[],
                0,
            );
            vault
        };
        let source = if kind == 2 {
            e.token_account(signer_key, &bag, 0)
        } else {
            native(&mut e, signer_key, 0)
        };
        let vault_auth = e.vault_auth;
        let sol_dest = if kind == 2 {
            native(&mut e, vault_auth, 0)
        } else {
            system()
        };
        let market_token = e.token_account(market_key, &bag, 1_000_000_000_000_000);
        let market_native = native(&mut e, market_key, 100_000_000_000_000);
        let oracles = if kind <= 2 && class == 1 {
            let feed = [7; 32];
            machine(&mut e, |m| {
                m.buckets[0].oracle = Pubkey::new_from_array(feed)
            });
            [
                pyth(&mut e, feed, 85_000_000, -8),
                pyth(
                    &mut e,
                    params::HIT_LIST_SOL_USD_PYTH_FEED_ID,
                    10_901_000_000,
                    -8,
                ),
                system(),
                system(),
            ]
        } else if kind <= 2 {
            let [pool, base, quote] = pool(&mut e, &bag);
            machine(&mut e, |m| m.buckets[0].oracle = pool);
            [pool, base, quote, system()]
        } else {
            meteora(&mut e, &bag, graduated)
        };
        let now = e.now();
        machine(&mut e, |m| {
            m.stock_sol = 100_000_000_000;
            m.burn_sol = 20_000_000_000;
            m.jackpot_sol = 20_000_000_000;
            m.hour_index = now as u64 / 3600;
            m.stock_hour_index = m.hour_index;
            m.burn_hour_index = m.hour_index;
            m.buckets[0].trend_hour_index = m.hour_index as u32;
        });
        e.donate_lamports(e.machine, 140_000_000_000);
        // Supply matches all injected accounts; the native mint has no tracked supply.
        let total = 1_000_000_000_000_000
            + if kind <= 2 { 10_000_000_000_000 } else { 0 }
            + if class == 2 || kind >= 3 {
                500_000_000_000_000
            } else {
                0
            };
        e.mutate(bag.mint, |a| write_u64(&mut a.data, 36, total));
        Self {
            e,
            signer,
            market,
            bag,
            kind,
            bucket,
            source,
            vault,
            sol_dest,
            oracles,
            market_token,
            market_native,
        }
    }
    pub fn begin(&self, value: u64) -> Instruction {
        let e = &self.e;
        let mut args = vec![self.kind, self.bucket];
        args.extend_from_slice(&value.to_le_bytes());
        let mut accounts = vec![
            meta(pubkey(&self.signer.pubkey()), true, true),
            meta(e.config, false, false),
            meta(e.machine, true, false),
            meta(self.bag.mint, false, false),
            meta(pda(&[b"ledger", self.bag.mint.as_ref()]).0, true, false),
            meta(self.vault, true, false),
            meta(e.vault_auth, false, false),
            meta(self.source, true, false),
            meta(self.sol_dest, self.kind == 2, false),
        ];
        accounts.extend(self.oracles.map(|at| meta(at, false, false)));
        accounts.extend([
            meta(self.bag.token_program, false, false),
            meta(token(), false, false),
            meta(instructions_sysvar(), false, false),
        ]);
        instruction("exec_begin", accounts, &args)
    }
    pub fn end(&self) -> Instruction {
        let e = &self.e;
        instruction(
            "exec_end",
            vec![
                meta(pubkey(&self.signer.pubkey()), true, true),
                meta(e.config, false, false),
                meta(e.machine, true, false),
                meta(self.bag.mint, true, false),
                meta(pda(&[b"ledger", self.bag.mint.as_ref()]).0, true, false),
                meta(self.vault, true, false),
                meta(e.vault_auth, false, false),
                meta(self.sol_dest, self.kind == 2, false),
                meta(self.bag.token_program, false, false),
                meta(token(), false, false),
                meta(system(), false, false),
            ],
            &[self.kind],
        )
    }
    pub fn swaps(&self, value: u64, delta: u64) -> Vec<Instruction> {
        let signer = pubkey(&self.signer.pubkey());
        let market = pubkey(&self.market.pubkey());
        if self.kind == 2 {
            vec![
                token_transfer(&self.bag, signer, self.source, self.market_token, value),
                token_transfer(
                    &native_bag(),
                    market,
                    self.market_native,
                    self.sol_dest,
                    delta,
                ),
            ]
        } else {
            vec![
                token_transfer(
                    &native_bag(),
                    signer,
                    self.source,
                    self.market_native,
                    value,
                ),
                token_transfer(&self.bag, market, self.market_token, self.vault, delta),
            ]
        }
    }
    pub fn transaction(&self, value: u64, delta: u64) -> Vec<Instruction> {
        let mut tx = vec![self.begin(value)];
        tx.extend(self.swaps(value, delta));
        tx.push(self.end());
        tx
    }
    pub fn send(
        &mut self,
        tx: &[Instruction],
    ) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>
    {
        let signers: Vec<_> = [&self.signer, &self.market]
            .into_iter()
            .filter(|signer| {
                tx.iter()
                    .flat_map(|ix| &ix.accounts)
                    .any(|meta| meta.is_signer && meta.pubkey == signer.pubkey())
            })
            .collect();
        self.e.send(tx, &signers)
    }
    pub fn execute(
        &mut self,
        value: u64,
        delta: u64,
    ) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>
    {
        self.send(&self.transaction(value, delta))
    }
    pub fn reject(&mut self, tx: &[Instruction], error: &str) {
        let watched: std::collections::BTreeMap<_, _> = self
            .e
            .tracked
            .iter()
            .copied()
            .filter(|at| *at != pubkey(&self.e.authority.pubkey()))
            .map(|at| (at, self.e.svm.get_account(&addr(&at))))
            .collect();
        let failure = self
            .send(tx)
            .expect_err("transaction unexpectedly succeeded");
        assert!(
            error
                .split('|')
                .any(|name| failure.meta.logs.iter().any(|line| line.contains(name))),
            "expected {error}, got {failure:?}"
        );
        for (at, before) in watched {
            assert_eq!(
                self.e.svm.get_account(&addr(&at)),
                before,
                "atomic rejection {at}"
            );
        }
    }
    pub fn refresh(&mut self) {
        let now = self.e.now();
        if self.kind <= 2
            && self.e.state::<Machine>(self.e.machine).buckets[usize::from(self.bucket)].class == 1
        {
            for at in &self.oracles[..2] {
                self.e
                    .mutate(*at, |a| a.data[93..101].copy_from_slice(&now.to_le_bytes()));
            }
        }
        if self.kind == 2 && self.e.closed(self.sol_dest) {
            let auth = self.e.vault_auth;
            native(&mut self.e, auth, 0);
        }
    }
}

#[path = "reference.rs"]
mod exec_reference;
pub fn expected(f: &ExecFixture, value: u64) -> (u64, u64) {
    if f.kind <= 2 && f.e.state::<Machine>(f.e.machine).buckets[usize::from(f.bucket)].class == 1 {
        let read = |at| {
            let data = f.e.account(at).data;
            (
                i64::from_le_bytes(data[73..81].try_into().unwrap()),
                i32::from_le_bytes(data[89..93].try_into().unwrap()),
            )
        };
        let (token, te) = read(f.oracles[0]);
        let (sol, se) = read(f.oracles[1]);
        exec_reference::exec_major(value, sol, se, token, te, f.bag.decimals, f.kind == 2).unwrap()
    } else {
        let slip = match f.kind {
            3 => params::BURN_MIN_OUT_SLIP_BPS,
            4 => params::JACKPOT_MIN_OUT_SLIP_BPS,
            _ => params::STOCK_TRENDING_MIN_OUT_SLIP_BPS,
        };
        if f.kind >= 3 {
            let (pool, offset) = if f.oracles[1] == system() {
                (f.oracles[0], 280)
            } else {
                (f.oracles[1], 456)
            };
            let data = f.e.account(pool).data;
            let sqrt_price = u128::from_le_bytes(data[offset..offset + 16].try_into().unwrap());
            exec_reference::exec_meteora(value, sqrt_price, slip).unwrap()
        } else {
            let data = f.e.account(f.oracles[0]).data;
            exec_reference::exec_pool(
                value,
                amount(&f.e, f.oracles[1]),
                amount(&f.e, f.oracles[2]),
                i128::from_le_bytes(data[245..261].try_into().unwrap()),
                slip,
                f.kind == 2,
            )
            .unwrap()
        }
    }
}
/// One accepted pair is checked against the independent book/SOL model.
pub fn check_success(f: &ExecFixture, before: &Machine, value: u64, delta: u64) {
    let after = f.e.state::<Machine>(f.e.machine);
    assert!(
        bytemuck::bytes_of(&after.exec)
            .iter()
            .all(|byte| *byte == 0),
        "I13"
    );
    match f.kind {
        1 => {
            assert_eq!(after.buckets[0].amount, before.buckets[0].amount + delta);
            assert_eq!(after.buckets[0].cost, before.buckets[0].cost + value);
            assert_eq!(after.stock_sol, before.stock_sol - value);
        }
        2 => {
            let book =
                exec_reference::exec_book(value, before.buckets[0].amount, before.buckets[0].cost)
                    .unwrap();
            assert_eq!(after.buckets[0].amount, before.buckets[0].amount - value);
            assert_eq!(after.buckets[0].cost, before.buckets[0].cost - book);
            assert_eq!(after.stock_sol, before.stock_sol + delta);
        }
        3 => {
            assert_eq!(after.burned_total, before.burned_total + delta);
            assert_eq!(after.burn_sol, before.burn_sol - value);
        }
        _ => {
            assert_eq!(after.jackpot_tokens, before.jackpot_tokens + delta);
            assert_eq!(after.jackpot_cost, before.jackpot_cost + value);
            assert_eq!(after.jackpot_sol, before.jackpot_sol - value);
        }
    }
    assert!(
        after.stock_bought_hour
            <= exec_reference::exec_cap(after.hit_out_last_hour, after.hit_out_this_hour)
    );
    if after.phase != 4 || after.buckets[0].class == 2 {
        assert!(
            after.stock_sold_hour
                <= exec_reference::exec_cap(after.hit_out_last_hour, after.hit_out_this_hour)
        );
    }
    assert!(after.burn_paid_hour <= params::BURN_HOURLY_MAX_LAMPORTS);
    assert!(after.buckets[0].trend_bought_hour <= params::STOCK_TRENDING_HOURLY_MAX_LAMPORTS);
    assert!(after.buckets[0].trend_sold_hour <= params::STOCK_TRENDING_HOURLY_MAX_LAMPORTS);
    if f.kind <= 2 {
        assert!(
            after.last_stock_trade_ts - before.last_stock_trade_ts
                >= params::STOCK_TRADE_MIN_SPACING_SECONDS
        );
        if before.buckets[usize::from(f.bucket)].class == 1 {
            assert_major_oracle_loss_bound(f, value, delta);
        }
    }
    f.e.check_invariants();
}

/// Compare loss in exact rational lamports, without flooring the oracle valuation.
/// The independent reference supplies the minimum delivered amount; no program
/// quote helper participates in this economic assertion.
fn assert_major_oracle_loss_bound(f: &ExecFixture, value: u64, delta: u64) {
    let read = |at| {
        let data = f.e.account(at).data;
        (
            u128::try_from(i64::from_le_bytes(data[73..81].try_into().unwrap())).unwrap(),
            i32::from_le_bytes(data[89..93].try_into().unwrap()),
        )
    };
    let (token_price, token_exponent) = read(f.oracles[0]);
    let (sol_price, sol_exponent) = read(f.oracles[1]);
    let exponent = token_exponent - sol_exponent + 9 - i32::from(f.bag.decimals);
    let scale = 10u128.checked_pow(exponent.unsigned_abs()).unwrap();
    // A token base unit is numerator / denominator lamports at the two oracles.
    let (numerator, denominator) = if exponent >= 0 {
        (token_price.checked_mul(scale).unwrap(), sol_price)
    } else {
        (token_price, sol_price.checked_mul(scale).unwrap())
    };
    let minimum = u128::from(expected(f, value).1);
    let (given_up, received, minimum_received) = if f.kind == 1 {
        (
            u128::from(value).checked_mul(denominator).unwrap(),
            u128::from(delta).checked_mul(numerator).unwrap(),
            minimum.checked_mul(numerator).unwrap(),
        )
    } else {
        (
            u128::from(value).checked_mul(numerator).unwrap(),
            u128::from(delta).checked_mul(denominator).unwrap(),
            minimum.checked_mul(denominator).unwrap(),
        )
    };
    assert!(
        minimum_received <= given_up,
        "MAJOR minimum has nonnegative loss bound"
    );
    assert!(
        given_up.saturating_sub(received) <= given_up - minimum_received,
        "MAJOR oracle-valued loss exceeds given-up value minus independent min_out"
    );
}

/// Audit regression: a temporary StockBuy debit must never select the fee regime.
pub fn reject_fee_collection_inside_exec(stock: u64, trade: u64, fee: u64) {
    let mut f = ExecFixture::new(1, 1, false, false);
    machine(&mut f.e, |m| {
        m.stock_sol = stock;
        m.buckets[0].amount = 0;
        m.buckets[0].cost = 0;
    });
    edit::<MintLedger>(&mut f.e, pda(&[b"ledger", f.bag.mint.as_ref()]).0, |l| {
        l.accounted = 0
    });
    let before = f.e.state::<Machine>(f.e.machine);
    assert_eq!(
        onepercent::math::creator_fee::regime(&before),
        onepercent::constants::REGIME_SEASON
    );
    let mut transient = before;
    transient.stock_sol -= trade;
    assert_eq!(
        onepercent::math::creator_fee::regime(&transient),
        onepercent::constants::REGIME_BELOW_FLOOR
    );
    let fee_in = f.e.fee_in;
    f.e.donate_lamports(fee_in, fee);
    let fee_balance = f.e.account(fee_in).lamports;
    let collect = super::launch_cases::collect_ix(&f.e, pubkey(&f.signer.pubkey()));
    let mut tx = f.transaction(trade, expected(&f, trade).1);
    tx.insert(tx.len() - 1, cpi(collect.clone()));
    f.reject(&tx, "ExecInFlight");
    assert_eq!(f.e.account(fee_in).lamports, fee_balance);
    assert_eq!(
        bytemuck::bytes_of(&f.e.state::<Machine>(f.e.machine)),
        bytemuck::bytes_of(&before)
    );
    f.e.check_invariants();
    // Outside the pair the exact collection remains permissionless and uses SEASON.
    f.send(&[collect]).unwrap();
    let after = f.e.state::<Machine>(f.e.machine);
    let split = onepercent::math::creator_fee::split(fee, onepercent::constants::REGIME_SEASON);
    assert_eq!(after.stock_sol, stock + split.stock);
    assert_eq!(after.team_sol, before.team_sol + split.team);
    f.e.check_invariants();
}
