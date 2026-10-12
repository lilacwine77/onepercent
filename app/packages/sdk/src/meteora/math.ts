import { Buffer } from "buffer";
import { NATIVE_MINT } from "@solana/spl-token";
import { TOKEN_1PCT } from "@onepercent/config";

// EXT (Meteora): Q64.64 bounds and fee denominator from the pinned DBC source.
export const DBC_Q64 = 1n << 64n;
export const DBC_Q128 = 1n << 128n;
export const DBC_MIN_SQRT_PRICE = 4_295_048_016n;
export const DBC_MAX_SQRT_PRICE = 79_226_673_521_066_979_257_578_248_091n;
// EXT (Meteora), D29 §2 and PARAMS §11.1.1: founder-approved launch profile.
export const DBC_DEFAULT_THRESHOLD = 85_000_000_000n;
export const DBC_FEE_NUMERATOR = 25_000_000n;
export const DBC_FEE_DENOMINATOR = 1_000_000_000n;
export const DBC_MIGRATION_SUPPLY_BPS = 2_070n;

export function ceilDiv(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new RangeError("Invalid unsigned division");
  return (n + d - 1n) / d;
}
export function integerSqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("Negative square root");
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const next = (x + n / x) / 2n;
    if (next >= x) return x;
    x = next;
  }
}
export function dbcBaseDelta(
  lower: bigint,
  upper: bigint,
  liquidity: bigint,
  roundUp = true,
): bigint {
  const n = liquidity * (upper - lower),
    d = lower * upper;
  return roundUp ? ceilDiv(n, d) : n / d;
}
export function dbcQuoteDelta(
  lower: bigint,
  upper: bigint,
  liquidity: bigint,
  roundUp = true,
): bigint {
  const n = liquidity * (upper - lower);
  return roundUp ? ceilDiv(n, DBC_Q128) : n / DBC_Q128;
}
/** Integer port of DBC buildCurve/getFirstCurve, with a 20.7% migration allocation. */
export function deriveDbcCurve(
  migrationQuoteThreshold = DBC_DEFAULT_THRESHOLD,
) {
  if (
    migrationQuoteThreshold <= 0n ||
    migrationQuoteThreshold > (1n << 64n) - 1n
  )
    throw new RangeError("Migration threshold outside u64");
  const totalSupply = BigInt(TOKEN_1PCT.totalSupply);
  const targetMigrationBase =
    (totalSupply * DBC_MIGRATION_SUPPLY_BPS) / 10_000n;
  const migrationSqrtPrice = integerSqrt(
    (migrationQuoteThreshold * DBC_Q128) / targetMigrationBase,
  );
  const migrationLiquidity =
    (migrationQuoteThreshold * DBC_Q128) /
    (migrationSqrtPrice - DBC_MIN_SQRT_PRICE);
  const migrationBaseThreshold = dbcBaseDelta(
    migrationSqrtPrice,
    DBC_MAX_SQRT_PRICE,
    migrationLiquidity,
  );
  const swapBaseAmount = totalSupply - migrationBaseThreshold;
  const sqrtStartPrice =
    (migrationSqrtPrice * migrationBaseThreshold) / swapBaseAmount;
  const baseLiquidity =
    (swapBaseAmount * sqrtStartPrice * migrationSqrtPrice) /
    (migrationSqrtPrice - sqrtStartPrice);
  const quoteLiquidity =
    (migrationQuoteThreshold * DBC_Q128) /
    (migrationSqrtPrice - sqrtStartPrice);
  const liquidity =
    baseLiquidity < quoteLiquidity ? baseLiquidity : quoteLiquidity;
  const curve = [{ sqrtPrice: migrationSqrtPrice, liquidity }];
  const actualSwapAmount = dbcBaseDelta(
    sqrtStartPrice,
    migrationSqrtPrice,
    liquidity,
  );
  const remaining = totalSupply - actualSwapAmount - migrationBaseThreshold;
  if (remaining > 0n) {
    const tail =
      (remaining * migrationSqrtPrice * DBC_MAX_SQRT_PRICE) /
      (DBC_MAX_SQRT_PRICE - migrationSqrtPrice);
    if (tail > 0n)
      curve.push({ sqrtPrice: DBC_MAX_SQRT_PRICE, liquidity: tail });
  }
  return {
    totalSupply,
    migrationQuoteThreshold,
    targetMigrationBase,
    migrationSqrtPrice,
    migrationBaseThreshold,
    sqrtStartPrice,
    swapBaseAmount: actualSwapAmount,
    curve,
  };
}
export function buildDbcLaunchConfig(
  migrationQuoteThreshold = DBC_DEFAULT_THRESHOLD,
) {
  const curve = deriveDbcCurve(migrationQuoteThreshold);
  const vesting = {
    vestingPercentage: 0,
    bpsPerPeriod: 0,
    numberOfPeriods: 0,
    cliffDurationFromMigrationTime: 0,
    frequency: 0,
  };
  return {
    poolFees: {
      baseFee: {
        cliffFeeNumerator: DBC_FEE_NUMERATOR,
        firstFactor: 0,
        secondFactor: 0n,
        thirdFactor: 0n,
        baseFeeMode: 0,
      },
      dynamicFee: null,
    },
    collectFeeMode: 0,
    migrationOption: 1,
    activationType: 1,
    tokenType: 0,
    tokenDecimal: TOKEN_1PCT.decimals,
    partnerLiquidityPercentage: 0,
    partnerPermanentLockedLiquidityPercentage: 100,
    creatorLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 0,
    migrationQuoteThreshold,
    sqrtStartPrice: curve.sqrtStartPrice,
    lockedVesting: {
      amountPerPeriod: 0n,
      cliffDurationFromMigrationTime: 0n,
      frequency: 0n,
      numberOfPeriod: 0n,
      cliffUnlockAmount: 0n,
    },
    migrationFeeOption: 6,
    tokenSupply: {
      preMigrationTokenSupply: curve.totalSupply,
      postMigrationTokenSupply: curve.totalSupply,
    },
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: 1,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    migratedPoolFee: { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 250 },
    poolCreationFee: 0n,
    partnerLiquidityVestingInfo: { ...vesting },
    creatorLiquidityVestingInfo: { ...vesting },
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: {
      numberOfPeriod: 0,
      sqrtPriceStepBps: 0,
      schedulerExpirationDuration: 0,
      reductionFactor: 0n,
    },
    enableFirstSwapWithMinFee: false,
    compoundingFeeBps: 0,
    padding: [0, 0],
    curve: curve.curve,
  };
}
export type DbcLaunchConfig = ReturnType<typeof buildDbcLaunchConfig>;
export function dbcFeeSplit(tradeFee: bigint) {
  if (tradeFee < 0n) throw new RangeError("Negative trading fee");
  const protocolFee = (tradeFee * 20n) / 100n;
  return { tradeFee, protocolFee, partnerFee: tradeFee - protocolFee };
}
/** Exact-output quote for an untouched launch pool; fees are collected in quote. */
export function quoteDbcExactOut(
  config: Pick<
    DbcLaunchConfig,
    "sqrtStartPrice" | "curve" | "migrationQuoteThreshold"
  >,
  amountOut: bigint,
  slippageBps = 0,
) {
  if (
    amountOut <= 0n ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 10_000
  )
    throw new RangeError("Invalid DBC quote amount or slippage");
  let left = amountOut,
    nextSqrtPrice = config.sqrtStartPrice,
    excludedFeeInput = 0n;
  for (const segment of config.curve) {
    if (left === 0n) break;
    const available = dbcBaseDelta(
      nextSqrtPrice,
      segment.sqrtPrice,
      segment.liquidity,
      false,
    );
    if (left <= available) {
      const next = ceilDiv(
        segment.liquidity * nextSqrtPrice,
        segment.liquidity - left * nextSqrtPrice,
      );
      excludedFeeInput += dbcQuoteDelta(nextSqrtPrice, next, segment.liquidity);
      nextSqrtPrice = next;
      left = 0n;
    } else {
      excludedFeeInput += dbcQuoteDelta(
        nextSqrtPrice,
        segment.sqrtPrice,
        segment.liquidity,
      );
      left -= available;
      nextSqrtPrice = segment.sqrtPrice;
    }
  }
  if (left > 0n || excludedFeeInput > config.migrationQuoteThreshold)
    throw new RangeError("Quote exceeds the migration threshold");
  const quoteIn = ceilDiv(
    excludedFeeInput * DBC_FEE_DENOMINATOR,
    DBC_FEE_DENOMINATOR - DBC_FEE_NUMERATOR,
  );
  return {
    amountOut,
    quoteIn,
    maxQuoteIn: ceilDiv(quoteIn * BigInt(10_000 + slippageBps), 10_000n),
    excludedFeeInput,
    nextSqrtPrice,
    ...dbcFeeSplit(quoteIn - excludedFeeInput),
  };
}

/** DAMM's concentrated-liquidity delta and fee rounding match DBC for D29's flat quote-only pool. */
export function quoteDammV2ExactOut(
  pool: import("./types.js").DammV2Pool,
  amountOut: bigint,
  slippageBps = 0,
) {
  const base = Buffer.from(pool.poolFees.baseFee.baseFeeInfo.data);
  if (
    !pool.tokenBMint.equals(NATIVE_MINT) ||
    pool.collectFeeMode !== 1 ||
    pool.poolFees.protocolFeePercent !== 20 ||
    pool.poolFees.compoundingFeeBps !== 0 ||
    pool.poolFees.dynamicFee.initialized !== 0 ||
    base.readBigUInt64LE(0) !== DBC_FEE_NUMERATOR ||
    base[8] !== 0 ||
    base.subarray(9).some((v) => v !== 0)
  )
    throw new Error("Unsupported DAMM fee configuration");
  return quoteDbcExactOut(
    {
      sqrtStartPrice: pool.sqrtPrice,
      curve: [{ sqrtPrice: pool.sqrtMaxPrice, liquidity: pool.liquidity }],
      migrationQuoteThreshold: (1n << 64n) - 1n,
    },
    amountOut,
    slippageBps,
  );
}

/** Exact-input SPL sale inside one DBC/DAMM segment, with all fees in SOL output. */
export function quoteMeteoraSell(input: {
  sqrtPrice: bigint;
  liquidity: bigint;
  minSqrtPrice: bigint;
  amountIn: bigint;
}) {
  if (input.amountIn <= 0n || input.liquidity <= 0n)
    throw new RangeError("Invalid sell quote");
  const nextSqrtPrice = ceilDiv(
    input.liquidity * input.sqrtPrice,
    input.liquidity + input.amountIn * input.sqrtPrice,
  );
  if (nextSqrtPrice < input.minSqrtPrice)
    throw new RangeError("Sell quote crosses a liquidity segment");
  const grossQuoteOut = dbcQuoteDelta(
    nextSqrtPrice,
    input.sqrtPrice,
    input.liquidity,
    false,
  );
  const tradeFee = ceilDiv(
    grossQuoteOut * DBC_FEE_NUMERATOR,
    DBC_FEE_DENOMINATOR,
  );
  return {
    amountIn: input.amountIn,
    quoteOut: grossQuoteOut - tradeFee,
    grossQuoteOut,
    nextSqrtPrice,
    ...dbcFeeSplit(tradeFee),
  };
}
