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
fn t19_01_threshold_per_edition_and_overflow_bound() {
    let (mut env, _, _, _) = setup(false, 100);
    specials::inject(&mut env, [2; 4], 1, 0);
    for price in params::PACK_EDITIONS_PRICE_LAMPORTS {
        for (cost, expected) in [(15 * price - 1, false), (15 * price, true)] {
            specials::machine(&mut env, |m| m.jackpot_cost = cost);
            assert_eq!(
                jackpot_live(&env.state::<Machine>(env.machine), price),
                expected
            );
            let user = env.user();
            let edition = params::PACK_EDITIONS_PRICE_LAMPORTS
                .iter()
                .position(|value| *value == price)
                .unwrap() as u8;
            let owner = pubkey(&user.pubkey());
            let mut instruction = env.buy_ix(owner, edition, 1, 0, None);
            instruction.data[14] = LIVE_JACKPOT;
            if expected {
                env.send(&[instruction], &[&user]).unwrap();
                let pull = pda(&[b"pull", owner.as_ref(), &0u32.to_le_bytes()]).0;
                let seq = env.state::<Pull>(pull).seq;
                let meta = env
                    .fulfill(
                        pull,
                        specials::find_random(seq, 0, edition, LIVE_JACKPOT, false, KIND_SILVER),
                    )
                    .unwrap();
                assert_eq!(events::<PackRevealed>(&meta)[0].live_flags, LIVE_JACKPOT);
                env.settle(pull, 0).unwrap();
            } else {
                assert_error(env.send(&[instruction], &[&user]), "LiveFlagsChanged");
            }
        }
    }
    specials::machine(&mut env, |m| m.jackpot_cost = u64::MAX);
    assert!(!jackpot_live(&env.state::<Machine>(env.machine), u64::MAX));
    specials::machine(&mut env, |m| m.jackpot_tokens = 0);
    assert!(!jackpot_live(&env.state::<Machine>(env.machine), 1));
}

#[test]
fn t19_02_win_moves_whole_pot_and_t19_05_prize_cards_redeem() {
    for tier in [KIND_ONE_PCT, KIND_JACKPOT] {
        for mainnet in [false, true] {
            let (mut env, user, _, _) = setup(mainnet, 100);
            let bag = specials::inject(&mut env, [0; 4], 4_200_000_000, 1_500_000_007);
            let ledger = pda(&[b"ledger", bag.mint.as_ref()]).0;
            let before_ledger = env.account(ledger);
            let leftover = 17_000_003;
            specials::machine(&mut env, |m| m.jackpot_sol = leftover);
            env.donate_lamports(env.machine, leftover);
            let (pull, _) = env.buy(&user, 0, 1).unwrap();
            let meta = env
                .fulfill(
                    pull,
                    specials::find_random(1, 0, 0, LIVE_ONE_PCT | LIVE_JACKPOT, false, tier),
                )
                .unwrap();
            no_exception_events(&meta);
            assert_eq!(env.account(ledger), before_ledger);
            let m = env.state::<Machine>(env.machine);
            let owner = pubkey(&user.pubkey());
            let hit = cards(&env, specials::binder(owner))[0];
            let event = &events::<PackRevealed>(&meta)[0];
            if tier == KIND_JACKPOT {
                assert_eq!((hit.amount, hit.value), (4_200_000_000, 1_500_000_007));
                assert_eq!((m.jackpot_tokens, m.jackpot_cost), (0, 0));
                let won = &events::<JackpotWon>(&meta)[0];
                assert_eq!(
                    (won.tokens, won.cost, won.jackpot_sol_left),
                    (hit.amount, hit.value, leftover)
                );
            } else {
                assert_eq!(
                    (hit.amount, hit.value),
                    (params::TOKEN_1PCT_ONE_PCT_CARD_AMOUNT, 0)
                );
            }
            assert_eq!(m.jackpot_sol, leftover + 5_000_000);
            assert_eq!(
                (
                    event.hit_bucket,
                    event.hit_mint,
                    event.hit_amount,
                    event.hit_value
                ),
                (255, bag.mint, hit.amount, hit.value)
            );
            assert_eq!(m.hit_value_out, [0; 4]);
            assert_eq!(events::<PullRevealed>(&meta)[0].hit_value_total, 0);
            env.check_invariants();
            env.send(
                &[
                    env.create_ata_ix(owner, &bag, owner),
                    env.redeem_ix(owner, &bag, 0, hit.amount),
                ],
                &[&user],
            )
            .unwrap();
            assert_eq!(
                read_u64(
                    &env.account(ata(&owner, &bag.mint, &bag.token_program)).data,
                    64
                ),
                hit.amount
            );
            env.check_invariants();
        }
    }
}

#[test]
fn t19_03_no_second_win_same_rip_exact_pack_flags() {
    let (mut env, user, _, _) = setup(false, 100);
    specials::inject(&mut env, [2; 4], 99_999, 1_500_000_000);
    let (pull, _) = env.buy(&user, 0, 10).unwrap();
    let randomness = (0..1_000_000u64)
        .map(random)
        .find(|r| {
            reference::draw(r, 1, 3, 0, LIVE_JACKPOT, false)
                .unwrap()
                .tier
                == KIND_JACKPOT
                && (0..3).all(|p| {
                    reference::draw(r, 1, p, 0, LIVE_JACKPOT, false)
                        .unwrap()
                        .tier
                        != KIND_JACKPOT
                })
        })
        .unwrap();
    let meta = env.fulfill(pull, randomness).unwrap();
    no_exception_events(&meta);
    assert_eq!(events::<JackpotWon>(&meta).len(), 1);
    assert_eq!(events::<JackpotWon>(&meta)[0].pack, 3);
    for event in events::<PackRevealed>(&meta) {
        let live = event.pack <= 3;
        assert_eq!(event.live_flags, if live { LIVE_JACKPOT } else { 0 });
        assert_eq!(event.widths[2], if live { 250_000 } else { 0 });
    }
    assert_eq!(env.state::<Pull>(pull).live_flags, LIVE_JACKPOT);
    env.check_invariants();
}

#[test]
fn t19_corrupt_missing_mint_skips_special_without_failing_callback() {
    for tier in [KIND_ONE_PCT, KIND_JACKPOT] {
        let (mut env, user, _, _) = setup(false, 100);
        specials::inject(&mut env, [0; 4], 100, 1_500_000_000);
        let (pull, _) = env.buy(&user, 0, 1).unwrap();
        specials::machine(&mut env, |m| m.token_mint = Default::default());
        let meta = env
            .fulfill(
                pull,
                specials::find_random(1, 0, 0, LIVE_ONE_PCT | LIVE_JACKPOT, false, tier),
            )
            .unwrap();
        assert_eq!(events::<HitSkipped>(&meta).len(), 1);
        assert!(events::<CallbackSkipped>(&meta).is_empty());
        assert_eq!(
            env.state::<Binder>(specials::binder(pubkey(&user.pubkey())))
                .reserved,
            0
        );
    }
}
