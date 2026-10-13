import { Buffer } from "buffer";
import {
  BPS_DENOMINATOR,
  BURN,
  FEED_RULES,
  HIT_LIST,
  JACKPOT,
  METEORA,
  PAUSE_BITS,
  PUMP_LAYOUTS,
  STOCK,
} from "@onepercent/config";
import {
  NATIVE_MINT,
  ExtensionType,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import {
  BUCKET_NONE,
  EXEC_KIND,
  EXTERNAL_IDS,
  PHASE,
  ONE_PCT_STATE,
  POOL_AUTHORITY_SEED,
  PUMPSWAP_POOL_DISCRIMINATOR,
  PYTH_PRICE_UPDATE_V2_DISCRIMINATOR,
} from "../constants.js";
import { discriminator, U64_MAX } from "../bytes.js";
import { decodeMintLedger } from "../layouts.js";
import type { Bucket, Config, Machine } from "../layouts.js";
import { execBeginIx } from "../ix/execBegin.js";
import type { ExecBeginInput } from "../ix/execBegin.js";
import { ledgerPda, userAta, vaultAta, vaultAuthPda } from "../pda.js";
import { rotateHour, tierValue } from "../math/index.js";
import { PACK_EDITIONS } from "@onepercent/config";

import type { ClusterDeployment } from "../deployment.js";

const U128_MAX = (1n << 128n) - 1n;
const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);
const I64_MAX = (1n << 63n) - 1n;
const I64_MIN = -(1n << 63n);
const BPS = BigInt(BPS_DENOMINATOR);
export type ExecError =
  | "MathOverflow"
  | "OracleInvalid"
  | "OracleStale"
  | "OracleWide"
  | "NotTopLevel"
  | "InvalidArgument"
  | "Unauthorized"
  | "RoleDisabled"
  | "Paused"
  | "WrongPhase"
  | "SeasonOver"
  | "ExecPairing"
  | "ExecInFlight"
  | "BucketInvalid"
  | "VaultMismatch"
  | "LedgerMismatch"
  | "AccountMismatch"
  | "BucketDisabled"
  | "MintNotSafe"
  | "TooSoon"
  | "TrancheTooLarge"
  | "BucketCapExceeded"
  | "HourlyCapReached"
  | "TrendingShareExceeded"
  | "ReservedCapacity"
  | "VaultInvariant";
class ExecCheckError extends Error {
  constructor(readonly code: ExecError) {
    super(code);
  }
}
function requireExec(condition: boolean, code: ExecError): asserts condition {
  if (!condition) throw new ExecCheckError(code);
}
function bounded(value: bigint, min: bigint, max: bigint): bigint {
  requireExec(value >= min && value <= max, "MathOverflow");
  return value;
}
const u64 = (n: bigint) => bounded(n, 0n, U64_MAX);
const u128 = (n: bigint) => bounded(n, 0n, U128_MAX);
const i64 = (n: bigint) => bounded(n, I64_MIN, I64_MAX);
const multiply = (a: bigint, b: bigint) => u128(a * b);
const add = (a: bigint, b: bigint) => u64(a + b);
const minimum = (a: bigint, b: bigint) => (a < b ? a : b);
const maximum = (a: bigint, b: bigint) => (a > b ? a : b);
function divide(n: bigint, d: bigint): bigint {
  requireExec(d !== 0n, "MathOverflow");
  return n / d;
}
function withSlip(expected: bigint, slip: number): ExecQuote {
  requireExec(
    Number.isInteger(slip) && slip >= 0 && slip <= BPS_DENOMINATOR,
    "MathOverflow",
  );
  return {
    expected: u64(expected),
    minOut: u64(multiply(expected, BPS - BigInt(slip)) / BPS),
  };
}
export interface ExecQuote {
  expected: bigint;
  minOut: bigint;
}
export interface MajorQuoteInput {
  amount: bigint;
  solPrice: bigint;
  solExponent: number;
  tokenPrice: bigint;
  tokenExponent: number;
  decimals: number;
  sell?: boolean;
}
/** Integer mirror of M2 §6.4, including intermediate overflow failures. */
export function minOutMajor(input: MajorQuoteInput): ExecQuote {
  const {
    amount,
    solPrice,
    solExponent,
    tokenPrice,
    tokenExponent,
    decimals,
    sell = false,
  } = input;
  u64(amount);
  i64(solPrice);
  i64(tokenPrice);
  requireExec(
    solPrice > 0n &&
      tokenPrice > 0n &&
      Number.isInteger(solExponent) &&
      solExponent >= -18 &&
      solExponent <= 0 &&
      Number.isInteger(tokenExponent) &&
      tokenExponent >= -18 &&
      tokenExponent <= 0 &&
      Number.isInteger(decimals) &&
      decimals >= 0 &&
      decimals <= 255,
    "OracleInvalid",
  );
  const exponent = sell
    ? tokenExponent - solExponent + 9 - decimals
    : solExponent - tokenExponent + decimals - 9;
  let numerator = multiply(amount, sell ? tokenPrice : solPrice);
  let denominator = sell ? solPrice : tokenPrice;
  const scale = u128(10n ** BigInt(Math.abs(exponent)));
  if (exponent >= 0) numerator = multiply(numerator, scale);
  else denominator = multiply(denominator, scale);
  return withSlip(divide(numerator, denominator), STOCK.majorMinOutSlipBps);
}
export interface PoolQuoteInput {
  amount: bigint;
  baseReserve: bigint;
  quoteReserve: bigint;
  virtualQuoteReserve: bigint;
  slipBps?: number;
}
export function effectiveQuote(
  quoteReserve: bigint,
  virtualQuoteReserve: bigint,
): bigint {
  u64(quoteReserve);
  bounded(virtualQuoteReserve, I128_MIN, I128_MAX);
  const quote = bounded(quoteReserve + virtualQuoteReserve, I128_MIN, I128_MAX);
  requireExec(quote > 0n, "OracleInvalid");
  return quote;
}
export function minOutPoolBuy(input: PoolQuoteInput): ExecQuote {
  const { amount, baseReserve, quoteReserve, virtualQuoteReserve } = input;
  u64(amount);
  u64(baseReserve);
  const quote = effectiveQuote(quoteReserve, virtualQuoteReserve);
  const effective =
    multiply(amount, BPS - BigInt(STOCK.trendingPoolFeeAllowanceBps)) / BPS;
  return withSlip(
    divide(multiply(baseReserve, effective), u128(quote + effective)),
    input.slipBps ?? STOCK.trendingMinOutSlipBps,
  );
}
export function minOutPoolSell(input: PoolQuoteInput): ExecQuote {
  const { amount, baseReserve, quoteReserve, virtualQuoteReserve } = input;
  u64(amount);
  u64(baseReserve);
  const quote = effectiveQuote(quoteReserve, virtualQuoteReserve);
  const denominator = u128(baseReserve + amount);
  requireExec(denominator > 0n, "OracleInvalid");
  const gross = divide(multiply(quote, amount), denominator);
  const expected = minimum(
    multiply(gross, BPS - BigInt(STOCK.trendingPoolFeeAllowanceBps)) / BPS,
    quoteReserve,
  );
  return withSlip(expected, input.slipBps ?? STOCK.trendingMinOutSlipBps);
}
export interface MeteoraQuoteInput {
  amount: bigint;
  /** Q64.64 square root of quote lamports per base unit. */
  sqrtPrice: bigint;
  slipBps: number;
}
/** D29 §3b spot-price bound; fees, conversion and slippage floor separately. */
export function minOutMeteoraBuy(input: MeteoraQuoteInput): ExecQuote {
  const { amount, sqrtPrice, slipBps } = input;
  u64(amount);
  u128(sqrtPrice);
  requireExec(sqrtPrice > 0n, "OracleInvalid");
  const effective = multiply(amount, BPS - BigInt(METEORA.feeAllowBps)) / BPS;
  // u128 squared fits U256; u64 shifted by 128 fits U256 as well.
  const expected = (effective << 128n) / (sqrtPrice * sqrtPrice);
  return withSlip(expected, slipBps);
}
export function bookOf(
  amount: bigint,
  bucketAmount: bigint,
  cost: bigint,
): bigint {
  for (const value of [amount, bucketAmount, cost]) u64(value);
  requireExec(amount > 0n && amount <= bucketAmount, "InvalidArgument");
  return amount === bucketAmount
    ? cost
    : u64(divide(multiply(amount, cost), bucketAmount));
}
export function stockCap(
  hitOutLastHour: bigint,
  hitOutThisHour: bigint,
): bigint {
  u64(hitOutLastHour);
  u64(hitOutThisHour);
  return maximum(
    STOCK.hourlyFloorLamports,
    minimum(
      U64_MAX,
      maximum(hitOutLastHour, hitOutThisHour) *
        BigInt(STOCK.hourlyHitOutMultiple),
    ),
  );
}
export function rotateStockHour<
  T extends Pick<
    Machine,
    "stock_hour_index" | "stock_bought_hour" | "stock_sold_hour"
  >,
>(state: T, now: bigint): T {
  i64(now);
  const hour = maximum(now, 0n) / 3600n;
  return hour === state.stock_hour_index
    ? { ...state }
    : {
        ...state,
        stock_hour_index: hour,
        stock_bought_hour: 0n,
        stock_sold_hour: 0n,
      };
}

/** Account bytes and metadata from a single consistent chain read. */
export interface ExecAccountReading {
  address: PublicKey;
  owner: PublicKey;
  data: Uint8Array;
  executable?: boolean;
}
export interface ExecReadings {
  mint: ExecAccountReading;
  ledger: ExecAccountReading;
  vault: ExecAccountReading;
  src: ExecAccountReading;
  solDest: ExecAccountReading;
  oracles: readonly [
    ExecAccountReading,
    ExecAccountReading,
    ExecAccountReading,
    ExecAccountReading,
  ];
  /** The actual top-level instruction list, including the begin under evaluation. */
  execution: {
    stackHeight: number;
    currentIndex: number;
    instructions: readonly TransactionInstruction[];
  };
  /** Rent is read from the cluster, never inferred from a fixed rate. */
  machineLamports: bigint;
  machineRentMinimum: bigint;
}
export interface ExecState {
  /** Selected deployment binds program addresses and the trusted DBC config pin. */
  deployment: ClusterDeployment;
  config: Config;
  machine: Machine;
}
export type ExecCheckResult =
  { ok: true; minOut: bigint } | { ok: false; error: ExecError };
function bytes(
  account: ExecAccountReading,
  length: number,
  code: ExecError,
): Buffer {
  requireExec(account.data.length >= length, code);
  return Buffer.from(account.data);
}
function keyAt(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}
function tokenData(account: ExecAccountReading, code: ExecError): Buffer {
  const data = bytes(account, 165, code);
  requireExec(
    (data[108] === 1 || data[108] === 2) &&
      [72, 109, 129].every((offset) => data.readUInt32LE(offset) <= 1) &&
      (data.length === 165 ||
        (data.length >= 166 && data.length !== 355 && data[165] === 2)),
    code,
  );
  return data;
}
function tokenAccount(
  account: ExecAccountReading,
  mint: PublicKey,
  program: PublicKey,
  owner: PublicKey | null,
  native: boolean,
  code: ExecError,
): bigint {
  const data = tokenData(account, code);
  requireExec(
    account.owner.equals(program) &&
      keyAt(data, 0).equals(mint) &&
      (owner === null || keyAt(data, 32).equals(owner)) &&
      (!native || data.readUInt32LE(109) === 1),
    code,
  );
  return data.readBigUInt64LE(64);
}
function safeMint(account: ExecAccountReading): void {
  const data = bytes(account, 82, "MintNotSafe");
  const token2022 = account.owner.equals(EXTERNAL_IDS.token2022);
  requireExec(
    account.owner.equals(EXTERNAL_IDS.splToken) || token2022,
    "MintNotSafe",
  );
  requireExec(
    (data.length === 82 || (token2022 && data.length >= 166)) &&
      data.readUInt32LE(0) === 0 &&
      data.readUInt32LE(46) === 0 &&
      data[45] === 1 &&
      data[44]! <= FEED_RULES.maxMintDecimals,
    "MintNotSafe",
  );
  if (data.length === 82) return;
  requireExec(data[165] === 1, "MintNotSafe");
  let offset = 166;
  while (offset < data.length) {
    requireExec(offset + 4 <= data.length, "MintNotSafe");
    const type = data.readUInt16LE(offset),
      length = data.readUInt16LE(offset + 2);
    if (type === 0 && length === 0) break;
    requireExec(
      type === ExtensionType.MetadataPointer ||
        type === ExtensionType.TokenMetadata,
      "MintNotSafe",
    );
    offset += 4 + length;
    requireExec(offset <= data.length, "MintNotSafe");
  }
}
function readPyth(
  account: ExecAccountReading,
  feedId: Uint8Array,
  now: bigint,
) {
  const data = bytes(account, 133, "OracleInvalid");
  requireExec(
    account.owner.equals(EXTERNAL_IDS.pythReceiver) &&
      data
        .subarray(0, 8)
        .equals(Buffer.from(PYTH_PRICE_UPDATE_V2_DISCRIMINATOR)) &&
      data[40] === 1 &&
      data.subarray(41, 73).equals(Buffer.from(feedId)),
    "OracleInvalid",
  );
  const price = data.readBigInt64LE(73),
    conf = data.readBigUInt64LE(81),
    exponent = data.readInt32LE(89),
    time = data.readBigInt64LE(93);
  requireExec(price > 0n && exponent >= -18 && exponent <= 0, "OracleInvalid");
  requireExec(
    minimum(maximum(now - time, I64_MIN), I64_MAX) <=
      BigInt(STOCK.pythMaxAgeSeconds),
    "OracleStale",
  );
  requireExec(
    multiply(conf, BPS) <= multiply(BigInt(STOCK.pythMaxConfBps), price),
    "OracleWide",
  );
  return { price, exponent };
}
function readPool(
  pool: ExecAccountReading,
  base: ExecAccountReading,
  quote: ExecAccountReading,
  mint: PublicKey,
) {
  const data = bytes(pool, 261, "OracleInvalid");
  const authority = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_AUTHORITY_SEED), mint.toBuffer()],
    EXTERNAL_IDS.pumpFun,
  )[0];
  const canonical = PublicKey.findProgramAddressSync(
    [
      Buffer.from(PUMP_LAYOUTS.poolSeed),
      Buffer.alloc(2),
      authority.toBuffer(),
      mint.toBuffer(),
      NATIVE_MINT.toBuffer(),
    ],
    EXTERNAL_IDS.pumpSwap,
  )[0];
  requireExec(
    pool.owner.equals(EXTERNAL_IDS.pumpSwap) &&
      pool.address.equals(canonical) &&
      data.subarray(0, 8).equals(PUMPSWAP_POOL_DISCRIMINATOR) &&
      data.readUInt16LE(9) === 0 &&
      keyAt(data, 43).equals(mint) &&
      keyAt(data, 75).equals(NATIVE_MINT) &&
      keyAt(data, 139).equals(base.address) &&
      keyAt(data, 171).equals(quote.address) &&
      data[243] === 0,
    "OracleInvalid",
  );
  requireExec(
    base.owner.equals(EXTERNAL_IDS.splToken) ||
      base.owner.equals(EXTERNAL_IDS.token2022),
    "OracleInvalid",
  );
  const baseReserve = tokenAccount(
    base,
    mint,
    base.owner,
    pool.address,
    false,
    "OracleInvalid",
  );
  const quoteReserve = tokenAccount(
    quote,
    NATIVE_MINT,
    EXTERNAL_IDS.splToken,
    pool.address,
    false,
    "OracleInvalid",
  );
  const virtualQuoteReserve =
    data.readBigUInt64LE(245) + (data.readBigInt64LE(253) << 64n);
  return {
    baseReserve,
    quoteReserve,
    virtualQuoteReserve,
    quoteEffective: effectiveQuote(quoteReserve, virtualQuoteReserve),
  };
}
// External ABI addresses from the pinned D29 IDLs.
const DBC_PROGRAM = EXTERNAL_IDS.meteoraDbc;
const DAMM_V2_PROGRAM = EXTERNAL_IDS.meteoraDammV2;
const DAMM_V2_CONFIG = new PublicKey(METEORA.dammV2Config);
const DBC_POOL_AUTHORITY = new PublicKey(
  "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM",
);
const DAMM_V2_POOL_AUTHORITY = new PublicKey(
  "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
);
const DBC_DISCRIMINATOR = Buffer.from("d5e005d16245775c", "hex");
const DAMM_V2_DISCRIMINATOR = Buffer.from("f19a6d0411b16dbc", "hex");
function meteoraPoolAddress(
  config: PublicKey,
  mint: PublicKey,
  program: PublicKey,
): PublicKey {
  const pair = [mint.toBuffer(), NATIVE_MINT.toBuffer()].sort(Buffer.compare);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), config.toBuffer(), pair[1]!, pair[0]!],
    program,
  )[0];
}
function readU128(data: Buffer, offset: number): bigint {
  return (
    data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n)
  );
}
export interface MeteoraReading {
  migrated: boolean;
  sqrtPrice: bigint;
  recordedQuote: bigint;
  actualQuote: bigint;
  /** DAMM ABI version and liquidity; absent for an unmigrated DBC pool. */
  layoutVersion?: number;
  liquidity?: bigint;
}
/** Decode a canonical D29 reference against an externally pinned launch config. */
export function readMeteora(
  oracles: ExecReadings["oracles"],
  mint: PublicKey,
  expectedDbcConfig: PublicKey,
): MeteoraReading {
  const [dbc, damm, base, quote] = oracles;
  requireExec(
    !expectedDbcConfig.equals(PublicKey.default) &&
      dbc.owner.equals(DBC_PROGRAM) &&
      dbc.address.equals(
        meteoraPoolAddress(expectedDbcConfig, mint, DBC_PROGRAM),
      ),
    "AccountMismatch",
  );
  const dbcData = bytes(dbc, 424, "OracleInvalid");
  requireExec(
    dbcData.subarray(0, 8).equals(DBC_DISCRIMINATOR),
    "OracleInvalid",
  );
  requireExec(
    keyAt(dbcData, 72).equals(expectedDbcConfig) &&
      keyAt(dbcData, 136).equals(mint),
    "AccountMismatch",
  );
  requireExec(dbcData[305] === 0 || dbcData[305] === 1, "OracleInvalid");
  const migrated = dbcData[305] === 1;
  let sqrtPrice: bigint;
  let recordedQuote: bigint;
  let authority: PublicKey;
  let baseKey: PublicKey;
  let quoteKey: PublicKey;
  let layoutVersion: number | undefined;
  let liquidity: bigint | undefined;
  if (migrated) {
    requireExec(
      damm.owner.equals(DAMM_V2_PROGRAM) &&
        damm.address.equals(
          meteoraPoolAddress(DAMM_V2_CONFIG, mint, DAMM_V2_PROGRAM),
        ),
      "AccountMismatch",
    );
    const dammData = bytes(damm, 1112, "OracleInvalid");
    requireExec(
      dammData.subarray(0, 8).equals(DAMM_V2_DISCRIMINATOR),
      "OracleInvalid",
    );
    requireExec(dammData[481] === 0 && dammData[696] === 1, "OracleInvalid");
    requireExec(
      keyAt(dammData, 168).equals(mint) &&
        keyAt(dammData, 200).equals(NATIVE_MINT),
      "AccountMismatch",
    );
    sqrtPrice = readU128(dammData, 456);
    recordedQuote = dammData.readBigUInt64LE(688);
    layoutVersion = dammData[696]!;
    liquidity = readU128(dammData, 360);
    baseKey = keyAt(dammData, 232);
    quoteKey = keyAt(dammData, 264);
    authority = DAMM_V2_POOL_AUTHORITY;
  } else {
    unused([damm]);
    sqrtPrice = readU128(dbcData, 280);
    recordedQuote = dbcData.readBigUInt64LE(240);
    baseKey = keyAt(dbcData, 168);
    quoteKey = keyAt(dbcData, 200);
    authority = DBC_POOL_AUTHORITY;
  }
  requireExec(sqrtPrice > 0n, "OracleInvalid");
  requireExec(
    base.address.equals(baseKey) && quote.address.equals(quoteKey),
    "AccountMismatch",
  );
  requireExec(
    base.owner.equals(EXTERNAL_IDS.splToken) &&
      quote.owner.equals(EXTERNAL_IDS.splToken),
    "AccountMismatch",
  );
  const baseData = tokenData(base, "OracleInvalid");
  const quoteData = tokenData(quote, "OracleInvalid");
  requireExec(
    keyAt(baseData, 0).equals(mint) &&
      keyAt(quoteData, 0).equals(NATIVE_MINT) &&
      keyAt(baseData, 32).equals(authority) &&
      keyAt(quoteData, 32).equals(authority),
    "AccountMismatch",
  );
  requireExec(quoteData.readUInt32LE(109) === 1, "OracleInvalid");
  const actualQuote = quoteData.readBigUInt64LE(64);
  return {
    migrated,
    sqrtPrice,
    recordedQuote,
    actualQuote,
    ...(migrated
      ? { layoutVersion: layoutVersion!, liquidity: liquidity! }
      : {}),
  };
}
function unused(
  accounts: readonly ExecAccountReading[],
  code: ExecError = "AccountMismatch",
): void {
  requireExec(
    accounts.every((a) => a.address.equals(SystemProgram.programId)),
    code,
  );
}
function oracleQuote(
  args: ExecBeginInput,
  readings: ExecReadings,
  bucket: Bucket | undefined,
  now: bigint,
  deployment: ClusterDeployment,
): ExecQuote & { quoteEffective?: bigint } {
  const [o0, o1, o2, o3] = readings.oracles;
  if (bucket?.class === 1) {
    unused([o2, o3], "OracleInvalid");
    const token = readPyth(o0, bucket.oracle.toBytes(), now);
    const sol = readPyth(
      o1,
      Buffer.from(HIT_LIST.solUsdPythFeedId, "hex"),
      now,
    );
    return minOutMajor({
      amount: args.amount,
      solPrice: sol.price,
      solExponent: sol.exponent,
      tokenPrice: token.price,
      tokenExponent: token.exponent,
      decimals: bytes(readings.mint, 82, "AccountMismatch")[44]!,
      sell: args.kind === EXEC_KIND.stockSell,
    });
  }
  if (bucket) {
    requireExec(bucket.class === 2, "BucketInvalid");
    unused([o3], "OracleInvalid");
    requireExec(o0.address.equals(bucket.oracle), "OracleInvalid");
    const pool = readPool(o0, o1, o2, args.mint);
    return {
      ...(args.kind === EXEC_KIND.stockSell ? minOutPoolSell : minOutPoolBuy)({
        ...pool,
        amount: args.amount,
      }),
      quoteEffective: pool.quoteEffective,
    };
  }
  const reference = readMeteora(
    readings.oracles,
    args.mint,
    new PublicKey(deployment.meteora.dbcConfig),
  );
  const slipBps =
    args.kind === EXEC_KIND.burn ? BURN.minOutSlipBps : JACKPOT.minOutSlipBps;
  const reserveBps =
    args.kind === EXEC_KIND.burn
      ? BURN.trancheMaxBpsOfQuoteReserves
      : JACKPOT.trancheMaxBpsOfQuoteReserves;
  // D29: recorded trading reserves exclude accrued fees and vault donations.
  requireExec(
    args.amount <= multiply(reference.recordedQuote, BigInt(reserveBps)) / BPS,
    "TrancheTooLarge",
  );
  return {
    ...minOutMeteoraBuy({
      amount: args.amount,
      sqrtPrice: reference.sqrtPrice,
      slipBps,
    }),
    quoteEffective: reference.recordedQuote,
  };
}
function spacing(last: bigint, seconds: number, now: bigint) {
  requireExec(i64(last + BigInt(seconds)) <= now, "TooSoon");
}
function pair(
  programId: PublicKey,
  args: ExecBeginInput,
  readings: ExecReadings,
): void {
  const { currentIndex, instructions } = readings.execution;
  const current = instructions[currentIndex];
  requireExec(
    !!current &&
      current.programId.equals(programId) &&
      current.data
        .subarray(0, 8)
        .equals(discriminator("global", "exec_begin")) &&
      current.data.length === 18 &&
      current.data[8] === args.kind &&
      current.data[9] === args.bucket &&
      current.data.readBigUInt64LE(10) === args.amount,
    "ExecPairing",
  );
  const own = instructions
    .map((instruction, index) => ({ instruction, index }))
    .filter(
      ({ instruction, index }) =>
        index !== currentIndex && instruction.programId.equals(programId),
    );
  const end = own[0];
  requireExec(
    own.length === 1 &&
      !!end &&
      end.index > currentIndex &&
      end.instruction.data
        .subarray(0, 8)
        .equals(discriminator("global", "exec_end")) &&
      end.instruction.data[8] === args.kind,
    "ExecPairing",
  );
}
function beginBindings(
  programId: PublicKey,
  args: ExecBeginInput,
  readings: ExecReadings,
): void {
  const current =
    readings.execution.instructions[readings.execution.currentIndex]!;
  const expectedKeys = execBeginIx(programId, args).keys;
  requireExec(
    current.keys.length === expectedKeys.length &&
      current.keys.every((meta, index) => {
        const expected = expectedKeys[index]!;
        return (
          meta.pubkey.equals(expected.pubkey) &&
          (!expected.isWritable || meta.isWritable) &&
          (!expected.isSigner || meta.isSigner)
        );
      }),
    "AccountMismatch",
  );
}
/** The opt-in composer places this exact restoration immediately before begin. */
function restoresTokenVault(
  programId: PublicKey,
  args: ExecBeginInput,
  readings: ExecReadings,
): boolean {
  const preceding =
    readings.execution.instructions[readings.execution.currentIndex - 1];
  const payer = preceding?.keys[0]?.pubkey;
  if (!preceding || !payer) return false;
  const expected = createAssociatedTokenAccountIdempotentInstruction(
    payer,
    vaultAta(programId, args.mint, args.tokenProgram),
    vaultAuthPda(programId)[0],
    args.mint,
    args.tokenProgram,
  );
  return (
    preceding.programId.equals(expected.programId) &&
    preceding.data.equals(expected.data) &&
    preceding.keys.length === expected.keys.length &&
    preceding.keys.every((meta, index) => {
      const account = expected.keys[index]!;
      return (
        meta.pubkey.equals(account.pubkey) &&
        (!account.isSigner || meta.isSigner) &&
        (!account.isWritable || meta.isWritable)
      );
    })
  );
}

/** Full begin preflight against account bytes and the proposed top-level transaction. */
export function checkExecBegin(
  state: ExecState,
  args: ExecBeginInput,
  readings: ExecReadings,
  now: bigint,
): ExecCheckResult {
  try {
    const { config, deployment } = state;
    const { programId } = deployment;
    let machine = state.machine;
    requireExec(readings.execution.stackHeight === 1, "NotTopLevel");
    requireExec(
      Number.isInteger(args.kind) &&
        args.kind >= EXEC_KIND.stockBuy &&
        args.kind <= EXEC_KIND.jackpotBuy,
      "InvalidArgument",
    );
    i64(now);
    u64(args.amount);
    const stock = args.kind <= EXEC_KIND.stockSell;
    const phase = machine.phase;
    const permissionlessBurn =
      args.kind === EXEC_KIND.burn && phase === PHASE.done;
    if (!permissionlessBurn) {
      requireExec(
        args.signer.equals(stock ? config.keeper : config.executor),
        "Unauthorized",
      );
      requireExec(
        (config.disabled_roles & (1 << (stock ? 3 : 4))) === 0,
        "RoleDisabled",
      );
      requireExec(
        ((config.admin_paused | config.guardian_paused) &
          (stock ? PAUSE_BITS.stockBuy : PAUSE_BITS.burn)) ===
          0,
        "Paused",
      );
    }
    requireExec(
      args.kind === EXEC_KIND.stockBuy
        ? phase === PHASE.poweredOn || phase === PHASE.onAir
        : args.kind === EXEC_KIND.stockSell
          ? phase === PHASE.onAir || phase === PHASE.buysClosed
          : args.kind === EXEC_KIND.burn
            ? phase >= PHASE.poweredOn && phase <= PHASE.done
            : phase === PHASE.onAir,
      "WrongPhase",
    );
    if (args.kind === EXEC_KIND.stockBuy)
      requireExec(machine.end_ts === 0n || now < machine.end_ts, "SeasonOver");
    if (args.kind === EXEC_KIND.jackpotBuy)
      requireExec(now < machine.end_ts, "SeasonOver");
    pair(programId, args, readings);
    requireExec(machine.exec.kind === 0, "ExecInFlight");
    const bucket = stock ? machine.buckets[args.bucket] : undefined;
    if (stock)
      requireExec(
        Number.isInteger(args.bucket) &&
          args.bucket >= 0 &&
          args.bucket < STOCK.maxBuckets &&
          !!bucket &&
          bucket.class !== 0 &&
          bucket.mint.equals(args.mint),
        "BucketInvalid",
      );
    else
      requireExec(
        args.bucket === BUCKET_NONE &&
          args.mint.equals(config.token_mint) &&
          !args.mint.equals(PublicKey.default),
        "AccountMismatch",
      );
    beginBindings(programId, args, readings);
    requireExec(
      readings.mint.address.equals(args.mint) &&
        readings.mint.owner.equals(args.tokenProgram) &&
        (args.tokenProgram.equals(EXTERNAL_IDS.splToken) ||
          args.tokenProgram.equals(EXTERNAL_IDS.token2022)),
      "AccountMismatch",
    );
    requireExec(
      readings.vault.address.equals(
        vaultAta(programId, args.mint, args.tokenProgram),
      ),
      "VaultMismatch",
    );
    if (
      permissionlessBurn &&
      readings.vault.owner.equals(SystemProgram.programId)
    ) {
      requireExec(
        readings.vault.data.length === 0 &&
          readings.vault.executable !== true &&
          restoresTokenVault(programId, args, readings),
        "VaultMismatch",
      );
    } else {
      tokenAccount(
        readings.vault,
        args.mint,
        args.tokenProgram,
        vaultAuthPda(programId)[0],
        false,
        "VaultMismatch",
      );
    }
    requireExec(
      readings.ledger.address.equals(ledgerPda(programId, args.mint)[0]),
      "LedgerMismatch",
    );
    let ledgerAccounted: bigint;
    if (
      permissionlessBurn &&
      readings.ledger.owner.equals(SystemProgram.programId)
    ) {
      requireExec(
        readings.ledger.data.length === 0 &&
          readings.ledger.executable !== true,
        "LedgerMismatch",
      );
      requireExec(
        machine.final_pool_1pct === 0n &&
          machine.jackpot_tokens === 0n &&
          machine.onepct.every(
            (slot) =>
              slot.amount === 0n ||
              (slot.state !== ONE_PCT_STATE.locked &&
                slot.state !== ONE_PCT_STATE.live),
          ),
        "LedgerMismatch",
      );
      // exec_begin recreates a closed empty ledger from the caller's rent.
      ledgerAccounted = 0n;
    } else {
      requireExec(readings.ledger.owner.equals(programId), "LedgerMismatch");
      try {
        const ledger = decodeMintLedger(readings.ledger.data);
        ledgerAccounted = ledger.accounted;
        requireExec(ledger.mint.equals(args.mint), "LedgerMismatch");
      } catch {
        throw new ExecCheckError("LedgerMismatch");
      }
    }
    const sell = args.kind === EXEC_KIND.stockSell;
    const sourceMint = sell ? args.mint : NATIVE_MINT,
      sourceProgram = sell ? args.tokenProgram : EXTERNAL_IDS.splToken;
    requireExec(
      readings.src.address.equals(
        userAta(args.signer, sourceMint, sourceProgram),
      ),
      "AccountMismatch",
    );
    tokenAccount(
      readings.src,
      sourceMint,
      sourceProgram,
      args.signer,
      !sell,
      "AccountMismatch",
    );
    if (sell) {
      requireExec(
        readings.solDest.address.equals(
          vaultAta(programId, NATIVE_MINT, EXTERNAL_IDS.splToken),
        ),
        "AccountMismatch",
      );
      tokenAccount(
        readings.solDest,
        NATIVE_MINT,
        EXTERNAL_IDS.splToken,
        vaultAuthPda(programId)[0],
        true,
        "AccountMismatch",
      );
    } else unused([readings.solDest]);
    requireExec(
      readings.oracles.every((reading, index) =>
        reading.address.equals(args.oracles[index]!),
      ),
      "AccountMismatch",
    );
    if (args.kind === EXEC_KIND.stockBuy) {
      requireExec(bucket?.enabled === 1, "BucketDisabled");
      safeMint(readings.mint);
    }
    machine = rotateStockHour(rotateHour(machine, now), now);
    const hour = maximum(now, 0n) / 3600n;
    const trendHour = Number(minimum(hour, 0xffffffffn));
    const trendBought =
      bucket?.trend_hour_index === trendHour ? bucket.trend_bought_hour : 0n;
    const trendSold =
      bucket?.trend_hour_index === trendHour ? bucket.trend_sold_hour : 0n;
    const cap = stockCap(machine.hit_out_last_hour, machine.hit_out_this_hour);
    let book = 0n;
    if (stock && bucket) {
      spacing(machine.last_stock_trade_ts, STOCK.tradeMinSpacingSeconds, now);
      const tranche =
        bucket.class === 1
          ? STOCK.majorTrancheMaxLamports
          : STOCK.trendingTrancheMaxLamports;
      if (!sell) {
        requireExec(
          args.amount > 0n &&
            args.amount <= tranche &&
            args.amount <= machine.stock_sol,
          "TrancheTooLarge",
        );
        requireExec(
          add(bucket.cost, args.amount) <= bucket.cap,
          "BucketCapExceeded",
        );
        requireExec(
          add(machine.stock_bought_hour, args.amount) <= cap,
          "HourlyCapReached",
        );
        if (bucket.class === 2) {
          requireExec(
            add(trendBought, args.amount) <= STOCK.trendingHourlyMaxLamports,
            "HourlyCapReached",
          );
          const trending = machine.buckets.reduce(
            (n, b) => (b.class === 2 ? u128(n + b.cost) : n),
            0n,
          );
          const total = machine.buckets.reduce(
            (n, b) => u128(n + b.cost),
            machine.stock_sol,
          );
          requireExec(
            multiply(u128(trending + args.amount), BPS) <=
              multiply(BigInt(STOCK.trendingShareMaxBps), total),
            "TrendingShareExceeded",
          );
        }
      } else {
        book = bookOf(args.amount, bucket.amount, bucket.cost);
        requireExec(book <= tranche, "TrancheTooLarge");
        requireExec(bucket.cost - book >= bucket.reserved, "ReservedCapacity");
        if (!(bucket.class === 1 && phase === PHASE.buysClosed))
          requireExec(
            add(machine.stock_sold_hour, book) <= cap,
            "HourlyCapReached",
          );
        if (bucket.class === 2)
          requireExec(
            add(trendSold, book) <= STOCK.trendingHourlyMaxLamports,
            "HourlyCapReached",
          );
      }
    } else if (args.kind === EXEC_KIND.burn) {
      spacing(machine.last_burn_ts, BURN.minSpacingSeconds, now);
      requireExec(
        args.amount > 0n &&
          args.amount <= BURN.trancheMaxLamports &&
          args.amount <= machine.burn_sol,
        "TrancheTooLarge",
      );
      requireExec(
        add(
          machine.burn_hour_index === hour ? machine.burn_paid_hour : 0n,
          args.amount,
        ) <= BURN.hourlyMaxLamports,
        "HourlyCapReached",
      );
    } else {
      spacing(
        machine.last_jackpot_buy_ts,
        JACKPOT.trancheMinSpacingSeconds,
        now,
      );
      requireExec(
        args.amount > 0n &&
          args.amount <= JACKPOT.trancheMaxLamports &&
          args.amount <= machine.jackpot_sol,
        "TrancheTooLarge",
      );
    }
    const quote = oracleQuote(args, readings, bucket, now, deployment);
    requireExec(quote.minOut > 0n, "OracleInvalid");
    // D12: preserve the smallest already-coverable hit while Pulls are pending.
    if (sell && bucket && bucket.reserved > 0n) {
      const nextAmount = u64(bucket.amount - args.amount);
      const nextCost = u64(bucket.cost - book);
      for (const edition of PACK_EDITIONS) {
        const smallest = tierValue(edition.priceLamports, 1);
        if (
          bucket.cost > 0n &&
          multiply(smallest, bucket.amount) >= bucket.cost
        )
          requireExec(
            nextCost > 0n && multiply(smallest, nextAmount) >= nextCost,
            "ReservedCapacity",
          );
      }
    }
    if (sell) u64(ledgerAccounted - args.amount);
    if (!sell)
      requireExec(
        readings.machineLamports >= args.amount &&
          readings.machineLamports - args.amount >= readings.machineRentMinimum,
        "TrancheTooLarge",
      );
    return { ok: true, minOut: quote.minOut };
  } catch (error) {
    if (error instanceof ExecCheckError)
      return { ok: false, error: error.code };
    throw error;
  }
}
