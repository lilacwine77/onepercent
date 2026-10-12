use crate::{constants, params};
use solana_sha256_hasher::hashv;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Draw {
    pub t: u32,
    pub tier: u8,
    pub widths: [u32; 6],
}

fn hash_u64(parts: &[&[u8]]) -> u64 {
    let bytes = hashv(parts).to_bytes();
    let mut first = [0u8; 8];
    if let Some(prefix) = bytes.get(..8) {
        first.copy_from_slice(prefix);
    }
    u64::from_le_bytes(first)
}

pub fn tier_position(randomness: &[u8; 32], seq: u64, pack: u8) -> u32 {
    let n = hash_u64(&[
        params::DRAW_TAGS_TIER,
        randomness,
        &seq.to_le_bytes(),
        &[pack],
    ]);
    ((u128::from(n) * u128::from(params::PPB_DENOMINATOR)) >> 64) as u32
}

pub fn draw(
    randomness: &[u8; 32],
    seq: u64,
    pack: u8,
    edition: u8,
    live: u8,
    holder: bool,
) -> Option<Draw> {
    let index = usize::from(edition);
    let price = *params::PACK_EDITIONS_PRICE_LAMPORTS.get(index)?;
    let one_pct = if live & constants::LIVE_ONE_PCT != 0 {
        let base = price / u64::from(params::HIT_ODDS_ONE_PCT_PRICE_DIVISOR);
        if holder {
            u64::try_from(
                u128::from(base)
                    * u128::from(params::TOKEN_1PCT_HOLDER_TIER_ONE_PCT_ODDS_MULTIPLIER_BPS)
                    / u128::from(params::BPS_DENOMINATOR),
            )
            .ok()?
        } else {
            base
        }
    } else {
        0
    };
    let jackpot = if live & constants::LIVE_JACKPOT != 0 {
        price / u64::from(params::HIT_ODDS_JACKPOT_PRICE_DIVISOR)
    } else {
        0
    };
    // D1 preserves the segment's position but gives it no width in Season 1.
    let widths = [
        u32::try_from(one_pct).ok()?,
        0,
        u32::try_from(jackpot).ok()?,
        params::HIT_ODDS_BLACK_PPB,
        params::HIT_ODDS_HOLO_PPB,
        *params::HIT_ODDS_BLUE_PPB.get(index)?,
    ];
    let kinds = [
        constants::KIND_ONE_PCT,
        constants::KIND_SPOTLIGHT,
        constants::KIND_JACKPOT,
        constants::KIND_BLACK,
        constants::KIND_HOLO,
        constants::KIND_BLUE,
    ];
    let t = tier_position(randomness, seq, pack);
    let mut total = 0u32;
    for (width, kind) in widths.iter().zip(kinds) {
        total = total.saturating_add(*width);
        if t < total {
            return Some(Draw {
                t,
                tier: kind,
                widths,
            });
        }
    }
    Some(Draw {
        t,
        tier: constants::KIND_SILVER,
        widths,
    })
}

pub fn dust_index(randomness: &[u8; 32], seq: u64, pack: u8, k: u8, len: u32) -> u32 {
    let n = hash_u64(&[
        params::DRAW_TAGS_DUST,
        randomness,
        &seq.to_le_bytes(),
        &[pack],
        &[k],
    ]);
    ((u128::from(n) * u128::from(len)) >> 64) as u32
}

pub fn bucket_position(randomness: &[u8; 32], seq: u64, pack: u8, total: u64) -> u64 {
    let n = hash_u64(&[
        params::DRAW_TAGS_BUCKET,
        randomness,
        &seq.to_le_bytes(),
        &[pack],
    ]);
    ((u128::from(n) * u128::from(total)) >> 64) as u64
}

pub fn caller_seed(program_id: &[u8; 32], seq: u64, buyer: &[u8; 32]) -> [u8; 32] {
    hashv(&[
        params::DRAW_TAGS_VRF_SEED,
        program_id,
        &seq.to_le_bytes(),
        buyer,
    ])
    .to_bytes()
}
