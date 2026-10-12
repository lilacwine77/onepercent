import { createHash } from "node:crypto";
import * as config from "@onepercent/config";
import { z } from "zod";
import { PublicDataUnavailable, type DraftMachine } from "./draft-layouts.js";

const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const positive = z.number().int().safe().positive();
const economicConfig = z.object({
  BPS_DENOMINATOR: positive,
  PACK_EDITIONS: z
    .array(
      z.object({ priceLamports: z.bigint().positive(), maxPerRip: positive }),
    )
    .length(4),
  CARDS_PER_PACK: z.object({ dust: positive }),
  HIT_TIERS: z.array(z.object({ valueBps: positive })).length(4),
  MAX_LIST_PER_RIP_LAMPORTS: z.bigint().positive(),
  COVERAGE: z.object({
    perPackValueBps: positive,
    dustBuffer: z.number().int().nonnegative(),
  }),
  STOCK: z.object({
    maxBuckets: positive,
    targetBaseLamports: z.bigint().nonnegative(),
  }),
  SELL_BACK: z.object({
    solFloorLamports: z.bigint().nonnegative(),
    hourlyBudgetMinLamports: z.bigint().nonnegative(),
    hourlyBudgetBpsOfStockSol: positive,
  }),
});
export function readEconomics(source: unknown = config) {
  const result = economicConfig.safeParse(source);
  if (!result.success)
    throw new PublicDataUnavailable("m1_parameters_unavailable");
  return result.data;
}
export type Economics = ReturnType<typeof readEconomics>;

/** Exact M1 math mirror; values are always supplied by packages/config. */
export function maxQty(
  edition: number,
  deckLen: number,
  machine: DraftMachine,
  params: Economics,
) {
  const item = params.PACK_EDITIONS[edition];
  if (!item) throw new PublicDataUnavailable("invalid_edition");
  const denom = BigInt(params.BPS_DENOMINATOR);
  const need =
    (item.priceLamports * BigInt(params.COVERAGE.perPackValueBps)) / denom;
  const silver =
    (item.priceLamports * BigInt(params.HIT_TIERS[0]!.valueBps)) / denom;
  if (need === 0n || need > (1n << 64n) - 1n) return 0;
  for (let quantity = item.maxPerRip; quantity > 0; quantity--) {
    if (
      BigInt(deckLen) <
        machine.reservedDust +
          BigInt(
            params.CARDS_PER_PACK.dust * quantity + params.COVERAGE.dustBuffer,
          ) ||
      BigInt(quantity) * item.priceLamports > params.MAX_LIST_PER_RIP_LAMPORTS
    )
      continue;
    const buckets = machine.buckets.slice(0, params.STOCK.maxBuckets);
    const free = buckets.map((b) =>
      b.cost > b.reserved ? b.cost - b.reserved : 0n,
    );
    let covered = true;
    for (let pack = 0; pack < quantity; pack++) {
      let selected = -1,
        largest = -1n;
      buckets.forEach((b, i) => {
        if (
          b.class === 1 &&
          b.enabled === 1 &&
          b.cost > 0n &&
          silver * b.amount >= b.cost &&
          free[i]! > largest
        ) {
          selected = i;
          largest = free[i]!;
        }
      });
      if (selected < 0 || largest < need) {
        covered = false;
        break;
      }
      free[selected] = largest - need;
    }
    if (covered) return quantity;
  }
  return 0;
}
export function rotateHour(machine: DraftMachine, now: bigint): DraftMachine {
  const hourIndex = (now > 0n ? now : 0n) / 3600n;
  if (hourIndex === machine.hourIndex) return { ...machine };
  const u64Max = (1n << 64n) - 1n;
  const nextHour = machine.hourIndex < u64Max ? machine.hourIndex + 1n : u64Max;
  return {
    ...machine,
    hourIndex,
    hitOutLastHour: hourIndex === nextHour ? machine.hitOutThisHour : 0n,
    hitOutThisHour: 0n,
    sbPaidHour: 0n,
    solAtHourStart: machine.stockSol,
  };
}

/** Canonical sorted compiled-key map; decimal strings preserve bigint exactly. */
export function paramsHash(source: unknown = config): string {
  const parsed = z
    .object({
      ONCHAIN_KEYS: z.array(z.object({ path: z.string() })).min(1),
      resolveOnchainKey: z.custom<(path: string) => unknown>(
        (v) => typeof v === "function",
      ),
      validateParams: z.custom<() => unknown>((v) => typeof v === "function"),
    })
    .safeParse(source);
  if (!parsed.success)
    throw new PublicDataUnavailable("m1_parameters_unavailable");
  parsed.data.validateParams();
  const canonical = (value: unknown): unknown => {
    if (typeof value === "bigint") return value.toString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => lexical(a, b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    if (typeof value === "number" && !Number.isSafeInteger(value))
      throw new PublicDataUnavailable("unsafe_parameter");
    if (value === undefined)
      throw new PublicDataUnavailable("missing_parameter");
    return value;
  };
  const values = Object.fromEntries(
    [...parsed.data.ONCHAIN_KEYS]
      .sort((a, b) => lexical(a.path, b.path))
      .map(({ path }) => [
        path,
        canonical(parsed.data.resolveOnchainKey(path)),
      ]),
  );
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
