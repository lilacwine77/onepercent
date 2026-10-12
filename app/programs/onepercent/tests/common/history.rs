//! Temporal invariant model, independent of program counters and debit helpers.
use crate::common::{addr, pack_cases::events, token, token2022, vrf, Env};
use anchor_lang::{prelude::Pubkey, Discriminator};
use onepercent::{
    events::PackRevealed,
    params,
    state::{Machine, PackRecord, Pull},
};
use solana_rent::Rent;
use std::collections::BTreeMap;

struct PullHistory {
    status: u8,
    shortfall: u128,
    seq: u64,
    price: u64,
    qty: u8,
}

pub struct History {
    rent: Rent,
    phase: u8,
    onepct_states: [u8; 4],
    pulls: BTreeMap<Pubkey, PullHistory>,
    deck_shortfall: u128,
    costs: [u64; 16],
    checked_transactions: usize,
}

impl History {
    /// Fixtures are established before this model starts observing instructions.
    pub fn new(env: &Env) -> Self {
        let machine = env.state::<Machine>(env.machine);
        Self {
            rent: env.svm.get_sysvar(),
            phase: machine.phase,
            onepct_states: machine.onepct.map(|slot| slot.state),
            pulls: BTreeMap::new(),
            deck_shortfall: 0,
            costs: machine.buckets.map(|b| b.cost),
            checked_transactions: env.transactions.len(),
        }
    }

    pub fn check(&mut self, env: &Env) {
        let rent: Rent = env.svm.get_sysvar();
        let machine = env.state::<Machine>(env.machine);
        assert!(machine.phase >= self.phase, "I9: phase moved backwards");
        self.phase = machine.phase;
        for (before, after) in self.onepct_states.iter().zip(machine.onepct.iter()) {
            assert!(after.state >= *before, "I9: special slot moved backwards");
        }
        self.onepct_states = machine.onepct.map(|slot| slot.state);

        let mut carved = [0u128; 16];
        for tx in env.transactions.iter().skip(self.checked_transactions) {
            for event in events::<PackRevealed>(tx) {
                assert!((1..=6).contains(&event.tier));
                assert!(event.hit_amount > 0);
                if event.tier >= 5 {
                    assert_eq!(event.hit_bucket, 255);
                    continue;
                }
                let expected =
                    u128::from(params::PACK_EDITIONS_PRICE_LAMPORTS[usize::from(event.edition)])
                        * u128::from(params::HIT_TIERS_VALUE_BPS[usize::from(event.tier - 1)])
                        / u128::from(params::BPS_DENOMINATOR);
                assert_eq!(u128::from(event.hit_value), expected);
                carved[usize::from(event.hit_bucket)] += expected;
            }
        }
        for (index, bucket) in machine.buckets.iter().enumerate() {
            assert_eq!(
                u128::from(self.costs[index]),
                u128::from(bucket.cost) + carved[index],
                "I8: book value must decrease by exactly carved hits"
            );
            self.costs[index] = bucket.cost;
        }
        self.checked_transactions = env.transactions.len();

        for (address, previous) in &mut self.pulls {
            let live = env.svm.get_account(&addr(address)).is_some_and(|a| {
                a.owner == addr(&onepercent::ID) && a.data.starts_with(Pull::DISCRIMINATOR)
            });
            if !live {
                previous.status = 3;
            }
        }
        for address in &env.tracked {
            if *address == env.program_data
                || *address == onepercent::ID
                || *address == vrf()
                || *address == env.queue
                || *address == token()
                || *address == token2022()
                || *address == anchor_spl::associated_token::ID
            {
                continue;
            }
            let Some(account) = env.svm.get_account(&addr(address)) else {
                continue;
            };
            if account.owner != addr(&onepercent::ID)
                || !account.data.starts_with(Pull::DISCRIMINATOR)
            {
                continue;
            }
            let pull: Pull = bytemuck::pod_read_unaligned(&account.data[8..176]);
            assert!(matches!(pull.status, 1 | 2));
            let is_new = !self.pulls.contains_key(address);
            let previous = self.pulls.entry(*address).or_insert_with(|| {
                assert_eq!(pull.status, 1, "I9: a new Pull must start Pending");
                PullHistory {
                    status: 1,
                    shortfall: 0,
                    seq: pull.seq,
                    price: pull.price,
                    qty: pull.qty,
                }
            });
            assert!(
                previous.status <= pull.status,
                "I9: Pull state moved backwards or a closed Pull reopened"
            );
            assert_eq!(
                (previous.seq, previous.price, previous.qty),
                (pull.seq, pull.price, pull.qty)
            );
            previous.status = pull.status;
            let mut obligation = if pull.status == 1 {
                u128::from(pull.price) * u128::from(pull.qty)
            } else {
                0
            };
            if pull.status == 2 {
                for (index, bytes) in account.data[176..].chunks_exact(200).enumerate() {
                    if pull.settled_mask & (1 << index) != 0 {
                        continue;
                    }
                    let pack: PackRecord = bytemuck::pod_read_unaligned(bytes);
                    for royalty in pack.royalties {
                        obligation += u128::from(royalty.lamports) + u128::from(royalty.refund);
                    }
                    if pull.referrer != Pubkey::default() {
                        obligation += u128::from(pull.price)
                            * u128::from(params::PACK_SPLIT_BPS_REFERRAL)
                            / u128::from(params::BPS_DENOMINATOR);
                    }
                }
            }
            previous.shortfall = bounded_shortfall(
                previous.shortfall,
                if is_new { &rent } else { &self.rent },
                &rent,
                account.data.len(),
                obligation,
                account.lamports,
                "I5 Pull",
            );
        }
        let deck = env.account(env.deck);
        self.deck_shortfall = bounded_shortfall(
            self.deck_shortfall,
            &self.rent,
            &rent,
            deck.data.len(),
            0,
            deck.lamports,
            "I6 Deck",
        );
        self.rent = rent;
    }
}

fn bounded_shortfall(
    previous: u128,
    old_rent: &Rent,
    rent: &Rent,
    bytes: usize,
    obligation: u128,
    lamports: u64,
    label: &str,
) -> u128 {
    let old_floor = u128::from(old_rent.minimum_balance(bytes));
    let floor = u128::from(rent.minimum_balance(bytes));
    let allowed = (previous + floor.saturating_sub(old_floor))
        .saturating_sub(old_floor.saturating_sub(floor));
    let deficit = (floor + obligation).saturating_sub(u128::from(lamports));
    assert!(
        deficit <= allowed,
        "{label}: deficit {deficit} exceeds observed rent-increase allowance {allowed}"
    );
    // A satisfied obligation cannot leave arbitrary credit for a later loss.
    deficit
}
