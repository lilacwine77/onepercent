import { Buffer } from "buffer";
import {
  ACCOUNT_SIZES,
  BPS_DENOMINATOR,
  CARDS_PER_PACK,
  COVERAGE,
  DRAW_TAGS,
  HIT_ODDS,
  HIT_TIERS,
  MAX_LIST_PER_RIP_LAMPORTS,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  PPB_DENOMINATOR,
  TOKEN_1PCT,
  STOCK,
} from "@onepercent/config";
import { fixedBytes, hash, integer, u8, u64, U64_MAX } from "../bytes.js";
import type { Bucket, Machine } from "../layouts.js";
const bps = (value: bigint, ratio: number) =>
  (value * BigInt(ratio)) / BigInt(BPS_DENOMINATOR);
export function splitPack(price: bigint) {
  u64(price);
  const royalty = bps(price, PACK_SPLIT_BPS.royaltyPerDustCard);
  const jackpot = bps(price, PACK_SPLIT_BPS.jackpot);
  const burn = bps(price, PACK_SPLIT_BPS.burn1pct);
  const referral = bps(price, PACK_SPLIT_BPS.referral);
  const team = bps(price, PACK_SPLIT_BPS.team);
  return {
    royalty,
    jackpot,
    burn,
    referral,
    team,
    stock:
      price -
      BigInt(CARDS_PER_PACK.dust) * royalty -
      jackpot -
      burn -
      referral -
      team,
  };
}
export function tierValue(price: bigint, tier: number): bigint {
  const item = HIT_TIERS[tier - 1];
  if (!item) throw new RangeError("Expected stock card kind");
  const value = bps(price, item.valueBps);
  u64(value);
  return value;
}
function editionAt(edition: number) {
  const item = PACK_EDITIONS[edition];
  if (!item) throw new RangeError("Invalid edition");
  return item;
}
/** Spotlight stays absent in Season 1. */
export function segments(
  edition: number,
  liveFlags = 0,
  holder = false,
): [number, number, number, number, number, number] {
  const { priceLamports: price, id } = editionAt(edition);
  const base = price / BigInt(HIT_ODDS.onePctPriceDivisor);
  return [
    liveFlags & 1
      ? Number(
          holder
            ? bps(base, TOKEN_1PCT.holderTier.onePctOddsMultiplierBps)
            : base,
        )
      : 0,
    0,
    liveFlags & 4 ? Number(price / BigInt(HIT_ODDS.jackpotPriceDivisor)) : 0,
    HIT_ODDS.blackPpb,
    HIT_ODDS.holoPpb,
    HIT_ODDS.bluePpb[id],
  ];
}
function sample(
  tag: string,
  randomness: Uint8Array,
  seq: bigint,
  pack: number,
  suffix?: number,
): bigint {
  const parts = [
    Buffer.from(tag),
    fixedBytes(randomness, 32),
    u64(seq),
    u8(pack),
  ];
  if (suffix !== undefined) parts.push(u8(suffix));
  return hash(...parts).readBigUInt64LE();
}
export function drawTier(
  randomness: Uint8Array,
  seq: bigint,
  pack: number,
  edition: number,
  liveFlags = 0,
  holder = false,
) {
  const t = Number(
    (sample(DRAW_TAGS.tier, randomness, seq, pack) * BigInt(PPB_DENOMINATOR)) >>
      64n,
  );
  const widths = segments(edition, liveFlags, holder);
  const kinds = [6, 7, 5, 4, 3, 2];
  let cumulative = 0;
  for (let i = 0; i < widths.length; i++) {
    cumulative += widths[i] ?? 0;
    if (t < cumulative) return { t, widths, tier: kinds[i] as number };
  }
  return { t, widths, tier: 1 };
}
export function dustIndex(
  randomness: Uint8Array,
  seq: bigint,
  pack: number,
  slot: number,
  len: number,
): number {
  integer(len, 0xffffffff);
  return Number(
    (sample(DRAW_TAGS.dust, randomness, seq, pack, slot) * BigInt(len)) >> 64n,
  );
}
export type MathBucket = Pick<
  Bucket,
  "amount" | "cost" | "reserved" | "class" | "enabled"
>;
export const freeCapacity = (bucket: MathBucket): bigint =>
  bucket.cost > bucket.reserved ? bucket.cost - bucket.reserved : 0n;
export function bucketPick(
  randomness: Uint8Array,
  seq: bigint,
  pack: number,
  tier: number,
  value: bigint,
  buckets: readonly MathBucket[],
  backing: number,
): number | null {
  const majorOnly = HIT_TIERS[tier - 1]?.majorOnly;
  if (majorOnly === undefined || value === 0n) return null;
  buckets = buckets.slice(0, STOCK.maxBuckets);
  const candidates = buckets.flatMap((b, index) =>
    b.class !== 0 &&
    b.enabled === 1 &&
    (!majorOnly || b.class === 1) &&
    freeCapacity(b) >= value &&
    value * b.amount >= b.cost
      ? [index]
      : [],
  );
  if (candidates.length === 0)
    return buckets[backing] && freeCapacity(buckets[backing]) >= value
      ? backing
      : null;
  const sum = candidates.reduce(
    (total, i) => total + freeCapacity(buckets[i] as MathBucket),
    0n,
  );
  const total = sum > U64_MAX ? U64_MAX : sum;
  const y = (sample(DRAW_TAGS.bucket, randomness, seq, pack) * total) >> 64n;
  let cumulative = 0n;
  for (const index of candidates) {
    cumulative += freeCapacity(buckets[index] as MathBucket);
    if (y < cumulative) return index;
  }
  return null;
}
export function carve(
  amount: bigint,
  cost: bigint,
  value: bigint,
): { tokens: bigint; amount: bigint; cost: bigint } | null {
  if (cost === 0n || value > cost) return null;
  const tokens = value === cost ? amount : (value * amount) / cost;
  if (tokens === 0n) return null;
  return { tokens, amount: amount - tokens, cost: cost - value };
}
/** D12: every covered stock tier must deliver at least one token base unit. */
export function coverageGranularity(
  price: bigint,
  bucket: MathBucket,
): boolean {
  return bucket.cost > 0n && tierValue(price, 1) * bucket.amount >= bucket.cost;
}
export function coverage(
  price: bigint,
  quantity: number,
  buckets: readonly MathBucket[],
): number[] | null {
  integer(quantity, 255);
  buckets = buckets.slice(0, STOCK.maxBuckets);
  const free = buckets.map(freeCapacity);
  const need = bps(price, COVERAGE.perPackValueBps);
  if (need === 0n || need > U64_MAX) return null;
  const backing: number[] = [];
  for (let pack = 0; pack < quantity; pack++) {
    let selected = -1;
    let largest = -1n;
    buckets.forEach((bucket, i) => {
      if (
        bucket.class === 1 &&
        bucket.enabled === 1 &&
        coverageGranularity(price, bucket) &&
        (free[i] ?? 0n) > largest
      ) {
        selected = i;
        largest = free[i] ?? 0n;
      }
    });
    if (selected === -1 || largest < need) return null;
    free[selected] = largest - need;
    backing.push(selected);
  }
  return backing;
}
export function maxQty(
  edition: number,
  deckLen: number,
  reservedDust: bigint,
  buckets: readonly MathBucket[],
): number {
  const item = editionAt(edition);
  for (let quantity = item.maxPerRip; quantity > 0; quantity--) {
    if (
      BigInt(deckLen) >=
        reservedDust +
          BigInt(CARDS_PER_PACK.dust * quantity + COVERAGE.dustBuffer) &&
      BigInt(quantity) * item.priceLamports <= MAX_LIST_PER_RIP_LAMPORTS &&
      coverage(item.priceLamports, quantity, buckets)
    )
      return quantity;
  }
  return 0;
}
export function deposits(rentPerByte: bigint) {
  if (rentPerByte < 0n) throw new RangeError("Negative rent rate");
  const rent = (size: number) =>
    BigInt(ACCOUNT_SIZES.accountOverhead + size) * rentPerByte;
  return {
    deckEntry: BigInt(ACCOUNT_SIZES.deckEntry) * rentPerByte,
    cardSlot: BigInt(ACCOUNT_SIZES.cardSlot) * rentPerByte,
    binder: rent(ACCOUNT_SIZES.binderHeader),
    mintLedger: rent(ACCOUNT_SIZES.mintLedger),
    vaultSpl: rent(ACCOUNT_SIZES.vaultSpl),
    vaultToken2022: rent(ACCOUNT_SIZES.vaultToken2022),
    pull: (qty: number) =>
      rent(ACCOUNT_SIZES.pullHeader + ACCOUNT_SIZES.pullPerPack * qty),
  };
}
export function feedNonces(
  base: number,
  bits: number,
  count: number,
): number[] {
  integer(base, 0xffffffff);
  integer(bits, 0xffff);
  integer(count, 16);
  const out: number[] = [];
  for (let slot = 0; slot < 16 && out.length < count; slot++)
    if ((bits & (1 << slot)) === 0 && base + slot <= 0xffffffff)
      out.push(base + slot);
  if (out.length !== count) throw new RangeError("Feed nonce window exhausted");
  return out;
}
export function rotateHour<
  T extends Pick<
    Machine,
    | "hour_index"
    | "hit_out_this_hour"
    | "hit_out_last_hour"
    | "sb_paid_hour"
    | "sol_at_hour_start"
    | "stock_sol"
  > &
    Partial<
      Pick<
        Machine,
        "sb_paid_prev_hour" | "bucket_history" | "keeper_history_version"
      >
    >,
>(machine: T, now: bigint): T {
  const hour = (now > 0n ? now : 0n) / 3600n;
  if (hour === machine.hour_index) return { ...machine };
  return {
    ...machine,
    hour_index: hour,
    hit_out_last_hour:
      hour ===
      (machine.hour_index < U64_MAX ? machine.hour_index + 1n : U64_MAX)
        ? machine.hit_out_this_hour
        : 0n,
    hit_out_this_hour: 0n,
    sb_paid_hour: 0n,
    ...(machine.keeper_history_version === undefined
      ? {}
      : {
          keeper_history_version:
            hour === machine.hour_index + 1n &&
            machine.keeper_history_version === 0n
              ? 2n
              : 1n,
        }),
    ...(machine.sb_paid_prev_hour === undefined
      ? {}
      : {
          sb_paid_prev_hour:
            hour === machine.hour_index + 1n ? machine.sb_paid_hour : 0n,
        }),
    ...(machine.bucket_history === undefined
      ? {}
      : {
          bucket_history: machine.bucket_history.map((history) => ({
            ...history,
            sb_inflow_hour: 0n,
            sb_inflow_prev_hour:
              hour === machine.hour_index + 1n ? history.sb_inflow_hour : 0n,
          })),
        }),
    sol_at_hour_start: machine.stock_sol,
  };
}

export * from "./specials.js";
export * from "./creatorFee.js";

export * from "./keeperHistory.js";

export * from "./finalPull.js";
