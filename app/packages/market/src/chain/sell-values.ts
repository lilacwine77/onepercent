import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  BPS_DENOMINATOR,
  CHAIN_LAYOUT,
  RESERVE_READS,
  MARKET,
  PROGRAM_IDS,
  PUMP_FEES_PROGRAM_ID,
  STOCK,
  WSOL_MINT,
} from "../params.js";
import type { ChainRpc } from "./exit-cap.js";
import {
  decodeBondingCurve,
  decodePumpPool,
  deriveBondingCurve,
  deriveCanonicalPool,
  type BondingCurveFields,
  type PumpPoolFields,
} from "./pump-layouts.js";

const BPS = BigInt(BPS_DENOMINATOR);

export interface SellHolding {
  mint: string;
  amount: bigint;
}
export type SellValueReason =
  | "UNREAD"
  | "CAP_UNAVAILABLE"
  | "NO_REAL_RESERVES"
  | "NON_SOL_QUOTE"
  | "NO_ROUTE"
  | "QUOTE_EXCEEDS_REAL_RESERVES";
export interface SellValue {
  lamports?: bigint;
  slot?: number;
  reason?: SellValueReason;
}
export interface SellValues {
  values: Map<string, SellValue>;
  partial: boolean;
}
export interface ReserveAccount {
  owner: string;
  data: Uint8Array;
}
export interface SellValueContext {
  /** Already-read BondingCurve accounts, keyed by their PDA. */
  curveAccounts?: ReadonlyMap<string, ReserveAccount | null>;
  /**
   * Internal caller's canonical PDA derivations, after its origin checks.
   * Reused only with preloaded account evidence; never accept this from HTTP input.
   */
  verifiedCurveAddresses?: ReadonlyMap<string, string>;
  /** Slot of the already-read curve evidence. Without one curves are reread. */
  slot?: number;
  signal?: AbortSignal;
}
interface AccountReading {
  account: ReserveAccount | null;
  slot: number;
}
async function continueCpuBatch(
  processed: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  if (processed > 0 && processed % RESERVE_READS.CPU_BATCH_SIZE === 0)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return !signal?.aborted;
}
const batchSchema = z.object({
  context: z.object({ slot: z.number().int().nonnegative() }),
  value: z.array(
    z
      .object({
        owner: z.string(),
        data: z.tuple([z.string(), z.literal("base64")]),
      })
      .nullable(),
  ),
});

function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Reserve lookup expired"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    void work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Each failed batch leaves its own accounts absent; healthy batches survive. */
async function readAccounts(
  rpc: ChainRpc,
  addresses: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, AccountReading>> {
  const unique = [...new Set(addresses)];
  const result = new Map<string, AccountReading>();
  let next = 0;
  await Promise.all(
    Array.from({ length: RESERVE_READS.BATCH_CONCURRENCY }, async () => {
      while (next < unique.length && !signal?.aborted) {
        const batch = unique.slice(
          next,
          next + RESERVE_READS.ACCOUNTS_PER_BATCH,
        );
        next += batch.length;
        try {
          const response = await abortable(
            rpc.call(batchSchema, "getMultipleAccounts", [
              batch,
              { encoding: "base64", commitment: "confirmed" },
            ]),
            signal,
          );
          if (response.value.length !== batch.length) continue;
          for (const [index, address] of batch.entries()) {
            const account = response.value[index];
            result.set(address, {
              account: account
                ? {
                    owner: account.owner,
                    data: Buffer.from(account.data[0], "base64"),
                  }
                : null,
              slot: response.context.slot,
            });
          }
        } catch {
          // An unread reserve is unknown, never a zero balance.
        }
      }
    }),
  );
  return result;
}

function outputAfterFee(
  amount: bigint,
  baseReserve: bigint,
  quoteReserve: bigint,
  realQuoteReserve: bigint,
  feeBps: number,
  roundingMargin: bigint,
): SellValue {
  if (amount < 0n) return { reason: "CAP_UNAVAILABLE" };
  if (amount === 0n) return { lamports: 0n };
  if (baseReserve <= 0n || quoteReserve <= 0n || realQuoteReserve <= 0n)
    return { reason: "NO_REAL_RESERVES" };
  const gross = (amount * quoteReserve) / (baseReserve + amount);
  if (gross > realQuoteReserve)
    return { reason: "QUOTE_EXCEEDS_REAL_RESERVES" };
  // Frozen X2 fee allowance. Integer rounding always lowers displayed proceeds.
  const net = (gross * (BPS - BigInt(feeBps))) / BPS - roundingMargin;
  return { lamports: net > 0n ? net : 0n };
}

export function curveSellValue(
  curve: BondingCurveFields,
  amount: bigint,
): SellValue {
  if (curve.complete) return { reason: "NO_ROUTE" };
  if (
    curve.quoteMint !== PublicKey.default.toBase58() &&
    curve.quoteMint !== WSOL_MINT
  )
    return { reason: "NON_SOL_QUOTE" };
  if (curve.creatorFeeBps !== 0n) return { reason: "CAP_UNAVAILABLE" };
  return outputAfterFee(
    amount,
    curve.virtualTokenReserves,
    curve.virtualQuoteReserves,
    curve.realQuoteReserves,
    MARKET.exitCap.curveFeeBps,
    1n, // Two separately rounded fees can exceed one rounded total by one.
  );
}

export function poolSellValue(
  pool: PumpPoolFields,
  amount: bigint,
  baseReserve: bigint,
  quoteReserve: bigint,
): SellValue {
  if (pool.quoteMint !== WSOL_MINT) return { reason: "NON_SOL_QUOTE" };
  if (pool.creatorFeeBps !== 0n) return { reason: "CAP_UNAVAILABLE" };
  return outputAfterFee(
    amount,
    baseReserve,
    quoteReserve + pool.virtualQuoteReserves,
    quoteReserve - pool.protocolFees - pool.creatorFees,
    STOCK.trendingPoolFeeAllowanceBps,
    2n, // Three separately rounded fees can exceed one rounded total by two.
  );
}

// FeeConfig layout from the published pump_fees IDL. Only the SOL schedule is
// consumed; later stable/exotic schedules cannot change SOL-pair fee selection.
function feeConfigAddress(program: string): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), new PublicKey(program).toBuffer()],
    new PublicKey(PUMP_FEES_PROGRAM_ID),
  )[0].toBase58();
}
function feeAllowanceVerified(
  reading: AccountReading | undefined,
  allowance: number,
  includeLp: boolean,
): boolean {
  const account = reading?.account;
  if (!account || account.owner !== PUMP_FEES_PROGRAM_ID) return false;
  const data = Buffer.from(account.data);
  if (
    data.length <
      RESERVE_READS.FEE_TIERS_LENGTH_OFFSET + CHAIN_LAYOUT.u32Bytes ||
    data.subarray(0, CHAIN_LAYOUT.discriminatorBytes).toString("hex") !==
      "8f3492bbdb7b4c9b"
  )
    return false;
  const count = data.readUInt32LE(RESERVE_READS.FEE_TIERS_LENGTH_OFFSET);
  if (
    count === 0 ||
    count >
      (data.length -
        RESERVE_READS.FEE_TIERS_LENGTH_OFFSET -
        CHAIN_LAYOUT.u32Bytes) /
        RESERVE_READS.FEE_TIER_BYTES
  )
    return false;
  for (let index = 0; index < count; index += 1) {
    const offset =
      RESERVE_READS.FEE_TIERS_LENGTH_OFFSET +
      CHAIN_LAYOUT.u32Bytes +
      index * RESERVE_READS.FEE_TIER_BYTES +
      RESERVE_READS.FEE_TIER_THRESHOLD_BYTES;
    const lp = data.readBigUInt64LE(offset);
    const protocol = data.readBigUInt64LE(
      offset + RESERVE_READS.FEE_COMPONENT_BYTES,
    );
    const creator = data.readBigUInt64LE(
      offset + RESERVE_READS.FEE_COMPONENT_BYTES * 2,
    );
    if (protocol + creator + (includeLp ? lp : 0n) > BigInt(allowance))
      return false;
  }
  return true;
}

function vaultAmount(
  reading: AccountReading | undefined,
  mint: string,
  poolAddress: string,
): bigint | undefined {
  const account = reading?.account;
  if (
    !account ||
    (account.owner !== PROGRAM_IDS.splToken &&
      account.owner !== PROGRAM_IDS.token2022)
  )
    return undefined;
  const data = Buffer.from(account.data);
  if (
    data.length < RESERVE_READS.TOKEN_ACCOUNT_BYTES ||
    data[RESERVE_READS.TOKEN_STATE_OFFSET] !== 1 ||
    new PublicKey(data.subarray(0, RESERVE_READS.KEY_BYTES)).toBase58() !==
      mint ||
    new PublicKey(
      data.subarray(RESERVE_READS.KEY_BYTES, RESERVE_READS.KEY_BYTES * 2),
    ).toBase58() !== poolAddress
  )
    return undefined;
  return data.readBigUInt64LE(RESERVE_READS.TOKEN_AMOUNT_OFFSET);
}

/** Reserve-derived sell amounts. No prices, per-mint RPC, or Jupiter calls. */
export function createSellValuesReader(rpc: ChainRpc) {
  return async function getSellValues(
    holdings: readonly SellHolding[],
    context: SellValueContext = {},
  ): Promise<SellValues> {
    const values = new Map<string, SellValue>();
    const amounts = new Map<string, bigint>();
    for (const holding of holdings)
      amounts.set(
        holding.mint,
        (amounts.get(holding.mint) ?? 0n) + holding.amount,
      );
    for (const mint of amounts.keys()) values.set(mint, { reason: "UNREAD" });
    const curveAddresses = new Map<string, string>();
    let processed = 0;
    for (const [mint, amount] of amounts) {
      if (!(await continueCpuBatch(processed++, context.signal))) break;
      if (amount < 0n) {
        values.set(mint, { reason: "CAP_UNAVAILABLE" });
        continue;
      }
      if (amount === 0n) {
        values.set(mint, { lamports: 0n, slot: context.slot ?? 0 });
        continue;
      }
      try {
        const verifiedAddress = context.verifiedCurveAddresses?.get(mint);
        curveAddresses.set(
          mint,
          verifiedAddress && context.curveAccounts?.has(verifiedAddress)
            ? verifiedAddress
            : deriveBondingCurve(mint),
        );
      } catch {
        values.set(mint, { reason: "CAP_UNAVAILABLE" });
      }
    }
    if (curveAddresses.size === 0 || context.signal?.aborted)
      return {
        values,
        partial: [...values.values()].some(
          (value) => value.reason === "UNREAD",
        ),
      };
    const curves = new Map<string, AccountReading>();
    const missing: string[] = [];
    for (const address of curveAddresses.values()) {
      if (context.slot !== undefined && context.curveAccounts?.has(address))
        curves.set(address, {
          account: context.curveAccounts.get(address) ?? null,
          slot: context.slot,
        });
      else missing.push(address);
    }
    const curveFeesAddress = feeConfigAddress(PROGRAM_IDS.pumpFun);
    const poolFeesAddress = feeConfigAddress(PROGRAM_IDS.pumpSwap);
    const reads = await readAccounts(
      rpc,
      [...missing, curveFeesAddress, poolFeesAddress],
      context.signal,
    );
    for (const [address, reading] of reads) curves.set(address, reading);
    const curveFees = reads.get(curveFeesAddress);
    const poolFees = reads.get(poolFeesAddress);
    const curveFeeVerified = feeAllowanceVerified(
      curveFees,
      MARKET.exitCap.curveFeeBps,
      false,
    );
    const poolFeeVerified = feeAllowanceVerified(
      poolFees,
      STOCK.trendingPoolFeeAllowanceBps,
      true,
    );
    const poolAddresses = new Map<string, string>();
    processed = 0;
    for (const [mint, address] of curveAddresses) {
      if (!(await continueCpuBatch(processed++, context.signal))) break;
      const reading = curves.get(address);
      if (!reading) continue;
      if (!reading.account || reading.account.owner !== PROGRAM_IDS.pumpFun) {
        values.set(mint, { reason: "NO_ROUTE" });
        continue;
      }
      try {
        const curve = decodeBondingCurve(Buffer.from(reading.account.data));
        if (curve.complete) {
          if (poolFees && !poolFeeVerified)
            values.set(mint, { reason: "CAP_UNAVAILABLE" });
          else poolAddresses.set(mint, deriveCanonicalPool(mint));
          continue;
        }
        const value = curveSellValue(curve, amounts.get(mint)!);
        if (value.reason) values.set(mint, { ...value, slot: reading.slot });
        else if (curveFees && !curveFeeVerified)
          values.set(mint, { reason: "CAP_UNAVAILABLE" });
        else if (curveFeeVerified && curveFees)
          values.set(mint, {
            ...value,
            slot: Math.min(reading.slot, curveFees.slot),
          });
      } catch {
        // Read but malformed evidence is a final unsupported state (D25).
        values.set(mint, { reason: "CAP_UNAVAILABLE" });
      }
    }
    const pools = await readAccounts(
      rpc,
      [...poolAddresses.values()],
      context.signal,
    );
    const decodedPools = new Map<
      string,
      { pool: PumpPoolFields; address: string; slot: number }
    >();
    processed = 0;
    for (const [mint, address] of poolAddresses) {
      if (!(await continueCpuBatch(processed++, context.signal))) break;
      const reading = pools.get(address);
      if (!reading) continue;
      if (!reading.account || reading.account.owner !== PROGRAM_IDS.pumpSwap) {
        values.set(mint, { reason: "NO_ROUTE" });
        continue;
      }
      try {
        const pool = decodePumpPool(Buffer.from(reading.account.data));
        if (pool.index !== 0 || pool.baseMint !== mint) {
          values.set(mint, { reason: "CAP_UNAVAILABLE" });
          continue;
        }
        if (pool.quoteMint !== WSOL_MINT) {
          values.set(mint, { reason: "NON_SOL_QUOTE" });
          continue;
        }
        if (pool.creatorFeeBps !== 0n) {
          values.set(mint, { reason: "CAP_UNAVAILABLE" });
          continue;
        }
        decodedPools.set(mint, { pool, address, slot: reading.slot });
      } catch {
        values.set(mint, { reason: "CAP_UNAVAILABLE" });
      }
    }
    const vaults = await readAccounts(
      rpc,
      [...decodedPools.values()].flatMap(({ pool }) => [
        pool.baseTokenAccount,
        pool.quoteTokenAccount,
      ]),
      context.signal,
    );
    processed = 0;
    for (const [mint, { pool, address, slot }] of decodedPools) {
      if (!(await continueCpuBatch(processed++, context.signal))) break;
      const base = vaults.get(pool.baseTokenAccount);
      const quote = vaults.get(pool.quoteTokenAccount);
      const baseAmount = vaultAmount(base, mint, address);
      const quoteAmount = vaultAmount(quote, WSOL_MINT, address);
      if (
        (base && baseAmount === undefined) ||
        (quote && quoteAmount === undefined)
      ) {
        values.set(mint, { reason: "CAP_UNAVAILABLE" });
        continue;
      }
      if (
        !base ||
        !quote ||
        baseAmount === undefined ||
        quoteAmount === undefined
      )
        continue;
      const value = poolSellValue(
        pool,
        amounts.get(mint)!,
        baseAmount,
        quoteAmount,
      );
      if (value.reason)
        values.set(mint, {
          ...value,
          slot: Math.min(slot, base.slot, quote.slot),
        });
      else if (poolFeeVerified && poolFees)
        values.set(mint, {
          ...value,
          slot: Math.min(slot, base.slot, quote.slot, poolFees.slot),
        });
    }
    return {
      values,
      partial: [...values.values()].some((value) => value.reason === "UNREAD"),
    };
  };
}
