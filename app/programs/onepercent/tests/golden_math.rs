use onepercent::{math, params};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn bucket_json(b: &math::BucketInput) -> Value {
    json!({"class":b.class,"enabled":b.enabled,"amount":b.amount.to_string(),"cost":b.cost.to_string(),"reserved":b.reserved.to_string()})
}
fn fixture(name: &str, values: Vec<Value>) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/vectors")
        .join(format!("{name}.json"));
    let content = format!("{}\n", serde_json::to_string_pretty(&values).unwrap());
    if std::env::var("UPDATE_GOLDEN").as_deref() == Ok("1") {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &content).unwrap();
    } else {
        assert_eq!(
            fs::read_to_string(&path)
                .unwrap_or_else(|_| panic!("missing {}; run golden:update", path.display())),
            content,
            "{} drifted",
            path.display()
        );
    }
}

#[test]
fn golden_math_vectors() {
    let mut splits = vec![];
    for price in params::PACK_EDITIONS_PRICE_LAMPORTS.into_iter().chain([
        0,
        1,
        49,
        50,
        99,
        101,
        u64::MAX - 1,
        u64::MAX,
    ]) {
        let s = math::split(price);
        splits.push(json!({"input":{"price":price.to_string()},"output":{"royalty":s.royalty.to_string(),"jackpot":s.jackpot.to_string(),"burn":s.burn.to_string(),"referral":s.referral.to_string(),"team":s.team.to_string(),"stock":s.stock.to_string()}}));
    }
    fixture("split", splits);
    let mut draws = vec![];
    let mut dust = vec![];
    for i in 0..256u64 {
        let mut randomness = [0u8; 32];
        for (j, b) in randomness.iter_mut().enumerate() {
            *b = (i.wrapping_mul(29).wrapping_add(j as u64 * 17)) as u8;
        }
        if i < 2 {
            randomness = [0; 32];
        }
        if i == 2 {
            randomness = [255; 32];
        }
        let seq = if i < 2 {
            1
        } else if i == 2 {
            7
        } else {
            i * 7919
        };
        let pack = if i < 2 {
            i as u8
        } else if i == 2 {
            3
        } else {
            (i % 10) as u8
        };
        let edition = (i % 4) as u8;
        let live = if i < 200 { 0 } else { (i % 8) as u8 };
        let holder = i % 2 == 0;
        let d = math::draw(&randomness, seq, pack, edition, live, holder).unwrap();
        draws.push(json!({"input":{"randomness":hex(&randomness),"seq":seq.to_string(),"pack":pack,"edition":edition,"live":live,"holder":holder},"output":{"t":d.t,"tier":d.tier,"widths":d.widths}}));
        let len = if i < 4 {
            1_000
        } else if i % 11 == 0 {
            u32::MAX
        } else {
            i as u32 * 487
        };
        let k = (i % 4) as u8;
        let (randomness, seq, pack) = if i < 4 {
            ([0u8; 32], 1, 0)
        } else {
            (randomness, seq, pack)
        };
        dust.push(json!({"input":{"randomness":hex(&randomness),"seq":seq.to_string(),"pack":pack,"k":k,"len":len},"output":math::dust_index(&randomness,seq,pack,k,len)}));
    }
    fixture("draw", draws);
    fixture("dust", dust);
    let mut carves = vec![];
    for (value, amount, cost) in [
        (0, 0, 0),
        (1, 1, 0),
        (1, 1, 3),
        (3, 5, 7),
        (7, 5, 7),
        (8, 5, 7),
        (u64::MAX, u64::MAX, u64::MAX),
        (u64::MAX - 1, u64::MAX, u64::MAX),
        (1, u64::MAX, u64::MAX),
        (10, 1_000, 99),
    ] {
        let output = math::carve(value,amount,cost).map(|c|json!({"tokens":c.tokens.to_string(),"amount":c.amount.to_string(),"cost":c.cost.to_string()}));
        carves.push(json!({"input":{"value":value.to_string(),"amount":amount.to_string(),"cost":cost.to_string()},"output":output}));
    }
    fixture("carve", carves);
    let mut buckets = vec![];
    let mut quantities = vec![];
    for i in 0..64u64 {
        let input = [
            math::BucketInput {
                class: 1,
                enabled: i % 5 != 0,
                amount: 1_000_000 + i,
                cost: 15_000_000_000 + i,
                reserved: i * 111,
            },
            math::BucketInput {
                class: 1,
                enabled: i % 7 != 0,
                amount: 2_000_000 + i,
                cost: 30_000_000_000 + i,
                reserved: i * 222,
            },
            math::BucketInput {
                class: 2,
                enabled: true,
                amount: 3_000_000,
                cost: u64::MAX,
                reserved: 0,
            },
        ];
        let randomness = [i as u8; 32];
        let seq = i * 811;
        let pack = (i % 10) as u8;
        let kind = (i % 4 + 1) as u8;
        let value =
            math::tier_value(params::PACK_EDITIONS_PRICE_LAMPORTS[(i % 4) as usize], kind).unwrap();
        let backing = (i % 2) as u8;
        buckets.push(json!({"input":{"randomness":hex(&randomness),"seq":seq.to_string(),"pack":pack,"kind":kind,"value":value.to_string(),"backing":backing,"buckets":input.iter().map(bucket_json).collect::<Vec<_>>()},"output":math::bucket_pick(&randomness,seq,pack,kind,value,backing,&input)}));
        let edition = (i % 4) as u8;
        let deck_len = 50 + i as u32;
        let reserved_dust = (i % 12) as u32;
        quantities.push(json!({"input":{"edition":edition,"deckLen":deck_len,"reservedDust":reserved_dust,"buckets":input.iter().map(bucket_json).collect::<Vec<_>>()},"output":math::max_qty(edition,deck_len,reserved_dust,&input)}));
    }
    fixture("bucket", buckets);
    let coarse = math::BucketInput {
        class: 1,
        enabled: true,
        amount: 1,
        cost: 2 * params::LAMPORTS_PER_SOL,
        reserved: 0,
    };
    let threshold = math::BucketInput {
        amount: 40,
        ..coarse
    };
    let alternative = math::BucketInput {
        amount: 60,
        cost: 3 * params::LAMPORTS_PER_SOL,
        ..coarse
    };
    let mut reservations = vec![];
    for input in [
        vec![coarse],
        vec![threshold],
        vec![coarse, alternative],
        vec![threshold, alternative],
    ] {
        for edition in 0..4u8 {
            let price = params::PACK_EDITIONS_PRICE_LAMPORTS[usize::from(edition)];
            quantities.push(json!({"input":{"edition":edition,"deckLen":100,"reservedDust":0,"buckets":input.iter().map(bucket_json).collect::<Vec<_>>()},"output":math::max_qty(edition,100,0,&input)}));
            for qty in [0, 1, 2, 3, 10] {
                let mut after = input.clone();
                let backing = math::coverage(price, qty, &mut after);
                reservations.push(json!({"input":{"price":price.to_string(),"qty":qty,"buckets":input.iter().map(bucket_json).collect::<Vec<_>>()},"output":{"backing":backing,"buckets":after.iter().map(bucket_json).collect::<Vec<_>>()}}));
            }
        }
    }
    fixture("maxqty", quantities);
    fixture("coverage", reservations);
}
