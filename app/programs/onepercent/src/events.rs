use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct DustPick {
    pub deck_len_before: u32,
    pub index: u32,
    pub moved_from: u32,
    pub mint: Pubkey,
    pub amount: u64,
    pub depositor: Pubkey,
    pub refund: u64,
}

#[event]
pub struct Initialized {
    pub version: u16,
    pub admin: Pubkey,
}

#[event]
pub struct ConfigChanged {
    pub action: u8,
    pub actor: Pubkey,
    pub key: Pubkey,
    pub a: u64,
    pub b: u64,
}

#[event]
pub struct PhaseAdvanced {
    pub from: u8,
    pub to: u8,
    pub ts: i64,
}

#[event]
pub struct BagFed {
    pub depositor: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub deck_index: u32,
    pub deposit: u64,
    pub fresh_in_deck: u16,
}

#[event]
pub struct BagTakenBack {
    pub depositor: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub deck_index: u32,
    pub moved_from: u32,
    pub refund: u64,
}

#[event]
pub struct PullOpened {
    pub pull: Pubkey,
    pub seq: u64,
    pub buyer: Pubkey,
    pub edition: u8,
    pub qty: u8,
    pub price: u64,
    pub referrer: Pubkey,
    pub holder: bool,
    pub queue: Pubkey,
    pub created_ts: i64,
    pub backing: [u8; 10],
}

#[event]
pub struct PackRevealed {
    pub seq: u64,
    pub pack: u8,
    pub edition: u8,
    pub live_flags: u8,
    pub holder: bool,
    pub t: u32,
    pub widths: [u32; 6],
    pub tier: u8,
    pub hit_bucket: u8,
    pub house_mask: u8,
    pub hit_mint: Pubkey,
    pub hit_amount: u64,
    pub hit_value: u64,
    pub dust: [DustPick; 4],
}

#[event]
pub struct PullRevealed {
    pub pull: Pubkey,
    pub seq: u64,
    pub buyer: Pubkey,
    pub randomness: [u8; 32],
    pub qty: u8,
    pub hit_value_total: u64,
    pub to_stock: u64,
    pub to_jackpot: u64,
    pub to_burn: u64,
    pub to_team: u64,
    pub shortfall: u64,
}

#[event]
pub struct CallbackSkipped {
    pub pull: Pubkey,
    pub seq: u64,
    pub reason: u8,
}

#[event]
pub struct HitSkipped {
    pub seq: u64,
    pub pack: u8,
    pub tier: u8,
    pub value: u64,
}

#[event]
pub struct CardDropped {
    pub seq: u64,
    pub pack: u8,
    pub tier: u8,
    pub value: u64,
}

#[event]
pub struct PackSettled {
    pub pull: Pubkey,
    pub seq: u64,
    pub pack: u8,
    pub paid: [u64; 4],
    pub redirected_mask: u8,
    pub referral_paid: u64,
    pub referral_to_team: u64,
}

#[event]
pub struct RoyaltyRedirected {
    pub seq: u64,
    pub pack: u8,
    pub slot: u8,
    pub depositor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ReferralRedirected {
    pub seq: u64,
    pub pack: u8,
    pub referrer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PullClosed {
    pub pull: Pubkey,
    pub seq: u64,
    pub to: Pubkey,
    pub lamports: u64,
    pub to_stock: bool,
}

#[event]
pub struct PullRefunded {
    pub pull: Pubkey,
    pub seq: u64,
    pub buyer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CardRedeemed {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub kind: u8,
    pub card_index: u16,
    pub moved_from: u16,
    pub refund: u64,
}

#[event]
pub struct TeamWithdrawn {
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VaultClosed {
    pub mint: Pubkey,
    pub payer: Pubkey,
    pub burned: u64,
    pub lamports: u64,
}

#[event]
pub struct VaultShortfall {
    pub mint: Pubkey,
    pub vault_amount: u64,
    pub accounted: u64,
}

#[event]
pub struct Pong {
    pub version: u16,
}

#[event]
pub struct ExecBegun {
    pub kind: u8,
    pub bucket: u8,
    pub mint: Pubkey,
    pub signer: Pubkey,
    pub amount: u64,
    pub min_out: u64,
    pub v0: u64,
    pub book: u64,
    pub expected: u64,
    pub ts: i64,
}

#[event]
pub struct ExecEnded {
    pub kind: u8,
    pub bucket: u8,
    pub mint: Pubkey,
    pub amount: u64,
    pub min_out: u64,
    pub delta: u64,
    pub book: u64,
    pub tracked_after: u64,
    pub ts: i64,
}

#[event]
pub struct SoldBack {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub bucket: u8,
    pub n: u8,
    pub total_amount: u64,
    pub stocked_value: u64,
    pub quote_lamports: u64,
    pub value: u64,
    pub payout: u64,
    pub to_team: u64,
    pub nonce: u32,
    pub sb_paid_hour: u64,
    pub slot_refund: u64,
}

#[event]
pub struct CardFedBack {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub kind: u8,
    pub card_index: u16,
    pub moved_from: u16,
    pub deck_index: u32,
    pub deposit: u64,
    pub slot_refund: u64,
}

#[event]
pub struct OwedWithdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub remaining: u64,
}

#[event]
pub struct BinderClosed {
    pub owner: Pubkey,
    pub lamports: u64,
}

#[cfg(test)]
mod m2_event_tests {
    use super::*;
    use anchor_lang::Event;

    fn verify<E: Event>(name: &str, event: E, expected_body: &[u8], length: usize) {
        let bytes = event.data();
        let hash = solana_sha256_hasher::hash(format!("event:{name}").as_bytes());
        assert_eq!(bytes.get(..8), hash.as_ref().get(..8));
        assert_eq!(bytes.get(8..), Some(expected_body));
        assert_eq!(bytes.len(), length);
    }

    #[test]
    fn m2_events_keep_declared_discriminators_field_order_and_widths() {
        {
            let mut body = Vec::new();
            body.extend_from_slice(&1u8.to_le_bytes());
            body.extend_from_slice(&2u8.to_le_bytes());
            body.extend_from_slice(&[3; 32]);
            body.extend_from_slice(&[4; 32]);
            body.extend_from_slice(&5u64.to_le_bytes());
            body.extend_from_slice(&6u64.to_le_bytes());
            body.extend_from_slice(&7u64.to_le_bytes());
            body.extend_from_slice(&8u64.to_le_bytes());
            body.extend_from_slice(&9u64.to_le_bytes());
            body.extend_from_slice(&10i64.to_le_bytes());
            verify(
                "ExecBegun",
                ExecBegun {
                    kind: 1,
                    bucket: 2,
                    mint: Pubkey::new_from_array([3; 32]),
                    signer: Pubkey::new_from_array([4; 32]),
                    amount: 5,
                    min_out: 6,
                    v0: 7,
                    book: 8,
                    expected: 9,
                    ts: 10,
                },
                &body,
                122,
            );
        }
        {
            let mut body = Vec::new();
            body.extend_from_slice(&1u8.to_le_bytes());
            body.extend_from_slice(&2u8.to_le_bytes());
            body.extend_from_slice(&[3; 32]);
            body.extend_from_slice(&4u64.to_le_bytes());
            body.extend_from_slice(&5u64.to_le_bytes());
            body.extend_from_slice(&6u64.to_le_bytes());
            body.extend_from_slice(&7u64.to_le_bytes());
            body.extend_from_slice(&8u64.to_le_bytes());
            body.extend_from_slice(&9i64.to_le_bytes());
            verify(
                "ExecEnded",
                ExecEnded {
                    kind: 1,
                    bucket: 2,
                    mint: Pubkey::new_from_array([3; 32]),
                    amount: 4,
                    min_out: 5,
                    delta: 6,
                    book: 7,
                    tracked_after: 8,
                    ts: 9,
                },
                &body,
                90,
            );
        }
        {
            let mut body = Vec::new();
            body.extend_from_slice(&[1; 32]);
            body.extend_from_slice(&[2; 32]);
            body.extend_from_slice(&3u8.to_le_bytes());
            body.extend_from_slice(&4u8.to_le_bytes());
            body.extend_from_slice(&5u64.to_le_bytes());
            body.extend_from_slice(&6u64.to_le_bytes());
            body.extend_from_slice(&7u64.to_le_bytes());
            body.extend_from_slice(&8u64.to_le_bytes());
            body.extend_from_slice(&9u64.to_le_bytes());
            body.extend_from_slice(&10u64.to_le_bytes());
            body.extend_from_slice(&11u32.to_le_bytes());
            body.extend_from_slice(&12u64.to_le_bytes());
            body.extend_from_slice(&13u64.to_le_bytes());
            verify(
                "SoldBack",
                SoldBack {
                    owner: Pubkey::new_from_array([1; 32]),
                    mint: Pubkey::new_from_array([2; 32]),
                    bucket: 3,
                    n: 4,
                    total_amount: 5,
                    stocked_value: 6,
                    quote_lamports: 7,
                    value: 8,
                    payout: 9,
                    to_team: 10,
                    nonce: 11,
                    sb_paid_hour: 12,
                    slot_refund: 13,
                },
                &body,
                142,
            );
        }
        {
            let mut body = Vec::new();
            body.extend_from_slice(&[1; 32]);
            body.extend_from_slice(&[2; 32]);
            body.extend_from_slice(&3u64.to_le_bytes());
            body.extend_from_slice(&4u8.to_le_bytes());
            body.extend_from_slice(&5u16.to_le_bytes());
            body.extend_from_slice(&6u16.to_le_bytes());
            body.extend_from_slice(&7u32.to_le_bytes());
            body.extend_from_slice(&8u64.to_le_bytes());
            body.extend_from_slice(&9u64.to_le_bytes());
            verify(
                "CardFedBack",
                CardFedBack {
                    owner: Pubkey::new_from_array([1; 32]),
                    mint: Pubkey::new_from_array([2; 32]),
                    amount: 3,
                    kind: 4,
                    card_index: 5,
                    moved_from: 6,
                    deck_index: 7,
                    deposit: 8,
                    slot_refund: 9,
                },
                &body,
                105,
            );
        }
        {
            let mut body = Vec::new();
            body.extend_from_slice(&[1; 32]);
            body.extend_from_slice(&2u64.to_le_bytes());
            body.extend_from_slice(&3u64.to_le_bytes());
            verify(
                "OwedWithdrawn",
                OwedWithdrawn {
                    owner: Pubkey::new_from_array([1; 32]),
                    amount: 2,
                    remaining: 3,
                },
                &body,
                56,
            );
        }
        {
            let mut body = Vec::new();
            body.extend_from_slice(&[1; 32]);
            body.extend_from_slice(&2u64.to_le_bytes());
            verify(
                "BinderClosed",
                BinderClosed {
                    owner: Pubkey::new_from_array([1; 32]),
                    lamports: 2,
                },
                &body,
                48,
            );
        }
    }
}

#[event]
pub struct PoweredOn {
    pub mint: Pubkey,
    pub launch_pool: Pubkey,
    pub fee_in: Pubkey,
    pub launch_wallet: Pubkey,
    pub dev_buy: u64,
    pub vault_amount: u64,
    pub accounted: u64,
    pub fee_in_topup: u64,
    pub power_on_ts: i64,
    pub on_air_ts: i64,
    pub end_ts: i64,
}
#[event]
pub struct OnePctLive {
    pub index: u8,
    pub release_ts: i64,
    pub ts: i64,
}
#[event]
pub struct OnePctPulled {
    pub seq: u64,
    pub pack: u8,
    pub index: u8,
    pub buyer: Pubkey,
    pub amount: u64,
    pub holder: bool,
}
#[event]
pub struct JackpotWon {
    pub seq: u64,
    pub pack: u8,
    pub buyer: Pubkey,
    pub edition: u8,
    pub tokens: u64,
    pub cost: u64,
    pub jackpot_sol_left: u64,
}
#[event]
pub struct CreatorFeesCollected {
    pub regime: u8,
    pub amount: u64,
    pub from_fee_in: u64,
    pub from_wsol: u64,
    pub to_stock: u64,
    pub to_burn: u64,
    pub to_team: u64,
    pub book: u64,
    pub target: u64,
    pub ts: i64,
}
#[event]
pub struct FinalPullStarted {
    pub final_ts: i64,
    pub pool_sol: u64,
    pub pool_1pct: u64,
    pub jackpot_tokens: u64,
    pub onepct_final_mask: u8,
    pub total_spend: u64,
    pub bucket_pools: [u64; 16],
}
#[event]
pub struct FinalSolClaimed {
    pub owner: Pubkey,
    pub share: u64,
    pub paid: u64,
    pub to_owed: bool,
    pub remaining: u64,
}
#[event]
pub struct FinalTokensClaimed {
    pub owner: Pubkey,
    pub onepct: u64,
    pub buckets: [u64; 16],
    pub cards: u8,
    pub slot_rent: u64,
}
#[event]
pub struct LaunchFeesClaimed {
    pub kind: u8,
    pub pool: Pubkey,
    pub quote: u64,
    pub base: u64,
    pub unwrapped_lamports: u64,
    pub ts: i64,
}

// Additive P3 events; all previously deployed event payloads remain unchanged.
#[event]
pub struct KeeperHistoryStarted {
    pub ts: i64,
}
#[event]
pub struct RevealTimestamped {
    pub seq: u64,
    pub ts: i64,
}
#[event]
pub struct BucketListed {
    pub bucket: u8,
    pub mint: Pubkey,
    pub listed_ts: i64,
}
#[event]
pub struct SellHistoryUpdated {
    pub bucket: u8,
    pub hour_index: u64,
    pub sb_paid_hour: u64,
    pub sb_paid_prev_hour: u64,
    pub sb_inflow_hour: u64,
    pub sb_inflow_prev_hour: u64,
}
