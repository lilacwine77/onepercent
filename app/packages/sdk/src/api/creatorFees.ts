import { z } from "zod";
import {
  Slot,
  Timestamp,
  TransactionSignature,
  U64String,
} from "./primitives.js";

// M4 §11.6: at most 100 collections. Keep the existing route name for clients.
export const CreatorFeesQuery = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().int().max(100))
    .optional()
    .default(100),
});
export const CreatorFeesResponse = z.strictObject({
  asOfSlot: Slot,
  items: z
    .array(
      z.strictObject({
        signature: TransactionSignature,
        ts: Timestamp,
        regime: z.enum(["belowFloor", "season", "afterEnd"]),
        amount: U64String,
        toStock: U64String,
        toBurn: U64String,
        toTeam: U64String,
      }),
    )
    .max(100),
});
export type CreatorFeesResponse = z.infer<typeof CreatorFeesResponse>;
