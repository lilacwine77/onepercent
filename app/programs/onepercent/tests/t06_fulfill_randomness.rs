#[path = "common/callback.rs"]
mod callback;
mod common;
#[path = "common/reference.rs"]
mod reference;
use anchor_lang::{prelude::Pubkey, AnchorSerialize, Discriminator};
use callback::*;
use common::*;
use onepercent::{events::*, math, params, state::*};
use solana_signer::Signer;

#[test]
fn t06_01_reveal_og_x1_each_tier() {
    for tier in 1..=4 {
        let (mut e, user, dust, stock) = setup(false, 100);
        let (pull, _) = e.buy(&user, 0, 1).unwrap();
        let p = e.state::<Pull>(pull);
        let randomness = force_tier(p.seq, 0, 0, tier);
        let before = e.state::<Machine>(e.machine);
        let lamports = e.account(e.machine).lamports;
        let meta = e.fulfill(pull, randomness).unwrap();
        revealed_accounting(&e, &meta, &before, lamports);
        let after = e.state::<Machine>(e.machine);
        assert_eq!(after.last_reveal_ts, e.now());
        let value = reference::tier_value(p.price, tier).unwrap();
        let hit =
            reference::carve(value, before.buckets[0].amount, before.buckets[0].cost).unwrap();
        assert_eq!(after.buckets[0].amount, hit.1);
        assert_eq!(after.buckets[0].cost, hit.2);
        assert_eq!(after.buckets[0].reserved, 0);
        let binder = pda(&[b"binder", pubkey(&user.pubkey()).as_ref()]).0;
        let cards = cards(&e, binder);
        assert_eq!(cards.len(), 5);
        assert_eq!(
            (
                cards[0].mint,
                cards[0].amount,
                cards[0].value,
                cards[0].kind
            ),
            (stock.mint, hit.0, value, tier)
        );
        for card in &cards[1..] {
            assert_eq!((card.mint, card.amount, card.kind), (dust.mint, 1000, 0));
        }
        for royalty in &packs(&e, pull)[0].royalties {
            assert_eq!(royalty.lamports, reference::split(p.price).royalty);
            assert_eq!(royalty.refund, e.rent_min(80) - e.rent_min(0));
        }
        let bh = e.state::<Binder>(binder);
        assert_eq!((bh.len, bh.reserved, bh.season_spend), (5, 0, p.price));
        let after_pull = e.state::<Pull>(pull);
        assert_eq!((after_pull.status, after_pull.randomness), (2, randomness));
        assert_eq!(
            (
                after.stock_sol - before.stock_sol,
                after.jackpot_sol - before.jackpot_sol,
                after.burn_sol - before.burn_sol,
                after.team_sol - before.team_sol
            ),
            (72_000_000, 5_000_000, 5_000_000, 10_000_000)
        );
    }
}
fn reference_run(edition: u8, qty: u8) {
    let (mut e, user, dust, _) = setup(false, 1000);
    let other = e.new_pump_mint(false);
    e.seed_bucket(1, &other, 1, 5_000_000_000_000, 200_000_000_000);
    let mut deck: Vec<DeckEntry> = e.account(e.deck).data[64..]
        .chunks_exact(80)
        .map(bytemuck::pod_read_unaligned)
        .collect();
    for (i, entry) in deck.iter_mut().enumerate() {
        entry.amount = i as u64 + 1;
    }
    let amount: u64 = deck.iter().map(|entry| entry.amount).sum();
    e.mutate(e.deck, |a| {
        a.data[64..].copy_from_slice(bytemuck::cast_slice(&deck))
    });
    let ledger = pda(&[b"ledger", dust.mint.as_ref()]).0;
    e.mutate(ledger, |a| write_u64(&mut a.data, 72, amount));
    let vault = ata(&e.vault_auth, &dust.mint, &token());
    e.mutate(vault, |a| write_u64(&mut a.data, 64, amount));
    let (pull, _) = e.buy(&user, edition, qty).unwrap();
    let p = e.state::<Pull>(pull);
    let records = packs(&e, pull);
    let machine = e.state::<Machine>(e.machine);
    let before_lamports = e.account(e.machine).lamports;
    let mut buckets: Vec<_> = machine
        .buckets
        .iter()
        .map(|b| reference::Bucket {
            class: b.class,
            enabled: b.enabled != 0,
            amount: b.amount,
            cost: b.cost,
            reserved: b.reserved,
        })
        .collect();
    let randomness = random(859);
    let meta = e.fulfill(pull, randomness).unwrap();
    revealed_accounting(&e, &meta, &machine, before_lamports);
    let reveals = events::<PackRevealed>(&meta);
    assert_eq!(reveals.len(), usize::from(qty));
    let binder = pda(&[b"binder", p.buyer.as_ref()]).0;
    let cards = cards(&e, binder);
    for (i, event) in reveals.iter().enumerate() {
        let drawn = reference::draw(&randomness, p.seq, i as u8, edition, 0, false).unwrap();
        assert_eq!(
            (event.t, event.tier, event.widths),
            (drawn.t, drawn.tier, drawn.widths)
        );
        let backing = usize::from(records[i].backing);
        buckets[backing].reserved -= 15 * p.price;
        let value = reference::tier_value(p.price, drawn.tier).unwrap();
        let pick = reference::bucket_pick(
            &randomness,
            p.seq,
            i as u8,
            drawn.tier,
            value,
            records[i].backing,
            &buckets,
        )
        .unwrap();
        let carve = reference::carve(value, buckets[pick].amount, buckets[pick].cost).unwrap();
        buckets[pick].amount = carve.1;
        buckets[pick].cost = carve.2;
        assert_eq!(
            (event.hit_bucket, event.hit_amount, event.hit_value),
            (pick as u8, carve.0, value)
        );
        assert_eq!(
            (cards[i * 5].mint, cards[i * 5].amount, cards[i * 5].value),
            (machine.buckets[pick].mint, carve.0, value)
        );
        for k in 0..4 {
            let len = deck.len();
            let index = reference::dust_index(&randomness, p.seq, i as u8, k as u8, len as u32);
            let entry = deck.swap_remove(index as usize);
            let pick = &event.dust[k];
            assert_eq!(
                (pick.deck_len_before, pick.index, pick.amount),
                (len as u32, index, entry.amount)
            );
            assert_eq!(
                (cards[i * 5 + k + 1].mint, cards[i * 5 + k + 1].amount),
                (entry.mint, entry.amount)
            );
        }
    }
    let after = e.state::<Machine>(e.machine);
    for (got, expected) in after.buckets.iter().zip(buckets) {
        assert_eq!(
            (got.amount, got.cost, got.reserved),
            (expected.amount, expected.cost, expected.reserved)
        );
    }
}
#[test]
fn t06_02_reveal_og_x10_matches_reference() {
    reference_run(0, 10);
}
#[test]
fn t06_03_reveal_ah_x5() {
    reference_run(3, 5);
}
#[test]
fn t06_04_identity_enforced() {
    for mainnet in [false, true] {
        let (mut e, user, _, _) = setup(mainnet, 100);
        let (pull, _) = e.buy(&user, 0, 1).unwrap();
        let p = e.state::<Pull>(pull);
        let mut ix = raw(&e, pull, [0; 32]);
        ix.program_id = addr(&onepercent::ID);
        ix.data = disc("global", "consume_randomness");
        ix.data.extend_from_slice(&[0; 32]);
        ix.data.extend_from_slice(&p.seq.to_le_bytes());
        ix.accounts.remove(1);
        assert!(e.send(&[ix], &[]).is_err());
        assert!(e
            .send(&[e.raw_fulfill_ix(pull, [0; 32], p.seq, true)], &[])
            .is_err());
        assert_eq!(e.state::<Pull>(pull).status, 1);
        e.check_invariants();
    }
}
#[test]
fn t06_05_closed_or_unknown_pull_skipped() {
    for mainnet in [false, true] {
        for closed in [false, true] {
            let (mut e, user, _, _) = setup(mainnet, 100);
            let (pull, _) = e.buy(&user, 0, 1).unwrap();
            let mut ix = raw(&e, pull, [0; 32]);
            if closed {
                e.warp(300);
                e.send(&[e.refund_ix(pull)], &[]).unwrap();
            } else {
                ix.accounts[2] = meta(Pubkey::new_unique(), true, false);
            }
            let before = e.account(e.machine);
            let result = e.send(&[ix], &[]).unwrap();
            skipped(&result, 1);
            assert_eq!(e.account(e.machine), before);
        }
    }
}
#[test]
fn t06_06_wrong_accounts_skipped() {
    for mainnet in [false, true] {
        for (slot, reason) in [(3usize, 6u8), (4, 7), (5, 8), (6, 3), (7, 9)] {
            let (mut e, user, _, _) = setup(mainnet, 100);
            let (pull, _) = e.buy(&user, 0, 1).unwrap();
            let mut ix = raw(&e, pull, [0; 32]);
            match slot {
                3 => ix.accounts[3] = meta(e.deck, true, false),
                4 => ix.accounts[4] = meta(e.machine, true, false),
                5 => {
                    let other = e.user();
                    let b = e.binder(pubkey(&other.pubkey()), &[], 0, 5);
                    ix.accounts[5] = meta(b, true, false);
                }
                6 => {
                    let n = ix.data.len();
                    ix.data[n - 8..].copy_from_slice(&999u64.to_le_bytes());
                }
                _ => ix.accounts[4].is_writable = false,
            }
            let before = e.account(pull);
            let result = e.send(&[ix], &[]).unwrap();
            skipped(&result, reason);
            assert_eq!(e.account(pull), before);
        }
    }
}
#[test]
fn t06_07_duplicate_callback_skipped() {
    for mainnet in [false, true] {
        let (mut e, user, _, _) = setup(mainnet, 100);
        let (pull, _) = e.buy(&user, 0, 1).unwrap();
        let ix = raw(&e, pull, [2; 32]);
        e.fulfill(pull, [1; 32]).unwrap();
        let before = e.account(pull);
        let revealed_ts = e.state::<Machine>(e.machine).last_reveal_ts;
        e.warp(1);
        let meta = e.send(&[ix], &[]).unwrap();
        skipped(&meta, 4);
        assert_eq!(e.state::<Machine>(e.machine).last_reveal_ts, revealed_ts);
        assert!(events::<RevealTimestamped>(&meta).is_empty());
        assert_eq!(e.account(pull), before);
        e.check_invariants();
    }
}
#[test]
fn t06_08_late_callback_skipped_then_refund() {
    for mainnet in [false, true] {
        let (mut e, user, _, _) = setup(mainnet, 100);
        let (pull, _) = e.buy(&user, 0, 1).unwrap();
        e.warp(301);
        let meta = e.fulfill(pull, [0; 32]).unwrap();
        skipped(&meta, 5);
        e.send(&[e.refund_ix(pull)], &[]).unwrap();
        assert!(e.closed(pull));
        e.check_invariants();
    }
}
#[test]
fn t06_09_short_deck_house_cards() {
    let (mut e, user, _, _) = setup(false, 100);
    let (pull, _) = e.buy(&user, 0, 1).unwrap();
    shrink_deck(&mut e, 2);
    let before = e.state::<Machine>(e.machine);
    let meta = e.fulfill(pull, [0; 32]).unwrap();
    no_exception_events(&meta);
    let event = events::<PackRevealed>(&meta);
    assert_eq!(event[0].house_mask.count_ones(), 2);
    let binder = pda(&[b"binder", pubkey(&user.pubkey()).as_ref()]).0;
    let b = e.state::<Binder>(binder);
    assert_eq!((b.len, b.reserved, b.cap), (3, 0, 5));
    assert_eq!(
        e.state::<Machine>(e.machine).stock_sol - before.stock_sol,
        76_000_000
    );
    e.check_invariants();
}
#[test]
fn t06_10_deck_exactly_4qty() {
    let (mut e, user, dust, _) = setup(false, 90);
    let owner = pubkey(&user.pubkey());
    e.mutate(e.deck, |a| {
        for entry in a.data[64..].chunks_exact_mut(80) {
            write_key(entry, 0, &owner);
        }
    });
    let (pull, _) = e.buy(&user, 0, 10).unwrap();
    e.send(&[e.create_ata_ix(owner, &dust, owner)], &[&user])
        .unwrap();
    for _ in 0..50 {
        e.send(&[e.take_back_ix(owner, &dust, 0, 1000)], &[&user])
            .unwrap();
    }
    let meta = e.fulfill(pull, [9; 32]).unwrap();
    let events = events::<PackRevealed>(&meta);
    assert_eq!(events.len(), 10);
    assert!(events.iter().all(|event| event.house_mask == 0));
    assert_eq!(e.account(e.deck).data.len(), 64);
    assert_eq!(e.state::<Deck>(e.deck).len, 0);
    e.check_invariants();
}
#[test]
fn t06_11_bucket_disabled_mid_pull() {
    for other_enabled in [false, true] {
        let (mut e, user, _, _) = setup(false, 100);
        let (pull, _) = e.buy(&user, 0, 1).unwrap();
        if other_enabled {
            let bag = e.new_pump_mint(false);
            e.seed_bucket(1, &bag, 1, 1_000_000_000_000, 30_000_000_000);
        }
        e.mutate(e.machine, |a| a.data[224 + 110] = 0);
        let meta = e.fulfill(pull, [7; 32]).unwrap();
        no_exception_events(&meta);
        assert_eq!(
            events::<PackRevealed>(&meta)[0].hit_bucket,
            u8::from(other_enabled)
        );
        e.check_invariants();
    }
}
#[test]
fn t06_12_cap_lowered_mid_pull() {
    let (mut e, user, _, _) = setup(false, 100);
    let (pull, _) = e.buy(&user, 0, 1).unwrap();
    e.mutate(e.machine, |a| write_u64(&mut a.data, 224 + 88, 0));
    let meta = e.fulfill(pull, [0; 32]).unwrap();
    no_exception_events(&meta);
    e.check_invariants();
}
#[test]
fn t06_13_trending_only_silver_blue() {
    for tier in 1..=4 {
        let (mut e, user, _, _) = setup(false, 100);
        let bag = e.new_pump_mint(false);
        e.seed_bucket(1, &bag, 2, 1_000_000_000_000_000, u64::MAX / 4);
        let (pull, _) = e.buy(&user, 0, 1).unwrap();
        let randomness = (0..1_000_000)
            .map(random)
            .find(|r| {
                let draw = reference::draw(r, 1, 0, 0, 0, false).unwrap();
                if draw.tier != tier {
                    return false;
                }
                let m = e.state::<Machine>(e.machine);
                let mut buckets = m.buckets.map(|b| reference::Bucket {
                    class: b.class,
                    enabled: b.enabled != 0,
                    amount: b.amount,
                    cost: b.cost,
                    reserved: b.reserved,
                });
                buckets[0].reserved = 0;
                reference::bucket_pick(
                    r,
                    1,
                    0,
                    tier,
                    reference::tier_value(100_000_000, tier).unwrap(),
                    0,
                    &buckets,
                ) == Some(if tier <= 2 { 1 } else { 0 })
            })
            .unwrap();
        let meta = e.fulfill(pull, randomness).unwrap();
        assert_eq!(
            events::<PackRevealed>(&meta)[0].hit_bucket,
            if tier <= 2 { 1 } else { 0 }
        );
        e.check_invariants();
    }
}
#[test]
fn t06_14_rent_increase_before_callback() {
    for mainnet in [false, true] {
        for house in [false, true] {
            let (mut e, user, _, _) = setup(mainnet, 100);
            let (pull, _) = e.buy(&user, 0, 1).unwrap();
            if house {
                shrink_deck(&mut e, 0);
            }
            e.set_rent(6960);
            let meta = e.fulfill(pull, [0; 32]).unwrap();
            no_exception_events(&meta);
            let event = events::<PullRevealed>(&meta);
            assert_eq!(event.len(), 1);
            if house {
                assert!(event[0].shortfall > 0);
            }
            e.check_invariants();
        }
    }
}
#[test]
fn t06_15_donations_before_callback() {
    let (mut e, user, _, _) = setup(false, 100);
    let (pull, _) = e.buy(&user, 0, 1).unwrap();
    let binder = pda(&[b"binder", pubkey(&user.pubkey()).as_ref()]).0;
    for account in [pull, e.machine, e.deck, binder] {
        e.donate_lamports(account, 1_234_567);
    }
    let machine = e.state::<Machine>(e.machine);
    let before = e.account(e.machine).lamports;
    let meta = e.fulfill(pull, [0; 32]).unwrap();
    revealed_accounting(&e, &meta, &machine, before);
    let before = e.account(pubkey(&user.pubkey())).lamports;
    e.settle(pull, 0).unwrap();
    assert_eq!(
        e.account(pubkey(&user.pubkey())).lamports - before,
        e.rent_min(376) + 1_234_567
    );
    e.check_invariants();
}
fn heavy_randomness(edition: u8, qty: u8) -> [u8; 32] {
    let mut best = [0u8; 32];
    let mut score = 0u32;
    for seed in 0..1_000_000 {
        let r = random(seed);
        let candidate = (0..qty)
            .map(|pack| {
                match reference::draw(&r, 1, pack, edition, 0, false)
                    .unwrap()
                    .tier
                {
                    4 => 4,
                    3 => 1,
                    _ => 0,
                }
            })
            .sum();
        if candidate > score {
            score = candidate;
            best = r;
        }
    }
    best
}
#[test]
fn t06_16_cu_og_x10_deck_max() {
    let heavy_og = heavy_randomness(0, 10);
    let heavy_ah = heavy_randomness(3, 5);
    let mut rows = Vec::new();
    for mainnet in [false, true] {
        for (edition, qty) in [(0u8, 1u8), (0, 10), (3, 5)] {
            for large in [false, true] {
                let mut outcomes = vec![
                    ("silver", all_silver(1, edition, qty)),
                    ("house", all_silver(1, edition, qty)),
                ];
                if qty == 1 {
                    for (name, tier) in [("blue", 2), ("holo", 3), ("black", 4)] {
                        outcomes.push((name, force_tier(1, 0, edition, tier)));
                    }
                } else {
                    outcomes.push(("heavy", if edition == 0 { heavy_og } else { heavy_ah }));
                }
                for (outcome, randomness) in outcomes {
                    let (mut e, user, dust, _) = setup(mainnet, params::COVERAGE_DECK_MAX);
                    for index in 1..16 {
                        let bag = e.new_pump_mint(false);
                        e.seed_bucket(index, &bag, 1, 1_000_000_000_000, 300_000_000_000);
                    }
                    if large {
                        large_binder(&mut e, &user, &dust, qty);
                    }
                    let (pull, _) = e.buy(&user, edition, qty).unwrap();
                    if outcome == "house" {
                        shrink_deck(&mut e, 2);
                    }
                    let metadata = e.fulfill(pull, randomness).unwrap();
                    no_exception_events(&metadata);
                    let callback = callback_cu(&metadata);
                    let total = metadata.compute_units_consumed + 45_000;
                    let heap = allocation_bound(qty);
                    assert!(
                        callback > 0 && callback <= 200_000,
                        "callback CU {callback}"
                    );
                    assert!(
                        total <= 270_000,
                        "fulfillment CU including provider allowance {total}"
                    );
                    assert!(heap <= 24 * 1024, "allocation upper bound {heap}");
                    let row = serde_json::json!({"features":if mainnet{"mainnet"}else{"all"},"edition":edition,"qty":qty,"binder":if large{"65535"}else{"small"},"outcome":outcome,"callbackCu":callback,"fulfillmentCuWithProvider":total,"allocationUpperBound":heap});
                    println!("T06.16 {row}");
                    rows.push(row);
                }
            }
        }
    }
    let mut spreads = Vec::new();
    for (edition, qty) in [(0u8, 1u8), (0, 10), (3, 5)] {
        let values: Vec<_> = rows
            .iter()
            .filter(|r| r["edition"] == edition && r["qty"] == qty)
            .map(|r| r["callbackCu"].as_u64().unwrap())
            .collect();
        let spread = values.iter().max().unwrap() - values.iter().min().unwrap();
        spreads.push(serde_json::json!({"edition":edition,"qty":qty,"callbackCuSpread":spread}));
        println!("T06.16 spread edition={edition} qty={qty}: {}", spread);
    }
    if std::env::var_os("UPDATE_REPORT").is_some() {
        let (mut env, user, _, _) = setup(false, 1000);
        let (pull, _) = env.buy(&user, 0, 10).unwrap();
        let metadata = env.fulfill(pull, [8; 32]).unwrap();
        let log_bytes = metadata.logs.iter().map(|line| line.len()).sum::<usize>();
        let report = serde_json::json!({"cases":rows,"spreads":spreads,"og10LogBytes":log_bytes,"allocationMethod":"qty-sized scratch buffers plus all retained Anchor event allocations and a conservative 4096-byte entrypoint/fixed-allocation allowance","providerAllowanceCu":45000});
        let directory =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/reports");
        std::fs::create_dir_all(&directory).unwrap();
        let mut encoded = serde_json::to_vec_pretty(&report).unwrap();
        encoded.push(b'\n');
        std::fs::write(directory.join("callback.json"), encoded).unwrap();
    }
}
#[test]
fn t06_17_logs_og_x10_fit() {
    for mainnet in [false, true] {
        let (mut e, user, _, _) = setup(mainnet, 1000);
        let (pull, _) = e.buy(&user, 0, 10).unwrap();
        let metadata = e.fulfill(pull, [8; 32]).unwrap();
        let bytes = metadata.logs.iter().map(|s| s.len()).sum::<usize>();
        assert!(bytes <= 9_000, "log bytes {bytes}");
        assert!(metadata.logs.iter().all(|l| !l.contains("Log truncated")));
        let pack_events = events::<PackRevealed>(&metadata);
        assert_eq!(pack_events.len(), 10);
        assert_eq!(events::<PullRevealed>(&metadata).len(), 1);
        let mut bytes = Vec::new();
        pack_events[0].serialize(&mut bytes).unwrap();
        assert!(bytes.len() + PackRevealed::DISCRIMINATOR.len() <= 512);
        println!(
            "T06.17 log bytes={bytes:?}",
            bytes = metadata.logs.iter().map(|s| s.len()).sum::<usize>()
        );
    }
}
#[test]
fn t06_18_hour_rotation() {
    let (mut e, user, _, _) = setup(false, 1000);
    let hour = e.now() as u64 / 3600;
    e.mutate(e.machine, |a| {
        write_u64(&mut a.data, 120, hour);
        write_u64(&mut a.data, 128, 500);
        write_u64(&mut a.data, 144, 700);
        write_u64(&mut a.data, 152, 900);
    });
    let (pull, _) = e.buy(&user, 0, 1).unwrap();
    e.fulfill(pull, force_tier(1, 0, 0, 1)).unwrap();
    let current = e.state::<Machine>(e.machine);
    assert_eq!(current.hit_out_this_hour, 500 + 50_000_000);
    assert_eq!(
        (current.sb_paid_hour, current.sol_at_hour_start),
        (700, 900)
    );
    e.warp(3600);
    let before = e.state::<Machine>(e.machine);
    let (pull, _) = e.buy(&user, 0, 1).unwrap();
    e.fulfill(pull, force_tier(2, 0, 0, 1)).unwrap();
    let after = e.state::<Machine>(e.machine);
    assert_eq!(after.hit_out_last_hour, before.hit_out_this_hour);
    assert_eq!(after.sb_paid_hour, 0);
    assert_eq!(after.sol_at_hour_start, before.stock_sol);
    let (pull, _) = e.buy(&user, 0, 1).unwrap();
    e.fulfill(pull, force_tier(3, 0, 0, 1)).unwrap();
    assert_eq!(
        e.state::<Machine>(e.machine).sol_at_hour_start,
        after.sol_at_hour_start
    );
    e.warp(7200);
    let (pull, _) = e.buy(&user, 0, 1).unwrap();
    e.fulfill(pull, force_tier(4, 0, 0, 1)).unwrap();
    assert_eq!(e.state::<Machine>(e.machine).hit_out_last_hour, 0);
    e.check_invariants();
}
#[test]
fn t06_19_draw_distribution() {
    const N: u64 = 1_000_000;
    for edition in 0..4 {
        let mut counts = [0u64; 5];
        for seed in 0..N {
            let result = math::draw(&random(seed), 1, 0, edition, 0, false).unwrap();
            counts[usize::from(result.tier)] += 1;
        }
        let blue = params::HIT_ODDS_BLUE_PPB[usize::from(edition)];
        let weights = [
            0,
            params::PPB_DENOMINATOR - params::HIT_ODDS_BLACK_PPB - params::HIT_ODDS_HOLO_PPB - blue,
            blue,
            params::HIT_ODDS_HOLO_PPB,
            params::HIT_ODDS_BLACK_PPB,
        ];
        for tier in 1..=4 {
            let p = f64::from(weights[tier]) / f64::from(params::PPB_DENOMINATOR);
            let expected = N as f64 * p;
            let deviation = (counts[tier] as f64 - expected).abs();
            let sigma = (N as f64 * p * (1.0 - p)).sqrt();
            assert!(
                deviation <= 4.0 * sigma,
                "edition {edition} tier {tier}: {deviation} > {}",
                4.0 * sigma
            );
        }
    }
}
#[test]
fn t06_20_dust_uniform() {
    const N: u64 = 1_000_000;
    let mut counts = [0u64; 97];
    for seed in 0..N {
        counts[math::dust_index(&random(seed), 1, 0, 0, 97) as usize] += 1;
    }
    let p = 1.0 / 97.0;
    let sigma = (N as f64 * p * (1.0 - p)).sqrt();
    for count in counts {
        assert!((count as f64 - N as f64 * p).abs() <= 4.0 * sigma);
    }
}
#[test]
fn t06_21_no_inner_instructions() {
    for mainnet in [false, true] {
        let (mut e, user, _, _) = setup(mainnet, 100);
        let (pull, _) = e.buy(&user, 0, 1).unwrap();
        let ix = raw(&e, pull, [0; 32]);
        let binder = pubkey(&ix.accounts[5].pubkey);
        let before: Vec<_> = e
            .tracked
            .iter()
            .filter(|a| {
                ![
                    pull,
                    e.machine,
                    e.deck,
                    binder,
                    pubkey(&e.authority.pubkey()),
                ]
                .contains(a)
            })
            .map(|a| (*a, e.svm.get_account(&addr(a))))
            .collect();
        let metadata = e.send(&[ix], &[]).unwrap();
        let invocations: Vec<_> = metadata
            .logs
            .iter()
            .filter(|l| l.starts_with("Program ") && l.contains(" invoke ["))
            .collect();
        assert_eq!(invocations.len(), 2, "{:?}", metadata.logs);
        assert!(invocations[1].contains(&onepercent::ID.to_string()));
        for (key, account) in before {
            assert_eq!(e.svm.get_account(&addr(&key)), account);
        }
        e.check_invariants();
    }
}
#[test]
fn t06_22_widths_match_params() {
    for edition in 0..4 {
        for flags in 0..8 {
            for holder in [false, true] {
                let got = math::draw(&[0; 32], 1, 0, edition, flags, holder).unwrap();
                let expected = reference::draw(&[0; 32], 1, 0, edition, flags, holder).unwrap();
                assert_eq!(got.widths, expected.widths);
                assert_eq!(got.widths[1], 0);
                let silver = params::PPB_DENOMINATOR - got.widths.iter().sum::<u32>();
                let ev = u128::from(silver) * u128::from(params::HIT_TIERS_VALUE_BPS[0])
                    + u128::from(got.widths[3]) * u128::from(params::HIT_TIERS_VALUE_BPS[3])
                    + u128::from(got.widths[4]) * u128::from(params::HIT_TIERS_VALUE_BPS[2])
                    + u128::from(got.widths[5]) * u128::from(params::HIT_TIERS_VALUE_BPS[1]);
                if flags & 5 == 5 && !holder {
                    assert_eq!(
                        ev,
                        u128::from(params::HIT_ODDS_CALIBRATED_STOCK_EV_BPS)
                            * u128::from(params::PPB_DENOMINATOR)
                    );
                }
            }
        }
    }
}

#[test]
fn t06_23_callback_commit_is_total_and_prewrites_are_atomic() {
    let source = include_str!("../src/instructions/consume_randomness.rs");
    let reveal = source
        .split("fn reveal(")
        .nth(1)
        .unwrap()
        .split("pub fn handler(")
        .next()
        .unwrap();
    let commit = reveal
        .split("// No Result propagation is allowed below this commit boundary.")
        .nth(1)
        .unwrap();
    for forbidden in [
        "?",
        "return Err",
        "CallbackSkipped",
        "unwrap()",
        "expect(",
        "panic!",
        "Rent::get",
    ] {
        assert!(
            !commit.contains(forbidden),
            "post-write reveal contains {forbidden}"
        );
    }
    let shrink = source
        .split("fn shrink_revealed_deck(")
        .nth(1)
        .unwrap()
        .split("#[inline(never)]")
        .next()
        .unwrap();
    assert!(shrink.contains(") -> u32"));
    for forbidden in [
        "?",
        "return Err",
        "CallbackSkipped",
        "unwrap()",
        "expect(",
        "panic!",
        "Rent::get",
    ] {
        assert!(
            !shrink.contains(forbidden),
            "total shrink helper contains {forbidden}"
        );
    }
    for mainnet in [false, true] {
        for rate in [5_080, 6_960] {
            let (mut e, user, _, _) = setup(mainnet, 100);
            let (pull, _) = e.buy(&user, 0, 1).unwrap();
            let b = pda(&[b"binder", pubkey(&user.pubkey()).as_ref()]).0;
            let good_deck = e.account(e.deck);
            e.mutate(e.deck, |account| {
                account.data.pop();
            });
            let protected = [pull, e.machine, e.deck, b];
            let before = protected.map(|at| e.account(at));
            let meta = e.fulfill(pull, [3; 32]).unwrap();
            assert_eq!(events::<CallbackSkipped>(&meta)[0].reason, 7);
            for (at, original) in protected.iter().zip(before.iter()) {
                let after = e.account(*at);
                // The runtime normalizes rent_epoch for exempt accounts. This
                // metadata is not a program write; monetary and layout state
                // must nevertheless remain byte-for-byte unchanged.
                assert_eq!(after.lamports, original.lamports);
                assert_eq!(after.data, original.data);
                assert_eq!(after.owner, original.owner);
                assert_eq!(after.executable, original.executable);
            }
            e.put(e.deck, good_deck);
            e.set_rent(rate);
            let deck_before = e.account(e.deck).lamports;
            let meta = e
                .send(
                    &[e.raw_fulfill_ix(pull, [3; 32], e.state::<Pull>(pull).seq, false)],
                    &[],
                )
                .unwrap();
            assert!(events::<CallbackSkipped>(&meta).is_empty());
            let d = e.state::<Deck>(e.deck);
            let expected_cap = if deck_before >= e.rent_min(64 + 96 * 80) {
                96
            } else {
                100
            };
            assert_eq!((d.len, d.cap), (96, expected_cap));
            assert_eq!(
                e.account(e.deck).data.len(),
                64 + expected_cap as usize * 80
            );
            let refunds: u64 = packs(&e, pull)[0].royalties.iter().map(|r| r.refund).sum();
            assert_eq!(e.account(e.deck).lamports, deck_before - refunds);
            assert_eq!(
                refunds,
                (4 * 406_400)
                    .min(deck_before.saturating_sub(e.rent_min(64 + expected_cap as usize * 80)))
            );
            assert_eq!(e.state::<Pull>(pull).status, 2);
            e.check_invariants();
        }
    }
}

#[path = "common/specials_cases.rs"]
mod specials;

#[test]
fn t06_16_m4_specials_cu_and_t06_17_log_matrix() {
    let mut rows = Vec::new();
    for (edition, qty) in [(0u8, 1u8), (0, 10), (3, 5)] {
        for large in [false, true] {
            for holder in [false, true] {
                let tiers: &[u8] = if qty == 1 {
                    &[1, 2, 3, 4, 5, 6]
                } else {
                    &[1, 5, 6]
                };
                for tier in tiers {
                    let (mut env, user, dust, _) = setup(true, params::COVERAGE_DECK_MAX);
                    specials::inject(&mut env, [0; 4], 5_000_000_000, 15_000_000_000);
                    let now = env.now();
                    specials::machine(&mut env, |m| m.on_air_ts = now - 453_600);
                    for index in 1..16 {
                        let bag = env.new_pump_mint(false);
                        env.seed_bucket(index, &bag, 1, 1_000_000_000_000, 300_000_000_000);
                    }
                    if large {
                        large_binder(&mut env, &user, &dust, qty);
                    }
                    let (pull, _) = env.buy(&user, edition, qty).unwrap();
                    env.mutate(pull, |a| a.data[145] = u8::from(holder));
                    let randomness = specials::find_random(1, 0, edition, 5, holder, *tier);
                    let meta = env.fulfill(pull, randomness).unwrap();
                    no_exception_events(&meta);
                    assert_eq!(events::<PackRevealed>(&meta)[0].tier, *tier);
                    let callback = callback_cu(&meta);
                    let total = meta.compute_units_consumed + 45_000;
                    // At most four promotions, four The 1% wins and one Jackpot
                    // win. Anchor's allocator retains their 256-byte encoders.
                    let heap = allocation_bound(qty) + 9 * 256;
                    let logs = meta.logs.iter().map(|line| line.len()).sum::<usize>();
                    assert!(callback <= 200_000, "callback CU {callback}");
                    assert!(total <= 270_000, "fulfillment CU {total}");
                    assert!(heap <= 24 * 1024, "allocation bound {heap}");
                    assert!(logs <= 9000, "logs {logs}");
                    assert!(meta.logs.iter().all(|line| !line.contains("Log truncated")));
                    env.check_invariants();
                    let row = serde_json::json!({"edition":edition,"qty":qty,"largeBinder":large,"holder":holder,"forcedTier":tier,"callbackCu":callback,"fulfillmentCuWithProvider":total,"allocationUpperBound":heap,"logBytes":logs});
                    println!("T06.16 M4 {row}");
                    rows.push(row);
                }
            }
        }
    }
    if std::env::var_os("UPDATE_REPORT").is_some() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/reports/callback-m4.json");
        let mut bytes = serde_json::to_vec_pretty(
            &serde_json::json!({"features":"mainnet","cases":rows,"providerAllowanceCu":45000}),
        )
        .unwrap();
        bytes.push(b'\n');
        std::fs::write(path, bytes).unwrap();
    }
}

#[test]
fn p3_legacy_pending_reveal_tracks_counter_without_exceeding_callback_budget() {
    let (mut e, user, _, _) = setup(false, 1000);
    let (pull, _) = e.buy(&user, 0, 10).unwrap();
    e.mutate(e.machine, |account| account.data[2656..3072].fill(0));
    let meta = e.fulfill(pull, [8; 32]).unwrap();
    let machine = e.state::<Machine>(e.machine);
    assert_eq!(machine.keeper_history_version, 1);
    assert_eq!(machine.keeper_history_started_ts, 0);
    assert_eq!(machine.unsettled_reveals, 1);
    assert_eq!(machine.last_reveal_ts, e.now());
    assert_eq!(events::<KeeperHistoryStarted>(&meta).len(), 1);
    assert_eq!(events::<RevealTimestamped>(&meta).len(), 1);
    assert_eq!(e.state::<Pull>(pull).status, 2);
    assert!(meta.compute_units_consumed <= 270_000);
    assert!(allocation_bound(10) <= 24 * 1024);
}
