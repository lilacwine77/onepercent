import { z } from "zod";
import {
  EditionId,
  PublicKeyString,
  SignatureString,
  Timestamp,
  U16,
  U64String,
} from "./primitives.js";
export const RoyaltiesRequest = z.strictObject({
  wallet: PublicKeyString,
  before: U64String.optional(),
});
export const RoyaltiesResponse = z.array(
  z.strictObject({
    seq: U64String,
    pack: U16,
    lamports: U64String,
    edition: EditionId,
    mint: PublicKeyString,
    sig: SignatureString,
    ts: Timestamp,
    redirected: z.boolean(),
  }),
);
