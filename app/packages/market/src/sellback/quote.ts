import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { MarketError } from "../errors.js";
import {
  BPS_DENOMINATOR,
  SECONDS_PER_HOUR,
  SELL_BACK,
  STOCK,
  TX_LIMITS,
  U16_MAX,
  U32_MAX,
  U64_MAX,
} from "../params.js";
import type { ValueNow } from "../value/value-now.js";

export interface SellBackCard {
  cardId: string;
  cardIndex: number;
  mint: string;
  amount: bigint;
  valueLamports: bigint;
  kind: string;
}

export interface SellBackBatchInput {
  owner: string;
  cards: readonly SellBackCard[];
  nonce: number;
  nowTs: number;
}

export interface MachineSnapshot {
  phase: string;
  endTs: number;
  stockSolLamports: bigint;
  stockBookLamports: bigint;
  hitOutLastHourLamports: bigint;
  sbHourIndex: number;
  sbPaidHourLamports: bigint;
  stockSolAtHourStartLamports: bigint;
  bucket: {
    mint: string;
    class: "MAJOR" | "TRENDING";
    enabled: boolean;
    bookCostLamports: bigint;
    capLamports: bigint;
  };
}

export interface SellBackMessageInputs {
  owner: string;
  cards: Array<{ cardIndex: number; amount: bigint }>;
  totalAmount: bigint;
  quoteLamports: bigint;
}

interface QuoteBase {
  mint: string;
  amount: bigint;
  payoutLamports: bigint;
  expiresAt: number;
  nonce: number;
}

export interface SellBackBatchQuote extends QuoteBase, SellBackMessageInputs {
  cardIds: string[];
  valueLamports: bigint;
  stockedValueLamports: bigint;
  bucketClass: "MAJOR" | "TRENDING";
  router: string;
  requestId: string;
  quoteFetchedAtMs: number;
}

export interface SellBackQuote extends QuoteBase, SellBackMessageInputs {
  cardId: string;
}

export type SellBackRefusalReason =
  | "INVALID_INPUT"
  | "PHASE"
  | "KIND"
  | "MINT"
  | "BUCKET_DISABLED"
  | "QUOTE_UNAVAILABLE"
  | "SOL_FLOOR"
  | "HOURLY_BUDGET"
  | "CAP";
export type SellBackResult<T> =
  { ok: true; quote: T } | { ok: false; reason: SellBackRefusalReason };

const publicKey = z.string().refine((input) => {
  try {
    new PublicKey(input);
    return true;
  } catch {
    return false;
  }
});
const timestamp = z.number().int().safe().nonnegative();
const u16 = z.number().int().min(0).max(U16_MAX);
const u32 = z.number().int().min(0).max(U32_MAX);
const u64 = z.bigint().min(0n).max(U64_MAX);
const cardSchema = z
  .object({
    cardId: z.string().min(1),
    cardIndex: u16,
    mint: publicKey,
    amount: u64,
    valueLamports: u64,
    kind: z.string(),
  })
  .strict();
const inputSchema = z
  .object({
    owner: publicKey,
    cards: z.array(cardSchema).min(1).max(TX_LIMITS.redeemPerTx),
    nonce: u32,
    nowTs: timestamp,
  })
  .strict();
const snapshotSchema = z
  .object({
    phase: z.string(),
    endTs: timestamp,
    stockSolLamports: u64,
    stockBookLamports: u64,
    hitOutLastHourLamports: u64,
    sbHourIndex: timestamp,
    sbPaidHourLamports: u64,
    stockSolAtHourStartLamports: u64,
    bucket: z
      .object({
        mint: publicKey,
        class: z.enum(["MAJOR", "TRENDING"]),
        enabled: z.boolean(),
        bookCostLamports: u64,
        capLamports: u64,
      })
      .strict(),
  })
  .strict();

function refused(reason: SellBackRefusalReason): SellBackResult<never> {
  return { ok: false, reason };
}

export async function quoteSellBackBatch(
  input: SellBackBatchInput,
  snapshot: MachineSnapshot,
  valueNow: ValueNow,
): Promise<SellBackResult<SellBackBatchQuote>> {
  if (
    !inputSchema.safeParse(input).success ||
    !snapshotSchema.safeParse(snapshot).success ||
    new Set(input.cards.map((card) => card.cardIndex)).size !==
      input.cards.length
  )
    return refused("INVALID_INPUT");
  const amount = input.cards.reduce((sum, card) => sum + card.amount, 0n);
  const stockedValueLamports = input.cards.reduce(
    (sum, card) => sum + card.valueLamports,
    0n,
  );
  if (
    amount > U64_MAX ||
    stockedValueLamports > U64_MAX ||
    !Number.isSafeInteger(
      input.nowTs +
        SELL_BACK.quoteTtlSeconds[
          snapshot.bucket.class === "MAJOR" ? "major" : "trending"
        ],
    )
  )
    return refused("INVALID_INPUT");
  if (snapshot.phase !== "OnAir" || input.nowTs >= snapshot.endTs)
    return refused("PHASE");
  if (
    input.cards.some(
      (card) =>
        !(SELL_BACK.eligibleKinds as readonly string[]).includes(card.kind),
    )
  )
    return refused("KIND");
  const mint = input.cards[0]!.mint;
  if (
    input.cards.some((card) => card.mint !== mint) ||
    mint !== snapshot.bucket.mint
  )
    return refused("MINT");
  if (!snapshot.bucket.enabled) return refused("BUCKET_DISABLED");
  let live;
  try {
    live = await valueNow(mint, amount);
  } catch {
    return refused("QUOTE_UNAVAILABLE");
  }
  if (
    live.status === "unavailable" ||
    live.lamports <= 0n ||
    live.quoteLamports > U64_MAX
  )
    return refused("QUOTE_UNAVAILABLE");
  const valueLamports =
    stockedValueLamports < live.lamports ? stockedValueLamports : live.lamports;
  const payoutLamports =
    (valueLamports * BigInt(SELL_BACK.payoutBps)) / BigInt(BPS_DENOMINATOR);
  const margin = valueLamports - payoutLamports;
  const below =
    snapshot.stockBookLamports <
    STOCK.targetBaseLamports + snapshot.hitOutLastHourLamports;
  const toTeam = below ? 0n : margin;
  if (
    snapshot.stockSolLamports <
    payoutLamports + toTeam + SELL_BACK.solFloorLamports
  )
    return refused("SOL_FLOOR");
  const sameHour =
    Math.floor(input.nowTs / SECONDS_PER_HOUR) === snapshot.sbHourIndex;
  const paid = sameHour ? snapshot.sbPaidHourLamports : 0n;
  const base = sameHour
    ? snapshot.stockSolAtHourStartLamports
    : snapshot.stockSolLamports;
  const proportionalBudget =
    (base * BigInt(SELL_BACK.hourlyBudgetBpsOfStockSol)) /
    BigInt(BPS_DENOMINATOR);
  const budget =
    proportionalBudget > SELL_BACK.hourlyBudgetMinLamports
      ? proportionalBudget
      : SELL_BACK.hourlyBudgetMinLamports;
  if (paid + payoutLamports > budget) return refused("HOURLY_BUDGET");
  if (
    snapshot.bucket.bookCostLamports + valueLamports >
    snapshot.bucket.capLamports
  )
    return refused("CAP");
  return {
    ok: true,
    quote: {
      cardIds: input.cards.map((card) => card.cardId),
      mint,
      amount,
      payoutLamports,
      expiresAt:
        input.nowTs +
        SELL_BACK.quoteTtlSeconds[
          snapshot.bucket.class === "MAJOR" ? "major" : "trending"
        ],
      nonce: input.nonce,
      owner: input.owner,
      cards: input.cards.map(({ cardIndex, amount: cardAmount }) => ({
        cardIndex,
        amount: cardAmount,
      })),
      totalAmount: amount,
      quoteLamports: live.lamports,
      valueLamports,
      stockedValueLamports,
      bucketClass: snapshot.bucket.class,
      router: live.router,
      requestId: live.requestId,
      quoteFetchedAtMs: live.fetchedAtMs,
    },
  };
}

export async function quoteSellBackCard(
  card: SellBackCard,
  context: Omit<SellBackBatchInput, "cards">,
  snapshot: MachineSnapshot,
  valueNow: ValueNow,
): Promise<SellBackResult<SellBackQuote>> {
  const result = await quoteSellBackBatch(
    { ...context, cards: [card] },
    snapshot,
    valueNow,
  );
  if (!result.ok) return result;
  const quote = result.quote;
  return {
    ok: true,
    quote: {
      cardId: card.cardId,
      mint: quote.mint,
      amount: quote.amount,
      payoutLamports: quote.payoutLamports,
      expiresAt: quote.expiresAt,
      nonce: quote.nonce,
      owner: quote.owner,
      cards: quote.cards,
      totalAmount: quote.totalAmount,
      quoteLamports: quote.quoteLamports,
    },
  };
}

export function createSellBackClient(options: { valueNow: ValueNow }) {
  return {
    quoteSellBackBatch: (
      input: SellBackBatchInput,
      snapshot: MachineSnapshot,
    ) => quoteSellBackBatch(input, snapshot, options.valueNow),
    quoteSellBackCard: (
      card: SellBackCard,
      context: Omit<SellBackBatchInput, "cards">,
      snapshot: MachineSnapshot,
    ) => quoteSellBackCard(card, context, snapshot, options.valueNow),
  };
}

const wireU64 = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .transform((input) => BigInt(input))
  .pipe(u64);
const wireBase = {
  mint: publicKey,
  amount: wireU64,
  payoutLamports: wireU64,
  expiresAt: timestamp,
  nonce: u32,
};
const wireMessage = {
  owner: publicKey,
  cards: z
    .array(z.object({ cardIndex: u16, amount: wireU64 }).strict())
    .min(1)
    .max(TX_LIMITS.redeemPerTx),
  totalAmount: wireU64,
  quoteLamports: wireU64,
};
const wireBatchSchema = z
  .object({
    ...wireBase,
    ...wireMessage,
    cardIds: z.array(z.string().min(1)).min(1).max(TX_LIMITS.redeemPerTx),
    valueLamports: wireU64,
    stockedValueLamports: wireU64,
    bucketClass: z.enum(["MAJOR", "TRENDING"]),
    router: z.string(),
    requestId: z.string(),
    quoteFetchedAtMs: timestamp,
  })
  .strict();
const wireSingleSchema = z
  .object({ ...wireBase, ...wireMessage, cardId: z.string().min(1) })
  .strict();
const wireQuoteSchema = z
  .union([wireBatchSchema, wireSingleSchema])
  .refine(
    (quote) =>
      quote.amount === quote.totalAmount &&
      quote.totalAmount ===
        quote.cards.reduce((sum, card) => sum + card.amount, 0n) &&
      new Set(quote.cards.map((card) => card.cardIndex)).size ===
        quote.cards.length &&
      ("cardIds" in quote
        ? quote.cardIds.length === quote.cards.length
        : quote.cards.length === 1),
  );

export function parseSellBackQuote(
  json: string,
): SellBackBatchQuote | SellBackQuote {
  try {
    return wireQuoteSchema.parse(JSON.parse(json));
  } catch {
    throw new MarketError("INVALID_INPUT", {
      message: "Invalid Sell back quote JSON",
    });
  }
}

export function serializeSellBackQuote(
  quote: SellBackBatchQuote | SellBackQuote,
): string {
  try {
    const json = JSON.stringify(quote, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    parseSellBackQuote(json);
    return json;
  } catch {
    throw new MarketError("INVALID_INPUT", {
      message: "Invalid Sell back quote",
    });
  }
}
