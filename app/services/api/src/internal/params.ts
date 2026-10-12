import * as config from "@onepercent/config";
import { z } from "zod";
import { SignerError } from "./error.js";

const positive = z.number().int().positive().safe();
export const rateParamsSchema = z
  .object({
    rateLimitPerMinutePerWallet: positive,
    rateLimitPerMinutePerIp: positive,
  })
  .refine((p) => p.rateLimitPerMinutePerIp >= p.rateLimitPerMinutePerWallet);
export const intakeParamsSchema = z.object({
  ATTESTATIONS: z.object({
    feedDomain: z.string().min(1),
    feedTtlSeconds: positive.min(10),
  }),
  FEED_RULES: z.object({ freshCapPerWallet: positive }),
  TX_LIMITS: z.object({
    feedBagsPerTxWithLookupTable: positive,
    txPerSignAll: positive.max(16),
  }),
  INTAKE: rateParamsSchema,
  SERVICES: z.object({
    indexer: z.object({ maxLagSecondsForIntake: positive }),
    signers: z.object({ evidenceCacheSeconds: positive }),
  }),
});
export type IntakeParams = z.infer<typeof intakeParamsSchema>;

/** Validate the canonical compiled config; missing values never get local defaults. */
export function loadIntakeParams(source: unknown = config): IntakeParams {
  const parsed = intakeParamsSchema.safeParse(source);
  if (!parsed.success) throw new SignerError(503, "params_unavailable");
  return parsed.data;
}
export function loadQuoteRateParams(source: unknown = config) {
  const parsed = z
    .object({ SERVICES: z.object({ quote: rateParamsSchema }) })
    .safeParse(source);
  if (!parsed.success) throw new SignerError(503, "params_unavailable");
  return parsed.data.SERVICES.quote;
}
