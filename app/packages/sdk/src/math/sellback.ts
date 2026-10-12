import {
  BPS_DENOMINATOR,
  HIT_TIERS,
  PACK_EDITIONS,
  PAUSE_BITS,
  SELL_BACK,
  STOCK,
} from "@onepercent/config";
import type { PublicKey } from "@solana/web3.js";
import type { SellBackCard } from "../attest.js";
import { U64_MAX } from "../bytes.js";
import { BUCKET_CLASS, MAX_SELL_BACK_CARDS, PHASE } from "../constants.js";
import type { Binder, Bucket, Card, Config, Machine } from "../layouts.js";
import { coverageGranularity, rotateHour } from "./index.js";

export type SellBackError =
  | "Paused"
  | "WrongPhase"
  | "SeasonOver"
  | "RoleDisabled"
  | "ExecInFlight"
  | "InvalidArgument"
  | "CardMoved"
  | "NotSellBackable"
  | "BucketInvalid"
  | "BucketDisabled"
  | "MintNotSafe"
  | "VaultInvariant"
  | "AttestationInvalid"
  | "AttestationExpired"
  | "AttestationReplay"
  | "MathOverflow"
  | "SellBackFloor"
  | "SellBackBudget"
  | "BucketCapExceeded"
  | "ReservedCapacity";

export type SellBackEconomicState = Pick<
  Machine,
  | "stock_sol"
  | "team_sol"
  | "hour_index"
  | "hit_out_this_hour"
  | "hit_out_last_hour"
  | "sb_paid_hour"
  | "sol_at_hour_start"
> & { buckets: readonly Pick<Bucket, "cost">[] };

export interface SellBackPayout {
  value: bigint;
  payout: bigint;
  margin: bigint;
}

export interface SellBackPlan extends SellBackPayout {
  hour: Pick<
    Machine,
    | "hour_index"
    | "hit_out_this_hour"
    | "hit_out_last_hour"
    | "sb_paid_hour"
    | "sol_at_hour_start"
    | "stock_sol"
  >;
  to_team: bigint;
  stock_sol: bigint;
  team_sol: bigint;
  sb_paid_hour: bigint;
  bucket_cost: bigint;
}

class SellBackCheckFailure extends Error {
  constructor(readonly code: SellBackError) {
    super(code);
  }
}

function fail(error: SellBackError): never {
  throw new SellBackCheckFailure(error);
}

function checkedU64(value: bigint): bigint {
  if (value < 0n || value > U64_MAX) fail("MathOverflow");
  return value;
}

/** Exact floor rounding; invalid zero payouts use the program's error name. */
export function sellBackPayout(
  stockedValue: bigint,
  quoteLamports: bigint,
): SellBackPayout {
  checkedU64(stockedValue);
  checkedU64(quoteLamports);
  if (quoteLamports === 0n) fail("InvalidArgument");
  const value = stockedValue < quoteLamports ? stockedValue : quoteLamports;
  const payout =
    (value * BigInt(SELL_BACK.payoutBps)) / BigInt(BPS_DENOMINATOR);
  if (payout === 0n) fail("InvalidArgument");
  return { value, payout, margin: value - payout };
}

/** Pure mirror of the Rust economic checks; neither input is mutated. */
export function sellBackEconomics(
  machine: SellBackEconomicState,
  bucket: Pick<Bucket, "cost" | "cap">,
  stockedValue: bigint,
  quoteLamports: bigint,
  now: bigint,
): SellBackPlan {
  const hour = rotateHour(machine, now);
  const result = sellBackPayout(stockedValue, quoteLamports);
  const book = machine.buckets.reduce(
    (total, item) => total + checkedU64(item.cost),
    checkedU64(machine.stock_sol),
  );
  const below = book < STOCK.targetBaseLamports + hour.hit_out_last_hour;
  const toTeam = below ? 0n : result.margin;
  const debit = checkedU64(result.payout + toTeam);
  if (machine.stock_sol < debit + SELL_BACK.solFloorLamports)
    fail("SellBackFloor");
  const percentBudget =
    (hour.sol_at_hour_start * BigInt(SELL_BACK.hourlyBudgetBpsOfStockSol)) /
    BigInt(BPS_DENOMINATOR);
  const budget =
    percentBudget > SELL_BACK.hourlyBudgetMinLamports
      ? percentBudget
      : SELL_BACK.hourlyBudgetMinLamports;
  const paid = hour.sb_paid_hour + result.payout;
  if (paid > budget) fail("SellBackBudget");
  const cost = bucket.cost + result.value;
  if (cost > bucket.cap) fail("BucketCapExceeded");
  return {
    ...result,
    hour: {
      hour_index: hour.hour_index,
      hit_out_this_hour: hour.hit_out_this_hour,
      hit_out_last_hour: hour.hit_out_last_hour,
      sb_paid_hour: hour.sb_paid_hour,
      sol_at_hour_start: hour.sol_at_hour_start,
      stock_sol: hour.stock_sol,
    },
    to_team: toTeam,
    stock_sol: checkedU64(machine.stock_sol - debit),
    team_sol: checkedU64(machine.team_sol + toTeam),
    sb_paid_hour: checkedU64(paid),
    bucket_cost: checkedU64(cost),
  };
}

/** Account binding and signature evidence must come from the caller's verified reads. */
export interface SellBackCheckState extends SellBackEconomicState {
  phase: Machine["phase"];
  end_ts: Machine["end_ts"];
  exec: Pick<Machine["exec"], "kind">;
  config: Pick<Config, "admin_paused" | "guardian_paused" | "disabled_roles">;
  binder: Pick<Binder, "len" | "sb_nonce">;
  mintSafe: boolean;
  vaultAmount: bigint;
  ledgerAccounted: bigint;
  attestationValid: boolean;
}

export interface SellBackQuote {
  mint: PublicKey;
  cards: readonly SellBackCard[];
  quoteLamports: bigint;
  expiry: bigint;
  nonce: number;
}

export type SellBackCheckResult =
  | ({
      ok: true;
      totalAmount: bigint;
      stockedValue: bigint;
      nonce: number;
    } & SellBackPlan)
  | { ok: false; error: SellBackError };

/** Read-only preflight mirror. The program remains authoritative at execution. */
export function sellBackChecks(
  machine: SellBackCheckState,
  bucket: Pick<
    Bucket,
    "mint" | "class" | "enabled" | "amount" | "cost" | "cap" | "reserved"
  >,
  cards: readonly Pick<Card, "mint" | "amount" | "value" | "kind">[],
  quote: SellBackQuote,
  now: bigint,
): SellBackCheckResult {
  try {
    const { config } = machine;
    if (machine.exec.kind !== 0) fail("ExecInFlight");
    if ((config.admin_paused | config.guardian_paused) & PAUSE_BITS.sellBack)
      fail("Paused");
    if (machine.phase !== PHASE.onAir) fail("WrongPhase");
    if (now >= machine.end_ts) fail("SeasonOver");
    // Quote signer is structural role 6 in the frozen Config encoding.
    if (config.disabled_roles & (1 << 6)) fail("RoleDisabled");
    if (
      quote.cards.length < 1 ||
      quote.cards.length > MAX_SELL_BACK_CARDS ||
      quote.quoteLamports <= 0n ||
      quote.cards.some(
        (card, index) =>
          !Number.isInteger(card.index) ||
          card.index < 0 ||
          card.index > 0xffff ||
          (index > 0 && card.index >= quote.cards[index - 1]!.index),
      )
    )
      fail("InvalidArgument");
    let stockedValue = 0n;
    let totalAmount = 0n;
    for (const requested of quote.cards) {
      const card = cards[requested.index];
      if (
        requested.index >= machine.binder.len ||
        !card ||
        !card.mint.equals(quote.mint) ||
        card.amount !== requested.amount
      )
        fail("CardMoved");
      if (card.kind < 1 || card.kind > 4 || !HIT_TIERS[card.kind - 1]?.sellBack)
        fail("NotSellBackable");
      stockedValue += card.value;
      totalAmount += card.amount;
    }
    if (!bucket.mint.equals(quote.mint) || bucket.class === BUCKET_CLASS.empty)
      fail("BucketInvalid");
    if (bucket.enabled !== 1) fail("BucketDisabled");
    if (!machine.mintSafe) fail("MintNotSafe");
    if (machine.vaultAmount < machine.ledgerAccounted) fail("VaultInvariant");
    checkedU64(totalAmount);
    if (!machine.attestationValid) fail("AttestationInvalid");
    if (
      bucket.class !== BUCKET_CLASS.major &&
      bucket.class !== BUCKET_CLASS.trending
    )
      fail("BucketInvalid");
    const ttl =
      bucket.class === BUCKET_CLASS.major
        ? SELL_BACK.quoteTtlSeconds.major
        : SELL_BACK.quoteTtlSeconds.trending;
    const maxI64 = (1n << 63n) - 1n;
    const maxExpiry = now + BigInt(ttl) > maxI64 ? maxI64 : now + BigInt(ttl);
    if (quote.expiry < now || quote.expiry > maxExpiry)
      fail("AttestationExpired");
    if (quote.nonce !== machine.binder.sb_nonce) fail("AttestationReplay");
    if (quote.nonce === 0xffffffff) fail("MathOverflow");
    checkedU64(stockedValue);
    const plan = sellBackEconomics(
      machine,
      bucket,
      stockedValue,
      quote.quoteLamports,
      now,
    );
    const amount = checkedU64(bucket.amount + totalAmount);
    if (bucket.reserved > 0n) {
      const next = { ...bucket, amount, cost: plan.bucket_cost };
      for (const edition of PACK_EDITIONS)
        if (
          coverageGranularity(edition.priceLamports, bucket) &&
          !coverageGranularity(edition.priceLamports, next)
        )
          fail("ReservedCapacity");
    }
    return {
      ok: true,
      ...plan,
      totalAmount,
      stockedValue,
      nonce: quote.nonce + 1,
    };
  } catch (error) {
    if (!(error instanceof SellBackCheckFailure)) throw error;
    return { ok: false, error: error.code };
  }
}
