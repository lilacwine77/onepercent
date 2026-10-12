import { z } from "zod";
import {
  PublicKeyString,
  Slot,
  TransactionSignature,
  U64String,
} from "./primitives.js";

export const Block0Buy = z.strictObject({
  slot: Slot,
  signature: TransactionSignature,
  owner: PublicKeyString,
  tokens: U64String,
  lamportsSpent: U64String.nullable(),
  team: z.boolean(),
  role: z.string().min(1).nullable(),
});
export const Block0Response = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending"), asOfSlot: Slot }),
  z.strictObject({
    status: z.literal("ready"),
    asOfSlot: Slot,
    launch: z.strictObject({
      signature: TransactionSignature,
      slot: Slot,
      mint: PublicKeyString,
      // D29 replaces the former bondingCurve wire field with the actual launch pool.
      launchPool: PublicKeyString,
      devBuyTokens: U64String,
    }),
    slots: Slot.positive(),
    buys: z.array(Block0Buy),
  }),
]);
export type Block0Response = z.infer<typeof Block0Response>;

/** Indexer completion notification, never an on-chain program event. */
export const Block0ReadyPayload = z.strictObject({
  name: z.literal("IndexerBlock0Ready"),
  signature: TransactionSignature,
  asOfSlot: z.union([Slot, U64String]),
});
