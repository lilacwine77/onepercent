mod common;
use bytemuck::Zeroable;
use common::{pack_cases::events, *};
use onepercent::{
    math::{rotate_hour, HourState},
    state::Machine,
};
use proptest::prelude::*;

fn advance(e: &Env) -> solana_instruction::Instruction {
    instruction(
        "advance_phase",
        vec![meta(e.config, false, false), meta(e.machine, true, false)],
        &[],
    )
}

fn rotate(m: &mut Machine, now: i64) {
    let mut h = HourState {
        hour_index: m.hour_index,
        sb_paid_hour: m.sb_paid_hour,
        ..Default::default()
    };
    rotate_hour(&mut h, now);
    m.rotate_keeper_history(now);
    m.hour_index = h.hour_index;
    m.sb_paid_hour = h.sb_paid_hour;
}

#[test]
fn legacy_activation_preserves_every_existing_byte_and_is_idempotent() {
    let mut e = Env::new();
    let bag = e.new_pump_mint(true);
    e.seed_bucket(0, &bag, 1, 1234, 5678);
    e.mutate(e.machine, |a| a.data[2656..3080].fill(0));
    let before = e.account(e.machine);
    let now = e.now();
    e.send(&[advance(&e)], &[]).unwrap();
    let after = e.account(e.machine);
    assert_eq!(after.data.len(), 3808);
    assert_eq!(after.lamports, before.lamports);
    assert_eq!(&after.data[..2656], &before.data[..2656]);
    assert_eq!(&after.data[3080..], &before.data[3080..]);
    let m = e.state::<Machine>(e.machine);
    assert_eq!(m.keeper_history_version, 0);
    assert_eq!(m.keeper_history_started_ts, 0);
    assert_eq!(m.bucket_history[0].listed_ts, 0);
    assert_eq!(m.bucket_history[1].listed_ts, 0);
    assert_eq!(m.last_reveal_ts, now);
    assert!(after.data[2664..3080].iter().all(|byte| *byte == 0));
    e.warp(1);
    e.send(&[advance(&e)], &[]).unwrap();
    assert_eq!(e.account(e.machine), after);
}

#[test]
fn listing_sets_only_its_own_timestamp() {
    let mut e = Env::new();
    for index in 0..2 {
        e.warp(5);
        let bag = e.new_pump_mint(true);
        e.token_account(e.vault_auth, &bag, 0);
        let previous = e.state::<Machine>(e.machine).bucket_history[0].listed_ts;
        let result = e.send(&[e.list_ix(&bag, 1, 1000)], &[]).unwrap();
        let m = e.state::<Machine>(e.machine);
        assert_eq!(m.bucket_history[index].listed_ts, e.now());
        assert_eq!(
            events::<onepercent::events::BucketListed>(&result)[0].listed_ts,
            e.now()
        );
        if index > 0 {
            assert_eq!(m.bucket_history[0].listed_ts, previous);
        }
    }
}

#[test]
fn adjacent_skipped_and_backward_hours_clear_correctly() {
    let mut m = Machine::zeroed();
    m.ensure_keeper_history(3500);
    m.sb_paid_hour = 13;
    m.bucket_history[3].sb_inflow_hour = 17;
    rotate(&mut m, 3599);
    assert_eq!(m.sb_paid_hour, 13);
    rotate(&mut m, 3600);
    assert_eq!((m.sb_paid_hour, m.sb_paid_prev_hour), (0, 13));
    assert_eq!(
        (
            m.bucket_history[3].sb_inflow_hour,
            m.bucket_history[3].sb_inflow_prev_hour
        ),
        (0, 17)
    );
    rotate(&mut m, 3601);
    assert_eq!(m.sb_paid_prev_hour, 13);
    rotate(&mut m, 10800);
    assert_eq!(m.sb_paid_prev_hour, 0);
    assert_eq!(m.bucket_history[3].sb_inflow_prev_hour, 0);
    m.sb_paid_hour = 19;
    rotate(&mut m, 100);
    assert_eq!(m.sb_paid_prev_hour, 0);
}

proptest! {
    #[test]
    fn retained_hours_bound_every_trailing_window(
        steps in prop::collection::vec((0u32..8000, 0u64..1_000_000, 0u64..1_000_000, 0usize..16), 1..201),
        window in 1i64..=3600,
    ) {
        let mut m = Machine::zeroed();
        m.ensure_keeper_history(0);
        let mut now = 0i64;
        let mut history = vec![];
        for (delta, paid, inflow, bucket) in steps {
            now += i64::from(delta);
            rotate(&mut m, now);
            m.sb_paid_hour += paid;
            m.bucket_history[bucket].sb_inflow_hour += inflow;
            history.push((now, paid, inflow, bucket));
            // Read without a transaction at now+1: the account may be one hour old.
            let read_now = now + 1;
            let mut snapshot = m;
            rotate(&mut snapshot, read_now);
            let boundary = read_now / 3600 * 3600;
            let include_previous = read_now - window < boundary;
            let payout_bound = snapshot.sb_paid_hour + if include_previous { snapshot.sb_paid_prev_hour } else { 0 };
            let exact_paid: u64 = history.iter().filter(|v| v.0 >= read_now-window).map(|v| v.1).sum();
            prop_assert!(payout_bound >= exact_paid);
            for index in 0..16 {
                let h = snapshot.bucket_history[index];
                let bound = h.sb_inflow_hour + if include_previous { h.sb_inflow_prev_hour } else { 0 };
                let exact: u64 = history.iter().filter(|v| v.0 >= read_now-window && v.3 == index).map(|v| v.2).sum();
                prop_assert!(bound >= exact);
            }
        }
    }
}
