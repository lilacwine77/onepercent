import { z } from "zod";
import { PublicKeyString, Timestamp, U64String } from "./primitives.js";
export const SwapSellRequest = z.strictObject({
  mint: PublicKeyString,
  amount: U64String,
  taker: PublicKeyString,
});
export const SwapInstruction = z.strictObject({
  programId: PublicKeyString,
  accounts: z.array(
    z.strictObject({
      pubkey: PublicKeyString,
      isSigner: z.boolean(),
      isWritable: z.boolean(),
    }),
  ),
  data: z
    .string()
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const SwapSellResponse = z.strictObject({
  instructions: z.array(SwapInstruction),
  lookupTables: z.record(PublicKeyString, z.array(PublicKeyString)),
  outAmount: U64String,
  minOut: U64String,
  expiresAt: Timestamp,
});
