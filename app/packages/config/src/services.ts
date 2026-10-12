import { MAINNET_RELEASE } from "./mainnet-release.js";
import { z } from "zod";

// D14/D15: transport budgets are independent of keeper scheduling and retry policy.
const positiveInteger = z.number().int().positive();
export const serviceTransportSchema = z
  .strictObject({
    rpcTimeoutMs: positiveInteger,
    rpcNodeLagMaxAttempts: positiveInteger.safe(),
    rpcNodeLagBackoffBaseMs: positiveInteger.safe(),
    rpcNodeLagBackoffMaxMs: positiveInteger.safe(),
    dbStatementTimeoutMs: positiveInteger,
    redisCommandTimeoutMs: positiveInteger,
    webhookTimeoutMs: positiveInteger,
    breakerFailureThreshold: positiveInteger,
    breakerOpenSeconds: positiveInteger,
    shutdownDrainMs: positiveInteger,
  })
  .refine(
    (transport) =>
      transport.rpcNodeLagBackoffBaseMs <= transport.rpcNodeLagBackoffMaxMs,
    {
      path: ["rpcNodeLagBackoffMaxMs"],
      message: "RPC node lag backoff must cover its base delay.",
    },
  );

export const serviceIndexerSchema = z
  .strictObject({
    pollMs: positiveInteger,
    accountReconcileSeconds: positiveInteger,
    deckReconcileSeconds: positiveInteger,
    deckChunkBytes: positiveInteger,
    fallbackAfterFailures: positiveInteger,
    fallbackRecoverSeconds: positiveInteger,
    maxLagSecondsForIntake: positiveInteger,
    lagAlertSeconds: positiveInteger,
  })
  .refine(
    (indexer) => indexer.maxLagSecondsForIntake < indexer.lagAlertSeconds,
    {
      path: ["maxLagSecondsForIntake"],
      message:
        "The intake lag limit must be lower than the lag alert threshold.",
    },
  );

export const serviceApiSchema = z
  .strictObject({
    machineMaxAgeMs: positiveInteger,
    meCacheMs: positiveInteger,
    rpcPerMinutePerIp: positiveInteger,
    rpcMaxDataSliceBytes: positiveInteger,
    rpcMaxConcurrent: positiveInteger.safe(),
    rpcMaxConcurrentPerIp: positiveInteger.safe(),
    rpcMaxResponseBytes: positiveInteger.safe(),
    rpcCapacityRetryAfterSeconds: positiveInteger.safe(),
    valuePerMinutePerIp: positiveInteger,
    ssePingSeconds: positiveInteger,
    sseReplayEvents: positiveInteger,
  })
  .refine((api) => api.rpcMaxConcurrentPerIp <= api.rpcMaxConcurrent, {
    path: ["rpcMaxConcurrentPerIp"],
    message:
      "The per-IP RPC concurrency limit must fit within process capacity.",
  });

export const serviceSignersSchema = z.strictObject({
  roleRecheckSeconds: positiveInteger,
  evidenceCacheSeconds: positiveInteger,
});

export const serviceQuoteSchema = z
  .strictObject({
    rateLimitPerMinutePerWallet: positiveInteger,
    rateLimitPerMinutePerIp: positiveInteger,
  })
  .refine(
    (quote) =>
      quote.rateLimitPerMinutePerIp >= quote.rateLimitPerMinutePerWallet,
    {
      path: ["rateLimitPerMinutePerIp"],
      message: "The IP quote limit must be at least the wallet quote limit.",
    },
  );

export const serviceKeeperSchema = z
  .strictObject({
    scanSeconds: positiveInteger,
    closeVaultPassSeconds: positiveInteger,
    teamWithdrawSeconds: positiveInteger,
    sendMaxAttempts: positiveInteger,
    backoffBaseMs: positiveInteger,
    backoffMaxMs: positiveInteger,
    followerRetrySeconds: positiveInteger,
    leaderFailoverSeconds: positiveInteger,
    settleP95TargetSeconds: positiveInteger,
    settleBacklogAlertSeconds: positiveInteger,
  })
  .refine(
    (keeper) => keeper.followerRetrySeconds < keeper.leaderFailoverSeconds,
    {
      path: ["followerRetrySeconds"],
      message: "Follower retries must precede the leader failover limit.",
    },
  );

export const serviceStockSchema = z.strictObject({
  hitlistReportMaxAgeSeconds: positiveInteger,
  pythSkipAgeSeconds: positiveInteger,
});

export const serviceMonitorSchema = z.strictObject({
  alertDedupeSeconds: positiveInteger,
  vrfExpiryClusterPerWallet24h: positiveInteger,
  stockCapUsageAlertBps: positiveInteger,
  stockConditionAlertSeconds: positiveInteger,
});

export const serviceLandingSchema = z.strictObject({
  cuMarginBps: positiveInteger,
  tipLamports: positiveInteger.nullable(),
  maxComputeUnitPriceMicroLamports: positiveInteger.nullable(),
});

export const servicesSchema = z
  .strictObject({
    transport: serviceTransportSchema,
    indexer: serviceIndexerSchema,
    api: serviceApiSchema,
    signers: serviceSignersSchema,
    quote: serviceQuoteSchema,
    keeper: serviceKeeperSchema,
    stock: serviceStockSchema,
    monitor: serviceMonitorSchema,
    landing: serviceLandingSchema,
  })
  .refine(
    (services) =>
      services.transport.rpcTimeoutMs <
      services.signers.roleRecheckSeconds * 1000,
    {
      path: ["transport", "rpcTimeoutMs"],
      message: "RPC timeout must be shorter than the role recheck interval.",
    },
  );

// PARAMS issue 3 §26.1
export const SERVICES = {
  transport: serviceTransportSchema.parse({
    rpcTimeoutMs: 10_000,
    // Operational RPC node lag fix (2026-10-11); no economic values.
    rpcNodeLagMaxAttempts: 3,
    rpcNodeLagBackoffBaseMs: 100,
    rpcNodeLagBackoffMaxMs: 400,
    dbStatementTimeoutMs: 5_000,
    redisCommandTimeoutMs: 2_000,
    webhookTimeoutMs: 5_000,
    breakerFailureThreshold: 5,
    breakerOpenSeconds: 30,
    shutdownDrainMs: 10_000,
  }),
  // [OFF] [A] PARAMS issue 3 §26.1.
  indexer: {
    pollMs: 2_000,
    accountReconcileSeconds: 300,
    deckReconcileSeconds: 600,
    deckChunkBytes: 262_144,
    fallbackAfterFailures: 5,
    fallbackRecoverSeconds: 600,
    maxLagSecondsForIntake: 30,
    lagAlertSeconds: 60,
  },
  api: {
    machineMaxAgeMs: 2_000,
    meCacheMs: 2_000,
    rpcPerMinutePerIp: 600,
    rpcMaxDataSliceBytes: 65_536,
    // Public RPC admission amendment (2026-10-11); no economic values.
    rpcMaxConcurrent: 64,
    rpcMaxConcurrentPerIp: 16,
    rpcMaxResponseBytes: 4 * 1024 * 1024,
    rpcCapacityRetryAfterSeconds: 1,
    valuePerMinutePerIp: 60,
    ssePingSeconds: 15,
    sseReplayEvents: 500,
  },
  // D24: M2 §4.3 operational values. Keep the complete signer group because
  // service-kit shallow-merges SERVICES over its role-recheck placeholder.
  signers: { roleRecheckSeconds: 60, evidenceCacheSeconds: 86_400 },
  quote: { rateLimitPerMinutePerWallet: 30, rateLimitPerMinutePerIp: 60 },
  // [OFF] [A] PARAMS issue 3 §26.1.
  keeper: {
    scanSeconds: 10,
    closeVaultPassSeconds: 3_600,
    teamWithdrawSeconds: 3_600,
    sendMaxAttempts: 5,
    backoffBaseMs: 500,
    backoffMaxMs: 30_000,
    followerRetrySeconds: 5,
    leaderFailoverSeconds: 60,
    settleP95TargetSeconds: 5,
    settleBacklogAlertSeconds: 60,
  },
  stock: { hitlistReportMaxAgeSeconds: 86_400, pythSkipAgeSeconds: 45 },
  monitor: {
    alertDedupeSeconds: 600,
    vrfExpiryClusterPerWallet24h: 3,
    stockCapUsageAlertBps: 8_000,
    stockConditionAlertSeconds: 900,
  },
  landing: {
    cuMarginBps: 2_000,
    tipLamports: MAINNET_RELEASE.landing.tipLamports ?? 1_000_000, // Development floor until P1 is supplied.
    maxComputeUnitPriceMicroLamports:
      MAINNET_RELEASE.landing.maxComputeUnitPriceMicroLamports, // P2, PARAMS §26.3
  },
} as const;
