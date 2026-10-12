mod common;
#[path = "common/mycards.rs"]
mod mycards;
#[path = "common/property.rs"]
mod property;
#[path = "common/reference.rs"]
mod reference;
use common::{exec_cases::*, *};
use onepercent::{params, state::Machine};
use proptest::prelude::*;
use solana_signer::Signer;

fn run(
    (kind, trending, graduated, steps): (u8, bool, bool, Vec<(u8, u16)>),
) -> proptest::test_runner::TestCaseResult {
    let class = if kind <= 2 {
        if trending {
            2
        } else {
            1
        }
    } else {
        0
    };
    let mut f = ExecFixture::new(kind, class, graduated, false);
    let feed_bag = f.e.new_pump_mint(false);
    let market = pubkey(&f.market.pubkey());
    f.e.token_account(market, &feed_bag, 1_000_000);
    let signer = pubkey(&f.signer.pubkey());
    let cards_bag = mycards::seed_exec_cards(&mut f.e, signer);
    if kind != 2 {
        f.e.token_account(signer, &f.bag, 0);
    }
    for (op, arg) in steps {
        f.e.warp(20 + i64::from(arg % 3));
        f.refresh();
        let value = if kind == 2 {
            1_000_000
        } else {
            1_000_000 + u64::from(arg)
        };
        let minimum = expected(&f, value).1;
        prop_assert!(minimum > 0);
        let donation = u64::from(arg);
        if op == 2 {
            f.e.donate_lamports(f.e.machine, donation);
            f.e.donate_tokens(f.vault, donation);
        }
        let before = f.e.state::<Machine>(f.e.machine);
        let delta = if op == 1 {
            minimum - 1
        } else {
            minimum + u64::from(arg)
        };
        let mut tx = f.transaction(value, delta);
        let rejected = match op {
            1 => Some("SlippageExceeded"),
            3 => {
                tx.insert(1, instruction("ping", vec![], &[]));
                Some("ExecPairing")
            }
            4 => {
                tx.pop();
                Some("ExecPairing")
            }
            5 => {
                tx.push(f.end());
                Some("ExecPairing")
            }
            6 => {
                tx[0] = cpi(f.begin(value));
                Some("NotTopLevel")
            }
            7 => {
                tx.insert(1, cpi(f.end()));
                Some("NotTopLevel")
            }
            8 => {
                let mut feed = f.e.feed_ixs(market, &[(&feed_bag, 1)], 0);
                let inner = feed.pop().unwrap();
                tx.splice(1..1, feed);
                tx.insert(tx.len() - 1, cpi(inner));
                Some("ExecInFlight")
            }
            9 => {
                tx.insert(1, f.begin(value));
                Some("ExecPairing")
            }
            10 => {
                tx.insert(1, cpi(f.e.redeem_ix(signer, &f.bag, 0, 1)));
                Some("ExecInFlight")
            }
            11 => {
                tx.insert(1, cpi(f.e.take_back_ix(signer, &f.bag, 0, 1)));
                Some("ExecInFlight")
            }
            12 => {
                let mut sale = mycards::sb_ixs(&f.e, signer, &cards_bag, &[0], 50_000_000);
                let inner = sale.pop().unwrap();
                // The signed message remains at index zero even inside the swap slot.
                tx.insert(0, sale.remove(0));
                tx.insert(2, cpi(inner));
                Some("ExecInFlight")
            }
            13 => {
                tx.insert(1, cpi(mycards::fb_ix(&f.e, signer, &[1])));
                Some("ExecInFlight")
            }
            14 => {
                tx.insert(1, cpi(f.e.buy_ix(signer, 0, 0, 0, None)));
                Some("ExecInFlight")
            }
            _ => None,
        };
        if let Some(error) = rejected {
            f.reject(&tx, error);
        } else {
            let receipt = f.send(&tx).unwrap();
            prop_assert!(
                common::pack_cases::events::<onepercent::events::ExecEnded>(&receipt)[0].delta
                    >= minimum
            );
            check_success(&f, &before, value, delta);
        }
        prop_assert_eq!(f.e.state::<Machine>(f.e.machine).exec.kind, 0);
    }
    Ok(())
}
#[test]
fn ex1_atomic_transactions_conserve_tokens_sol_book_caps_and_spacing() {
    property::parallel(
        file!(),
        || {
            (
                1u8..=4,
                any::<bool>(),
                any::<bool>(),
                prop::collection::vec((0u8..15, any::<u16>()), 200),
            )
        },
        run,
    );
}
#[test]
fn ex1_mycards_controls_succeed_without_an_exec_record() {
    for feed in [false, true] {
        let mut f = ExecFixture::new(1, 1, false, false);
        let owner = pubkey(&f.signer.pubkey());
        let bag = mycards::seed_exec_cards(&mut f.e, owner);
        let ixs = if feed {
            vec![mycards::fb_ix(&f.e, owner, &[1])]
        } else {
            mycards::sb_ixs(&f.e, owner, &bag, &[0], 50_000_000)
        };
        f.e.send(&ixs, &[&f.signer]).unwrap();
        f.e.check_invariants();
    }
}

#[test]
fn exec_independent_math_extremes() {
    use onepercent::math::exec::*;
    property::parallel_named(
        file!(),
        concat!(file!(), ".math"),
        || {
            (
                any::<u64>(),
                any::<u64>(),
                any::<u64>(),
                any::<i128>(),
                0u8..=18,
            )
        },
        |(value, base, quote, virtual_quote, decimals)| {
            prop_assert_eq!(
                removed_book(value, base, quote).ok(),
                reference::exec_book(value, base, quote)
            );
            prop_assert_eq!(
                stock_hourly_cap(base, quote),
                reference::exec_cap(base, quote)
            );
            if let Some(effective) = i128::from(quote)
                .checked_add(virtual_quote)
                .filter(|v| *v > 0)
            {
                let pool = PoolReserves {
                    base,
                    quote,
                    quote_eff: effective as u128,
                };
                for sell in [false, true] {
                    let actual = if sell {
                        pool_sell(value, pool, params::STOCK_TRENDING_MIN_OUT_SLIP_BPS)
                    } else {
                        pool_buy(value, pool, params::STOCK_TRENDING_MIN_OUT_SLIP_BPS)
                    };
                    prop_assert_eq!(
                        actual.ok().map(|q| (q.expected, q.min_out)),
                        reference::exec_pool(
                            value,
                            base,
                            quote,
                            virtual_quote,
                            params::STOCK_TRENDING_MIN_OUT_SLIP_BPS,
                            sell
                        )
                    );
                }
            }
            let token = Price {
                price: quote.max(1).min(i64::MAX as u64),
                exponent: -i32::from(decimals),
            };
            let sol = Price {
                price: base.max(1).min(i64::MAX as u64),
                exponent: -8,
            };
            prop_assert_eq!(
                major_buy(value, token, sol, decimals)
                    .ok()
                    .map(|q| (q.expected, q.min_out)),
                reference::exec_major(
                    value,
                    sol.price as i64,
                    sol.exponent,
                    token.price as i64,
                    token.exponent,
                    decimals,
                    false
                )
            );
            prop_assert_eq!(
                major_sell(value, token, sol, decimals)
                    .ok()
                    .map(|q| (q.expected, q.min_out)),
                reference::exec_major(
                    value,
                    sol.price as i64,
                    sol.exponent,
                    token.price as i64,
                    token.exponent,
                    decimals,
                    true
                )
            );
            for sqrt_price in [
                (u128::from(base) << 64) | u128::from(quote),
                u128::from(base),
                u128::from(quote) << 32,
            ] {
                prop_assert_eq!(
                    meteora_buy(value, sqrt_price, params::BURN_MIN_OUT_SLIP_BPS)
                        .ok()
                        .map(|q| (q.expected, q.min_out)),
                    reference::exec_meteora(value, sqrt_price, params::BURN_MIN_OUT_SLIP_BPS)
                );
            }
            Ok(())
        },
    );
}

#[test]
fn ex1_fee_collection_cannot_observe_transient_stock_book() {
    reject_fee_collection_inside_exec(2_500_000_000, 1_000_000_000, 1_000_000_000);
    property::parallel_named(
        file!(),
        concat!(file!(), ".creator_fees"),
        || (1u64..500_000_000, 1u64..2_000_000_000),
        |(margin, fees)| {
            let floor = params::STOCK_CREATOR_FEE_FLOOR_LAMPORTS;
            reject_fee_collection_inside_exec(floor + margin, margin + 1, fees);
            Ok(())
        },
    );
}
