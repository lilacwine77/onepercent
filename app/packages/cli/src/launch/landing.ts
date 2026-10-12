import { z } from "zod";
import { SERVICES } from "@onepercent/config";

export interface LandingClient {
  sendSingle(encoded: string): Promise<string>;
}
export async function loadLandingClient(): Promise<LandingClient> {
  const { createLandingClient } =
    await import("@onepercent/service-kit/landing");
  return createLandingClient();
}

const positiveBigint = z
  .union([z.bigint(), z.number().int().safe()])
  .transform(BigInt)
  .refine((value) => value > 0n);
export const landingPolicySchema = z.object({
  landing: z.object({
    cuMarginBps: z.number().int().nonnegative(),
    tipLamports: positiveBigint,
    maxComputeUnitPriceMicroLamports: positiveBigint,
  }),
  keeper: z.object({
    sendMaxAttempts: z.number().int().positive(),
    backoffBaseMs: z.number().int().positive(),
  }),
});
export type LaunchPolicy = z.infer<typeof landingPolicySchema>;
export function readLaunchPolicy(
  config: unknown = SERVICES,
): LaunchPolicy | null {
  const result = landingPolicySchema.safeParse(config);
  return result.success ? result.data : null;
}

export function launchPriorityPrice(
  samples: { prioritizationFee: number }[],
  cap: bigint,
) {
  const prices = z
    .array(
      z.object({ prioritizationFee: z.number().int().nonnegative().safe() }),
    )
    .parse(samples)
    .map((s) => BigInt(s.prioritizationFee))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const price = prices[Math.ceil((prices.length * 3) / 4) - 1] ?? 0n;
  return price < cap ? price : cap;
}
