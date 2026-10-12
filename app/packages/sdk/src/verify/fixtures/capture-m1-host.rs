// Offline host math fixture exporter. Link the read-only M1 libonepercent.rlib;
// this does not run a validator, execute a callback, or create any signer.
use onepercent::{math, params};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn case(
    name: &str,
    seq: u64,
    edition: u8,
    randomness: [u8; 32],
    holder: bool,
    flags: &[u8],
    mut deck_len: u32,
) {
    let qty = flags.len();
    assert!(qty <= params::PACK_EDITIONS_MAX_PER_RIP[usize::from(edition)] as usize);
    assert!(
        qty as u64 * params::PACK_EDITIONS_PRICE_LAMPORTS[usize::from(edition)]
            <= params::MAX_LIST_PER_RIP_LAMPORTS
    );
    let live = flags.iter().fold(0u8, |total, flag| total | flag);
    let caller_seed = math::caller_seed(&onepercent::ID.to_bytes(), seq, &[0; 32]);
    print!(
        "{{\"name\":\"{name}\",\"programId\":\"{}\",\"initialDeckLen\":{deck_len},\"pull\":{{\"seq\":\"{seq}\",\"buyer\":\"11111111111111111111111111111111\",\"edition\":{edition},\"qty\":{qty},\"liveFlags\":{live},\"holder\":{holder},\"randomness\":\"{}\",\"callerSeed\":\"{}\"}},\"packs\":[",
        onepercent::ID,
        hex(&randomness),
        hex(&caller_seed),
    );
    for (pack, flag) in flags.iter().copied().enumerate() {
        if pack != 0 {
            print!(",");
        }
        let draw = math::draw(&randomness, seq, pack as u8, edition, flag, holder).unwrap();
        let mut picks = Vec::new();
        let mut house_mask = 0u8;
        for slot in 0..params::CARDS_PER_PACK_DUST {
            let index = math::dust_index(&randomness, seq, pack as u8, slot as u8, deck_len);
            picks.push(format!(
                "{{\"deckLenBefore\":{deck_len},\"index\":{index}}}"
            ));
            if deck_len == 0 {
                house_mask |= 1u8 << slot;
            } else {
                deck_len -= 1;
            }
        }
        print!(
            "{{\"seq\":\"{seq}\",\"pack\":{pack},\"edition\":{edition},\"liveFlags\":{flag},\"holder\":{holder},\"t\":{},\"widths\":{:?},\"tier\":{},\"hitBucket\":255,\"houseMask\":{house_mask},\"dust\":[{}]}}",
            draw.t, draw.widths, draw.tier, picks.join(","),
        );
    }
    print!("]}}");
}

fn main() {
    print!("[");
    case("original_ten", 101, 0, [0; 32], false, &[0; 10], 100);
    print!(",");
    case(
        "blue_shift_ten",
        u64::MAX - 1,
        1,
        [255; 32],
        true,
        &[0; 10],
        120,
    );
    print!(",");
    case("signature_five", 103, 2, [17; 32], true, &[0; 5], 64);
    print!(",");
    case("after_hours_five", 104, 3, [53; 32], true, &[0; 5], 64);
    print!(",");
    case("short_deck_house_five", 105, 0, [97; 32], false, &[0; 5], 3);
    print!(",");
    let randomness = (0u64..100_000)
        .find_map(|counter| {
            let mut bytes = [85; 32];
            bytes[..8].copy_from_slice(&counter.to_le_bytes());
            (math::draw(&bytes, 106, 0, 3, 4, false).unwrap().tier == 5).then_some(bytes)
        })
        .expect("deterministic search must find a first-pack Jackpot sample");
    case(
        "jackpot_flags_change",
        106,
        3,
        randomness,
        false,
        &[4, 0],
        16,
    );
    println!("]");
}
