import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

/** Integer representation limits; these are not product parameters. */
export const U8 = z.number().int().min(0).max(0xff);
export const U16 = z.number().int().min(0).max(0xffff);
export const U32 = z.number().int().min(0).max(0xffff_ffff);
export const Slot = z.number().int().safe().nonnegative();
export const Timestamp = z.number().int().safe();
const decimalU64Pattern = /^\d{1,20}$/;
export const U64String = z
  .string()
  .regex(decimalU64Pattern)
  .refine(
    (value) =>
      decimalU64Pattern.test(value) && BigInt(value) <= (1n << 64n) - 1n,
    "Outside u64 range",
  );

/** Keep schemas JSON-safe; convert at arithmetic boundaries, without Number. */
export function parseU64(value: unknown): bigint {
  return BigInt(U64String.parse(value));
}

export function formatU64(value: bigint): string {
  return U64String.parse(value.toString());
}

export const PublicKeyString = z.string().refine((value) => {
  try {
    if (value.length < 32 || value.length > 44) return false;
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}, "Expected a canonical base58 public key");

const base58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function hasBase58Length(value: string, byteLength: number): boolean {
  if (value.length > 88) return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false;
  let decoded = 0n;
  for (const character of value) {
    decoded = decoded * 58n + BigInt(base58Alphabet.indexOf(character));
  }
  let length = 0;
  while (decoded !== 0n) {
    decoded >>= 8n;
    length += 1;
  }
  for (const character of value) {
    if (character !== "1") break;
    length += 1;
  }
  return length === byteLength;
}

export const TransactionSignature = z
  .string()
  .max(88)
  .refine((value) => hasBase58Length(value, 64), "Expected a Solana signature");
export const Hex32 = z.string().regex(/^[0-9a-f]{64}$/);
export const Base64 = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return btoa(atob(value)) === value;
    } catch {
      return false;
    }
  }, "Expected canonical padded base64");
export const Cluster = z.enum(["mainnet-beta", "devnet", "localnet"]);
export const BucketClass = z.enum(["MAJOR", "TRENDING"]);
export const PullStatus = z.enum(["pending", "revealed", "closed", "refunded"]);
export const Widths = z.tuple([U32, U32, U32, U32, U32, U32]);
export const StreamEventId = z
  .string()
  .regex(/^\d{1,20}-\d{1,20}-\d{1,20}$/)
  .refine((value) =>
    value.split("-").every((part) => U64String.safeParse(part).success),
  );

export type U64String = z.infer<typeof U64String>;
export type PublicKeyString = z.infer<typeof PublicKeyString>;
export type StreamEventId = z.infer<typeof StreamEventId>;
