mod common;
#[path = "common/reference.rs"]
mod reference;
use anchor_lang::prelude::Pubkey;
use common::{exec_cases::*, pack_cases::events, *};
use onepercent::{
    events::{ExecBegun, ExecEnded},
    params,
    state::{Machine, MintLedger},
};
use solana_signer::Signer;

fn min(f: &ExecFixture, value: u64) -> u64 {
    if f.kind <= 2 {
        if f.e.state::<Machine>(f.e.machine).buckets[0].class == 1 {
            reference::exec_major(
                value,
                10_901_000_000,
                -8,
                85_000_000,
                -8,
                f.bag.decimals,
                f.kind == 2,
            )
            .unwrap()
            .1
        } else {
            reference::exec_pool(
                value,
                500_000_000_000_000,
                400_000_000_000,
                -2_000_000_000,
                params::STOCK_TRENDING_MIN_OUT_SLIP_BPS,
                f.kind == 2,
            )
            .unwrap()
            .1
        }
    } else {
        let slip = if f.kind == 3 {
            params::BURN_MIN_OUT_SLIP_BPS
        } else {
            params::JACKPOT_MIN_OUT_SLIP_BPS
        };
        let sqrt_price = if f.oracles[1] == system() {
            128_794_468_968_736_475
        } else {
            125_545_362_027_818_175
        };
        reference::exec_meteora(value, sqrt_price, slip).unwrap().1
    }
}
fn clean(f: &ExecFixture) {
    assert!(bytemuck::bytes_of(&f.e.state::<Machine>(f.e.machine).exec)
        .iter()
        .all(|b| *b == 0));
}

#[test]
fn p3_prepared_buy_is_rechecked_after_draw_reveal_and_settlement() {
    let mut f = ExecFixture::new(1, 1, false, false);
    f.e.inject_deck(100);
    let buyer = f.e.user();
    let value = 1_000_000_000;
    let prepared = f.transaction(value, min(&f, value));
    let (pull, _) = f.e.buy(&buyer, 0, 2).unwrap();
    f.reject(&prepared, "StockBuyPullInFlight");
    f.e.fulfill(pull, [1; 32]).unwrap();
    assert_eq!(f.e.state::<Machine>(f.e.machine).pending_pulls, 0);
    assert_eq!(f.e.state::<Machine>(f.e.machine).unsettled_reveals, 1);
    f.reject(&prepared, "StockBuyPullInFlight");
    f.e.settle(pull, 0).unwrap();
    assert_eq!(f.e.state::<Machine>(f.e.machine).unsettled_reveals, 1);
    f.e.settle(pull, 0).unwrap();
    f.e.settle(pull, 1).unwrap();
    assert_eq!(f.e.state::<Machine>(f.e.machine).unsettled_reveals, 0);
    f.reject(&prepared, "StockBuyRevealDelay");
    f.e.warp(params::POST_REVEAL_BUY_DELAY);
    f.refresh();
    f.send(&prepared).unwrap();
}

#[test]
fn p3_sell_remains_available_during_all_stockbuy_blocks() {
    let mut f = ExecFixture::new(2, 2, false, false);
    let now = f.e.now();
    machine(&mut f.e, |m| {
        m.pending_pulls = 1;
        m.unsettled_reveals = 1;
        m.last_reveal_ts = now;
        m.bucket_history[0].listed_ts = now;
        m.sb_paid_hour = u64::MAX;
    });
    let value = 1_000_000;
    f.execute(value, min(&f, value)).unwrap();
}
#[test]
fn t12_01_stockbuy_major_happy() {
    for mainnet in [false, true] {
        let mut f = ExecFixture::new(1, 1, false, mainnet);
        let value = 5_000_000_000;
        let delta = min(&f, value);
        let before = f.e.state::<Machine>(f.e.machine);
        let ledger = pda(&[b"ledger", f.bag.mint.as_ref()]).0;
        let tx = f.execute(value, delta).unwrap();
        let after = f.e.state::<Machine>(f.e.machine);
        assert_eq!(
            (after.buckets[0].amount, after.buckets[0].cost),
            (
                before.buckets[0].amount + delta,
                before.buckets[0].cost + value
            )
        );
        assert_eq!(
            f.e.state::<MintLedger>(ledger).accounted,
            after.buckets[0].amount
        );
        assert_eq!(after.stock_sol, before.stock_sol - value);
        assert_eq!(after.stock_bought_hour, value);
        assert_eq!(after.last_stock_trade_ts, f.e.now());
        assert_eq!(events::<ExecBegun>(&tx)[0].min_out, delta);
        assert_eq!(events::<ExecEnded>(&tx)[0].delta, delta);
        clean(&f);
        f.e.check_invariants();
    }
}
#[test]
fn t12_02_stockbuy_trending_pool() {
    let mut f = ExecFixture::new(1, 2, false, false);
    let delta = min(&f, 1_500_000_000);
    assert_eq!(delta, 1_835_427_194_642);
    f.execute(1_500_000_000, delta).unwrap();
    clean(&f);
    for case in 0..8 {
        let mut f = ExecFixture::new(1, 2, false, false);
        let pool = f.oracles[0];
        match case {
            0 => {
                let fake = Pubkey::new_unique();
                let account = f.e.account(pool);
                f.e.put(fake, account);
                f.oracles[0] = fake;
                machine(&mut f.e, |m| m.buckets[0].oracle = fake);
            }
            1 => {
                f.e.mutate(pool, |a| write_key(&mut a.data, 43, &Pubkey::new_unique()))
            }
            2 => {
                f.e.mutate(pool, |a| write_key(&mut a.data, 75, &Pubkey::new_unique()))
            }
            3 => f.e.mutate(pool, |a| a.data[243] = 1),
            4 => {
                f.e.mutate(pool, |a| write_key(&mut a.data, 139, &Pubkey::new_unique()))
            }
            5 => f.e.mutate(pool, |a| {
                a.data[245..261].copy_from_slice(&(-400_000_000_000i128).to_le_bytes())
            }),
            6 => f.e.mutate(f.oracles[1], |a| {
                write_key(&mut a.data, 0, &Pubkey::new_unique())
            }),
            _ => f.e.mutate(f.oracles[2], |a| a.owner = addr(&system())),
        }
        let tx = f.transaction(1_000_000_000, 1_000_000_000_000);
        f.reject(&tx, "OracleInvalid");
    }
}
#[test]
fn t12_03_stocksell_major_and_trending() {
    for class in [1, 2] {
        for all in [false, true] {
            let mut f = ExecFixture::new(2, class, false, false);
            if all {
                machine(&mut f.e, |m| m.buckets[0].cost = 1_000_000_000);
            }
            let before = f.e.state::<Machine>(f.e.machine);
            let value = if all {
                before.buckets[0].amount
            } else {
                1_000_000_000_000
            };
            let delta = min(&f, value);
            let book =
                reference::exec_book(value, before.buckets[0].amount, before.buckets[0].cost)
                    .unwrap();
            let signer = pubkey(&f.signer.pubkey());
            let balance = f.e.account(signer).lamports;
            let rent = f.e.account(f.sol_dest).lamports;
            f.execute(value, delta).unwrap();
            let after = f.e.state::<Machine>(f.e.machine);
            assert_eq!(
                (after.buckets[0].amount, after.buckets[0].cost),
                (
                    before.buckets[0].amount - value,
                    before.buckets[0].cost - book
                )
            );
            assert_eq!(after.stock_sol, before.stock_sol + delta);
            assert_eq!(f.e.account(signer).lamports, balance + rent);
            assert!(f.e.closed(f.sol_dest));
            clean(&f);
            f.e.check_invariants();
        }
    }
}
#[test]
fn t12_04_burn_and_jackpot_dbc_and_damm() {
    for kind in [3, 4] {
        for graduated in [false, true] {
            let mut f = ExecFixture::new(kind, 0, graduated, false);
            let value = 50_000_000;
            let delta = min(&f, value);
            let supply = read_u64(&f.e.account(f.bag.mint).data, 36);
            f.execute(value, delta).unwrap();
            let m = f.e.state::<Machine>(f.e.machine);
            if kind == 3 {
                assert_eq!(m.burned_total, delta);
                assert_eq!(read_u64(&f.e.account(f.bag.mint).data, 36), supply - delta);
                assert_eq!(amount(&f.e, f.vault), 0);
            } else {
                assert_eq!((m.jackpot_tokens, m.jackpot_cost), (delta, value));
                assert_eq!(amount(&f.e, f.vault), delta);
            }
            clean(&f);
        }
    }
    let mut f = ExecFixture::new(4, 0, true, false);
    f.e.mutate(f.oracles[0], |a| a.data[305] = 0);
    let tx = f.transaction(50_000_000, 10_000_000_000);
    f.reject(&tx, "AccountMismatch");
}
#[test]
fn t12_05_pairing_rejections() {
    for case in 0..9 {
        let mut f = ExecFixture::new(1, 1, false, false);
        let mut tx = f.transaction(1_000_000_000, min(&f, 1_000_000_000));
        match case {
            0 => {
                tx.pop();
            }
            1 => tx.push(f.end()),
            2 => tx.last_mut().unwrap().data[8] = 2,
            3..=5 => {
                let name = ["ping", "settle", "redeem"][(case - 3) as usize];
                tx.insert(0, instruction(name, vec![], &[]));
            }
            6 => tx.insert(1, f.begin(1_000_000_000)),
            7 => tx = vec![f.end()],
            _ => {
                let end = tx.pop().unwrap();
                tx.insert(0, end);
            }
        }
        // Earlier malformed program instructions would fail before begin, so place extras after it.
        if (3..=5).contains(&case) {
            let extra = tx.remove(0);
            tx.insert(1, extra);
        }
        f.reject(&tx, "ExecPairing");
        clean(&f);
    }
}
#[test]
fn t12_06_not_top_level_and_double_credit() {
    for begin in [true, false] {
        let mut f = ExecFixture::new(1, 1, false, false);
        let inner = if begin { f.begin(1) } else { f.end() };
        f.reject(&[cpi(inner)], "NotTopLevel");
    }
    let mut f = ExecFixture::new(1, 1, false, false);
    let user = f.e.user();
    let bag = f.bag.clone();
    let user_key = pubkey(&user.pubkey());
    f.e.token_account(user_key, &bag, 1000);
    let mut feed = f.e.feed_ixs(user_key, &[(&bag, 1000)], 0);
    let inner = feed.pop().unwrap();
    let before = f.e.snapshot();
    let mut tx = vec![f.begin(1_000_000_000)];
    tx.extend(feed);
    tx.push(cpi(inner));
    tx.push(f.end());
    let result = f.e.send(&tx, &[&f.signer, &user]);
    assert_error(result, "ExecInFlight");
    for at in [
        f.e.machine,
        f.e.deck,
        pda(&[b"ledger", f.bag.mint.as_ref()]).0,
        f.vault,
    ] {
        assert_eq!(f.e.account(at), before[&at]);
    }
    clean(&f);
}
#[test]
fn t12_07_slack_rule() {
    for kind in [1, 3, 4] {
        let mut f = ExecFixture::new(kind, if kind == 1 { 1 } else { 0 }, false, false);
        f.e.donate_tokens(f.vault, 777);
        let delta = min(&f, 50_000_000);
        let old = f.e.state::<Machine>(f.e.machine).buckets[0].amount;
        f.execute(50_000_000, delta).unwrap();
        let m = f.e.state::<Machine>(f.e.machine);
        let credited = match kind {
            1 => m.buckets[0].amount - old,
            3 => m.burned_total,
            _ => m.jackpot_tokens,
        };
        assert_eq!(credited, delta);
        let mut f = ExecFixture::new(kind, if kind == 1 { 1 } else { 0 }, false, false);
        let current = amount(&f.e, f.vault);
        edit::<MintLedger>(&mut f.e, pda(&[b"ledger", f.bag.mint.as_ref()]).0, |l| {
            l.accounted = current + 1
        });
        let tx = f.transaction(50_000_000, min(&f, 50_000_000));
        f.reject(&tx, "SlackShort");
    }
}
#[test]
fn t12_08_min_out_boundary() {
    for kind in 1..=4 {
        for below in [false, true] {
            let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, false);
            let value = 50_000_000;
            let delta = min(&f, value);
            let tx = f.transaction(value, delta - u64::from(below));
            if below {
                f.reject(&tx, "SlippageExceeded");
            } else {
                f.send(&tx).unwrap();
            }
            clean(&f);
        }
    }
}
#[test]
fn t12_09_pyth_rejections() {
    for target in 0..2 {
        for case in 0..9 {
            let mut f = ExecFixture::new(1, 1, false, false);
            let at = f.oracles[target];
            let now = f.e.now();
            f.e.mutate(at, |a| match case {
                0 => a.data[93..101].copy_from_slice(&(now - 61).to_le_bytes()),
                1 => {
                    let price = i64::from_le_bytes(a.data[73..81].try_into().unwrap());
                    write_u64(&mut a.data, 81, (price as u64 * 101).div_ceil(10_000));
                }
                2 => a.owner = addr(&system()),
                3 => a.data[0] ^= 1,
                4 => a.data[41] ^= 1,
                5 => a.data[40] = 0,
                6 => a.data[73..81].copy_from_slice(&0i64.to_le_bytes()),
                7 => a.data[73..81].copy_from_slice(&(-1i64).to_le_bytes()),
                _ => a.data[89..93].copy_from_slice(&(-19i32).to_le_bytes()),
            });
            let error = match case {
                0 => "OracleStale",
                1 => "OracleWide",
                _ => "OracleInvalid",
            };
            let tx = f.transaction(1_000_000_000, 126_323_352);
            f.reject(&tx, error);
        }
    }
}
#[test]
fn t12_10_spacing_tranche_caps() {
    for kind in 1..=4 {
        let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, false);
        let now = f.e.now();
        machine(&mut f.e, |m| {
            m.last_stock_trade_ts = now - 19;
            m.last_burn_ts = now - 19;
            m.last_jackpot_buy_ts = now - 19;
        });
        let tx = f.transaction(50_000_000, 1_000_000_000);
        f.reject(&tx, "TooSoon");
    }
    for (kind, class, value) in [
        (1, 1, 5_000_000_001),
        (1, 2, 1_500_000_001),
        (3, 0, 75_000_001),
        (4, 0, 300_000_001),
    ] {
        let mut f = ExecFixture::new(kind, class, false, false);
        let tx = f.transaction(value, 1);
        f.reject(&tx, "TrancheTooLarge");
    }
    for (last, current, expected) in [
        (0, 0, 30_000_000_000),
        (10_000_000_000, 22_000_000_000, 44_000_000_000),
        (22_000_000_000, 10_000_000_000, 44_000_000_000),
    ] {
        let mut f = ExecFixture::new(1, 1, false, false);
        machine(&mut f.e, |m| {
            m.hit_out_last_hour = last;
            m.hit_out_this_hour = current;
            m.stock_bought_hour = expected;
            m.sb_paid_hour = 17;
            m.bucket_history[0].sb_inflow_hour = 19;
        });
        let tx = f.transaction(1_000_000_000, min(&f, 1_000_000_000));
        f.reject(&tx, "HourlyCapReached");
        f.e.warp(3600);
        f.refresh();
        f.execute(1_000_000_000, min(&f, 1_000_000_000)).unwrap();
        let after = f.e.state::<Machine>(f.e.machine);
        assert_eq!(after.sb_paid_prev_hour, 17);
        assert_eq!(after.bucket_history[0].sb_inflow_prev_hour, 19);
        assert_eq!(
            f.e.state::<Machine>(f.e.machine).stock_bought_hour,
            1_000_000_000
        );
    }
    for kind in [1, 2] {
        let mut f = ExecFixture::new(kind, 2, false, false);
        machine(&mut f.e, |m| {
            m.buckets[0].trend_bought_hour = 10_000_000_000;
            m.buckets[0].trend_sold_hour = 10_000_000_000;
        });
        let tx = f.transaction(
            if kind == 1 {
                1_000_000_000
            } else {
                1_000_000_000_000
            },
            1,
        );
        f.reject(&tx, "HourlyCapReached");
    }
    for excess in [false, true] {
        let mut f = ExecFixture::new(1, 1, false, false);
        machine(&mut f.e, |m| {
            m.buckets[0].cap = m.buckets[0].cost + 1_000_000_000 - u64::from(excess)
        });
        let tx = f.transaction(1_000_000_000, min(&f, 1_000_000_000));
        if excess {
            f.reject(&tx, "BucketCapExceeded");
        } else {
            f.send(&tx).unwrap();
        }
    }
    for class in [1, 2] {
        let mut f = ExecFixture::new(2, class, false, false);
        f.e.inject_phase(4);
        machine(&mut f.e, |m| m.stock_sold_hour = 30_000_000_000);
        let value = 1_000_000_000_000;
        let tx = f.transaction(value, min(&f, value));
        if class == 1 {
            f.send(&tx).unwrap();
        } else {
            f.reject(&tx, "HourlyCapReached");
        }
    }
    for excess in [false, true] {
        let mut f = ExecFixture::new(1, 2, false, false);
        machine(&mut f.e, |m| {
            m.stock_sol = 63_333_333_334 - u64::from(excess);
        });
        let tx = f.transaction(1_000_000_000, min(&f, 1_000_000_000));
        if excess {
            f.reject(&tx, "TrendingShareExceeded");
        } else {
            f.send(&tx).unwrap();
        }
    }
}
#[test]
fn t12_11_never_sells_reserved() {
    for excess in [false, true] {
        let mut f = ExecFixture::new(2, 1, false, false);
        machine(&mut f.e, |m| {
            m.buckets[0].reserved = 9_000_000_000 + u64::from(excess)
        });
        let value = 1_000_000_000_000;
        let tx = f.transaction(value, min(&f, value));
        if excess {
            f.reject(&tx, "ReservedCapacity");
        } else {
            f.send(&tx).unwrap();
        }
    }
}
#[test]
fn t12_12_roles_pauses_phases() {
    for kind in 1..=4 {
        for gate in 0..3 {
            let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, false);
            config(&mut f.e, |c| match gate {
                0 => {
                    c.keeper = Pubkey::new_unique();
                    c.executor = Pubkey::new_unique();
                }
                1 => c.disabled_roles = 255,
                _ => {
                    c.guardian_paused = if kind <= 2 {
                        params::PAUSE_BITS_STOCK_BUY
                    } else {
                        params::PAUSE_BITS_BURN
                    }
                }
            });
            let tx = f.transaction(50_000_000, 1);
            f.reject(&tx, ["Unauthorized", "RoleDisabled", "Paused"][gate]);
        }
        for phase in 0..=6 {
            let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, false);
            f.e.inject_phase(phase);
            let permitted = match kind {
                1 => [2, 3].contains(&phase),
                2 => [3, 4].contains(&phase),
                3 => (2..6).contains(&phase),
                _ => phase == 3,
            };
            let value = 50_000_000;
            let tx = f.transaction(value, min(&f, value));
            if permitted {
                f.send(&tx).unwrap();
            } else {
                f.reject(&tx, "WrongPhase");
            }
        }
    }
    for kind in [1, 4] {
        let mut f = ExecFixture::new(kind, if kind == 1 { 1 } else { 0 }, false, false);
        let now = f.e.now();
        machine(&mut f.e, |m| m.end_ts = now);
        let tx = f.transaction(50_000_000, 1);
        f.reject(&tx, "SeasonOver");
    }
}
#[test]
fn t12_13_bucket_states() {
    for kind in [1, 2] {
        let mut f = ExecFixture::new(kind, 1, false, false);
        machine(&mut f.e, |m| m.buckets[0].enabled = 0);
        let value = 50_000_000;
        let tx = f.transaction(value, min(&f, value));
        if kind == 1 {
            f.reject(&tx, "BucketDisabled");
        } else {
            f.send(&tx).unwrap();
        }
    }
}
#[test]
fn t12_14_src_and_sol_dest_checks() {
    for case in 0..5 {
        let mut f = ExecFixture::new(1, 1, false, false);
        match case {
            0 => {
                let fake = Pubkey::new_unique();
                f.e.put(fake, f.e.account(f.source));
                f.source = fake;
            }
            1 => f.e.mutate(f.source, |a| write_u32(&mut a.data, 109, 0)),
            2 => f.e.mutate(f.source, |a| {
                write_key(&mut a.data, 32, &Pubkey::new_unique())
            }),
            3 => f.e.mutate(f.source, |a| a.owner = addr(&token2022())),
            _ => {
                let fake = Pubkey::new_unique();
                f.e.put(fake, f.e.account(f.vault));
                f.vault = fake;
            }
        }
        let tx = f.transaction(50_000_000, 1);
        f.reject(
            &tx,
            if case == 4 {
                "VaultMismatch"
            } else {
                "AccountMismatch"
            },
        );
    }
    let mut f = ExecFixture::new(2, 1, false, false);
    let auth = f.e.vault_auth;
    native(&mut f.e, auth, 777);
    let signer = pubkey(&f.signer.pubkey());
    let balance = f.e.account(signer).lamports;
    let before = f.e.state::<Machine>(f.e.machine).stock_sol;
    let value = 50_000_000;
    let delta = min(&f, value);
    let rent = f.e.rent_min(165);
    f.execute(value, delta).unwrap();
    assert_eq!(f.e.state::<Machine>(f.e.machine).stock_sol, before + delta);
    assert_eq!(f.e.account(signer).lamports, balance + rent + 777);
    let mut f = ExecFixture::new(2, 1, false, false);
    let mut tx = vec![f.begin(1), f.end()];
    tx[0].accounts[8].is_writable = false;
    tx[1].accounts[7].is_writable = false;
    // No swap or ATA setup can promote sol_dest to writable in the compiled message.
    assert_eq!(tx.len(), 2);
    assert!(tx
        .iter()
        .flat_map(|ix| &ix.accounts)
        .filter(|meta| meta.pubkey == addr(&f.sol_dest))
        .all(|meta| !meta.is_writable));
    let before = f.e.snapshot();
    let failure = f
        .send(&tx)
        .expect_err("readonly StockSell destination must fail");
    assert_eq!(
        format!("{:?}", failure.err),
        format!(
            "InstructionError(0, Custom({}))",
            u32::from(onepercent::errors::MachineError::AccountMismatch)
        )
    );
    assert!(failure
        .meta
        .logs
        .iter()
        .any(|line| line.contains("Instruction: ExecBegin")));
    assert!(!failure
        .meta
        .logs
        .iter()
        .any(|line| line.contains("Instruction: ExecEnd")));
    for (at, account) in before {
        if at != pubkey(&f.e.authority.pubkey()) {
            assert_eq!(
                f.e.account(at),
                account,
                "readonly destination rejection {at}"
            );
        }
    }
    clean(&f);
    for kind in [1, 3, 4] {
        let f = ExecFixture::new(kind, if kind == 1 { 1 } else { 0 }, false, false);
        assert!(!f.begin(1).accounts[8].is_writable);
        assert!(!f.end().accounts[7].is_writable);
    }
}
#[test]
fn t12_15_machine_donation_not_stock() {
    for kind in 1..=4 {
        let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, false);
        let before = f.e.state::<Machine>(f.e.machine);
        f.e.donate_lamports(f.e.machine, 777_777);
        let value = 50_000_000;
        let delta = min(&f, value);
        f.execute(value, delta).unwrap();
        let after = f.e.state::<Machine>(f.e.machine);
        assert_eq!(
            after.stock_sol,
            match kind {
                1 => before.stock_sol - value,
                2 => before.stock_sol + delta,
                _ => before.stock_sol,
            }
        );
    }
}
#[test]
fn t12_16_exec_report() {
    use solana_compute_budget_interface::ComputeBudgetInstruction;
    use solana_message::{AddressLookupTableAccount, VersionedMessage};
    for mainnet in [false, true] {
        for (kind, class, graduated) in [
            (1, 1, false),
            (1, 2, false),
            (2, 1, false),
            (2, 2, false),
            (3, 0, false),
            (3, 0, true),
            (4, 0, false),
            (4, 0, true),
        ] {
            let mut f = ExecFixture::new(kind, class, graduated, mainnet);
            let value = 50_000_000;
            let mut ixs = vec![
                ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
                ComputeBudgetInstruction::set_compute_unit_price(1),
            ];
            ixs.extend(f.transaction(value, min(&f, value)));
            let report = f.send(&ixs).unwrap();
            let payer = f.signer.pubkey();
            let source_bag = if kind == 2 {
                f.bag.clone()
            } else {
                native_bag()
            };
            let mut pair = vec![
                ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
                ComputeBudgetInstruction::set_compute_unit_price(1),
                f.e.create_ata_ix(pubkey(&payer), &source_bag, pubkey(&payer)),
            ];
            if kind == 2 {
                pair.push(f.e.create_ata_ix(f.e.vault_auth, &native_bag(), pubkey(&payer)));
            }
            pair.extend([f.begin(value), f.end()]);
            // Size assumes the frozen protocol LUT contains every non-signer
            // account of these fixed exec and ATA-preparation instructions.
            // Route-only swap accounts and all swap instructions are excluded.
            // The validator e2e creates and freezes a real table for this layout.
            let keys: std::collections::BTreeSet<_> = pair
                .iter()
                .flat_map(|i| i.accounts.iter())
                .filter(|m| !m.is_signer)
                .map(|m| m.pubkey)
                .collect();
            let lookup = AddressLookupTableAccount {
                key: addr(&Pubkey::new_unique()),
                addresses: keys.into_iter().collect(),
            };
            let message = solana_message::v0::Message::try_compile(
                &payer,
                &pair,
                &[lookup],
                f.e.svm.latest_blockhash(),
            )
            .unwrap();
            let bytes = 1 + 64 + VersionedMessage::V0(message).serialize().len();
            assert!(bytes <= 1232);
            let prefix = format!("Program {} consumed ", onepercent::ID);
            let handlers: Vec<_> = report
                .logs
                .iter()
                .filter_map(|line| line.strip_prefix(&prefix))
                .filter_map(|line| line.split_whitespace().next())
                .map(|value| value.parse::<u64>().unwrap())
                .collect();
            assert_eq!(handlers.len(), 2);
            println!("exec kind={kind} class={class} graduated={graduated} mainnet={mainnet} begin_cu={} end_cu={} cu={} pair_bytes={bytes} jupiter_bytes={} lut_scope=fixed_exec_and_ata_accounts_without_swap",handlers[0],handlers[1],report.compute_units_consumed,1232-bytes);
            clean(&f);
        }
    }
}
#[test]
fn t12_17_end_bindings_and_sell_sources() {
    for kind in [1, 2, 3, 4] {
        let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, false);
        let fake = Pubkey::new_unique();
        f.e.put(fake, f.e.account(f.vault));
        let mut tx = f.transaction(50_000_000, min(&f, 50_000_000));
        tx.last_mut().unwrap().accounts[5].pubkey = addr(&fake);
        f.reject(&tx, "VaultMismatch");
    }
    for case in 0..7 {
        let mut f = ExecFixture::new(2, 1, false, false);
        match case {
            0 => {
                let fake = Pubkey::new_unique();
                f.e.put(fake, f.e.account(f.sol_dest));
                f.sol_dest = fake;
            }
            1 => f.e.mutate(f.sol_dest, |a| {
                write_key(&mut a.data, 0, &Pubkey::new_unique())
            }),
            2 => f.e.mutate(f.sol_dest, |a| {
                write_key(&mut a.data, 32, &Pubkey::new_unique())
            }),
            3 => f.e.mutate(f.sol_dest, |a| write_u32(&mut a.data, 109, 0)),
            4 => {
                let fake = Pubkey::new_unique();
                f.e.put(fake, f.e.account(f.source));
                f.source = fake;
            }
            5 => f.e.mutate(f.source, |a| {
                write_key(&mut a.data, 32, &Pubkey::new_unique())
            }),
            _ => f.e.mutate(f.source, |a| {
                write_key(&mut a.data, 0, &Pubkey::new_unique())
            }),
        }
        let tx = f.transaction(50_000_000, min(&f, 50_000_000));
        f.reject(&tx, "AccountMismatch");
    }
    let mut f = ExecFixture::new(2, 1, false, false);
    let fake = Pubkey::new_unique();
    f.e.put(fake, f.e.account(f.sol_dest));
    let mut tx = f.transaction(50_000_000, min(&f, 50_000_000));
    tx.last_mut().unwrap().accounts[7].pubkey = addr(&fake);
    f.reject(&tx, "AccountMismatch");
}
#[test]
fn t12_18_pyth_exact_boundaries_and_truncation() {
    let mut f = ExecFixture::new(1, 1, false, false);
    let now = f.e.now();
    for at in &f.oracles[..2] {
        f.e.mutate(*at, |a| {
            a.data[93..101].copy_from_slice(&(now - 60).to_le_bytes());
            let price = i64::from_le_bytes(a.data[73..81].try_into().unwrap());
            write_u64(&mut a.data, 81, price as u64 / 100);
        });
    }
    f.execute(1_000_000_000, min(&f, 1_000_000_000)).unwrap();
    for length in [0, 8, 40, 73, 101, 132] {
        let mut f = ExecFixture::new(1, 1, false, false);
        f.e.mutate(f.oracles[0], |a| a.data.truncate(length));
        let tx = f.transaction(1_000_000_000, min(&f, 1_000_000_000));
        f.reject(&tx, "OracleInvalid");
    }
}
#[test]
fn t12_19_reserved_granularity_uses_actual_delta_and_sell_keeps_it() {
    let mut f = ExecFixture::new(1, 1, false, false);
    let smallest =
        onepercent::math::tier_value(params::PACK_EDITIONS_PRICE_LAMPORTS[0], 1).unwrap();
    machine(&mut f.e, |m| {
        m.buckets[0].amount = 100;
        m.buckets[0].cost = 100 * smallest;
        m.buckets[0].reserved = smallest;
    });
    f.e.mutate(f.vault, |a| write_u64(&mut a.data, 64, 100));
    edit::<MintLedger>(&mut f.e, pda(&[b"ledger", f.bag.mint.as_ref()]).0, |l| {
        l.accounted = 100
    });
    f.e.mutate(f.oracles[0], |a| {
        a.data[73..81].copy_from_slice(&500_000_000_000_000i64.to_le_bytes())
    });
    let value = 2 * smallest;
    let delta = expected(&f, value).1;
    assert!(delta > 0);
    assert!(delta < 2);
    let tx = f.transaction(value, delta);
    f.reject(&tx, "ReservedCapacity");
    let mut f = ExecFixture::new(2, 1, false, false);
    machine(&mut f.e, |m| {
        m.buckets[0].amount = 100;
        m.buckets[0].cost = 100 * smallest - 1;
        m.buckets[0].reserved = smallest;
    });
    f.e.mutate(f.vault, |a| write_u64(&mut a.data, 64, 100));
    edit::<MintLedger>(&mut f.e, pda(&[b"ledger", f.bag.mint.as_ref()]).0, |l| {
        l.accounted = 100
    });
    f.execute(1, min(&f, 1)).unwrap();
    let b = f.e.state::<Machine>(f.e.machine).buckets[0];
    assert!(u128::from(smallest) * u128::from(b.amount) >= u128::from(b.cost));
}
#[test]
fn t12_20_onepercent_reserve_and_absolute_tranches() {
    for kind in [3, 4] {
        for graduated in [false, true] {
            for above in [false, true] {
                let mut f = ExecFixture::new(kind, 0, graduated, false);
                let reserve_cap = if graduated {
                    if kind == 3 {
                        995_000_000
                    } else {
                        3_980_000_000
                    }
                } else if kind == 3 {
                    75_000_000
                } else {
                    300_000_000
                };
                let maximum = reserve_cap.min(if kind == 3 {
                    params::BURN_TRANCHE_MAX_LAMPORTS
                } else {
                    params::JACKPOT_TRANCHE_MAX_LAMPORTS
                });
                let value = maximum + u64::from(above);
                let tx = f.transaction(value, min(&f, value));
                if above {
                    f.reject(&tx, "TrancheTooLarge");
                } else {
                    f.send(&tx).unwrap();
                }
            }
        }
    }
    // Recorded reserves are authoritative even when vault balances include fees
    // or donations. A larger vault cannot increase the accepted tranche.
    for migrated in [false, true] {
        for kind in [3, 4] {
            let mut f = ExecFixture::new(kind, 0, migrated, false);
            let (pool, offset) = if migrated {
                (f.oracles[1], 688)
            } else {
                (f.oracles[0], 240)
            };
            f.e.mutate(pool, |a| write_u64(&mut a.data, offset, 20_000_000_000));
            let cap = if kind == 3 { 50_000_000 } else { 200_000_000 };
            let before = expected(&f, cap);
            f.e.donate_tokens(f.oracles[3], 1_000_000_000_000);
            f.e.donate_lamports(f.oracles[3], 1_000_000_000_000);
            assert_eq!(expected(&f, cap), before);
            let tx = f.transaction(cap + 1, min(&f, cap + 1));
            f.reject(&tx, "TrancheTooLarge");
            f.execute(cap, before.1).unwrap();
        }
    }
}

#[test]
fn t12_21_signer_source_donations_remain_unclaimed() {
    for kind in 1..=4 {
        let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, false);
        if kind == 2 {
            f.e.donate_tokens(f.source, 777);
        } else {
            let signer = pubkey(&f.signer.pubkey());
            native(&mut f.e, signer, 777);
        }
        let value = 50_000_000;
        let delta = min(&f, value);
        f.execute(value, delta).unwrap();
        assert_eq!(amount(&f.e, f.source), 777);
        clean(&f);
    }
}
#[test]
fn t12_22_redeem_and_take_back_inside_pair_are_locked() {
    use bytemuck::Zeroable;
    use onepercent::state::Card;
    for redeem in [false, true] {
        for compensate in [false, true] {
            let mut f = ExecFixture::new(1, 1, false, false);
            let signer = pubkey(&f.signer.pubkey());
            let card_amount = 10_000_000;
            f.e.token_account(signer, &f.bag, if redeem { 0 } else { card_amount });
            if redeem {
                let mut card = Card::zeroed();
                card.mint = f.bag.mint;
                card.amount = card_amount;
                f.e.binder(signer, &[card], 0, 1);
                f.e.donate_tokens(f.vault, card_amount);
                edit::<MintLedger>(
                    &mut f.e,
                    pda(&[b"ledger", f.bag.mint.as_ref()]).0,
                    |ledger| ledger.accounted += card_amount,
                );
            } else {
                f.e.feed(&f.signer, &f.bag, card_amount, 0).unwrap();
            }
            f.e.check_invariants();
            let value = 50_000_000;
            let minimum = min(&f, value);
            let delivered = minimum + if compensate { card_amount } else { 0 };
            let before = f.e.state::<Machine>(f.e.machine);
            let mut tx = f.transaction(value, delivered);
            let inner = if redeem {
                f.e.redeem_ix(signer, &f.bag, 0, card_amount)
            } else {
                f.e.take_back_ix(signer, &f.bag, 0, card_amount)
            };
            tx.insert(tx.len() - 1, cpi(inner));
            f.reject(&tx, "ExecInFlight");
            assert_eq!(
                f.e.state::<Machine>(f.e.machine).stock_sol,
                before.stock_sol
            );
            f.e.check_invariants();
            // The same exit remains executable outside the atomic pair.
            let exit = if redeem {
                f.e.redeem_ix(signer, &f.bag, 0, card_amount)
            } else {
                f.e.take_back_ix(signer, &f.bag, 0, card_amount)
            };
            f.send(&[exit]).unwrap();
            f.e.check_invariants();
        }
    }
}
#[test]
fn t12_23_buy_packs_inside_pair_is_locked() {
    for below in [false, true] {
        let mut f = ExecFixture::new(1, 1, false, false);
        f.e.inject_deck(100);
        let signer = pubkey(&f.signer.pubkey());
        // A second installation of the same test mock avoids recursive entry
        // into the queue program when buy_packs legitimately requests VRF.
        let wrapper = Pubkey::new_unique();
        let bytes = std::fs::read(Env::artifact("mock_vrf.so")).unwrap();
        let authority = pubkey(&f.e.authority.pubkey());
        f.e.install_program(wrapper, &bytes, authority);
        let value = 50_000_000;
        let minimum = min(&f, value);
        let before = f.e.state::<Machine>(f.e.machine);
        let mut tx = f.transaction(value, minimum - u64::from(below));
        let mut inner = cpi(f.e.buy_ix(signer, 0, 1, 0, None));
        inner.program_id = addr(&wrapper);
        tx.insert(tx.len() - 1, inner);
        f.reject(&tx, "ExecInFlight");
        assert_eq!(
            f.e.state::<Machine>(f.e.machine).pending_pulls,
            before.pending_pulls
        );
        f.e.check_invariants();
        f.send(&[f.e.buy_ix(signer, 0, 1, 0, None)]).unwrap();
        let pull = pda(&[b"pull", signer.as_ref(), &0u32.to_le_bytes()]).0;
        f.e.fulfill(pull, [1; 32]).unwrap();
        f.e.settle(pull, 0).unwrap();
        f.e.check_invariants();
    }
}

#[test]
fn t12_24_burn_hourly_cap_boundary_and_rollover() {
    let value = 50_000_000;
    for excess in [false, true] {
        let mut f = ExecFixture::new(3, 0, false, false);
        machine(&mut f.e, |m| {
            m.burn_paid_hour = params::BURN_HOURLY_MAX_LAMPORTS - value + u64::from(excess);
        });
        let tx = f.transaction(value, min(&f, value));
        if excess {
            f.reject(&tx, "HourlyCapReached");
        } else {
            f.send(&tx).unwrap();
            assert_eq!(
                f.e.state::<Machine>(f.e.machine).burn_paid_hour,
                params::BURN_HOURLY_MAX_LAMPORTS
            );
        }
        clean(&f);
    }
    let mut f = ExecFixture::new(3, 0, false, false);
    let previous_hour = f.e.state::<Machine>(f.e.machine).burn_hour_index;
    machine(&mut f.e, |m| {
        m.burn_paid_hour = params::BURN_HOURLY_MAX_LAMPORTS
    });
    let tx = f.transaction(value, min(&f, value));
    f.reject(&tx, "HourlyCapReached");
    f.e.warp(3600);
    f.refresh();
    f.execute(value, min(&f, value)).unwrap();
    let after = f.e.state::<Machine>(f.e.machine);
    assert_eq!(after.burn_hour_index, previous_hour + 1);
    assert_eq!(after.burn_paid_hour, value);
    clean(&f);
    f.e.check_invariants();
}

#[test]
fn t12_25_trending_hourly_counters_are_independent_and_reset_together() {
    for kind in [1, 2] {
        let value = if kind == 1 {
            1_000_000_000
        } else {
            1_000_000_000_000
        };
        let charge = 1_000_000_000;
        let cap = params::STOCK_TRENDING_HOURLY_MAX_LAMPORTS;

        // Exhausting the opposite direction does not spend this direction's budget.
        let mut f = ExecFixture::new(kind, 2, false, false);
        machine(&mut f.e, |m| {
            if kind == 1 {
                m.buckets[0].trend_sold_hour = cap;
            } else {
                m.buckets[0].trend_bought_hour = cap;
            }
        });
        f.execute(value, min(&f, value)).unwrap();
        let b = f.e.state::<Machine>(f.e.machine).buckets[0];
        assert_eq!(
            (b.trend_bought_hour, b.trend_sold_hour),
            if kind == 1 {
                (charge, cap)
            } else {
                (cap, charge)
            }
        );
        clean(&f);

        // Exactly the per-mint budget is accepted; one lamport more is refused.
        for excess in [false, true] {
            let mut f = ExecFixture::new(kind, 2, false, false);
            machine(&mut f.e, |m| {
                let used = cap - charge + u64::from(excess);
                if kind == 1 {
                    m.buckets[0].trend_bought_hour = used;
                } else {
                    m.buckets[0].trend_sold_hour = used;
                }
            });
            let tx = f.transaction(value, min(&f, value));
            if excess {
                f.reject(&tx, "HourlyCapReached");
            } else {
                f.send(&tx).unwrap();
                let b = f.e.state::<Machine>(f.e.machine).buckets[0];
                assert_eq!(
                    (b.trend_bought_hour, b.trend_sold_hour),
                    if kind == 1 { (cap, 0) } else { (0, cap) }
                );
            }
            clean(&f);
        }

        let mut f = ExecFixture::new(kind, 2, false, false);
        let previous_hour = f.e.state::<Machine>(f.e.machine).buckets[0].trend_hour_index;
        machine(&mut f.e, |m| {
            m.buckets[0].trend_bought_hour = cap;
            m.buckets[0].trend_sold_hour = cap;
        });
        f.e.warp(3600);
        f.refresh();
        f.execute(value, min(&f, value)).unwrap();
        let b = f.e.state::<Machine>(f.e.machine).buckets[0];
        assert_eq!(b.trend_hour_index, previous_hour + 1);
        assert_eq!(
            (b.trend_bought_hour, b.trend_sold_hour),
            if kind == 1 { (charge, 0) } else { (0, charge) }
        );
        clean(&f);
        f.e.check_invariants();
    }
}

#[test]
fn t12_26_stockbuy_refuses_unsafe_listed_mint_while_sell_down_remains_live() {
    for unsafe_field in 0..3 {
        let mut f = ExecFixture::new(1, 1, false, false);
        let tx = f.transaction(50_000_000, min(&f, 50_000_000));
        f.e.mutate(f.bag.mint, |account| match unsafe_field {
            0 => write_u32(&mut account.data, 0, 1),
            1 => write_u32(&mut account.data, 46, 1),
            _ => account.data[44] = u8::try_from(params::FEED_RULES_MAX_MINT_DECIMALS + 1).unwrap(),
        });
        f.reject(&tx, "MintNotSafe");
        clean(&f);
    }
    // StockSell still permits existing inventory to be sold down in this injected state.
    let mut f = ExecFixture::new(2, 1, false, false);
    f.e.mutate(f.bag.mint, |account| write_u32(&mut account.data, 0, 1));
    f.execute(50_000_000, min(&f, 50_000_000)).unwrap();
    clean(&f);
    f.e.check_invariants();
}

#[test]
fn t12_27_existing_exec_record_is_never_overwritten() {
    for kind in 1..=4 {
        let mut f = ExecFixture::new(kind, if kind <= 2 { 1 } else { 0 }, false, false);
        machine(&mut f.e, |state| {
            state.exec.kind = 1;
            state.exec.amount = 77;
            state.exec.min_out = 88;
        });
        let record = f.e.state::<Machine>(f.e.machine).exec;
        let tx = f.transaction(50_000_000, min(&f, 50_000_000));
        f.reject(&tx, "ExecInFlight");
        assert_eq!(
            bytemuck::bytes_of(&f.e.state::<Machine>(f.e.machine).exec),
            bytemuck::bytes_of(&record)
        );
    }
}

#[test]
fn t12_28_end_rechecks_signer_mint_vault_and_program_binding() {
    use onepercent::errors::MachineError;
    for case in 0..4 {
        let mut f = ExecFixture::new(1, 1, false, false);
        let mut tx = f.transaction(50_000_000, min(&f, 50_000_000));
        let end = tx.last_mut().unwrap();
        let expected_error = match case {
            0 => {
                end.accounts[0].pubkey = f.market.pubkey();
                MachineError::Unauthorized
            }
            1 => {
                let other = f.e.new_pump_mint(false);
                f.e.seed_bucket(1, &other, 1, 0, 0);
                end.accounts[3].pubkey = addr(&other.mint);
                end.accounts[4].pubkey = addr(&pda(&[b"ledger", other.mint.as_ref()]).0);
                end.accounts[5].pubkey =
                    addr(&ata(&f.e.vault_auth, &other.mint, &other.token_program));
                MachineError::BucketInvalid
            }
            2 => {
                let other = Pubkey::new_unique();
                f.e.put(other, f.e.account(f.vault));
                end.accounts[5].pubkey = addr(&other);
                MachineError::VaultMismatch
            }
            _ => {
                end.accounts[8].pubkey = addr(&token2022());
                // The substituted program changes the required vault ATA before
                // the later explicit mint-owner constraint is evaluated.
                MachineError::VaultMismatch
            }
        };
        let before = f.e.snapshot();
        let failure = f
            .send(&tx)
            .expect_err("mismatched completion must roll back the whole pair");
        assert_eq!(
            format!("{:?}", failure.err),
            format!(
                "InstructionError({}, Custom({}))",
                tx.len() - 1,
                u32::from(expected_error)
            )
        );
        for (at, account) in before {
            if at != pubkey(&f.e.authority.pubkey()) {
                assert_eq!(
                    f.e.account(at),
                    account,
                    "completion identity rollback {at}"
                );
            }
        }
        clean(&f);
    }
}

#[test]
fn t12_29_gross_stock_caps_accept_exact_boundary_and_reject_one_more() {
    for kind in [1, 2] {
        for (last, current, cap) in [
            (0, 0, 30_000_000_000),
            (10_000_000_000, 22_000_000_000, 44_000_000_000),
            (22_000_000_000, 10_000_000_000, 44_000_000_000),
        ] {
            for excess in [false, true] {
                let mut f = ExecFixture::new(kind, 1, false, false);
                let value = if kind == 1 {
                    1_000_000_000
                } else {
                    1_000_000_000_000
                };
                let charge = 1_000_000_000;
                machine(&mut f.e, |state| {
                    state.hit_out_last_hour = last;
                    state.hit_out_this_hour = current;
                    state.stock_bought_hour = cap;
                    state.stock_sold_hour = cap;
                    if kind == 1 {
                        state.stock_bought_hour = cap - charge + u64::from(excess);
                    } else {
                        state.stock_sold_hour = cap - charge + u64::from(excess);
                    }
                });
                let tx = f.transaction(value, min(&f, value));
                if excess {
                    f.reject(&tx, "HourlyCapReached");
                } else {
                    f.send(&tx).unwrap();
                    let after = f.e.state::<Machine>(f.e.machine);
                    assert_eq!((after.stock_bought_hour, after.stock_sold_hour), (cap, cap));
                    f.e.check_invariants();
                }
                clean(&f);
            }
        }
    }
}

#[test]
fn t12_30_meteora_canonical_reference_and_migration_are_required() {
    for migrated in [false, true] {
        for kind in [3, 4] {
            for case in 0..6 {
                let mut f = ExecFixture::new(kind, 0, migrated, false);
                let active = usize::from(migrated);
                match case {
                    0 => {
                        let other = Pubkey::new_unique();
                        f.e.put(other, f.e.account(f.oracles[active]));
                        f.oracles[active] = other;
                    }
                    1 => f.e.mutate(f.oracles[active], |a| a.owner = addr(&system())),
                    2 => f.e.mutate(f.oracles[0], |a| {
                        write_key(&mut a.data, 72, &Pubkey::new_unique())
                    }),
                    3 => f.e.mutate(f.oracles[active], |a| {
                        write_key(
                            &mut a.data,
                            if migrated { 168 } else { 136 },
                            &Pubkey::new_unique(),
                        )
                    }),
                    4 => f.e.mutate(f.oracles[3], |a| {
                        write_key(&mut a.data, 32, &Pubkey::new_unique())
                    }),
                    _ => {
                        f.e.mutate(f.oracles[0], |a| a.data[305] = u8::from(!migrated))
                    }
                }
                let tx = f.transaction(50_000_000, 1);
                f.reject(&tx, "AccountMismatch");
            }
            let mut f = ExecFixture::new(kind, 0, migrated, false);
            let value = 50_000_000;
            let delta = min(&f, value);
            if migrated {
                // Migration switches both the price and tranche reserve to DAMM.
                f.e.mutate(f.oracles[0], |a| {
                    a.data[240..248].fill(0);
                    a.data[280..296].fill(0);
                });
            }
            let receipt = f.execute(value, delta).unwrap();
            assert_eq!(events::<ExecBegun>(&receipt)[0].min_out, delta);
            clean(&f);
        }
    }
}

#[test]
fn t12_31_done_burn_is_refused_until_d18_upgrade() {
    for migrated in [false, true] {
        let mut f = ExecFixture::new(3, 0, migrated, false);
        f.e.inject_phase(6);
        let tx = f.transaction(50_000_000, min(&f, 50_000_000));
        f.reject(&tx, "WrongPhase");
        config(&mut f.e, |c| c.executor = Pubkey::default());
        f.reject(&tx, "Unauthorized");
        clean(&f);
    }
}

#[test]
fn t12_32_creator_fee_collection_inside_stockbuy_rolls_back() {
    reject_fee_collection_inside_exec(2_500_000_000, 1_000_000_000, 1_000_000_000);
}

#[test]
fn t12_33_claim_launch_fees_is_locked_before_any_venue_cpi() {
    use common::launch_fee_cases::{DbcClaimCase, PoolClaimCase};
    fn rejects(env: &mut Env, claim: solana_instruction::Instruction) {
        machine(env, |m| {
            m.exec.kind = onepercent::constants::EXEC_KIND_STOCK_BUY
        });
        let payer = pubkey(&env.authority.pubkey());
        let before = env.snapshot();
        let absent: Vec<_> = claim
            .accounts
            .iter()
            .map(|a| pubkey(&a.pubkey))
            .filter(|key| env.svm.get_account(&addr(key)).is_none())
            .collect();
        assert_error(env.send(&[cpi(claim)], &[]), "ExecInFlight");
        for (key, account) in before {
            if key != payer {
                assert_eq!(env.account(key), account);
            }
        }
        for key in absent {
            assert!(env.svm.get_account(&addr(&key)).is_none());
        }
        machine(env, |m| m.exec.kind = onepercent::constants::EXEC_KIND_NONE);
    }
    for kind in [0, 2] {
        let mut f = DbcClaimCase::new(1_000_000_000);
        let claim = f.claim(kind);
        rejects(&mut f.env, claim.clone());
        f.env.send(&[claim], &[]).unwrap();
    }
    let mut f = PoolClaimCase::new(123, 1_000_000_000, token());
    let claim = f.claim();
    rejects(&mut f.env, claim.clone());
    f.env.send(&[claim], &[]).unwrap();
}

#[test]
fn t12_34_settle_refund_and_callback_cannot_run_inside_pair() {
    use onepercent::state::Pull;
    for operation in 0..3 {
        let mut f = ExecFixture::new(2, 1, false, false);
        f.e.inject_deck(100);
        let signer = pubkey(&f.signer.pubkey());
        f.send(&[f.e.buy_ix(signer, 0, 1, 0, None)]).unwrap();
        let pull = pda(&[b"pull", signer.as_ref(), &0u32.to_le_bytes()]).0;
        if operation == 0 {
            f.e.fulfill(pull, [1; 32]).unwrap();
        }
        if operation == 1 {
            f.e.warp(params::VRF_TIMEOUT_SECONDS + 1);
            f.refresh();
        }
        let inner = match operation {
            0 => cpi(f.e.settle_ix(pull, 0)),
            1 => cpi(f.e.refund_ix(pull)),
            _ => {
                f.e.raw_fulfill_ix(pull, [1; 32], f.e.state::<Pull>(pull).seq, false)
            }
        };
        let mut tx = f.transaction(50_000_000, min(&f, 50_000_000));
        tx.insert(tx.len() - 1, inner);
        f.reject(&tx, "ExecInFlight");
        match operation {
            0 => {
                f.e.settle(pull, 0).unwrap();
            }
            1 => {
                f.e.send(&[f.e.refund_ix(pull)], &[]).unwrap();
            }
            _ => {
                f.e.fulfill(pull, [1; 32]).unwrap();
            }
        }
        f.e.check_invariants();
    }
}

#[test]
fn t12_35_every_machine_entry_checks_the_exec_lock() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/instructions");
    for name in [
        "collect_creator_fees",
        "claim_launch_fees",
        "buy_packs",
        "redeem",
        "take_back",
        "settle",
        "feed",
        "refund_pull",
        "sell_back",
        "feed_back",
        "admin_config",
        "admin_list_mint",
        "guardian",
        "advance_phase",
        "team_withdraw",
        "close_vault",
        "power_on",
        "consume_randomness",
    ] {
        let text = std::fs::read_to_string(root.join(format!("{name}.rs"))).unwrap();
        assert!(
            text.contains("exec.kind == EXEC_KIND_NONE"),
            "{name} lacks the exec lock"
        );
        assert!(
            text.contains("MachineError::ExecInFlight"),
            "{name} lacks its error"
        );
    }
}
