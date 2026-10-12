import { TX_LIMITS } from "@onepercent/config";
import { z } from "zod";
import {
  Base64,
  PublicKeyString,
  SellBackQuoteResponse as SharedSellBackQuoteResponse,
  SellBackRefusalReason,
  Slot,
  U16,
  U32,
  U64String,
  createSellBackQuoteRequest,
} from "@onepercent/sdk/api";

export const U64_MAX = (1n << 64n) - 1n;
export const publicKeySchema = PublicKeyString;
export const u16Schema = U16;
export const u32Schema = U32;
export const u64Schema = z.bigint().min(0n).max(U64_MAX);
export const u64StringSchema = U64String;
export const timestampSchema = Slot;
export const base64Schema = Base64;
export const sellBackRefusalSchema = SellBackRefusalReason;
export const sellBackQuoteRequestSchema = createSellBackQuoteRequest(
  TX_LIMITS.redeemPerTx,
);
export const sellBackQuoteResponseSchema = SharedSellBackQuoteResponse;
export type SellBackQuoteRequest = z.infer<typeof sellBackQuoteRequestSchema>;
export type SellBackQuoteResponse = z.infer<typeof sellBackQuoteResponseSchema>;
