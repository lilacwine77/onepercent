use super::*;
use anchor_lang::{prelude::Pubkey, Discriminator};
use onepercent::{math, state::*};
use std::collections::BTreeMap;

impl Env {
    /// Recomputes claims from every live account, independently of program counters.
    pub fn check_invariants(&self) {
        let m = self.state::<Machine>(self.machine);
        let d = self.state::<Deck>(self.deck);
        let data = self.account(self.deck).data;
        assert!(d.len <= d.cap && d.cap <= onepercent::params::COVERAGE_DECK_MAX);
        assert_eq!(data.len(), 64 + 80 * d.cap as usize);
        let mut claims = BTreeMap::<Pubkey, u128>::new();
        let mut fresh = BTreeMap::<Pubkey, u64>::new();
        for bytes in data[64..].chunks_exact(80).take(d.len as usize) {
            let e: DeckEntry = bytemuck::pod_read_unaligned(bytes);
            *claims.entry(e.mint).or_default() += u128::from(e.amount);
            if e.flags & 1 != 0 {
                *fresh.entry(e.depositor).or_default() += 1;
            }
        }
        let mut pending = 0;
        let mut dust_reserved = 0;
        let mut card_reserved = 0;
        let mut binder_reserved = 0;
        let mut bucket_reserved = [0u64; 16];
        let mut minimums = [u64::MAX; 16];
        for at in &self.tracked {
            if *at == self.program_data
                || *at == onepercent::ID
                || *at == vrf()
                || *at == self.queue
                || *at == token()
                || *at == token2022()
                || *at == anchor_spl::associated_token::ID
            {
                continue;
            }
            let Some(a) = self.svm.get_account(&addr(at)) else {
                continue;
            };
            if a.owner != addr(&onepercent::ID) {
                continue;
            }
            if a.data.starts_with(Pull::DISCRIMINATOR) {
                let p: Pull = bytemuck::pod_read_unaligned(&a.data[8..176]);
                assert!((1..=10).contains(&p.qty));
                assert_eq!(a.data.len(), 176 + 200 * usize::from(p.qty));
                if p.status == 1 {
                    pending += 1;
                    dust_reserved += 4 * u64::from(p.qty);
                    card_reserved += 5 * u64::from(p.qty);
                    assert!(a.lamports >= p.price * u64::from(p.qty));
                }
                for (index, bytes) in a.data[176..].chunks_exact(200).enumerate() {
                    let pack: PackRecord = bytemuck::pod_read_unaligned(bytes);
                    if p.status == 1 {
                        let b = usize::from(pack.backing);
                        assert!(b < 16);
                        bucket_reserved[b] += math::coverage_need(p.price).unwrap();
                        minimums[b] = minimums[b].min(math::tier_value(p.price, 1).unwrap());
                    } else if p.settled_mask & (1 << index) == 0 {
                        for k in 0..4 {
                            if pack.fresh_mask & (1 << k) != 0 {
                                *fresh.entry(pack.royalties[k].depositor).or_default() += 1;
                            }
                        }
                    }
                }
            } else if a.data.starts_with(Binder::DISCRIMINATOR) {
                let b: Binder = bytemuck::pod_read_unaligned(&a.data[8..112]);
                assert!(u32::from(b.len) + u32::from(b.reserved) <= u32::from(b.cap));
                assert_eq!(a.data.len(), 112 + 56 * usize::from(b.cap));
                binder_reserved += u64::from(b.reserved);
                for bytes in a.data[112..].chunks_exact(56).take(usize::from(b.len)) {
                    let c: Card = bytemuck::pod_read_unaligned(bytes);
                    *claims.entry(c.mint).or_default() += u128::from(c.amount);
                    if (1..=4).contains(&c.kind) {
                        assert_eq!(
                            Some(c.value),
                            math::tier_value(
                                onepercent::params::PACK_EDITIONS_PRICE_LAMPORTS
                                    [usize::from(c.edition)],
                                c.kind
                            )
                        );
                    }
                }
            }
        }
        assert_eq!(m.pending_pulls, pending);
        assert_eq!(m.reserved_dust, dust_reserved);
        assert_eq!(binder_reserved, card_reserved);
        let tracked = m.stock_sol as u128
            + m.jackpot_sol as u128
            + m.burn_sol as u128
            + m.team_sol as u128
            + m.final_pool_sol as u128;
        assert!(
            self.account(self.machine).lamports as u128 >= self.rent_min(3808) as u128 + tracked
        );
        for (index, b) in m.buckets.iter().enumerate() {
            assert!(b.reserved <= b.cost);
            assert_eq!(b.reserved, bucket_reserved[index]);
            if b.class != 0 {
                *claims.entry(b.mint).or_default() += u128::from(b.amount);
            }
            // D12 remains true for the weakest outstanding covered tier.
            if minimums[index] != u64::MAX {
                assert!(b.cost > 0);
                assert!(u128::from(minimums[index]) * u128::from(b.amount) >= u128::from(b.cost));
            }
        }
        if m.token_mint != Pubkey::default() {
            let active: u128 = m
                .onepct
                .iter()
                .filter(|slot| slot.state <= 1)
                .map(|slot| u128::from(slot.amount))
                .sum();
            *claims.entry(m.token_mint).or_default() +=
                active + u128::from(m.jackpot_tokens) + u128::from(m.final_pool_1pct);
        }
        let live: Vec<_> = m
            .onepct
            .iter()
            .enumerate()
            .filter(|(_, slot)| slot.state == 1)
            .collect();
        assert!(live.len() <= 1, "L1: multiple live slots");
        if let Some((index, _)) = live.first() {
            assert!(
                m.onepct[..*index].iter().all(|slot| slot.state == 2),
                "L1: earlier slot not pulled"
            );
        }
        assert!(bytemuck::bytes_of(&m.spotlight)
            .iter()
            .all(|byte| *byte == 0));
        for at in &self.tracked {
            if *at == self.program_data
                || *at == onepercent::ID
                || *at == vrf()
                || *at == self.queue
                || *at == token()
                || *at == token2022()
                || *at == anchor_spl::associated_token::ID
            {
                continue;
            }
            let Some(a) = self.svm.get_account(&addr(at)) else {
                continue;
            };
            if a.owner != addr(&onepercent::ID) {
                continue;
            }
            if a.data.starts_with(MintLedger::DISCRIMINATOR) {
                let ledger: MintLedger = bytemuck::pod_read_unaligned(&a.data[8..80]);
                assert_eq!(
                    u128::from(ledger.accounted),
                    claims.remove(&ledger.mint).unwrap_or(0),
                    "claims {}",
                    ledger.mint
                );
                let mint = self.account(ledger.mint);
                let vault = ata(&self.vault_auth, &ledger.mint, &pubkey(&mint.owner));
                assert!(read_u64(&self.account(vault).data, 64) >= ledger.accounted);
            } else if a.data.starts_with(Binder::DISCRIMINATOR) {
                let b: Binder = bytemuck::pod_read_unaligned(&a.data[8..112]);
                assert_eq!(
                    u64::from(b.fresh_in_deck),
                    fresh.remove(&b.owner).unwrap_or(0)
                );
                assert!(
                    u32::from(b.fresh_in_deck)
                        <= onepercent::params::FEED_RULES_FRESH_CAP_PER_WALLET
                );
            }
        }
        assert!(claims.values().all(|x| *x == 0));
        assert!(fresh.values().all(|x| *x == 0));
    }
}
