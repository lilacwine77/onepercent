#[path = "common/reference.rs"]
mod reference;
use onepercent::{math, params};
use proptest::prelude::*;
fn bucket_strategy() -> impl Strategy<Value = math::BucketInput> {
    (
        0u8..4,
        any::<bool>(),
        any::<u64>(),
        any::<u64>(),
        any::<u64>(),
    )
        .prop_map(
            |(class, enabled, amount, cost, reserved)| math::BucketInput {
                class,
                enabled,
                amount,
                cost,
                reserved,
            },
        )
}
fn refs(buckets: &[math::BucketInput]) -> Vec<reference::Bucket> {
    buckets
        .iter()
        .map(|b| reference::Bucket {
            class: b.class,
            enabled: b.enabled,
            amount: b.amount,
            cost: b.cost,
            reserved: b.reserved,
        })
        .collect()
}
proptest! {
#![proptest_config(ProptestConfig {
    failure_persistence: Some(Box::new(proptest::test_runner::FileFailurePersistence::Direct(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/prop_m_ref.proptest-regressions"),
    ))),
    ..ProptestConfig::default()
})]
#[test]
fn m_ref_split_and_tier_value(price in any::<u64>(),kind in any::<u8>()){
 let got=math::split(price);let want=reference::split(price);
 prop_assert_eq!((got.royalty,got.jackpot,got.burn,got.referral,got.team,got.stock),(want.royalty,want.jackpot,want.burn,want.referral,want.team,want.stock));
 prop_assert_eq!(math::tier_value(price,kind),reference::tier_value(price,kind));
}
#[test]
fn m_ref_draw_and_dust(randomness in any::<[u8;32]>(),seq in any::<u64>(),pack in any::<u8>(),edition in 0u8..8,live in any::<u8>(),holder in any::<bool>(),k in any::<u8>(),len in any::<u32>()){
 let got=math::draw(&randomness,seq,pack,edition,live,holder).map(|d|(d.t,d.tier,d.widths));let want=reference::draw(&randomness,seq,pack,edition,live,holder).map(|d|(d.t,d.tier,d.widths));
 prop_assert_eq!(got,want);prop_assert_eq!(math::dust_index(&randomness,seq,pack,k,len),reference::dust_index(&randomness,seq,pack,k,len));
}
#[test]
fn m_ref_bucket_pick(randomness in any::<[u8;32]>(),seq in any::<u64>(),pack in any::<u8>(),kind in 0u8..10,value in any::<u64>(),backing in any::<u8>(),buckets in prop::collection::vec(bucket_strategy(),0..20)){
 prop_assert_eq!(math::bucket_pick(&randomness,seq,pack,kind,value,backing,&buckets),reference::bucket_pick(&randomness,seq,pack,kind,value,backing,&refs(&buckets)));
}
#[test]
fn m_ref_carve(value in any::<u64>(),amount in any::<u64>(),cost in any::<u64>()){
 prop_assert_eq!(math::carve(value,amount,cost).map(|c|(c.tokens,c.amount,c.cost)),reference::carve(value,amount,cost));
}
#[test]
fn m_ref_coverage_and_max_qty(price in any::<u64>(),qty in 0u8..12,edition in 0u8..8,deck_len in any::<u32>(),reserved_dust in any::<u32>(),buckets in prop::collection::vec(bucket_strategy(),0..20)){
 let mut actual=buckets.clone();let mut expected=refs(&buckets);
 prop_assert_eq!(math::coverage(price,qty,&mut actual),reference::coverage(price,qty,&mut expected));prop_assert_eq!(refs(&actual),expected);
 prop_assert_eq!(math::max_qty(edition,deck_len,reserved_dust,&buckets),reference::max_qty(edition,deck_len,reserved_dust,&refs(&buckets)));
}
    #[test]
    fn m_ref_calibrated_coverage(edition in 0usize..4,qty in 0u8..12,deck_len in 0u32..200,reserved_dust in 0u32..100,raw in prop::collection::vec((0u8..4,any::<bool>(),0u64..1_000,0u64..100_000_000_000,0u64..50_000_000_000),0..20)) {
        let buckets:Vec<_> = raw.into_iter().map(|(class,enabled,amount,cost,reserved)|math::BucketInput{class,enabled,amount,cost,reserved}).collect();
        let mut actual = buckets.clone();let mut expected = refs(&buckets);
        let price = params::PACK_EDITIONS_PRICE_LAMPORTS[edition];
        prop_assert_eq!(math::coverage(price,qty,&mut actual),reference::coverage(price,qty,&mut expected));
        prop_assert_eq!(refs(&actual),expected);
        prop_assert_eq!(math::max_qty(edition as u8,deck_len,reserved_dust,&buckets),reference::max_qty(edition as u8,deck_len,reserved_dust,&refs(&buckets)));
    }
#[test]
fn d12_pending_granularity_survives_200_interleaved_carves(edition in 0usize..4,extra in any::<u64>(),amount in 1u64..=u64::MAX,selectors in prop::collection::vec(any::<u64>(),200)){
 let price=params::PACK_EDITIONS_PRICE_LAMPORTS[edition];let need=math::coverage_need(price).unwrap();let cost=need.saturating_add(extra);let mut bucket=math::BucketInput{class:1,enabled:true,amount,cost,reserved:0};
 if math::coverage_granularity(price,&bucket){
  prop_assert_eq!(math::coverage(price,1,std::slice::from_mut(&mut bucket)),Some(vec![0]));
  for selector in selectors{let free=bucket.cost-bucket.reserved;if free==0{break;}let value=((u128::from(selector)*u128::from(free))>>64)as u64+1;
   if let Some(c)=math::carve(value,bucket.amount,bucket.cost){prop_assert!(u128::from(c.amount)*u128::from(bucket.cost)>=u128::from(bucket.amount)*u128::from(c.cost));bucket.amount=c.amount;bucket.cost=c.cost;prop_assert!(bucket.cost>=bucket.reserved);prop_assert!(math::coverage_granularity(price,&bucket));}}
  bucket.reserved-=need;let smallest=math::tier_value(price,1).unwrap();prop_assert!(math::carve(smallest,bucket.amount,bucket.cost).is_some());
 }
}
#[test]
fn m_ref_specials_and_creator_fees(now in any::<i64>(), start in any::<i64>(), states in any::<[u8;4]>(), amount in any::<u64>(), cost in any::<u64>(), tokens in any::<u64>(), price in any::<u64>(), phase in any::<u8>(), stock in any::<u64>(), costs in any::<[u64;16]>()) {
    let mut m: onepercent::state::Machine = bytemuck::Zeroable::zeroed();
    m.on_air_ts = start;
    for (slot, state) in m.onepct.iter_mut().zip(states) { slot.state = state; }
    m.jackpot_tokens = tokens;
    m.jackpot_cost = cost;
    m.phase = phase;
    m.stock_sol = stock;
    for (bucket, cost) in m.buckets.iter_mut().zip(costs) { bucket.cost = cost; }
    prop_assert_eq!(math::specials::live_flags(&m, price, now), reference::live_flags(&m, price, now));
    let regime = math::creator_fee::regime(&m);
    prop_assert_eq!(regime, reference::creator_regime(&m));
    let split = math::creator_fee::split(amount, regime);
    prop_assert_eq!((split.stock, split.burn, split.team), reference::creator_split(amount, regime));
    prop_assert_eq!(u128::from(split.stock) + u128::from(split.burn) + u128::from(split.team), u128::from(amount));
}

}
