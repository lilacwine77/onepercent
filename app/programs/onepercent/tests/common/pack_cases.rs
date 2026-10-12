use super::*;
use anchor_lang::__private::base64::{engine::general_purpose::STANDARD, Engine};
use anchor_lang::{prelude::Pubkey, AnchorDeserialize, Discriminator};
use bytemuck::Zeroable;
use onepercent::state::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

pub fn setup(mainnet: bool) -> (Env, Keypair, Bag, Bag) {
    let mut e = Env::with_mainnet(mainnet);
    e.inject_phase(3);
    let dust = e.inject_deck(100);
    let hit = e.new_pump_mint(false);
    e.seed_bucket(0, &hit, 1, 1_000_000_000_000, 300_000_000_000);
    let buyer = e.user();
    (e, buyer, dust, hit)
}
pub fn binder(owner: Pubkey) -> Pubkey {
    pda(&[b"binder", owner.as_ref()]).0
}
pub fn records(e: &Env, pull: Pubkey) -> Vec<PackRecord> {
    e.account(pull).data[176..]
        .chunks_exact(200)
        .map(bytemuck::pod_read_unaligned)
        .collect()
}
pub fn cards(e: &Env, owner: Pubkey) -> Vec<Card> {
    let a = e.account(binder(owner));
    let n = read_u16(&a.data, 104) as usize;
    a.data[112..112 + n * 56]
        .chunks_exact(56)
        .map(bytemuck::pod_read_unaligned)
        .collect()
}
pub fn events<T: AnchorDeserialize + Discriminator>(
    m: &litesvm::types::TransactionMetadata,
) -> Vec<T> {
    m.logs
        .iter()
        .filter_map(|line| line.strip_prefix("Program data: "))
        .filter_map(|line| STANDARD.decode(line).ok())
        .filter_map(|bytes| {
            if !bytes.starts_with(T::DISCRIMINATOR) {
                return None;
            }
            T::deserialize(&mut &bytes[T::DISCRIMINATOR.len()..]).ok()
        })
        .collect()
}
pub fn pause_all(e: &mut Env) {
    e.mutate(e.config, |a| {
        a.data[740] = 255;
        a.data[741] = 255;
        a.data[742] = 255;
    });
}
pub fn team_ix(e: &Env) -> solana_instruction::Instruction {
    instruction(
        "team_withdraw",
        vec![
            meta(e.machine, true, false),
            meta(e.config, false, false),
            meta(pubkey(&e.authority.pubkey()), true, false),
        ],
        &[],
    )
}
pub fn close_ix(e: &Env, bag: &Bag) -> solana_instruction::Instruction {
    let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
    instruction(
        "close_vault",
        vec![
            meta(e.machine, false, false),
            meta(bag.mint, true, false),
            meta(ledger, true, false),
            meta(
                ata(&e.vault_auth, &bag.mint, &bag.token_program),
                true,
                false,
            ),
            meta(e.vault_auth, false, false),
            meta(e.state::<MintLedger>(ledger).payer, true, false),
            meta(bag.token_program, false, false),
        ],
        &[],
    )
}
pub fn card_fixture(t22: bool, n: usize) -> (Env, Keypair, Bag) {
    card_fixture_for(false, t22, n)
}
pub fn card_fixture_for(mainnet: bool, t22: bool, n: usize) -> (Env, Keypair, Bag) {
    let mut e = Env::with_mainnet(mainnet);
    let owner = e.user();
    let who = pubkey(&owner.pubkey());
    let bag = e.new_pump_mint(t22);
    e.token_account(e.vault_auth, &bag, 1000 * n as u64);
    e.token_account(who, &bag, 0);
    e.mutate(bag.mint, |a| write_u64(&mut a.data, 36, 1000 * n as u64));
    e.set_state(
        pda(&[b"ledger", bag.mint.as_ref()]).0,
        &MintLedger {
            mint: bag.mint,
            payer: who,
            accounted: 1000 * n as u64,
        },
        &[],
        0,
    );
    let mut card = Card::zeroed();
    card.mint = bag.mint;
    card.amount = 1000;
    card.kind = 0;
    e.binder(who, &vec![card; n], 0, n as u16);
    (e, owner, bag)
}
