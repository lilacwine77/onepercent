import { z } from "zod";

const positive = z.number().int().positive().safe();
/** Pass SERVICES from config; operational values have no local defaults. */
export const indexerSettingsSchema = z
  .object({
    indexer: z.object({
      pollMs: positive,
      accountReconcileSeconds: positive,
      deckReconcileSeconds: positive,
      deckChunkBytes: positive,
      fallbackAfterFailures: positive,
      fallbackRecoverSeconds: positive,
      maxLagSecondsForIntake: positive,
      lagAlertSeconds: positive,
    }),
    api: z.object({ sseReplayEvents: positive }),
    transport: z.object({
      rpcTimeoutMs: positive,
      rpcNodeLagMaxAttempts: positive,
      rpcNodeLagBackoffBaseMs: positive,
      rpcNodeLagBackoffMaxMs: positive,
      breakerFailureThreshold: positive,
      breakerOpenSeconds: positive,
    }),
  })
  .refine(
    (value) =>
      value.indexer.maxLagSecondsForIntake < value.indexer.lagAlertSeconds,
  )
  .refine(
    (value) =>
      value.transport.rpcNodeLagBackoffBaseMs <=
      value.transport.rpcNodeLagBackoffMaxMs,
  );
export type IndexerSettings = z.infer<typeof indexerSettingsSchema>;

/** M6.1 supplies monitoring thresholds; S1 records VRF statistics without them. */
export const vrfAlertThresholdsSchema = z.strictObject({
  expiryCluster: positive,
  expiriesPerThousand: positive,
});
export type VrfAlertThresholds = z.infer<typeof vrfAlertThresholdsSchema>;

export const indexerEnvSchema = z.object({
  INDEXER_RPC_URL_FALLBACK: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url({ protocol: /^https?$/ }).optional(),
  ),
  INDEXER_WS_URL: z.url({ protocol: /^wss?$/ }).optional(),
});
