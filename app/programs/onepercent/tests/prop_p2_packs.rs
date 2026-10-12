mod common;
#[path = "common/history.rs"]
mod history;
#[path = "common/launch_cases.rs"]
mod launch;
#[path = "common/reference.rs"]
mod reference;
#[path = "common/specials_cases.rs"]
mod specials;
use history::History;
#[path = "common/intake_cases.rs"]
mod intake;
#[path = "common/property.rs"]
mod property;
use anchor_lang::{prelude::Pubkey, AnchorSerialize};
use common::pack_cases::{binder, cards, close_ix, events, records, team_ix};
use common::*;
use intake::{config, edit_state, entries, reset_user_bag, token_amount};
use onepercent::{
    events::{
        CardDropped, HitSkipped, PackSettled, PullClosed, PullRefunded, PullRevealed,
        ReferralRedirected, RoyaltyRedirected, VaultShortfall,
    },
    instructions::GuardianAction,
    params,
    state::{Binder, Machine, MintLedger, Pull},
};
use proptest::prelude::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use std::collections::BTreeMap;

fn read_only(instruction: &mut solana_instruction::Instruction, key: Pubkey) {
    // Account privileges are unified across every occurrence of an address.
    for account in &mut instruction.accounts {
        if account.pubkey == addr(&key) {
            account.is_writable = false;
        }
    }
}

fn reject_atomically(
    env: &mut Env,
    instruction: solana_instruction::Instruction,
    caller: &Keypair,
) {
    let before: BTreeMap<_, _> = instruction
        .accounts
        .iter()
        .map(|meta| pubkey(&meta.pubkey))
        .filter(|key| *key != onepercent::ID)
        .map(|key| (key, env.svm.get_account(&addr(&key))))
        .collect();
    assert_error(
        env.send_with_payer(&[instruction], caller, &[]),
        "AccountMismatch",
    );
    for (key, account) in before {
        assert_eq!(
            env.svm.get_account(&addr(&key)),
            account,
            "rejected payout is atomic"
        );
    }
}

fn referrers(env: &mut Env) -> [Option<Pubkey>; 6] {
    let funded = who(&env.user());
    let owned = Pubkey::new_unique();
    env.put(
        owned,
        solana_account::Account {
            lamports: env.rent_min(0),
            owner: addr(&onepercent::ID),
            ..Default::default()
        },
    );
    [
        None,
        Some(funded),
        Some(Pubkey::new_unique()),
        Some(anchor_lang::solana_program::sysvar::rent::ID),
        Some(owned),
        Some(onepercent::ID),
    ]
}

#[allow(deprecated)]
fn restore_wallet(env: &mut Env, owner: Pubkey, balance: u64) {
    if balance > 0 {
        env.send(
            &[ix(
                anchor_lang::solana_program::system_instruction::transfer(
                    &who(&env.authority),
                    &owner,
                    balance,
                ),
            )],
            &[],
        )
        .unwrap();
    }
}

struct PayeeBalance {
    balance: u64,
    minimum: u64,
    eligible: bool,
}

struct PaymentOracle(BTreeMap<Pubkey, PayeeBalance>);
impl PaymentOracle {
    fn new(
        env: &Env,
        instruction: &solana_instruction::Instruction,
        keys: impl IntoIterator<Item = Pubkey>,
    ) -> Self {
        Self(
            keys.into_iter()
                .map(|key| {
                    let account = env.svm.get_account(&addr(&key)).unwrap_or_default();
                    let writable = instruction
                        .accounts
                        .iter()
                        .any(|meta| meta.pubkey == addr(&key) && meta.is_writable);
                    (
                        key,
                        PayeeBalance {
                            balance: account.lamports,
                            minimum: env.rent_min(account.data.len()),
                            eligible: writable
                                && account.owner == addr(&anchor_lang::system_program::ID)
                                && !account.executable,
                        },
                    )
                })
                .collect(),
        )
    }
    // The oracle applies the specification in payment order, so aliases see
    // previous credits before their own rent eligibility is evaluated.
    fn credit(&mut self, key: Pubkey, amount: u64) -> bool {
        let payee = self.0.get_mut(&key).unwrap();
        if payee.eligible
            && payee
                .balance
                .checked_add(amount)
                .is_some_and(|balance| balance >= payee.minimum)
        {
            payee.balance += amount;
            true
        } else {
            false
        }
    }
    fn verify(&self, env: &Env, source: Pubkey) {
        for (key, payee) in &self.0 {
            if *key != source && *key != env.machine {
                assert_eq!(
                    env.svm.get_balance(&addr(key)).unwrap_or(0),
                    payee.balance,
                    "exact payee credit {key}"
                );
            }
        }
    }
}

fn settle_with_flags(
    env: &mut Env,
    pull: Pubkey,
    pack: u8,
    mode: u8,
    users: &[Keypair],
    caller: &Keypair,
) {
    let p = env.state::<Pull>(pull);
    let record = records(env, pull)[usize::from(pack)];
    let last = (p.settled_mask | (1 << pack)) == (1 << p.qty) - 1;
    let depositor = record
        .royalties
        .iter()
        .enumerate()
        .find(|(slot, _)| record.house_mask & (1 << slot) == 0)
        .map(|(_, royalty)| royalty.depositor);
    let target = match mode {
        1 | 4 => depositor,
        2 | 5 if last => Some(p.buyer),
        3 if p.referrer != Pubkey::default() => Some(p.referrer),
        _ => None,
    };
    let restored = if mode >= 4 {
        target
            .and_then(|key| users.iter().find(|user| who(user) == key))
            .map(|user| {
                let balance = env.account(who(user)).lamports;
                drain_wallet(env, user);
                (who(user), balance)
            })
    } else {
        None
    };
    let before_machine = env.state::<Machine>(env.machine);
    let source = env.account(pull);
    let mut instruction = env.settle_ix(pull, pack);
    if let Some(key) = target {
        read_only(&mut instruction, key);
    }
    let must_reject = target.is_some_and(|key| {
        let account = env.svm.get_account(&addr(&key)).unwrap_or_default();
        account.owner == addr(&anchor_lang::system_program::ID)
            && !account.executable
            && (mode != 3 || account.lamports > 0)
    });
    if must_reject {
        reject_atomically(env, instruction, caller);
        instruction = env.settle_ix(pull, pack);
    }
    let mut keys = vec![p.buyer];
    if p.referrer != Pubkey::default() {
        keys.push(p.referrer);
    }
    for (slot, royalty) in record.royalties.iter().enumerate() {
        if record.house_mask & (1 << slot) == 0 {
            keys.push(royalty.depositor);
        }
    }
    let mut oracle = PaymentOracle::new(env, &instruction, keys);
    let floor = if last {
        0
    } else {
        env.rent_min(source.data.len())
    };
    let mut remaining = source.lamports;
    let mut expected_paid = [0u64; 4];
    let mut expected_mask = 0u8;
    let mut expected_stock = 0u64;
    let mut expected_royalties = BTreeMap::new();
    for (slot, royalty) in record.royalties.iter().enumerate() {
        if record.house_mask & (1 << slot) != 0 {
            continue;
        }
        let amount = (royalty.lamports + royalty.refund).min(remaining.saturating_sub(floor));
        remaining -= amount;
        expected_paid[slot] = amount;
        if !oracle.credit(royalty.depositor, amount) {
            expected_stock += amount;
            expected_mask |= 1 << slot;
            expected_royalties.insert(slot as u8, (royalty.depositor, amount));
        }
    }
    let mut expected_referral_paid = 0;
    let mut expected_referral_redirected = None;
    if p.referrer != Pubkey::default() {
        let nominal = (u128::from(p.price) * u128::from(params::PACK_SPLIT_BPS_REFERRAL)
            / u128::from(params::BPS_DENOMINATOR)) as u64;
        let amount = nominal.min(remaining.saturating_sub(floor));
        remaining -= amount;
        if oracle.credit(p.referrer, amount) {
            expected_referral_paid = amount;
        } else {
            expected_stock += amount;
            expected_referral_redirected = Some(amount);
        }
    }
    let expected_closed = if last {
        let amount = remaining;
        remaining = 0;
        let to_stock = !oracle.credit(p.buyer, amount);
        if to_stock {
            expected_stock += amount;
        }
        Some((
            if to_stock { env.machine } else { p.buyer },
            amount,
            to_stock,
        ))
    } else {
        None
    };
    let tx = env.send_with_payer(&[instruction], caller, &[]).unwrap();
    let settled = events::<PackSettled>(&tx);
    assert_eq!(settled.len(), 1);
    assert_eq!(settled[0].paid, expected_paid);
    assert_eq!(settled[0].redirected_mask, expected_mask);
    assert_eq!(settled[0].referral_to_team, 0);
    assert_eq!(settled[0].referral_paid, expected_referral_paid);
    let royalty_redirected = events::<RoyaltyRedirected>(&tx);
    assert_eq!(royalty_redirected.len(), expected_royalties.len());
    for event in royalty_redirected {
        assert_eq!(
            expected_royalties.remove(&event.slot),
            Some((event.depositor, event.amount))
        );
    }
    let referral_redirected = events::<ReferralRedirected>(&tx);
    assert_eq!(
        referral_redirected.len(),
        usize::from(expected_referral_redirected.is_some())
    );
    if let Some(amount) = expected_referral_redirected {
        assert_eq!(
            (
                referral_redirected[0].referrer,
                referral_redirected[0].amount
            ),
            (p.referrer, amount)
        );
    }
    let closed = events::<PullClosed>(&tx);
    assert_eq!(closed.len(), usize::from(expected_closed.is_some()));
    if let Some((to, lamports, to_stock)) = expected_closed {
        assert_eq!(
            (closed[0].to, closed[0].lamports, closed[0].to_stock),
            (to, lamports, to_stock)
        );
    }
    assert_eq!(env.svm.get_balance(&addr(&pull)).unwrap_or(0), remaining);
    oracle.verify(env, pull);
    let after = env.state::<Machine>(env.machine);
    assert_eq!(after.team_sol, before_machine.team_sol);
    assert_eq!(after.stock_sol - before_machine.stock_sol, expected_stock);
    if let Some((owner, balance)) = restored {
        restore_wallet(env, owner, balance);
    }
}

fn refund_with_flags(env: &mut Env, pull: Pubkey, readonly: bool, caller: &Keypair) {
    let p = env.state::<Pull>(pull);
    let binder = pda(&[b"binder", p.buyer.as_ref()]).0;
    let mut instruction = env.refund_ix(pull);
    if readonly {
        read_only(&mut instruction, p.buyer);
        reject_atomically(env, instruction, caller);
        instruction = env.refund_ix(pull);
    }
    let mut oracle = PaymentOracle::new(env, &instruction, [p.buyer]);
    let amount = env.account(pull).lamports;
    let b = env.state::<Binder>(binder);
    let before_binder = env.account(binder);
    let before_machine = env.state::<Machine>(env.machine);
    let released = (params::CARDS_PER_PACK_DUST + params::CARDS_PER_PACK_HIT) * u32::from(p.qty);
    let reserved = b.reserved.saturating_sub(released as u16);
    let target = b.len + reserved;
    let size = params::ACCOUNT_SIZES_BINDER_HEADER as usize
        + params::ACCOUNT_SIZES_CARD_SLOT as usize * usize::from(target);
    let floor = env.rent_min(size) + b.sol_owed;
    let mut expected_binder_balance = before_binder.lamports;
    let mut expected_binder_size = before_binder.data.len();
    if target < b.cap && before_binder.lamports >= floor {
        expected_binder_size = size;
        let refund = before_binder.lamports - floor;
        if oracle.credit(p.buyer, refund) {
            expected_binder_balance -= refund;
        }
    }
    let expected_stock = if oracle.credit(p.buyer, amount) {
        0
    } else {
        amount
    };
    let tx = env.send_with_payer(&[instruction], caller, &[]).unwrap();
    oracle.verify(env, pull);
    assert!(env.closed(pull));
    assert_eq!(env.account(binder).lamports, expected_binder_balance);
    assert_eq!(env.account(binder).data.len(), expected_binder_size);
    assert_eq!(env.state::<Binder>(binder).reserved, reserved);
    let after = env.state::<Machine>(env.machine);
    assert_eq!(after.stock_sol - before_machine.stock_sol, expected_stock);
    assert_eq!(after.team_sol, before_machine.team_sol);
    let refunded = events::<PullRefunded>(&tx);
    assert_eq!(refunded.len(), 1);
    assert_eq!((refunded[0].buyer, refunded[0].amount), (p.buyer, amount));
}

fn who(key: &Keypair) -> Pubkey {
    pubkey(&key.pubkey())
}
fn tracked_sol(m: &Machine) -> u64 {
    m.stock_sol + m.jackpot_sol + m.burn_sol + m.team_sol + m.final_pool_sol
}
fn current_cards(env: &Env, key: Pubkey) -> Vec<onepercent::state::Card> {
    let binder = pda(&[b"binder", key.as_ref()]).0;
    if env.closed(binder) {
        vec![]
    } else {
        cards(env, key)
    }
}
fn valid_state(env: &Env, checked_transactions: &mut usize) {
    env.check_invariants();
    for tx in env.transactions.iter().skip(*checked_transactions) {
        assert!(events::<HitSkipped>(tx).is_empty());
        assert!(events::<CardDropped>(tx).is_empty());
        assert!(events::<VaultShortfall>(tx).is_empty());
    }
    *checked_transactions = env.transactions.len();
}
fn fulfill(env: &mut Env, pull: Pubkey, randomness: [u8; 32]) {
    let before = env.state::<Machine>(env.machine);
    let balance = env.account(env.machine).lamports;
    let tx = env.fulfill(pull, randomness).unwrap();
    let after = env.state::<Machine>(env.machine);
    let emitted = events::<PullRevealed>(&tx);
    if !emitted.is_empty() {
        assert_eq!(emitted.len(), 1);
        let e = &emitted[0];
        let moved = e.to_stock + e.to_jackpot + e.to_burn + e.to_team;
        assert_eq!(env.account(env.machine).lamports - balance, moved);
        assert_eq!(tracked_sol(&after) - tracked_sol(&before), moved);
    }
}
fn redeem_one(env: &mut Env, user: &Keypair, bag: &Bag, index: u16, amount: u64) {
    let owner = who(user);
    env.send_with_payer(
        &[
            env.create_ata_ix(owner, bag, owner),
            env.redeem_ix(owner, bag, index, amount),
        ],
        user,
        &[],
    )
    .unwrap();
}

fn run_case(steps: Vec<(u8, u16, [u8; 32])>) -> proptest::test_runner::TestCaseResult {
    let mut env = Env::new();
    let mut checked_transactions = 0;
    let users = [env.user(), env.user(), env.user()];
    let caller = env.user();
    let referrals = referrers(&mut env);
    let guardian = env.guardian.insecure_clone();
    let mut bags = BTreeMap::<Pubkey, Bag>::new();
    let mut donations = BTreeMap::<Pubkey, u64>::new();
    let dust = env.inject_deck(100);
    let depositor = who(&users[0]);
    env.mutate(env.deck, |a| {
        for bytes in a.data[64..].chunks_exact_mut(80) {
            write_key(bytes, 0, &depositor);
        }
    });
    let ledger = pda(&[b"ledger", dust.mint.as_ref()]).0;
    edit_state::<MintLedger>(&mut env, ledger, |l| l.payer = depositor);
    env.token_account(depositor, &dust, 0);
    bags.insert(dust.mint, dust);
    for index in 0..16 {
        let bag = env.new_pump_mint(index % 2 == 0);
        env.seed_bucket(index, &bag, 1, 600, 30 * params::LAMPORTS_PER_SOL);
        bags.insert(bag.mint, bag);
    }
    env.inject_phase(3);
    let special = specials::inject(&mut env, [0; 4], 5_000_000, 15_000_000_000);
    let special_mint = special.mint;
    bags.insert(special.mint, special);
    let initial_machine = env.account(env.machine).lamports;
    let mut machine_donations = 0u64;
    let mut pulls = vec![];
    let mut history = History::new(&env);
    for (index, user) in users.iter().enumerate() {
        let referral = referrals[(usize::from(steps[index].1) + index) % referrals.len()];
        let (pull, _) = env.buy_with_payer(user, 0, 1, referral, user).unwrap();
        pulls.push(pull);
    }
    valid_state(&env, &mut checked_transactions);
    history.check(&env);
    for (op, arg, randomness) in steps {
        let pick = usize::from(arg);
        let user = &users[pick % 3];
        let owner = who(user);
        match op {
            0 => match env.buy_with_payer(
                user,
                (arg % 4) as u8,
                1 + (arg % 2) as u8,
                referrals[pick % referrals.len()],
                user,
            ) {
                Ok((pull, _)) => pulls.push(pull),
                Err(error) => prop_assert!(
                    error.meta.logs.iter().any(|line| [
                        "Refilling",
                        "MachineHungry",
                        "DeckUnderfunded"
                    ]
                    .iter()
                    .any(|name| line.contains(name))),
                    "unexpected buy failure: {error:?}"
                ),
            },
            1 => {
                let pending: Vec<_> = pulls
                    .iter()
                    .copied()
                    .filter(|at| !env.closed(*at) && env.state::<Pull>(*at).status == 1)
                    .collect();
                if !pending.is_empty() {
                    let at = pending[pick % pending.len()];
                    let p = env.state::<Pull>(at);
                    if env.now() > p.created_ts + params::VRF_TIMEOUT_SECONDS {
                        refund_with_flags(&mut env, at, arg % 2 == 0, &caller);
                    } else {
                        fulfill(&mut env, at, randomness);
                    }
                }
            }
            2 => {
                env.warp(i64::from(arg % 401));
                let expired: Vec<_> = pulls
                    .iter()
                    .copied()
                    .filter(|at| {
                        !env.closed(*at) && {
                            let p = env.state::<Pull>(*at);
                            p.status == 1 && env.now() > p.created_ts + params::VRF_TIMEOUT_SECONDS
                        }
                    })
                    .collect();
                if !expired.is_empty() {
                    refund_with_flags(
                        &mut env,
                        expired[pick % expired.len()],
                        arg % 2 == 0,
                        &caller,
                    );
                }
            }
            3 => {
                let revealed: Vec<_> = pulls
                    .iter()
                    .copied()
                    .filter(|at| !env.closed(*at) && env.state::<Pull>(*at).status == 2)
                    .collect();
                if !revealed.is_empty() {
                    let at = revealed[pick % revealed.len()];
                    let p = env.state::<Pull>(at);
                    let unsettled: Vec<_> = (0..p.qty)
                        .filter(|pack| p.settled_mask & (1 << pack) == 0)
                        .collect();
                    settle_with_flags(
                        &mut env,
                        at,
                        unsettled[pick % unsettled.len()],
                        (arg % 6) as u8,
                        &users,
                        &caller,
                    );
                }
            }
            4 => {
                let owned = current_cards(&env, owner);
                if !owned.is_empty() {
                    let index = pick % owned.len();
                    let card = &owned[index];
                    redeem_one(
                        &mut env,
                        user,
                        bags.get(&card.mint).unwrap(),
                        index as u16,
                        card.amount,
                    );
                }
            }
            5 => {
                let bag = env.new_pump_mint(arg % 2 == 0);
                let amount = u64::from(arg) + 1;
                reset_user_bag(&mut env, owner, &bag, amount);
                let binder = pda(&[b"binder", owner.as_ref()]).0;
                let nonce = if env.closed(binder) {
                    0
                } else {
                    env.state::<Binder>(binder).feed_nonce_base
                };
                let result =
                    env.send_with_payer(&env.feed_ixs(owner, &[(&bag, amount)], nonce), user, &[]);
                if let Err(error) = result {
                    prop_assert!(
                        error
                            .meta
                            .logs
                            .iter()
                            .any(|line| ["DeckUnderfunded", "FreshCapReached"]
                                .iter()
                                .any(|name| line.contains(name))),
                        "unexpected Feed failure: {error:?}"
                    );
                }
                bags.insert(bag.mint, bag);
            }
            6 => {
                let live = entries(&env);
                if !live.is_empty() {
                    let index = pick % live.len();
                    let entry = &live[index];
                    let signer = users.iter().find(|u| who(u) == entry.depositor).unwrap();
                    let bag = bags.get(&entry.mint).unwrap();
                    env.send_with_payer(
                        &[env.take_back_ix(entry.depositor, bag, index as u32, entry.amount)],
                        signer,
                        &[],
                    )
                    .unwrap();
                }
            }
            7 => {
                let target = match arg % 4 {
                    0 => env.machine,
                    1 => env.deck,
                    2 => pda(&[b"binder", owner.as_ref()]).0,
                    _ => {
                        let active: Vec<_> =
                            pulls.iter().copied().filter(|p| !env.closed(*p)).collect();
                        active
                            .get(pick % active.len().max(1))
                            .copied()
                            .unwrap_or(env.machine)
                    }
                };
                let amount = u64::from(arg) + 1;
                env.donate_lamports(target, amount);
                if target == env.machine {
                    machine_donations += amount;
                }
            }
            8 => {
                let live: Vec<_> = bags
                    .values()
                    .filter(|b| !env.closed(ata(&env.vault_auth, &b.mint, &b.token_program)))
                    .collect();
                if !live.is_empty() {
                    let bag = live[pick % live.len()];
                    let amount = u64::from(arg) + 1;
                    env.donate_tokens(ata(&env.vault_auth, &bag.mint, &bag.token_program), amount);
                    env.mutate(bag.mint, |a| {
                        let supply = read_u64(&a.data, 36);
                        write_u64(&mut a.data, 36, supply + amount);
                    });
                    *donations.entry(bag.mint).or_default() += amount;
                }
            }
            9 => {
                env.set_rent([5080, 2575, 1322, 696, 6960][pick % 5]);
                let minimum = env.rent_min(env.account(env.queue).data.len());
                env.mutate(env.queue, |a| a.lamports = a.lamports.max(minimum));
            }
            10 => {
                let action = GuardianAction::DisableBucket {
                    index: (arg % 16) as u8,
                };
                env.send(
                    &[env.guardian_ix(action.try_to_vec().unwrap())],
                    &[&guardian],
                )
                .unwrap();
            }
            12 => {
                let pending = pulls.iter().copied().find(|at| {
                    !env.closed(*at) && {
                        let p = env.state::<Pull>(*at);
                        p.status == 1 && env.now() <= p.created_ts + params::VRF_TIMEOUT_SECONDS
                    }
                });
                if let Some(at) = pending {
                    let p = env.state::<Pull>(at);
                    let (flags, _) = onepercent::math::specials::live_flags(
                        &env.state::<Machine>(env.machine),
                        p.price,
                        env.now(),
                    );
                    let kind = if flags & 1 != 0 {
                        6
                    } else if flags & 4 != 0 {
                        5
                    } else {
                        1
                    };
                    fulfill(
                        &mut env,
                        at,
                        specials::find_random(p.seq, 0, p.edition, flags, p.holder != 0, kind),
                    );
                }
            }
            13 => {
                env.donate_lamports(env.fee_in, u64::from(arg) + 1);
                let before = env.state::<Machine>(env.machine);
                let tx = launch::collect(&mut env);
                for event in events::<onepercent::events::CreatorFeesCollected>(&tx) {
                    assert_eq!(event.to_stock + event.to_burn + event.to_team, event.amount);
                    assert_eq!(event.to_burn, 0);
                    let book = u128::from(before.stock_sol)
                        + before
                            .buckets
                            .iter()
                            .map(|b| u128::from(b.cost))
                            .sum::<u128>();
                    let team = if book < u128::from(params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS) {
                        0
                    } else {
                        reference::creator_split(event.amount, 1).2
                    };
                    assert_eq!(event.to_team, team);
                }
            }
            14 => {
                let m = env.state::<Machine>(env.machine);
                if let Some(release) = params::TOKEN_1PCT_ONE_PCT_RELEASE_OFFSETS_SECONDS
                    .iter()
                    .map(|offset| m.on_air_ts + offset)
                    .find(|release| *release > env.now())
                {
                    specials::set_time(&mut env, release);
                    env.send(&[specials::advance(&env)], &[]).unwrap();
                }
            }
            _ => env.warp(i64::from(arg % 301)),
        }
        valid_state(&env, &mut checked_transactions);
        history.check(&env);
        let machine = env.state::<Machine>(env.machine);
        prop_assert_eq!(
            env.account(env.machine).lamports,
            initial_machine + machine_donations + tracked_sol(&machine)
        );
    }
    // Drain with every entry operation paused and all timeouts elapsed.
    config(&mut env, |c| {
        c.admin_paused = 31;
        c.guardian_paused = 31;
        c.disabled_roles = 0x78;
    });
    env.warp(params::VRF_TIMEOUT_SECONDS + 1);
    for at in &pulls {
        if env.closed(*at) {
            continue;
        }
        let p = env.state::<Pull>(*at);
        if p.status == 1 {
            refund_with_flags(&mut env, *at, false, &caller);
        } else {
            for pack in 0..p.qty {
                if !env.closed(*at) && env.state::<Pull>(*at).settled_mask & (1 << pack) == 0 {
                    settle_with_flags(&mut env, *at, pack, 0, &users, &caller);
                }
            }
        }
        valid_state(&env, &mut checked_transactions);
        history.check(&env);
    }
    for user in &users {
        loop {
            let owned = current_cards(&env, who(user));
            let Some(card) = owned.last() else {
                break;
            };
            redeem_one(
                &mut env,
                user,
                bags.get(&card.mint).unwrap(),
                (owned.len() - 1) as u16,
                card.amount,
            );
            valid_state(&env, &mut checked_transactions);
            history.check(&env);
        }
    }
    loop {
        let live = entries(&env);
        let Some(entry) = live.last() else {
            break;
        };
        let signer = users.iter().find(|u| who(u) == entry.depositor).unwrap();
        let bag = bags.get(&entry.mint).unwrap();
        env.send_with_payer(
            &[
                env.create_ata_ix(entry.depositor, bag, entry.depositor),
                env.take_back_ix(entry.depositor, bag, (live.len() - 1) as u32, entry.amount),
            ],
            signer,
            &[],
        )
        .unwrap();
        valid_state(&env, &mut checked_transactions);
        history.check(&env);
    }
    let machine = env.state::<Machine>(env.machine);
    for bag in bags.values() {
        let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
        let listed = machine
            .buckets
            .iter()
            .any(|b| b.class != 0 && b.mint == bag.mint);
        if bag.mint == special_mint {
            let remaining = machine
                .onepct
                .iter()
                .filter(|slot| slot.state <= 1)
                .map(|slot| slot.amount)
                .sum::<u64>()
                + machine.jackpot_tokens;
            prop_assert_eq!(
                token_amount(&env, ata(&env.vault_auth, &bag.mint, &bag.token_program)),
                remaining + donations.get(&bag.mint).copied().unwrap_or(0)
            );
            if remaining == 0 {
                env.send(&[close_ix(&env, bag)], &[]).unwrap();
                prop_assert!(env.closed(ledger));
                prop_assert!(env.closed(ata(&env.vault_auth, &bag.mint, &bag.token_program)));
            }
            continue;
        }
        if !listed && !env.closed(ledger) {
            env.send(&[close_ix(&env, bag)], &[]).unwrap();
        }
        if !listed {
            prop_assert!(env.closed(ata(&env.vault_auth, &bag.mint, &bag.token_program)));
        } else {
            let amount: u64 = machine
                .buckets
                .iter()
                .filter(|b| b.mint == bag.mint)
                .map(|b| b.amount)
                .sum();
            prop_assert_eq!(
                token_amount(&env, ata(&env.vault_auth, &bag.mint, &bag.token_program)),
                amount + donations.get(&bag.mint).copied().unwrap_or(0)
            );
        }
    }
    env.send(&[team_ix(&env)], &[]).unwrap();
    valid_state(&env, &mut checked_transactions);
    history.check(&env);
    for at in pulls {
        prop_assert!(env.closed(at));
    }
    prop_assert!(entries(&env).is_empty());
    for user in &users {
        let b = env.state::<Binder>(pda(&[b"binder", who(user).as_ref()]).0);
        prop_assert_eq!((b.len, b.reserved, b.fresh_in_deck), (0, 0, 0));
    }
    // Token supply returns to wallets or stays as stock or unpulled special
    // claims plus donations; other unlisted vault donations were burned.
    for bag in bags.values() {
        let mut total = 0u128;
        for at in &env.tracked {
            if let Some(account) = env.svm.get_account(&addr(at)) {
                if account.owner == addr(&bag.token_program)
                    && account.data.len() >= 165
                    && read_key(&account.data, 0) == bag.mint
                {
                    total += u128::from(read_u64(&account.data, 64));
                }
            }
        }
        prop_assert_eq!(total, u128::from(read_u64(&env.account(bag.mint).data, 36)));
    }
    let m = env.state::<Machine>(env.machine);
    prop_assert_eq!(m.team_sol, 0);
    prop_assert_eq!(
        env.account(env.machine).lamports,
        initial_machine + machine_donations + tracked_sol(&m)
    );
    Ok(())
}

#[test]
fn p2_interleaved_packs_and_all_permissionless_exits() {
    property::parallel(
        file!(),
        || prop::collection::vec((0u8..15, any::<u16>(), any::<[u8; 32]>()), 200),
        run_case,
    );
}

#[test]
fn p2_d20_payee_permissions_and_user_fees_matrix() {
    // 48 deterministic combinations complement the 200-step random campaign:
    // both feature sets, two real rent rates, six referral classes, both flags.
    for mainnet in [false, true] {
        for rate in [5080, 6960] {
            for class in 0..6 {
                for readonly in [false, true] {
                    let (mut env, buyer, _, _) = common::pack_cases::setup(mainnet);
                    let caller = env.user();
                    let referral = referrers(&mut env)[class];
                    let (pull, _) = env.buy_with_payer(&buyer, 0, 1, referral, &buyer).unwrap();
                    assert_eq!(
                        env.state::<Pull>(pull).referrer,
                        referral.unwrap_or_default()
                    );
                    env.fulfill(pull, [7; 32]).unwrap();
                    env.set_rent(rate);
                    settle_with_flags(
                        &mut env,
                        pull,
                        0,
                        if readonly { 3 } else { 0 },
                        &[buyer],
                        &caller,
                    );
                    assert!(env.closed(pull));
                    env.check_invariants();
                }
            }
        }
        // Funded and empty former signers reject a third party's read-only
        // override, then allow the identical exit with correct privileges.
        for mode in [1, 2, 4, 5] {
            let (mut env, buyer, dust, _) = common::pack_cases::setup(mainnet);
            let caller = env.user();
            let depositor = env.user();
            let owner = who(&depositor);
            env.token_account(owner, &dust, 0);
            env.mutate(env.deck, |account| {
                for entry in account.data[64..].chunks_exact_mut(80) {
                    write_key(entry, 0, &owner);
                }
            });
            let (pull, _) = env.buy_with_payer(&buyer, 0, 1, None, &buyer).unwrap();
            env.fulfill(pull, [8; 32]).unwrap();
            settle_with_flags(&mut env, pull, 0, mode, &[buyer, depositor], &caller);
            assert!(env.closed(pull));
            env.check_invariants();
        }
        let (mut env, buyer, _, _) = common::pack_cases::setup(mainnet);
        let caller = env.user();
        let (pull, _) = env.buy_with_payer(&buyer, 0, 1, None, &buyer).unwrap();
        drain_wallet(&mut env, &buyer);
        env.warp(params::VRF_TIMEOUT_SECONDS + 1);
        refund_with_flags(&mut env, pull, true, &caller);
        assert!(env.closed(pull));
        assert!(env.account(who(&buyer)).lamports >= env.rent_min(0));
        env.check_invariants();
    }
}

#[allow(deprecated)]
fn drain_wallet(env: &mut Env, wallet: &Keypair) {
    let owner = who(wallet);
    let balance = env.account(owner).lamports;
    env.send(
        &[ix(
            anchor_lang::solana_program::system_instruction::transfer(
                &owner,
                &pubkey(&env.authority.pubkey()),
                balance,
            ),
        )],
        &[wallet],
    )
    .unwrap();
    assert_eq!(env.svm.get_balance(&addr(&owner)).unwrap_or(0), 0);
}

#[allow(deprecated)]
fn allocate_at_current_rent(env: &mut Env, wallet: &Keypair, bytes: u32) {
    let owner = who(wallet);
    let transfer = anchor_lang::solana_program::system_instruction::transfer(
        &owner,
        &pubkey(&env.authority.pubkey()),
        env.account(owner).lamports - env.rent_min(bytes as usize),
    );
    let allocate =
        anchor_lang::solana_program::system_instruction::allocate(&owner, u64::from(bytes));
    env.send(&[ix(transfer), ix(allocate)], &[wallet]).unwrap();
    assert_eq!(env.account(owner).data.len(), bytes as usize);
}

/// Supplemental D17 scenarios; the main P2 property still runs 200 random
/// steps and a complete drain. Each case here varies one real payout sequence.
#[allow(deprecated)]
fn rent_payee_case(
    (mainnet, mode, donation, bytes): (bool, u8, u16, u32),
) -> proptest::test_runner::TestCaseResult {
    let (mut env, buyer, dust, _) = common::pack_cases::setup(mainnet);
    let buyer_key = who(&buyer);
    let depositor = env.user();
    let referrer = env.user();
    let referrer_key = who(&referrer);
    let owner = if mode == 2 {
        buyer_key
    } else {
        who(&depositor)
    };
    env.token_account(owner, &dust, 0);
    env.mutate(env.deck, |account| {
        for entry in account.data[64..].chunks_exact_mut(80) {
            write_key(entry, 0, &owner);
        }
    });
    let qty = match mode {
        0 => 2,
        1 => 7,
        _ => 1,
    };
    env.send(
        &[env.buy_ix(buyer_key, 0, qty, 0, (mode == 1).then_some(referrer_key))],
        &[&buyer],
    )
    .unwrap();
    let pull = pda(&[b"pull", buyer_key.as_ref(), &0u32.to_le_bytes()]).0;
    if donation > 0 {
        env.send(
            &[ix(
                anchor_lang::solana_program::system_instruction::transfer(
                    &pubkey(&env.authority.pubkey()),
                    &pull,
                    u64::from(donation),
                ),
            )],
            &[],
        )
        .unwrap();
    }
    if mode <= 1 {
        let keep = usize::from(mode == 0);
        loop {
            let live = entries(&env);
            if live.len() == keep {
                break;
            }
            let entry = live.last().unwrap();
            env.send(
                &[env.take_back_ix(owner, &dust, (live.len() - 1) as u32, entry.amount)],
                &[&depositor],
            )
            .unwrap();
        }
        drain_wallet(&mut env, if mode == 0 { &depositor } else { &referrer });
    } else {
        allocate_at_current_rent(&mut env, &buyer, bytes);
    }
    env.set_rent(6_960);
    if mode == 3 {
        env.warp(params::VRF_TIMEOUT_SECONDS + 1);
        let binder = pda(&[b"binder", buyer_key.as_ref()]).0;
        let buyer_before = env.account(buyer_key).lamports;
        let binder_before = env.account(binder).lamports;
        let amount = env.account(pull).lamports;
        prop_assert!(buyer_before + amount < env.rent_min(bytes as usize));
        let stock = env.state::<Machine>(env.machine).stock_sol;
        let tx = env.send(&[env.refund_ix(pull)], &[]).unwrap();
        prop_assert!(env.closed(pull));
        prop_assert_eq!(env.account(buyer_key).lamports, buyer_before);
        prop_assert_eq!(env.account(binder).lamports, binder_before);
        prop_assert_eq!(env.state::<Binder>(binder).reserved, 0);
        prop_assert_eq!(env.state::<Machine>(env.machine).stock_sol, stock + amount);
        prop_assert_eq!(events::<PullRefunded>(&tx)[0].amount, amount);
    } else {
        env.fulfill(pull, [1; 32]).unwrap();
        match mode {
            0 => {
                let pack = records(&env, pull)[0];
                prop_assert_eq!(pack.house_mask, 14);
                let source = env.account(pull);
                let nominal = pack.royalties[0].lamports + pack.royalties[0].refund;
                let amount = nominal.min(
                    source
                        .lamports
                        .saturating_sub(env.rent_min(source.data.len())),
                );
                prop_assert!(amount > 0 && amount < env.rent_min(0));
                let stock = env.state::<Machine>(env.machine).stock_sol;
                let tx = env.settle(pull, 0).unwrap();
                let redirected = events::<RoyaltyRedirected>(&tx);
                prop_assert_eq!(redirected.len(), 1);
                prop_assert_eq!(
                    (redirected[0].depositor, redirected[0].amount),
                    (owner, amount)
                );
                prop_assert_eq!(events::<PackSettled>(&tx)[0].redirected_mask, 1);
                prop_assert_eq!(env.svm.get_balance(&addr(&owner)).unwrap_or(0), 0);
                prop_assert_eq!(env.state::<Machine>(env.machine).stock_sol, stock + amount);
                env.settle(pull, 1).unwrap();
                prop_assert!(env.closed(pull));
            }
            1 => {
                prop_assert!(records(&env, pull).iter().all(|pack| pack.house_mask == 15));
                for pack in 0..5 {
                    env.settle(pull, pack).unwrap();
                    drain_wallet(&mut env, &referrer);
                }
                let source = env.account(pull);
                let amount = source.lamports - env.rent_min(source.data.len());
                prop_assert!(amount > 0 && amount < env.rent_min(0));
                let before = env.state::<Machine>(env.machine);
                let tx = env.settle(pull, 5).unwrap();
                let settled = events::<PackSettled>(&tx);
                prop_assert_eq!(settled[0].referral_paid, 0);
                prop_assert_eq!(settled[0].referral_to_team, 0);
                let redirected = events::<ReferralRedirected>(&tx);
                prop_assert_eq!(redirected.len(), 1);
                prop_assert_eq!(
                    (redirected[0].referrer, redirected[0].amount),
                    (referrer_key, amount)
                );
                let after = env.state::<Machine>(env.machine);
                prop_assert_eq!(after.team_sol, before.team_sol);
                prop_assert_eq!(after.stock_sol, before.stock_sol + amount);
                prop_assert_eq!(env.svm.get_balance(&addr(&referrer_key)).unwrap_or(0), 0);
                env.settle(pull, 6).unwrap();
                prop_assert!(env.closed(pull));
            }
            _ => {
                let buyer_before = env.account(buyer_key).lamports;
                let amount = env.account(pull).lamports;
                prop_assert!(buyer_before + amount < env.rent_min(bytes as usize));
                let pack = records(&env, pull)[0];
                prop_assert_eq!(pack.house_mask, 0);
                let royalties: u64 = pack.royalties.iter().map(|r| r.lamports + r.refund).sum();
                let stock = env.state::<Machine>(env.machine).stock_sol;
                let tx = env.settle(pull, 0).unwrap();
                let redirected = events::<RoyaltyRedirected>(&tx);
                prop_assert_eq!(redirected.len(), 4);
                prop_assert!(redirected.iter().all(|event| event.depositor == buyer_key));
                prop_assert_eq!(
                    redirected.iter().map(|event| event.amount).sum::<u64>(),
                    royalties
                );
                prop_assert_eq!(events::<PackSettled>(&tx)[0].redirected_mask, 15);
                let closed = events::<PullClosed>(&tx);
                prop_assert_eq!(closed.len(), 1);
                prop_assert_eq!(closed[0].to, env.machine);
                prop_assert!(closed[0].to_stock);
                prop_assert_eq!(closed[0].lamports, amount - royalties);
                prop_assert_eq!(env.account(buyer_key).lamports, buyer_before);
                prop_assert_eq!(env.state::<Machine>(env.machine).stock_sol, stock + amount);
                prop_assert!(env.closed(pull));
            }
        }
    }
    env.check_invariants();
    Ok(())
}

#[test]
fn p2_d17_rent_payees_preserve_permissionless_progress() {
    property::parallel_named(
        file!(),
        concat!(file!(), ".d17"),
        || (any::<bool>(), 0u8..4, any::<u16>(), 80_000u32..=100_000),
        rent_payee_case,
    );
}

// P1 and P2 operations share reservations, stock accounting and the final stock drain.
#[test]
fn p2_exec_pairs_interleaved_with_pending_pulls_and_final_stock_drain() {
    property::parallel_named(
        file!(),
        concat!(file!(), ".exec"),
        || {
            (
                1u8..=4,
                any::<bool>(),
                prop::collection::vec((0u8..10, any::<u16>(), any::<[u8; 32]>()), 200),
            )
        },
        |(kind, trending, steps)| {
            use common::exec_cases::{self as exec, ExecFixture};
            let class = if kind <= 2 {
                if trending {
                    2
                } else {
                    1
                }
            } else {
                0
            };
            let mut f = ExecFixture::new(kind, class, false, false);
            f.e.inject_deck(100);
            if kind >= 3 || class == 2 {
                let anchor = f.e.new_pump_mint(false);
                f.e.seed_bucket(1, &anchor, 1, 1_000_000_000_000, 300_000_000_000);
            }
            let buyer = f.e.user();
            let owner = who(&buyer);
            mycards::seed_exec_cards(&mut f.e, owner);
            let mut pending = Vec::new();
            for (op, arg, randomness) in steps {
                f.e.warp(20 + i64::from(arg % 3));
                f.refresh();
                let costs_before = f.e.state::<Machine>(f.e.machine).buckets.map(|b| b.cost);
                let transactions_before = f.e.transactions.len();
                match op {
                    0..=2 => {
                        if op == 2 {
                            f.e.donate_lamports(f.e.machine, u64::from(arg));
                            f.e.donate_tokens(f.vault, u64::from(arg));
                        }
                        let value = 1_000_000 + u64::from(arg);
                        let delta = exec::expected(&f, value).1;
                        let before = f.e.state::<Machine>(f.e.machine);
                        let tx = f.transaction(value, delta.saturating_sub(u64::from(op == 1)));
                        let blocked = if kind != 1 { None }
                        else if before.pending_pulls > 0 || before.unsettled_reveals > 0 { Some("StockBuyPullInFlight") }
                        else if f.e.now() < before.last_reveal_ts + params::POST_REVEAL_BUY_DELAY { Some("StockBuyRevealDelay") }
                        else {
                            let hour = f.e.now() as u64 / 3600;
                            let (paid, previous) = if hour == before.hour_index { (before.sb_paid_hour, before.sb_paid_prev_hour) }
                                else if hour == before.hour_index + 1 { (0, before.sb_paid_hour) } else { (0, 0) };
                            let reserve = u128::from(params::SELL_BACK_SOL_FLOOR_LAMPORTS) + u128::from(paid)
                                + if f.e.now() % 3600 < params::KEEPER_POLICY_SOL_RESERVE_EXTRA_MINUTES * 60 { u128::from(previous) } else { 0 };
                            if u128::from(before.stock_sol.saturating_sub(value)) < reserve { Some("StockBuyReserve") } else { None }
                        };
                        if let Some(error) = blocked { f.reject(&tx, error); }
                        else if op == 1 {
                            f.reject(&tx, "SlippageExceeded");
                        } else {
                            f.send(&tx).unwrap();
                            exec::check_success(&f, &before, value, delta);
                        }
                    }
                    3 => match f.e.buy(&buyer, 0, 1) {
                        Ok((pull, _)) => pending.push(pull),
                        Err(error) => prop_assert!(error.meta.logs.iter().any(|line| line
                            .contains("MachineHungry")
                            || line.contains("Refilling"))),
                    },
                    4 => {
                        if let Some(pull) = pending.pop() {
                            finish_exec_pull(&mut f.e, pull, randomness);
                        }
                    }
                    _ => {}
                }
                if op >= 5 {
                    combined_mycards_operation(&mut f.e, &buyer, op, arg);
                }
                let mut expected_costs = costs_before.map(i128::from);
                for tx in f.e.transactions.iter().skip(transactions_before) {
                    for event in events::<onepercent::events::PackRevealed>(tx) {
                        if event.hit_value > 0 {
                            expected_costs[usize::from(event.hit_bucket)] -=
                                i128::from(event.hit_value);
                        }
                    }
                    for event in events::<onepercent::events::SoldBack>(tx) {
                        expected_costs[usize::from(event.bucket)] += i128::from(event.value);
                    }
                    for event in events::<onepercent::events::ExecEnded>(tx) {
                        match event.kind {
                            1 => {
                                expected_costs[usize::from(event.bucket)] +=
                                    i128::from(event.amount)
                            }
                            2 => {
                                expected_costs[usize::from(event.bucket)] -= i128::from(event.book)
                            }
                            _ => {}
                        }
                    }
                }
                prop_assert_eq!(
                    expected_costs,
                    f.e.state::<Machine>(f.e.machine)
                        .buckets
                        .map(|b| i128::from(b.cost))
                );
                f.e.check_invariants();
                prop_assert_eq!(f.e.state::<Machine>(f.e.machine).exec.kind, 0);
            }
            for pull in pending {
                finish_exec_pull(&mut f.e, pull, [1; 32]);
            }
            while !cards(&f.e, owner).is_empty() {
                combined_mycards_operation(&mut f.e, &buyer, 9, 0);
            }
            loop {
                let entries = mycards::entries(&f.e);
                let Some((index, entry)) = entries
                    .iter()
                    .enumerate()
                    .rev()
                    .find(|(_, e)| e.depositor == owner)
                else {
                    break;
                };
                let bag = bag_for_card(&f.e, entry.mint);
                f.e.send(
                    &[
                        f.e.create_ata_ix(owner, &bag, owner),
                        f.e.take_back_ix(owner, &bag, index as u32, entry.amount),
                    ],
                    &[&buyer],
                )
                .unwrap();
            }
            mycards::edit::<Binder>(&mut f.e, binder(owner), |b| b.flags |= 3);
            f.e.send(
                &[mycards::owed_ix(owner), mycards::close_binder_ix(owner)],
                &[&buyer],
            )
            .unwrap();
            prop_assert!(f.e.closed(binder(owner)));
            // Drain every populated bucket through the same protected StockSell
            // path after pending reservations have all resolved.
            f.e.inject_phase(4);
            for index in 0..16 {
                let bucket = f.e.state::<Machine>(f.e.machine).buckets[index];
                if bucket.class == 0 {
                    continue;
                }
                f.kind = 2;
                f.bucket = index as u8;
                let mint = f.e.account(bucket.mint);
                f.bag = Bag {
                    mint: bucket.mint,
                    token_program: pubkey(&mint.owner),
                    curve: Pubkey::find_program_address(
                        &[b"bonding-curve", bucket.mint.as_ref()],
                        &params::PROGRAM_IDS_PUMP_FUN,
                    )
                    .0,
                    decimals: bucket.decimals,
                };
                f.source = f.e.token_account(who(&f.signer), &f.bag, 0);
                f.vault = ata(&f.e.vault_auth, &f.bag.mint, &f.bag.token_program);
                f.market_token = ata(&who(&f.market), &f.bag.mint, &f.bag.token_program);
                if f.e.svm.get_account(&addr(&f.market_token)).is_none() {
                    f.e.token_account(who(&f.market), &f.bag, 0);
                }
                let auth = f.e.vault_auth;
                f.sol_dest = exec::native(&mut f.e, auth, 0);
                if bucket.class == 1 {
                    let feed = [8; 32];
                    exec::machine(&mut f.e, |m| {
                        m.buckets[index].oracle = Pubkey::new_from_array(feed)
                    });
                    f.oracles = [
                        exec::pyth(&mut f.e, feed, 85_000_000, -8),
                        exec::pyth(
                            &mut f.e,
                            params::HIT_LIST_SOL_USD_PYTH_FEED_ID,
                            10_901_000_000,
                            -8,
                        ),
                        system(),
                        system(),
                    ];
                }
                loop {
                    let b = f.e.state::<Machine>(f.e.machine).buckets[index];
                    if b.amount == 0 {
                        break;
                    }
                    f.e.warp(3600);
                    f.refresh();
                    let tranche = if b.class == 1 {
                        params::STOCK_MAJOR_TRANCHE_MAX_LAMPORTS
                    } else {
                        params::STOCK_TRENDING_TRANCHE_MAX_LAMPORTS
                    };
                    let value = if b.cost <= tranche {
                        b.amount
                    } else {
                        ((u128::from(b.amount) * u128::from(tranche)) / u128::from(b.cost)) as u64
                    }
                    .max(1);
                    let delta = common::exec_cases::expected(&f, value).1;
                    f.execute(value, delta).unwrap();
                    f.e.check_invariants();
                }
                prop_assert_eq!(f.e.state::<Machine>(f.e.machine).buckets[index].cost, 0);
            }
            prop_assert_eq!(f.e.state::<Machine>(f.e.machine).exec.kind, 0);
            Ok(())
        },
    );
}

fn finish_exec_pull(env: &mut Env, pull: Pubkey, randomness: [u8; 32]) {
    if env.now() > env.state::<Pull>(pull).created_ts + params::VRF_TIMEOUT_SECONDS {
        env.send(&[env.refund_ix(pull)], &[]).unwrap();
    } else {
        env.fulfill(pull, randomness).unwrap();
        env.settle(pull, 0).unwrap();
    }
}

// Focused My cards coverage complements the combined executor operation set above.
#[path = "common/mycards.rs"]
mod mycards;

fn mycards_operation_case(ops: Vec<(u8, u16, u32)>) -> proptest::test_runner::TestCaseResult {
    let (mut env, user, bag) = mycards::fixture(8);
    let owner = who(&user);
    mycards::seed_refed(&mut env, owner, &bag, 100);
    let machine_key = env.machine;
    mycards::edit::<Machine>(&mut env, machine_key, |m| {
        m.buckets[0].cost = params::STOCK_TARGET_BASE_LAMPORTS * 10
    });
    let mut pulls = Vec::new();
    for (op, arg, quote) in ops {
        let at = common::pack_cases::binder(owner);
        if env.closed(at) {
            env.binder(owner, &[], 0, 0);
        }
        let owned = cards(&env, owner);
        let costs_before = env.state::<Machine>(env.machine).buckets.map(|b| b.cost);
        let transactions_before = env.transactions.len();
        match op % 10 {
            0 => match env.buy(&user, 0, 1) {
                Ok((pull, _)) => pulls.push(pull),
                Err(error) => prop_assert!(
                    error.meta.logs.iter().any(|line| [
                        "Refilling",
                        "MachineHungry",
                        "DeckUnderfunded"
                    ]
                    .iter()
                    .any(|name| line.contains(name))),
                    "unexpected buy failure: {error:?}"
                ),
            },
            1 => {
                if let Some(pull) = pulls
                    .iter()
                    .copied()
                    .find(|p| !env.closed(*p) && env.state::<Pull>(*p).status == 1)
                {
                    let pending = env.state::<Pull>(pull);
                    if env.now() > pending.created_ts + params::VRF_TIMEOUT_SECONDS {
                        env.send(&[env.refund_ix(pull)], &[]).unwrap();
                        prop_assert!(env.closed(pull));
                    } else {
                        env.fulfill(pull, [arg as u8; 32]).unwrap();
                        prop_assert_eq!(env.state::<Pull>(pull).status, 2);
                    }
                }
            }
            2 => {
                if let Some(pull) = pulls
                    .iter()
                    .copied()
                    .find(|p| !env.closed(*p) && env.state::<Pull>(*p).status != 1)
                {
                    env.settle(pull, 0).unwrap();
                }
            }
            3 => {
                if let Some((index, card)) = owned
                    .iter()
                    .enumerate()
                    .rev()
                    .find(|(_, c)| (1..=4).contains(&c.kind))
                {
                    let before = env.state::<Machine>(env.machine);
                    let nonce = env.state::<Binder>(at).sb_nonce;
                    let quote = u64::from(quote);
                    let expected = reference::sell_back_check(
                        &before,
                        &before.buckets[0],
                        card.value,
                        quote,
                        env.now(),
                    );
                    let ixs = mycards::sb_ixs(&env, owner, &bag, &[index as u16], quote);
                    match expected {
                        Ok(expected) => {
                            let tx = env.send(&ixs, &[&user]).unwrap();
                            let event = events::<onepercent::events::SoldBack>(&tx).remove(0);
                            prop_assert!(
                                u128::from(event.payout) * u128::from(params::BPS_DENOMINATOR)
                                    <= u128::from(card.value)
                                        * u128::from(params::SELL_BACK_PAYOUT_BPS)
                            );
                            let after = env.state::<Machine>(env.machine);
                            prop_assert_eq!(after.buckets[0].cost, expected.bucket_cost);
                            prop_assert_eq!(after.stock_sol, expected.stock_sol);
                            prop_assert_eq!(after.sb_paid_hour, expected.sb_paid_hour);
                            prop_assert!(after.stock_sol >= params::SELL_BACK_SOL_FLOOR_LAMPORTS);
                            prop_assert_eq!(env.state::<Binder>(at).sb_nonce, nonce + 1);
                        }
                        Err(error) => mycards::unchanged_on_error(&mut env, &user, &ixs, error),
                    }
                }
            }
            4 => {
                if !owned.is_empty() {
                    let n = owned.len().min(usize::from(arg % 8) + 1);
                    let indices: Vec<_> = ((owned.len() - n)..owned.len())
                        .rev()
                        .map(|i| i as u16)
                        .collect();
                    let before = env.state::<Machine>(env.machine);
                    env.send(&[mycards::fb_ix(&env, owner, &indices)], &[&user])
                        .unwrap();
                    prop_assert_eq!(
                        env.state::<Machine>(env.machine).buckets[0].cost,
                        before.buckets[0].cost
                    );
                }
            }
            5 => {
                let owed = u64::from(arg);
                mycards::edit::<Binder>(&mut env, at, |b| b.sol_owed += owed);
                env.donate_lamports(at, owed);
                env.send(&[mycards::owed_ix(owner)], &[&user]).unwrap();
                prop_assert_eq!(env.state::<Binder>(at).sol_owed, 0);
            }
            6 => {
                let b = env.state::<Binder>(at);
                let ix = mycards::close_binder_ix(owner);
                if b.len != 0 || b.fresh_in_deck != 0 || b.sol_owed != 0 {
                    mycards::unchanged_on_error(&mut env, &user, &[ix], "BinderNotEmpty");
                } else if b.reserved != 0 {
                    mycards::unchanged_on_error(&mut env, &user, &[ix], "PullPending");
                } else if b.season_spend > 0 && b.flags & 3 != 3 {
                    mycards::unchanged_on_error(&mut env, &user, &[ix], "FinalNotClaimed");
                } else {
                    env.send(&[ix], &[&user]).unwrap();
                }
            }
            7 => {
                if let Some(card) = owned.last() {
                    env.send(
                        &[env.redeem_ix(owner, &bag, (owned.len() - 1) as u16, card.amount)],
                        &[&user],
                    )
                    .unwrap();
                }
            }
            8 => env.warp(i64::from(arg % 61)),
            _ => {
                env.donate_lamports(at, u64::from(arg));
                env.donate_lamports(env.deck, u64::from(arg));
                env.donate_lamports(env.machine, u64::from(arg));
            }
        }
        let mut costs_expected = costs_before.map(u128::from);
        for tx in env.transactions.iter().skip(transactions_before) {
            for event in events::<onepercent::events::PackRevealed>(tx) {
                if event.hit_value == 0 {
                    prop_assert_eq!(event.hit_bucket, onepercent::constants::TIER_NOT_DRAWN);
                    prop_assert_eq!(event.hit_amount, 0);
                    prop_assert_eq!(event.hit_mint, Pubkey::default());
                } else {
                    let bucket = usize::from(event.hit_bucket);
                    prop_assert!(bucket < costs_expected.len());
                    prop_assert!(costs_expected[bucket] >= u128::from(event.hit_value));
                    costs_expected[bucket] -= u128::from(event.hit_value);
                }
            }
            for event in events::<onepercent::events::SoldBack>(tx) {
                let bucket = usize::from(event.bucket);
                prop_assert!(bucket < costs_expected.len());
                costs_expected[bucket] += u128::from(event.value);
            }
        }
        for (expected, bucket) in costs_expected
            .into_iter()
            .zip(env.state::<Machine>(env.machine).buckets)
        {
            prop_assert_eq!(expected, u128::from(bucket.cost), "I8 per operation");
        }
        env.check_invariants();
        prop_assert_eq!(env.state::<Machine>(env.machine).exec.kind, 0);
    }
    env.inject_phase(4);
    common::pack_cases::pause_all(&mut env);
    env.warp(params::VRF_TIMEOUT_SECONDS + 1);
    for pull in pulls {
        if !env.closed(pull) {
            if env.state::<Pull>(pull).status == 1 {
                env.send(&[env.refund_ix(pull)], &[]).unwrap();
            } else {
                env.settle(pull, 0).unwrap();
            }
        }
    }
    let at = common::pack_cases::binder(owner);
    if !env.closed(at) {
        loop {
            let owned = cards(&env, owner);
            let Some(card) = owned.last() else {
                break;
            };
            env.send(
                &[env.redeem_ix(owner, &bag, (owned.len() - 1) as u16, card.amount)],
                &[&user],
            )
            .unwrap();
        }
    }
    loop {
        let entries = mycards::entries(&env);
        let Some(entry) = entries.last() else {
            break;
        };
        env.send(
            &[env.take_back_ix(owner, &bag, (entries.len() - 1) as u32, entry.amount)],
            &[&user],
        )
        .unwrap();
    }
    if !env.closed(at) {
        mycards::edit::<Binder>(&mut env, at, |b| b.flags |= 3);
        env.send(
            &[mycards::owed_ix(owner), mycards::close_binder_ix(owner)],
            &[&user],
        )
        .unwrap();
    }
    prop_assert!(env.closed(at));
    env.check_invariants();
    prop_assert_eq!(env.state::<Machine>(env.machine).exec.kind, 0);
    Ok(())
}

#[test]
fn p2_mycards_operations_and_exit_drain() {
    property::parallel_named(
        file!(),
        concat!(file!(), ".mycards"),
        || prop::collection::vec((0u8..10, any::<u16>(), any::<u32>()), 200),
        mycards_operation_case,
    );
}

#[test]
fn p2_mycards_expired_request_refunded_before_repeated_reveal() {
    let mut ops = vec![(0, 0, 0)];
    // Six 60-second advances exceed the VRF timeout without changing the mock request.
    ops.extend([(8, 60, 0); 6]);
    ops.extend([(1, 240, 0), (1, 241, 0)]);
    mycards_operation_case(ops).unwrap();
}

fn bag_for_card(env: &Env, mint: Pubkey) -> Bag {
    let account = env.account(mint);
    Bag {
        mint,
        token_program: pubkey(&account.owner),
        decimals: account.data[44],
        curve: system(),
    }
}

fn combined_mycards_operation(env: &mut Env, user: &Keypair, op: u8, arg: u16) {
    let owner = who(user);
    let at = binder(owner);
    let owned = cards(env, owner);
    match op {
        5 => {
            if let Some((index, card)) = owned
                .iter()
                .enumerate()
                .rev()
                .find(|(_, c)| (1..=4).contains(&c.kind))
            {
                let bag = bag_for_card(env, card.mint);
                let ixs = mycards::sb_ixs(env, owner, &bag, &[index as u16], card.value);
                let before = env.snapshot();
                if let Err(error) = env.send(&ixs, &[user]) {
                    assert!(
                        error.meta.logs.iter().any(|line| [
                            "SellBackFloor",
                            "SellBackBudget",
                            "ReservedCapacity",
                            "BucketCapExceeded"
                        ]
                        .iter()
                        .any(|name| line.contains(name))),
                        "{error:?}"
                    );
                    for key in [env.machine, at] {
                        assert_eq!(env.account(key), before[&key]);
                    }
                }
            }
        }
        6 => {
            if let Some((index, _)) = owned.iter().enumerate().rev().find(|(_, c)| c.kind <= 4) {
                env.send(&[mycards::fb_ix(env, owner, &[index as u16])], &[user])
                    .unwrap();
            }
        }
        7 => {
            let owed = u64::from(arg);
            mycards::edit::<Binder>(env, at, |b| b.sol_owed += owed);
            env.donate_lamports(at, owed);
            env.send(&[mycards::owed_ix(owner)], &[user]).unwrap();
            assert_eq!(env.state::<Binder>(at).sol_owed, 0);
        }
        8 => {
            let b = env.state::<Binder>(at);
            let error = if b.len != 0 || b.fresh_in_deck != 0 || b.sol_owed != 0 {
                "BinderNotEmpty"
            } else if b.reserved != 0 {
                "PullPending"
            } else if b.season_spend > 0 && b.flags & 3 != 3 {
                "FinalNotClaimed"
            } else {
                ""
            };
            if error.is_empty() {
                env.send(&[mycards::close_binder_ix(owner)], &[user])
                    .unwrap();
                env.binder(owner, &[], 0, 0);
            } else {
                mycards::unchanged_on_error(env, user, &[mycards::close_binder_ix(owner)], error);
            }
        }
        9 => {
            if let Some(card) = owned.last() {
                let bag = bag_for_card(env, card.mint);
                redeem_one(env, user, &bag, (owned.len() - 1) as u16, card.amount);
            }
        }
        _ => unreachable!(),
    }
}
