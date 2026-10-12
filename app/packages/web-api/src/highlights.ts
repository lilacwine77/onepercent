import { z } from "zod";
import {
  CardKind,
  EditionId,
  PublicKeyString,
  SignatureString,
  Timestamp,
  U64String,
} from "./primitives.js";
export const HighlightsRequest = z.strictObject({
  window: z.enum(["today", "season"]),
});
export const HighlightsResponse = z.array(
  z.strictObject({
    seq: U64String,
    tier: CardKind,
    edition: EditionId,
    who: PublicKeyString,
    hitValueLamports: U64String,
    sig: SignatureString,
    ts: Timestamp,
  }),
);
