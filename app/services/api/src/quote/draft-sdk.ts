import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  publicKeySchema,
  timestampSchema,
  u32Schema,
  u64Schema,
} from "./schema.js";

import { ACCOUNT_SIZES, PAUSE_BITS, STOCK } from "@onepercent/config";
import { PHASE, SIZES } from "@onepercent/sdk";
export { attestationExpiry, rotateHour } from "@onepercent/sdk";

// JSON quote projections retain string keys and role-specific validation, unlike
// the raw SDK decoders. Their fixture vectors keep the shared account ABI checked.
export const DRAFT_SDK = {
  configSize: SIZES.config,
  machineSize: SIZES.machine,
  binderHeaderSize: ACCOUNT_SIZES.binderHeader,
  cardSlotSize: ACCOUNT_SIZES.cardSlot,
  bucketSize: SIZES.bucket,
  bucketCount: STOCK.maxBuckets,
  sellBackPause: PAUSE_BITS.sellBack,
  onAirPhase: PHASE.onAir,
  kinds: [
    "dust",
    "silver",
    "blue",
    "holo",
    "black",
    "jackpot",
    "onepct",
    "other",
  ],
} as const;
export const quoteCardSchema = z
  .object({
    mint: publicKeySchema,
    amount: u64Schema,
    value: u64Schema,
    kind: z.number().int().min(0).max(255),
  })
  .strict();
export const quoteBucketSchema = z
  .object({
    mint: publicKeySchema,
    amount: u64Schema,
    cost: u64Schema,
    cap: u64Schema,
    class: z.number().int().min(0).max(2),
    enabled: z.boolean(),
  })
  .strict();
export const quoteMachineSchema = z
  .object({
    phase: z.number().int().min(0).max(6),
    end_ts: z
      .bigint()
      .min(-(1n << 63n))
      .max((1n << 63n) - 1n),
    stock_sol: u64Schema,
    hour_index: u64Schema,
    hit_out_this_hour: u64Schema,
    hit_out_last_hour: u64Schema,
    sb_paid_hour: u64Schema,
    sol_at_hour_start: u64Schema,
    buckets: z.array(quoteBucketSchema).length(DRAFT_SDK.bucketCount),
  })
  .strict();
export const quoteBinderSchema = z
  .object({
    owner: publicKeySchema,
    sb_nonce: u32Schema,
    cards: z.array(quoteCardSchema).max(0xffff),
  })
  .strict();
export const quoteStateSchema = z
  .object({
    asOfSlot: timestampSchema,
    sellBackPaused: z.boolean(),
    machine: quoteMachineSchema,
    binder: quoteBinderSchema,
  })
  .strict();
export type QuoteMachine = z.infer<typeof quoteMachineSchema>;
export type QuoteBinder = z.infer<typeof quoteBinderSchema>;
export type QuoteState = z.infer<typeof quoteStateSchema>;

function discriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}
function key(data: Buffer, offset: number): string {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}
export function decodeMachine(data: Buffer): QuoteMachine {
  if (
    data.length !== DRAFT_SDK.machineSize ||
    !data.subarray(0, 8).equals(discriminator("Machine")) ||
    data[8] !== 1
  )
    throw new Error("machine_unavailable");
  return quoteMachineSchema.parse({
    phase: data[10],
    end_ts: data.readBigInt64LE(56),
    stock_sol: data.readBigUInt64LE(72),
    hour_index: data.readBigUInt64LE(120),
    hit_out_this_hour: data.readBigUInt64LE(128),
    hit_out_last_hour: data.readBigUInt64LE(136),
    sb_paid_hour: data.readBigUInt64LE(144),
    sol_at_hour_start: data.readBigUInt64LE(152),
    buckets: Array.from({ length: DRAFT_SDK.bucketCount }, (_, index) => {
      const offset = 224 + index * DRAFT_SDK.bucketSize;
      if (data[offset + 110]! > 1) throw new Error("bucket_unavailable");
      return {
        mint: key(data, offset),
        amount: data.readBigUInt64LE(offset + 64),
        cost: data.readBigUInt64LE(offset + 72),
        cap: data.readBigUInt64LE(offset + 88),
        class: data[offset + 109],
        enabled: data[offset + 110] === 1,
      };
    }),
  });
}
export function decodeBinder(data: Buffer): QuoteBinder {
  if (
    data.length < DRAFT_SDK.binderHeaderSize ||
    !data.subarray(0, 8).equals(discriminator("Binder"))
  )
    throw new Error("binder_unavailable");
  const len = data.readUInt16LE(104),
    cap = data.readUInt16LE(106),
    reserved = data.readUInt16LE(108);
  if (
    len + reserved > cap ||
    data.length !== DRAFT_SDK.binderHeaderSize + DRAFT_SDK.cardSlotSize * cap
  )
    throw new Error("binder_unavailable");
  return quoteBinderSchema.parse({
    owner: key(data, 8),
    sb_nonce: data.readUInt32LE(92),
    cards: Array.from({ length: len }, (_, index) => {
      const offset =
        DRAFT_SDK.binderHeaderSize + index * DRAFT_SDK.cardSlotSize;
      return {
        mint: key(data, offset),
        amount: data.readBigUInt64LE(offset + 32),
        value: data.readBigUInt64LE(offset + 40),
        kind: data[offset + 48],
      };
    }),
  });
}
export function decodeQuoteConfig(data: Buffer): { sellBackPaused: boolean } {
  if (
    data.length !== DRAFT_SDK.configSize ||
    data[736] !== 1 ||
    !data.subarray(0, 8).equals(discriminator("Config"))
  )
    throw new Error("config_unavailable");
  return {
    sellBackPaused: ((data[740]! | data[741]!) & DRAFT_SDK.sellBackPause) !== 0,
  };
}
