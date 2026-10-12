mod common;
#[path = "common/launch_cases.rs"]
mod launch;
#[path = "common/property.rs"]
mod property;
#[path = "common/reference.rs"]
mod reference;
#[path = "common/specials_cases.rs"]
mod specials;
use common::{
    pack_cases::{cards, close_ix, events, team_ix},
    *,
};
use onepercent::{constants::*, events::*, math, params, state::*};
use proptest::prelude::*;
use solana_signer::Signer;

fn season(steps: Vec<(u8, u64, [u8; 32])>) -> proptest::test_runner::TestCaseResult {
    let (mut env, coin) = launch::setup();
    env.send(&[launch::power_ix(&env, &coin)], &[]).unwrap();
    env.check_invariants();
    let fees = params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS;
    env.donate_lamports(env.fee_in, fees);
    let first = launch::collect(&mut env);
    prop_assert_eq!(events::<CreatorFeesCollected>(&first)[0].to_stock, fees);
    let dust = env.inject_deck(120);
    let depositor = pubkey(&env.authority.pubkey());
    env.mutate(env.deck, |account| {
        for entry in account.data[64..].chunks_exact_mut(80) {
            write_key(entry, 0, &depositor);
        }
    });
    let stock = env.new_pump_mint(false);
    env.seed_bucket(0, &stock, 1, 1_000_000_000_000, 300_000_000_000);
    // P1's executor is outside the P0 base: back an injected pre-bought pot.
    let ledger = pda(&[b"ledger", coin.mint.as_ref()]).0;
    let pot = 5_000_000;
    env.donate_tokens(ata(&env.vault_auth, &coin.mint, &coin.token_program), pot);
    env.mutate(coin.mint, |a| {
        let supply = read_u64(&a.data, 36);
        write_u64(&mut a.data, 36, supply + pot);
    });
    env.mutate(ledger, |a| {
        let amount = read_u64(&a.data, 72);
        write_u64(&mut a.data, 72, amount + pot);
    });
    launch::machine(&mut env, |m| {
        m.jackpot_tokens = pot;
        m.jackpot_cost = 1_500_000_000;
    });
    let user = env.user();
    let owner = pubkey(&user.pubkey());
    let start = env.state::<Machine>(env.machine).on_air_ts;
    specials::set_time(&mut env, start);
    env.send(&[launch::advance_ix(&env)], &[]).unwrap();
    let mut states = env
        .state::<Machine>(env.machine)
        .onepct
        .map(|slot| slot.state);
    for (step, (op, amount, randomness)) in steps.into_iter().enumerate() {
        specials::set_time(
            &mut env,
            start + step as i64 * (params::SEASON_DURATION_SECONDS - 10) / 200,
        );
        let mandatory = [0, 51, 101, 151, 175].contains(&step);
        if mandatory || (op % 4 == 0 && step % 20 == 10) {
            let edition = if mandatory { 0 } else { (op / 4) % 4 };
            let (pull, _) = env.buy(&user, edition, 1).unwrap();
            let p = env.state::<Pull>(pull);
            let (flags, _) =
                math::specials::live_flags(&env.state::<Machine>(env.machine), p.price, env.now());
            let tier = if flags & LIVE_ONE_PCT != 0 {
                KIND_ONE_PCT
            } else if flags & LIVE_JACKPOT != 0 {
                KIND_JACKPOT
            } else {
                KIND_SILVER
            };
            let bytes = if mandatory {
                specials::find_random(p.seq, 0, 0, flags, false, tier)
            } else {
                randomness
            };
            let meta = env.fulfill(pull, bytes).unwrap();
            prop_assert!(events::<HitSkipped>(&meta).is_empty());
            prop_assert!(events::<CallbackSkipped>(&meta).is_empty());
            env.settle(pull, 0).unwrap();
        } else if op % 4 == 1 {
            let amount = amount % 1_000_000_000 + 1;
            let before = env.state::<Machine>(env.machine);
            env.donate_lamports(env.fee_in, amount);
            let collected = launch::collect(&mut env);
            let event = &events::<CreatorFeesCollected>(&collected)[0];
            prop_assert_eq!(
                (event.to_stock, event.to_burn, event.to_team),
                reference::creator_split(amount, reference::creator_regime(&before))
            );
            prop_assert_eq!(event.amount, event.to_stock + event.to_burn + event.to_team);
        } else {
            env.send(&[launch::advance_ix(&env)], &[]).unwrap();
        }
        let m = env.state::<Machine>(env.machine);
        for (old, new) in states.iter().zip(m.onepct.iter()) {
            prop_assert!(new.state >= *old);
        }
        states = m.onepct.map(|slot| slot.state);
        env.check_invariants();
    }
    prop_assert_eq!(states, [ONEPCT_PULLED; 4]);
    prop_assert_eq!(env.state::<Machine>(env.machine).jackpot_tokens, 0);
    let end = env.state::<Machine>(env.machine).end_ts;
    specials::set_time(&mut env, end);
    env.send(&[launch::advance_ix(&env)], &[]).unwrap();
    prop_assert_eq!(env.state::<Machine>(env.machine).phase, PHASE_BUYS_CLOSED);
    launch::config(&mut env, |c| {
        c.admin_paused = 31;
        c.guardian_paused = 31;
        c.disabled_roles = 255;
    });
    env.donate_lamports(env.fee_in, 12345);
    let ended = launch::collect(&mut env);
    prop_assert_eq!(
        (
            events::<CreatorFeesCollected>(&ended)[0].to_stock,
            events::<CreatorFeesCollected>(&ended)[0].to_team
        ),
        (0, 12345)
    );
    loop {
        let owned = cards(&env, owner);
        let Some(card) = owned.last() else {
            break;
        };
        let bag = if card.mint == coin.mint {
            &coin
        } else if card.mint == stock.mint {
            &stock
        } else {
            &dust
        };
        env.send(
            &[
                env.create_ata_ix(owner, bag, owner),
                env.redeem_ix(owner, bag, (owned.len() - 1) as u16, card.amount),
            ],
            &[&user],
        )
        .unwrap();
        env.check_invariants();
    }
    let depositor = pubkey(&env.authority.pubkey());
    env.send(&[env.create_ata_ix(depositor, &dust, depositor)], &[])
        .unwrap();
    while env.state::<Deck>(env.deck).len > 0 {
        let length = env.state::<Deck>(env.deck).len;
        env.send(&[env.take_back_ix(depositor, &dust, length - 1, 1000)], &[])
            .unwrap();
    }
    env.send(&[team_ix(&env)], &[]).unwrap();
    env.check_invariants();
    prop_assert_eq!(env.state::<Binder>(specials::binder(owner)).len, 0);
    prop_assert_eq!(env.state::<MintLedger>(ledger).accounted, 0);
    env.send(&[close_ix(&env, &coin), close_ix(&env, &dust)], &[])
        .unwrap();
    prop_assert!(env.closed(ledger));
    env.check_invariants();
    let m = env.state::<Machine>(env.machine);
    prop_assert_eq!(m.team_sol, 0);
    // D18 ends this launch campaign at BuysClosed. Remaining stock and pack
    // burn SOL retain their tracked claims for the separately shipped upgrade.
    prop_assert_eq!(m.phase, PHASE_BUYS_CLOSED);
    Ok(())
}

#[test]
fn p4_launch_season_200_steps_preserves_claims_and_exits() {
    property::parallel(
        file!(),
        || prop::collection::vec((any::<u8>(), any::<u64>(), any::<[u8; 32]>()), 200),
        season,
    );
}
