import * as config from "@onepercent/config";
import { z } from "zod";

const positive = z.number().int().positive().safe();
export const publicSettingsSchema = z.object({
  api: config.serviceApiSchema,
  quote: z.object({
    rateLimitPerMinutePerWallet: positive,
    rateLimitPerMinutePerIp: positive,
  }),
  intake: z.object({
    rateLimitPerMinutePerWallet: positive,
    rateLimitPerMinutePerIp: positive,
  }),
  tx: z.object({
    feedBagsPerTxWithLookupTable: positive,
    txPerSignAll: positive,
    redeemPerTx: positive,
  }),
  transport: config.serviceTransportSchema,
  indexer: z.object({ pollMs: positive }),
});
export type PublicSettings = z.infer<typeof publicSettingsSchema>;

/** G1/P0 supplies these parameters. A missing value is never replaced locally. */
export function loadPublicSettings(): PublicSettings {
  const source = config as Record<string, unknown>;
  const services = z.record(z.string(), z.unknown()).parse(source.SERVICES);
  const parsed = publicSettingsSchema.safeParse({
    ...services,
    intake: source.INTAKE,
    tx: source.TX_LIMITS,
  });
  if (!parsed.success) throw new Error("public_parameters_unavailable");
  return parsed.data;
}
