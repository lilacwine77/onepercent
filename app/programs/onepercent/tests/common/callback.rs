#![allow(dead_code)]
use crate::common::*;
use anchor_lang::{
    __private::base64::{engine::general_purpose::STANDARD, Engine},
    prelude::Pubkey,
    AnchorDeserialize, Discriminator,
};
use litesvm::types::TransactionMetadata;
use onepercent::{events::*, state::*};
use solana_signer::Signer;

pub fn setup(mainnet: bool, count: u32) -> (Env, solana_keypair::Keypair, Bag, Bag) {
    let mut env = Env::with_mainnet(mainnet);
    env.inject_phase(3);
    let dust = env.inject_deck(count);
    let stock = env.new_pump_mint(false);
    env.seed_bucket(0, &stock, 1, 1_000_000_000_000, 300_000_000_000);
    let user = env.user();
    (env, user, dust, stock)
}
pub fn events<T: AnchorDeserialize + Discriminator>(metadata: &TransactionMetadata) -> Vec<T> {
    metadata
        .logs
        .iter()
        .filter_map(|line| line.strip_prefix("Program data: "))
        .filter_map(|text| STANDARD.decode(text).ok())
        .filter(|data| data.starts_with(T::DISCRIMINATOR))
        .map(|data| T::deserialize(&mut &data[T::DISCRIMINATOR.len()..]).unwrap())
        .collect()
}
pub fn no_exception_events(metadata: &TransactionMetadata) {
    assert!(events::<HitSkipped>(metadata).is_empty());
    assert!(events::<CardDropped>(metadata).is_empty());
    assert!(events::<VaultShortfall>(metadata).is_empty());
    assert!(events::<CallbackSkipped>(metadata).is_empty());
}
pub fn skipped(metadata: &TransactionMetadata, reason: u8) {
    let skipped = events::<CallbackSkipped>(metadata);
    assert_eq!(skipped.len(), 1, "{:?}", metadata.logs);
    assert_eq!(skipped[0].reason, reason);
    assert!(events::<PullRevealed>(metadata).is_empty());
}
pub fn cards(env: &Env, binder: Pubkey) -> Vec<Card> {
    let account = env.account(binder);
    let count = read_u16(&account.data, 104);
    account.data[112..]
        .chunks_exact(56)
        .take(usize::from(count))
        .map(bytemuck::pod_read_unaligned)
        .collect()
}
pub fn packs(env: &Env, pull: Pubkey) -> Vec<PackRecord> {
    let account = env.account(pull);
    account.data[176..]
        .chunks_exact(200)
        .map(bytemuck::pod_read_unaligned)
        .collect()
}
pub fn random(seed: u64) -> [u8; 32] {
    let mut randomness = [0u8; 32];
    randomness[..8].copy_from_slice(&seed.to_le_bytes());
    randomness
}
pub fn force_tier(seq: u64, pack: u8, edition: u8, tier: u8) -> [u8; 32] {
    (0u64..1_000_000)
        .map(random)
        .find(|r| {
            crate::reference::draw(r, seq, pack, edition, 0, false)
                .unwrap()
                .tier
                == tier
        })
        .unwrap()
}
pub fn all_silver(seq: u64, edition: u8, qty: u8) -> [u8; 32] {
    (0u64..1_000_000)
        .map(random)
        .find(|r| {
            (0..qty).all(|p| {
                crate::reference::draw(r, seq, p, edition, 0, false)
                    .unwrap()
                    .tier
                    == 1
            })
        })
        .unwrap()
}
pub fn shrink_deck(env: &mut Env, count: u32) {
    let previous = env.account(env.deck);
    let old = read_u32(&previous.data, 8);
    assert!(count <= old);
    let mut removed = std::collections::BTreeMap::<Pubkey, u64>::new();
    for entry in previous.data[64..]
        .chunks_exact(80)
        .take(old as usize)
        .skip(count as usize)
    {
        *removed.entry(read_key(entry, 32)).or_default() += read_u64(entry, 64);
    }
    for (mint, amount) in removed {
        let ledger = pda(&[b"ledger", mint.as_ref()]).0;
        env.mutate(ledger, |a| {
            let value = read_u64(&a.data, 72);
            write_u64(&mut a.data, 72, value - amount)
        });
    }
    env.mutate(env.deck, |a| {
        write_u32(&mut a.data, 8, count);
        write_u32(&mut a.data, 12, count);
        a.data.truncate(64 + 80 * count as usize);
    });
}
pub fn raw(env: &Env, pull: Pubkey, randomness: [u8; 32]) -> solana_instruction::Instruction {
    let seq = env.state::<Pull>(pull).seq;
    env.raw_fulfill_ix(pull, randomness, seq, false)
}
pub fn callback_cu(metadata: &TransactionMetadata) -> u64 {
    let prefix = format!("Program {} consumed ", onepercent::ID);
    metadata
        .logs
        .iter()
        .filter_map(|line| line.strip_prefix(&prefix))
        .map(|s| s.split_whitespace().next().unwrap().parse::<u64>().unwrap())
        .sum()
}
pub fn allocation_bound(qty: u8) -> usize {
    // Anchor's event encoder allocates 256 then 512 bytes per 467-byte pack event;
    // the default allocator retains both. Four KiB also covers entrypoint account
    // metadata, fixed callback arguments and the small final event encoding.
    let q = usize::from(qty);
    q * std::mem::size_of::<PackRevealed>()
        + q * 4 * std::mem::size_of::<(u8, u8, u32)>()
        + q * 4 * std::mem::size_of::<u32>()
        + q * 4 * std::mem::size_of::<u64>()
        + q * (256 + 512)
        // RevealTimestamped plus KeeperHistoryStarted on a legacy first reveal.
        + 2 * 256
        + 4096
}
pub fn large_binder(env: &mut Env, user: &solana_keypair::Keypair, dust: &Bag, qty: u8) {
    let count = usize::from(u16::MAX) - usize::from(qty) * 5;
    let card = Card {
        mint: dust.mint,
        amount: 1,
        value: 0,
        kind: 0,
        edition: 0,
        flags: 0,
        _pad: 0,
        seq_lo: 0,
    };
    env.binder(pubkey(&user.pubkey()), &vec![card; count], 0, u16::MAX);
    let ledger = pda(&[b"ledger", dust.mint.as_ref()]).0;
    env.mutate(ledger, |a| {
        let old = read_u64(&a.data, 72);
        write_u64(&mut a.data, 72, old + count as u64);
    });
    let vault = ata(&env.vault_auth, &dust.mint, &token());
    env.donate_tokens(vault, count as u64);
}
pub fn revealed_accounting(
    env: &Env,
    metadata: &TransactionMetadata,
    before: &Machine,
    before_lamports: u64,
) {
    let event = events::<PullRevealed>(metadata);
    assert_eq!(event.len(), 1);
    let e = &event[0];
    let after = env.state::<Machine>(env.machine);
    let moved = e.to_stock + e.to_jackpot + e.to_burn + e.to_team;
    assert_eq!(env.account(env.machine).lamports - before_lamports, moved);
    assert_eq!(after.stock_sol - before.stock_sol, e.to_stock);
    assert_eq!(after.jackpot_sol - before.jackpot_sol, e.to_jackpot);
    assert_eq!(after.burn_sol - before.burn_sol, e.to_burn);
    assert_eq!(after.team_sol - before.team_sol, e.to_team);
    assert_eq!(
        after.reserved_dust,
        before.reserved_dust - 4 * u64::from(e.qty)
    );
    assert_eq!(after.pending_pulls, before.pending_pulls - 1);
    assert_eq!(e.shortfall, 0);
    no_exception_events(metadata);
    env.check_invariants();
}
