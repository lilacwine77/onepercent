import * as config from "@onepercent/config";
import { z } from "zod";

// M2 §4.3 [A], provisional until PARAMS issue 3 and P0 export SERVICES.
// No economic parameters live here; unmeasured fee settings remain null.
export const S0_OPERATIONAL_PLACEHOLDERS = {
  keeper: {
    sendMaxAttempts: 5,
    backoffBaseMs: 500,
    backoffMaxMs: 30_000,
    followerRetrySeconds: 5,
    leaderFailoverSeconds: 60,
    scanSeconds: 10,
  },
  signers: { roleRecheckSeconds: 60 },
  monitor: { alertDedupeSeconds: 600 },
  landing: {
    cuMarginBps: 2_000,
    tipLamports: null,
    maxComputeUnitPriceMicroLamports: null,
  },
} as const;
const positive = z.number().int().positive();
export const serviceParamsSchema = z
  .object({
    transport: config.serviceTransportSchema,
    keeper: z.object({
      sendMaxAttempts: positive,
      backoffBaseMs: positive,
      backoffMaxMs: positive,
      followerRetrySeconds: positive,
      leaderFailoverSeconds: positive,
      scanSeconds: positive,
    }),
    signers: z.object({ roleRecheckSeconds: positive }),
    monitor: z.object({ alertDedupeSeconds: positive }),
    landing: z.object({
      cuMarginBps: positive,
      tipLamports: positive.nullable(),
      maxComputeUnitPriceMicroLamports: positive.nullable(),
    }),
  })
  .refine(
    (x) =>
      x.keeper.followerRetrySeconds < x.keeper.leaderFailoverSeconds &&
      x.keeper.backoffBaseMs <= x.keeper.backoffMaxMs,
  )
  .refine(
    (x) => x.transport.rpcTimeoutMs < x.signers.roleRecheckSeconds * 1000,
    {
      path: ["transport", "rpcTimeoutMs"],
      message: "RPC timeout must be shorter than the role recheck interval",
    },
  );
// D14 publishes transport now; P0 will replace the remaining operational placeholders.
export const serviceParams = serviceParamsSchema.parse({
  ...S0_OPERATIONAL_PLACEHOLDERS,
  ...config.SERVICES,
});
