import { WEB } from "@onepercent/config/web";
import { z } from "zod";
import { PublicKeyString, U64String } from "./primitives.js";
// SWITCH to @onepercent/sdk/api when M2 S4 merges.
export const ValueUnavailable = z.strictObject({
  status: z.literal("unavailable"),
  reason: z
    .string()
    .regex(/^[A-Z_]+$/)
    .max(64),
});
export const ValueResponse = z.union([
  z.strictObject({
    status: z.literal("ok"),
    lamports: U64String,
    capped: z.boolean(),
    label: z.literal("if_sold_now"),
  }),
  ValueUnavailable,
]);
export const EstimateValue = z.union([
  z.strictObject({
    status: z.literal("ok"),
    lamports: U64String,
    capped: z.boolean(),
    label: z.literal("est"),
  }),
  ValueUnavailable,
]);
export const ValuesItem = z.strictObject({
  mint: PublicKeyString,
  amount: U64String,
});
export const ValuesRequest = z.strictObject({
  mode: z.enum(["est", "now"]),
  items: z.array(ValuesItem).min(1).max(WEB.valuesBatchMax),
});
export const ValuesResponse = z.strictObject({
  items: z
    .array(
      z.strictObject({
        mint: PublicKeyString,
        amount: U64String,
        symbol: z.string().max(16),
        name: z.string().max(32),
        decimals: z.number().int().min(0).max(255).nullable(),
        logo: z
          .string()
          .regex(/^\/api\/logo\/[1-9A-HJ-NP-Za-km-z]{32,44}$/)
          .nullable(),
        value: z.union([ValueResponse, EstimateValue]),
      }),
    )
    .max(WEB.valuesBatchMax),
});
export type ValuesInput = z.infer<typeof ValuesRequest>;
export type ValuesOutput = z.infer<typeof ValuesResponse>;
export type Value = z.infer<typeof ValueResponse>;
export const valuesRequestSchema = ValuesRequest;
export const valuesResponseSchema = ValuesResponse;
