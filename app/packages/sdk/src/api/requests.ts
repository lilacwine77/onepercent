import { z } from "zod";
import {
  Base64,
  BucketClass,
  Hex32,
  PublicKeyString,
  Slot,
  Timestamp,
  U8,
  U16,
  U32,
  U64String,
} from "./primitives.js";

const FeedBagRequest = z.strictObject({
  mint: PublicKeyString,
  amount: U64String.optional(),
});
export const FeedAttestRequest = z
  .strictObject({
    wallet: PublicKeyString,
    chunks: z.array(z.array(FeedBagRequest).min(1)).min(1),
  })
  .refine((request) => {
    const mints = request.chunks.flat().map((bag) => bag.mint);
    return new Set(mints).size === mints.length;
  }, "Mints must be distinct across all chunks");

/** Bounds must come from the merged config, including M1's measurement. */
export function createFeedAttestRequest(limits: {
  feedBagsPerTxWithLookupTable: number;
  txPerSignAll: number;
}) {
  const bags = z
    .number()
    .int()
    .positive()
    .safe()
    .parse(limits.feedBagsPerTxWithLookupTable);
  const chunks = z.number().int().positive().safe().parse(limits.txPerSignAll);
  return FeedAttestRequest.refine(
    (request) =>
      request.chunks.length <= chunks &&
      request.chunks.every((chunk) => chunk.length <= bags),
    "Feed request exceeds the configured transaction bounds",
  );
}

export const FeedRefusal = z.enum([
  "snapshot_not_held",
  "passed_on",
  "hop_sender_ineligible",
  "hop_used",
  "not_bought",
  "zero_balance",
  "live_card",
  "team_wallet",
  "not_whole_bag",
  "feed_closed",
  "fresh_cap",
  "not_pump_fun",
  "not_supported",
  "mint_forbidden",
  "evidence_unavailable",
]);
export const SignerErrorReason = z.enum([
  "indexer_lag",
  "role_mismatch",
  "role_disabled",
  "evidence_unavailable",
  "rate_limited",
  "feed_closed",
]);
export const SignerErrorResponse = z.strictObject({
  reason: SignerErrorReason,
});
export const FeedAttestResponse = z.strictObject({
  asOfSlot: Slot,
  wallet: PublicKeyString,
  signer: PublicKeyString,
  snapshotSlot: Slot,
  attestations: z.array(
    z.strictObject({
      chunk: Slot,
      nonce: U32,
      expiry: Timestamp,
      bagsHash: Hex32,
      message: Base64,
      signature: Base64,
      bags: z
        .array(
          z.strictObject({
            mint: PublicKeyString,
            amount: U64String,
            decimals: U8,
            tokenProgram: PublicKeyString,
            source: PublicKeyString,
            mergeFrom: z.array(PublicKeyString),
          }),
        )
        .min(1),
    }),
  ),
  refused: z.array(
    z.strictObject({
      mint: PublicKeyString,
      reason: FeedRefusal,
      date: z
        .union([z.iso.date(), z.iso.datetime({ offset: true })])
        .nullable(),
    }),
  ),
});

export const SellBackQuoteRequest = z
  .strictObject({ owner: PublicKeyString, cardIndices: z.array(U16).min(1) })
  .refine(
    (request) =>
      new Set(request.cardIndices).size === request.cardIndices.length,
    "Card indices must be distinct",
  );
export function createSellBackQuoteRequest(maxSellBackCards: number) {
  const max = z.number().int().positive().safe().parse(maxSellBackCards);
  return SellBackQuoteRequest.refine(
    (request) => request.cardIndices.length <= max,
    "Sell back request exceeds the configured card bound",
  );
}
export const SellBackRefusalReason = z.enum([
  "INVALID_INPUT",
  "PHASE",
  "KIND",
  "MINT",
  "BUCKET_DISABLED",
  "QUOTE_UNAVAILABLE",
  "SOL_FLOOR",
  "HOURLY_BUDGET",
  "CAP",
]);
export const SellBackQuoteResponse = z.discriminatedUnion("ok", [
  z.strictObject({
    asOfSlot: Slot,
    ok: z.literal(true),
    quote: z.strictObject({
      owner: PublicKeyString,
      mint: PublicKeyString,
      cards: z.array(z.strictObject({ index: U16, amount: U64String })).min(1),
      totalAmount: U64String,
      quoteLamports: U64String,
      stockedValueLamports: U64String,
      valueLamports: U64String,
      payoutLamports: U64String,
      expiry: Timestamp,
      nonce: U32,
      bucketClass: BucketClass,
      message: Base64,
      signature: Base64,
      signer: PublicKeyString,
      router: z.string().min(1),
      requestId: z.string().min(1),
    }),
  }),
  z.strictObject({
    asOfSlot: Slot,
    ok: z.literal(false),
    reason: SellBackRefusalReason,
  }),
]);

export const ValueRequest = z.strictObject({
  mint: PublicKeyString,
  amount: U64String,
});
export const ValueUnavailableReason = z.enum([
  "NO_QUOTE",
  "PROVIDER_ERROR",
  "CAP_UNAVAILABLE",
  "NON_SOL_QUOTE",
  "NO_REAL_RESERVES",
  "QUOTE_EXCEEDS_REAL_RESERVES",
]);
export const ValueResponse = z.discriminatedUnion("status", [
  z.strictObject({
    asOfSlot: Slot,
    status: z.literal("ok"),
    lamports: U64String,
    capped: z.boolean(),
    label: z.literal("if_sold_now"),
  }),
  z.strictObject({
    asOfSlot: Slot,
    status: z.literal("unavailable"),
    reason: ValueUnavailableReason,
  }),
]);

export type FeedAttestRequest = z.infer<typeof FeedAttestRequest>;
export type FeedAttestResponse = z.infer<typeof FeedAttestResponse>;
export type SellBackQuoteRequest = z.infer<typeof SellBackQuoteRequest>;
export type SellBackQuoteResponse = z.infer<typeof SellBackQuoteResponse>;
export type ValueRequest = z.infer<typeof ValueRequest>;
export type ValueResponse = z.infer<typeof ValueResponse>;
export type FeedRefusal = z.infer<typeof FeedRefusal>;
export type SignerErrorReason = z.infer<typeof SignerErrorReason>;
export type SignerErrorResponse = z.infer<typeof SignerErrorResponse>;
export type SellBackRefusalReason = z.infer<typeof SellBackRefusalReason>;
export type ValueUnavailableReason = z.infer<typeof ValueUnavailableReason>;
