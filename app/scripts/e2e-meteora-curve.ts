import assert from "node:assert/strict";
import { TOKEN_1PCT } from "../packages/config/src/index.js";

const Q128 = 1n << 128n;
const MIN_SQRT = 4_295_048_016n;
const MAX_SQRT = 79_226_673_521_066_979_257_578_248_091n;
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
function sqrt(n: bigint): bigint {
  let x = n;
  let next = (x + 1n) / 2n;
  while (next < x) {
    x = next;
    next = (x + n / x) / 2n;
  }
  return x;
}
/**
 * Local test configuration, using the integer forms of Meteora's buildCurve,
 * getFirstCurve and getMigrationBaseToken at SDK 31a472c. These inputs reproduce
 * D29's approximate 79.3% / 20.7% shape. The launch track owns production inputs.
 */
export function meteoraTestConfig() {
  const supply = TOKEN_1PCT.totalSupply;
  const threshold = 85_000_000_000n;
  const migrationAllocation = (supply * 207n) / 1000n;
  const migrationSqrt = sqrt((threshold * Q128) / migrationAllocation);
  const migrationLiquidity = (threshold * Q128) / (migrationSqrt - MIN_SQRT);
  const migrationBase = ceil(
    migrationLiquidity * (MAX_SQRT - migrationSqrt),
    migrationSqrt * MAX_SQRT,
  );
  const swapBase = supply - migrationBase;
  const start = (migrationSqrt * migrationBase) / swapBase;
  const fromBase = (swapBase * start * migrationSqrt) / (migrationSqrt - start);
  const fromQuote = (threshold * Q128) / (migrationSqrt - start);
  const liquidity = fromBase < fromQuote ? fromBase : fromQuote;
  const curve = [{ sqrt_price: migrationSqrt, liquidity }];
  // buildCurve appends the integer remainder at its full-range terminal price.
  const consumed = ceil(
    liquidity * (migrationSqrt - start),
    start * migrationSqrt,
  );
  const remaining = supply - consumed - migrationBase;
  assert(remaining >= 0n);
  const tail =
    (remaining * migrationSqrt * MAX_SQRT) / (MAX_SQRT - migrationSqrt);
  if (tail > 0n) curve.push({ sqrt_price: MAX_SQRT, liquidity: tail });
  const noVesting = {
    vesting_percentage: 0,
    bps_per_period: 0,
    number_of_periods: 0,
    cliff_duration_from_migration_time: 0,
    frequency: 0,
  };
  return {
    pool_fees: {
      base_fee: {
        cliff_fee_numerator: 25_000_000n,
        first_factor: 0,
        second_factor: 0n,
        third_factor: 0n,
        base_fee_mode: 0,
      },
      dynamic_fee: null,
    },
    collect_fee_mode: 0,
    migration_option: 1,
    activation_type: 0,
    token_type: 0,
    token_decimal: TOKEN_1PCT.decimals,
    partner_liquidity_percentage: 0,
    partner_permanent_locked_liquidity_percentage: 100,
    creator_liquidity_percentage: 0,
    creator_permanent_locked_liquidity_percentage: 0,
    migration_quote_threshold: threshold,
    sqrt_start_price: start,
    locked_vesting: {
      amount_per_period: 0n,
      cliff_duration_from_migration_time: 0n,
      frequency: 0n,
      number_of_period: 0n,
      cliff_unlock_amount: 0n,
    },
    migration_fee_option: 6,
    token_supply: {
      pre_migration_token_supply: supply,
      post_migration_token_supply: supply,
    },
    creator_trading_fee_percentage: 0,
    token_update_authority: 1,
    migration_fee: { fee_percentage: 0, creator_fee_percentage: 0 },
    migrated_pool_fee: {
      collect_fee_mode: 0,
      dynamic_fee: 0,
      pool_fee_bps: 250,
    },
    pool_creation_fee: 0n,
    partner_liquidity_vesting_info: noVesting,
    creator_liquidity_vesting_info: noVesting,
    migrated_pool_base_fee_mode: 0,
    migrated_pool_market_cap_fee_scheduler_params: {
      number_of_period: 0,
      sqrt_price_step_bps: 0,
      scheduler_expiration_duration: 0,
      reduction_factor: 0n,
    },
    enable_first_swap_with_min_fee: false,
    compounding_fee_bps: 0,
    padding: [0, 0],
    curve,
  };
}
