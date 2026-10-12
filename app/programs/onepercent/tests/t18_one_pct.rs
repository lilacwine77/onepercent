#[path = "common/callback.rs"]
mod callback;
mod common;
#[path = "common/reference.rs"]
mod reference;
#[path = "common/specials_cases.rs"]
mod specials;
use callback::*;
use common::*;
use onepercent::{constants::*, events::*, math::specials::*, params, state::*};
use solana_signer::Signer;

#[test]
fn t18_01_release_schedule_and_t18_08_min_live_flags() {
    let start = 1_793_290_500;
    for (states, now, expected) in [
        ([0; 4], start - 1, None),
        ([0; 4], start, Some(0)),
        ([2, 0, 0, 0], start + 151_199, None),
        ([2, 0, 0, 0], start + 151_200, Some(1)),
        ([0; 4], start + 200_000, Some(0)),
        ([2; 4], start + 200_000, None),
        ([7, 0, 0, 0], start + 200_000, None),
        ([3; 4], start + 200_000, None),
    ] {
        let (mut env, user, _, _) = setup(false, 100);
        specials::inject(&mut env, states, 0, 0);
        specials::machine(&mut env, |m| {
            m.on_air_ts = start;
            m.end_ts = start + 604_800;
        });
        specials::set_time(&mut env, now);
        assert_eq!(
            onepct_live_index(&env.state::<Machine>(env.machine), now),
            expected
        );
        let mut ix = env.buy_ix(pubkey(&user.pubkey()), 0, 1, 0, None);
        ix.data[14] = LIVE_ONE_PCT;
        if expected.is_some() {
            env.send(&[ix], &[&user]).unwrap();
            let pull = pda(&[
                b"pull",
                pubkey(&user.pubkey()).as_ref(),
                &0u32.to_le_bytes(),
            ])
            .0;
            let meta = env.fulfill(pull, [0; 32]).unwrap();
            assert_eq!(events::<PackRevealed>(&meta)[0].live_flags, LIVE_ONE_PCT);
        } else {
            assert_error(env.send(&[ix], &[&user]), "LiveFlagsChanged");
        }
        let nonce = if expected.is_some() { 1 } else { 0 };
        let mut ix = env.buy_ix(pubkey(&user.pubkey()), 0, 1, nonce, None);
        ix.data[14] = LIVE_SPOTLIGHT;
        assert_error(env.send(&[ix], &[&user]), "LiveFlagsChanged");
    }
}

#[test]
fn t18_02_pull_one_pct_preserves_ledger_and_i14() {
    for mainnet in [false, true] {
        let (mut env, user, _, _) = setup(mainnet, 100);
        let bag = specials::inject(&mut env, [0; 4], 0, 0);
        let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
        let before = env.account(ledger);
        let (pull, _) = env.buy(&user, 0, 1).unwrap();
        let meta = env
            .fulfill(
                pull,
                specials::find_random(1, 0, 0, LIVE_ONE_PCT, false, KIND_ONE_PCT),
            )
            .unwrap();
        no_exception_events(&meta);
        let hit = cards(&env, specials::binder(pubkey(&user.pubkey())))[0];
        assert_eq!(
            (
                hit.mint,
                hit.amount,
                hit.value,
                hit.kind,
                hit.edition,
                hit.seq_lo
            ),
            (
                bag.mint,
                params::TOKEN_1PCT_ONE_PCT_CARD_AMOUNT,
                0,
                KIND_ONE_PCT,
                0,
                1
            )
        );
        let event = &events::<PackRevealed>(&meta)[0];
        assert_eq!(
            (
                event.widths[0],
                event.hit_bucket,
                event.hit_amount,
                event.hit_value
            ),
            (100_000, 255, hit.amount, 0)
        );
        assert_eq!(
            env.state::<Machine>(env.machine).onepct[0].state,
            ONEPCT_PULLED
        );
        assert_eq!(events::<OnePctPulled>(&meta).len(), 1);
        assert_eq!(events::<PullRevealed>(&meta)[0].hit_value_total, 0);
        assert_eq!(env.account(ledger), before);
        env.check_invariants();
    }
}

#[test]
fn t18_03_holder_width_only_boosts_signed_pull_flag() {
    let randomness = (0..1_000_000u64)
        .map(random)
        .find(|r| {
            let draw = reference::draw(r, 1, 0, 0, LIVE_ONE_PCT, true).unwrap();
            (100_000..150_000).contains(&draw.t)
        })
        .unwrap();
    for holder in [false, true] {
        let (mut env, user, _, _) = setup(false, 100);
        specials::inject(&mut env, [0; 4], 0, 0);
        let (pull, _) = env.buy(&user, 0, 1).unwrap();
        // HOLD verification is covered by T05.11; the callback consumes that bit.
        env.mutate(pull, |a| a.data[145] = u8::from(holder));
        let meta = env.fulfill(pull, randomness).unwrap();
        let draw = &events::<PackRevealed>(&meta)[0];
        assert_eq!(draw.widths[0], if holder { 150_000 } else { 100_000 });
        assert_eq!(draw.tier == KIND_ONE_PCT, holder);
        env.check_invariants();
    }
}

#[test]
fn t18_04_two_cards_one_rip_and_per_pack_flags() {
    let (mut env, user, _, _) = setup(false, 100);
    specials::inject(&mut env, [0; 4], 0, 0);
    let now = env.now();
    specials::machine(&mut env, |m| m.on_air_ts = now - 151_200);
    let (pull, _) = env.buy(&user, 0, 10).unwrap();
    // Exhaustive tier-hash search found this seed; the independent model
    // rechecks both forced pack positions before the transaction is sent.
    let randomness = random(2_681_008);
    let forced: Vec<_> = (0..10)
        .filter(|pack| {
            reference::draw(&randomness, 1, *pack, 0, LIVE_ONE_PCT, false)
                .unwrap()
                .tier
                == KIND_ONE_PCT
        })
        .collect();
    assert_eq!(forced, vec![2, 5]);
    let meta = env.fulfill(pull, randomness).unwrap();
    no_exception_events(&meta);
    let wins = events::<OnePctPulled>(&meta);
    assert_eq!(wins.len(), 2);
    assert_eq!((wins[0].pack, wins[0].index), (2, 0));
    assert_eq!(wins[1].index, 1);
    let draws = events::<PackRevealed>(&meta);
    for draw in &draws {
        assert_eq!(
            draw.live_flags,
            if draw.pack <= wins[1].pack {
                LIVE_ONE_PCT
            } else {
                0
            }
        );
    }
    assert_eq!(env.state::<Pull>(pull).live_flags, LIVE_ONE_PCT);
    env.check_invariants();
}

#[test]
fn t18_05_specials_live_for_pending_draw_after_buys_close() {
    for phase in [PHASE_ON_AIR, PHASE_BUYS_CLOSED] {
        let (mut env, user, _, _) = setup(false, 100);
        specials::inject(&mut env, [0; 4], 123, 1_500_000_000);
        let now = env.now();
        specials::machine(&mut env, |m| m.end_ts = now + 5);
        let (pull, _) = env.buy(&user, 0, 1).unwrap();
        env.warp(10);
        specials::machine(&mut env, |m| m.phase = phase);
        let meta = env
            .fulfill(
                pull,
                specials::find_random(1, 0, 0, LIVE_ONE_PCT | LIVE_JACKPOT, false, KIND_ONE_PCT),
            )
            .unwrap();
        assert_eq!(
            events::<PackRevealed>(&meta)[0].live_flags,
            LIVE_ONE_PCT | LIVE_JACKPOT
        );
        env.check_invariants();
    }
    for source in [
        include_str!("../src/instructions/consume_randomness.rs"),
        include_str!("../src/math/specials.rs"),
    ] {
        assert!(!source.contains("end_ts"));
    }
}

#[test]
fn t18_06_promotion_once_from_each_entry_point() {
    for source in 0..3 {
        let (mut env, user, _, _) = setup(false, 100);
        specials::inject(&mut env, [0; 4], 0, 0);
        let now = env.now();
        specials::machine(&mut env, |m| m.on_air_ts = now + 1);
        let pull = if source == 2 {
            Some(env.buy(&user, 0, 1).unwrap().0)
        } else {
            None
        };
        env.warp(1);
        let meta = match source {
            0 => env.send(&[specials::advance(&env)], &[]).unwrap(),
            1 => env.buy(&user, 0, 1).unwrap().1,
            _ => env.fulfill(pull.unwrap(), [0; 32]).unwrap(),
        };
        assert_eq!(events::<OnePctLive>(&meta).len(), 1);
        assert_eq!(
            env.state::<Machine>(env.machine).onepct[0].state,
            ONEPCT_LIVE
        );
        let repeated = env.send(&[specials::advance(&env)], &[]).unwrap();
        assert!(events::<OnePctLive>(&repeated).is_empty());
        env.check_invariants();
    }
}

#[test]
fn advance_phase_injected_final_state_respects_seal_boundary() {
    let (mut env, _, _, _) = setup(false, 100);
    let now = env.now();
    specials::machine(&mut env, |m| {
        m.phase = PHASE_FINAL_PULL;
        m.final_ts = now;
    });
    env.warp(params::SEASON_SEAL_DELAY_SECONDS - 1);
    env.send(&[specials::advance(&env)], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, PHASE_FINAL_PULL);
    env.warp(1);
    let meta = env.send(&[specials::advance(&env)], &[]).unwrap();
    assert_eq!(env.state::<Machine>(env.machine).phase, PHASE_DONE);
    assert_eq!(events::<PhaseAdvanced>(&meta).len(), 1);
    assert!(
        events::<PhaseAdvanced>(&env.send(&[specials::advance(&env)], &[]).unwrap()).is_empty()
    );
}
