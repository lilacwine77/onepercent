import { z } from "zod";
// SWITCH to @onepercent/sdk/api when M2 S4 merges.
export const U64String = z
  .string()
  .regex(/^\d{1,20}$/)
  .transform(BigInt)
  .pipe(
    z
      .bigint()
      .nonnegative()
      .max((1n << 64n) - 1n),
  );
export const U16 = z.number().int().min(0).max(65_535);
export const U32 = z.number().int().min(0).max(4_294_967_295);
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function isPublicKey(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let n = 0n;
  for (const char of value) n = n * 58n + BigInt(alphabet.indexOf(char));
  let bytes = 0;
  for (; n > 0n; n >>= 8n) bytes += 1;
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}
export const PublicKeyString = z.string().refine(isPublicKey);
export const SignatureString = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
export const EditionId = z.enum([
  "original",
  "blue_shift",
  "signature",
  "after_hours",
]);
export const CardKind = z.enum([
  "dust",
  "silver",
  "blue",
  "holo",
  "black",
  "jackpot",
  "one_pct",
  "spotlight",
  "final",
]);
export const Timestamp = z.number().int().safe().nonnegative();
export function wireJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === "bigint" ? entry.toString() : entry,
  );
}
