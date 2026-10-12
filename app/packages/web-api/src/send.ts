import { z } from "zod";
import { SignatureString } from "./primitives.js";
// Base64 bound for Solana's 1,232-byte packet; signature verification belongs to M3.2's route.
export const SendRequest = z.strictObject({
  tx: z
    .string()
    .min(4)
    .max(1_644)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine(
      (value) =>
        (value.length * 3) / 4 -
          (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0) <=
        1_232,
    ),
});
export const SendResponse = z.strictObject({ signature: SignatureString });
