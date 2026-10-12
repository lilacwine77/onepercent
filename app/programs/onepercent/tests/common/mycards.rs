//! P2 transaction fixtures, using the frozen P0 account and instruction encodings.
#![allow(dead_code)]
use crate::common::{pack_cases::*, *};
use anchor_lang::{prelude::Pubkey, AnchorSerialize, InstructionData, ToAccountMetas};
use onepercent::{instructions::SellBackCard, params, state::*};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_signer::Signer;

pub fn edit<T: anchor_lang::Discriminator + bytemuck::Pod>(
    e: &mut Env,
    at: Pubkey,
    f: impl FnOnce(&mut T),
) {
    let mut value: T = e.state(at);
    f(&mut value);
    e.mutate(at, |a| {
        a.data[8..8 + core::mem::size_of::<T>()].copy_from_slice(bytemuck::bytes_of(&value))
    });
}

pub fn fixture(n: usize) -> (Env, Keypair, Bag) {
    fixture_for(n, false)
}

pub fn fixture_for(n: usize, token_2022: bool) -> (Env, Keypair, Bag) {
    let (mut e, user, bag) = card_fixture(token_2022, n);
    let owner = pubkey(&user.pubkey());
    e.inject_phase(3);
    let quote_signer = pubkey(&e.intake.pubkey());
    let config = e.config;
    edit::<Config>(&mut e, config, |c| c.quote_signer = quote_signer);
    e.seed_bucket(0, &bag, 1, 1_000_000, 1_000_000_000);
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
    let total = 1_000_000 + 1000 * n as u64;
    e.mutate(vault, |a| write_u64(&mut a.data, 64, total));
    e.mutate(bag.mint, |a| write_u64(&mut a.data, 36, total));
    edit::<MintLedger>(&mut e, ledger, |l| l.accounted = total);
    e.mutate(binder(owner), |a| {
        for card in a.data[112..].chunks_exact_mut(56).take(n) {
            write_u64(
                card,
                40,
                params::PACK_EDITIONS_PRICE_LAMPORTS[0] * u64::from(params::HIT_TIERS_VALUE_BPS[0])
                    / u64::from(params::BPS_DENOMINATOR),
            );
            card[48] = 1;
        }
    });
    let now = e.now();
    let machine = e.machine;
    edit::<Machine>(&mut e, machine, |m| {
        m.stock_sol = 100_000_000_000;
        m.sol_at_hour_start = m.stock_sol;
        m.hour_index = now.max(0) as u64 / 3600;
        m.end_ts = now + 100_000;
    });
    fund_machine(&mut e);
    (e, user, bag)
}

/// Benchmark mints do not depend on the process-global unique-public-key counter.
/// The original fixture mint retains zero-accounted, zero-supply accounts.
pub fn measurement_fixture(n: usize, token_2022: bool, sample: u64) -> (Env, Keypair, Bag) {
    let (mut e, user, previous) = fixture_for(n, token_2022);
    let owner = pubkey(&user.pubkey());
    let mint = Pubkey::new_from_array(
        solana_sha256_hasher::hashv(&[
            b"onepercent-p2-cu-mint",
            &sample.to_le_bytes(),
            &[u8::from(token_2022)],
        ])
        .to_bytes(),
    );
    let curve = Pubkey::find_program_address(
        &[b"bonding-curve", mint.as_ref()],
        &params::PROGRAM_IDS_PUMP_FUN,
    )
    .0;
    let bag = Bag {
        mint,
        curve,
        ..previous.clone()
    };
    e.put(mint, e.account(previous.mint));
    e.put(curve, e.account(previous.curve));
    let old_ledger = pda(&[b"ledger", previous.mint.as_ref()]).0;
    let mut ledger = e.state::<MintLedger>(old_ledger);
    ledger.mint = mint;
    e.set_state(pda(&[b"ledger", mint.as_ref()]).0, &ledger, &[], 0);
    let old_vault = ata(&e.vault_auth, &previous.mint, &previous.token_program);
    e.token_account(e.vault_auth, &bag, ledger.accounted);
    e.token_account(owner, &bag, 0);
    e.mutate(old_vault, |a| write_u64(&mut a.data, 64, 0));
    e.mutate(previous.mint, |a| write_u64(&mut a.data, 36, 0));
    edit::<MintLedger>(&mut e, old_ledger, |l| l.accounted = 0);
    let machine = e.machine;
    edit::<Machine>(&mut e, machine, |m| m.buckets[0].mint = mint);
    e.mutate(binder(owner), |a| {
        for card in a.data[112..].chunks_exact_mut(56).take(n) {
            write_key(card, 0, &mint);
        }
    });
    (e, user, bag)
}

pub fn fund_machine(e: &mut Env) {
    let m = e.state::<Machine>(e.machine);
    let minimum = e.rent_min(e.account(e.machine).data.len());
    e.mutate(e.machine, |a| {
        a.lamports =
            minimum + m.stock_sol + m.team_sol + m.jackpot_sol + m.burn_sol + m.final_pool_sol
    });
}

pub fn selected(e: &Env, owner: Pubkey, indices: &[u16]) -> Vec<SellBackCard> {
    let owned = cards(e, owner);
    indices
        .iter()
        .map(|index| SellBackCard {
            index: *index,
            amount: owned[usize::from(*index)].amount,
        })
        .collect()
}

pub fn sb_message(
    owner: Pubkey,
    mint: Pubkey,
    selected: &[SellBackCard],
    quote: u64,
    expiry: i64,
    nonce: u32,
) -> Vec<u8> {
    let mut message = params::ATTESTATIONS_SELL_BACK_DOMAIN.to_vec();
    for key in [onepercent::ID, owner, mint] {
        message.extend_from_slice(key.as_ref());
    }
    message.push(selected.len() as u8);
    for card in selected {
        message.extend_from_slice(&card.index.to_le_bytes());
        message.extend_from_slice(&card.amount.to_le_bytes());
    }
    message.extend_from_slice(&selected.iter().map(|c| c.amount).sum::<u64>().to_le_bytes());
    message.extend_from_slice(&quote.to_le_bytes());
    message.extend_from_slice(&expiry.to_le_bytes());
    message.extend_from_slice(&nonce.to_le_bytes());
    message
}

pub fn sb_ix(
    e: &Env,
    owner: Pubkey,
    bag: &Bag,
    selected: Vec<SellBackCard>,
    quote: u64,
    expiry: i64,
    nonce: u32,
) -> Instruction {
    ix(anchor_lang::solana_program::instruction::Instruction {
        program_id: onepercent::ID,
        accounts: onepercent::accounts::SellBack {
            owner,
            config: e.config,
            machine: e.machine,
            binder: binder(owner),
            mint: bag.mint,
            ledger: pda(&[b"ledger", bag.mint.as_ref()]).0,
            vault: ata(&e.vault_auth, &bag.mint, &bag.token_program),
            instructions: instructions_sysvar(),
        }
        .to_account_metas(None),
        data: onepercent::instruction::SellBack {
            cards: selected,
            quote_lamports: quote,
            expiry,
            nonce,
            att_ix: 0,
        }
        .data(),
    })
}

pub fn sb_ixs(e: &Env, owner: Pubkey, bag: &Bag, indices: &[u16], quote: u64) -> Vec<Instruction> {
    let selected = selected(e, owner, indices);
    let nonce = e.state::<Binder>(binder(owner)).sb_nonce;
    let expiry = e.now();
    vec![
        e.attest_ix(&sb_message(
            owner, bag.mint, &selected, quote, expiry, nonce,
        )),
        sb_ix(e, owner, bag, selected, quote, expiry, nonce),
    ]
}

pub fn fb_ix(e: &Env, owner: Pubkey, indices: &[u16]) -> Instruction {
    instruction(
        "feed_back",
        vec![
            meta(owner, true, true),
            meta(e.config, false, false),
            meta(e.machine, false, false),
            meta(e.deck, true, false),
            meta(binder(owner), true, false),
            meta(system(), false, false),
        ],
        &indices.to_vec().try_to_vec().unwrap(),
    )
}

pub fn close_binder_ix(owner: Pubkey) -> Instruction {
    instruction(
        "close_binder",
        vec![meta(owner, true, true), meta(binder(owner), true, false)],
        &[],
    )
}
pub fn owed_ix(owner: Pubkey) -> Instruction {
    instruction(
        "withdraw_owed",
        vec![meta(owner, true, true), meta(binder(owner), true, false)],
        &[],
    )
}

pub fn unchanged_on_error(e: &mut Env, user: &Keypair, ixs: &[Instruction], error: &str) {
    let keys: Vec<_> = ixs
        .iter()
        .flat_map(|ix| {
            ix.accounts
                .iter()
                .filter(|a| a.is_writable)
                .map(|a| pubkey(&a.pubkey))
        })
        .collect();
    let before: Vec<_> = keys.iter().map(|k| e.svm.get_account(&addr(k))).collect();
    assert_error(e.send(ixs, &[user]), error);
    for (key, before) in keys.into_iter().zip(before) {
        assert_eq!(
            e.svm.get_account(&addr(&key)),
            before,
            "refusal changed {key}"
        );
    }
}

pub fn entries(e: &Env) -> Vec<DeckEntry> {
    let deck = e.state::<Deck>(e.deck);
    e.account(e.deck).data[64..]
        .chunks_exact(80)
        .take(deck.len as usize)
        .map(bytemuck::pod_read_unaligned)
        .collect()
}

pub fn seed_refed(e: &mut Env, owner: Pubkey, bag: &Bag, count: u32) {
    let entry = DeckEntry {
        depositor: owner,
        mint: bag.mint,
        amount: 1000,
        deposit: u32::try_from(e.rent_min(144) - e.rent_min(64)).unwrap(),
        flags: onepercent::constants::ENTRY_REFED,
        _pad: [0; 3],
    };
    let mut deck = e.state::<Deck>(e.deck);
    deck.len = count;
    deck.cap = count;
    deck.total_fed = u64::from(count);
    let tail = bytemuck::cast_slice(&vec![entry; count as usize]).to_vec();
    e.set_state(
        e.deck,
        &deck,
        &tail,
        u64::from(count) * u64::from(entry.deposit),
    );
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    edit::<MintLedger>(e, ledger, |l| l.accounted += u64::from(count) * 1000);
    let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
    e.mutate(vault, |a| {
        let amount = read_u64(&a.data, 64);
        write_u64(&mut a.data, 64, amount + u64::from(count) * 1000);
    });
    e.mutate(bag.mint, |a| {
        let amount = read_u64(&a.data, 36);
        write_u64(&mut a.data, 36, amount + u64::from(count) * 1000);
    });
}

/// Mirrors the SDK default legacy transaction with both compute budget instructions.
/// Ed25519 is retained and its instruction offset is adjusted by the caller.
pub fn measure(e: &mut Env, owner: &Keypair, instructions: Vec<Instruction>) -> (u64, usize) {
    use solana_compute_budget_interface::ComputeBudgetInstruction;
    let mut all = vec![
        ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
        ComputeBudgetInstruction::set_compute_unit_price(1),
    ];
    all.extend(instructions);
    let message = solana_message::Message::new_with_blockhash(
        &all,
        Some(&owner.pubkey()),
        &e.svm.latest_blockhash(),
    );
    let size =
        1 + 64 * usize::from(message.header.num_required_signatures) + message.serialize().len();
    assert!(size <= 1232, "SDK-shaped transaction is {size} bytes");
    let result = e.send_with_payer(&all, owner, &[]).unwrap();
    (result.compute_units_consumed, size)
}

pub fn via_cpi(inner: Instruction) -> Instruction {
    let mut accounts = vec![meta(onepercent::ID, false, false)];
    accounts.extend(inner.accounts);
    let mut data = vec![0xf3];
    data.extend_from_slice(&inner.data);
    Instruction {
        program_id: addr(&vrf()),
        accounts,
        data,
    }
}

/// A distinct listed mint keeps My cards operations valid for every executor kind.
pub fn seed_exec_cards(e: &mut Env, owner: Pubkey) -> Bag {
    use bytemuck::Zeroable;
    let bag = e.new_pump_mint(false);
    e.seed_bucket(15, &bag, 1, 1_000_000_000, 1_000_000_000);
    let card = Card {
        mint: bag.mint,
        amount: 1000,
        value: 50_000_000,
        kind: 1,
        ..Card::zeroed()
    };
    e.binder(owner, &[card, Card { kind: 0, ..card }], 0, 2);
    let vault = ata(&e.vault_auth, &bag.mint, &bag.token_program);
    e.donate_tokens(vault, 2000);
    e.mutate(bag.mint, |a| write_u64(&mut a.data, 36, 1_000_002_000));
    edit::<MintLedger>(e, pda(&[b"ledger", bag.mint.as_ref()]).0, |l| {
        l.accounted += 2000
    });
    let config = e.config;
    let signer = pubkey(&e.intake.pubkey());
    edit::<Config>(e, config, |c| c.quote_signer = signer);
    bag
}
