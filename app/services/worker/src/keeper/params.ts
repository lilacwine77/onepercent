import { z } from "zod";

const positive = z.number().int().positive().safe();
/** Pass the @onepercent/config module. Missing M1/P0 fields fail closed. */
export const keeperParamsSchema = z
  .object({
    SERVICES: z.object({
      keeper: z.object({
        scanSeconds: positive,
        closeVaultPassSeconds: positive,
        teamWithdrawSeconds: positive,
        sendMaxAttempts: positive,
        backoffBaseMs: positive,
        backoffMaxMs: positive,
        settleBacklogAlertSeconds: positive,
        settleP95TargetSeconds: positive,
      }),
      monitor: z.object({ vrfExpiryClusterPerWallet24h: positive }),
      landing: z.object({
        cuMarginBps: positive,
        maxComputeUnitPriceMicroLamports: positive.nullable(),
      }),
    }),
    TX_LIMITS: z.object({
      settlePacksPerTx: positive.max(2),
      maxTxBytes: positive,
    }),
    VRF: z.object({ timeoutSeconds: positive }),
    MONITOR: z.object({
      vrfQueueOccupancyAlertBps: positive,
      vrfExpiriesPerThousandRipsAlert: positive,
    }),
    CU_LIMITS: z.object({
      settle: z.array(positive).length(2),
      refundPull: positive,
    }),
  })
  .superRefine((value, context) => {
    if (
      value.SERVICES.keeper.backoffBaseMs > value.SERVICES.keeper.backoffMaxMs
    )
      context.addIssue({ code: "custom", message: "invalid_backoff" });
  });
export type KeeperParams = z.infer<typeof keeperParamsSchema>;
