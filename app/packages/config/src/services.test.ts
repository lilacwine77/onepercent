import { describe, expect, it } from "vitest";
import {
  MAINNET_RELEASE,
  PARAMS,
  SERVICES,
  serviceTransportSchema,
  validateParams,
} from "./index.js";

describe("D14/D15 service transport", () => {
  it("publishes the independently approved budgets", () => {
    expect(SERVICES.transport).toEqual({
      rpcTimeoutMs: 10_000,
      rpcNodeLagMaxAttempts: 3,
      rpcNodeLagBackoffBaseMs: 100,
      rpcNodeLagBackoffMaxMs: 400,
      dbStatementTimeoutMs: 5_000,
      redisCommandTimeoutMs: 2_000,
      webhookTimeoutMs: 5_000,
      breakerFailureThreshold: 5,
      breakerOpenSeconds: 30,
      shutdownDrainMs: 10_000,
    });
  });

  it("rejects a node lag backoff ceiling below its base delay", () => {
    expect(
      serviceTransportSchema.safeParse({
        ...SERVICES.transport,
        rpcNodeLagBackoffMaxMs: SERVICES.transport.rpcNodeLagBackoffBaseMs - 1,
      }).success,
    ).toBe(false);
  });

  it("rejects nonpositive, fractional and unexpected transport settings", () => {
    for (const key of Object.keys(SERVICES.transport)) {
      for (const value of [0, -1, 0.5, undefined, "1000"]) {
        expect(
          serviceTransportSchema.safeParse({
            ...SERVICES.transport,
            [key]: value,
          }).success,
        ).toBe(false);
      }
    }
    expect(
      serviceTransportSchema.safeParse({ ...SERVICES.transport, unexpected: 1 })
        .success,
    ).toBe(false);
  });
});

describe("PARAMS issue 3 service settings", () => {
  it("publishes the indexer and API values from section 26.1", () => {
    expect(SERVICES.indexer).toEqual({
      pollMs: 2_000,
      accountReconcileSeconds: 300,
      deckReconcileSeconds: 600,
      deckChunkBytes: 262_144,
      fallbackAfterFailures: 5,
      fallbackRecoverSeconds: 600,
      maxLagSecondsForIntake: 30,
      lagAlertSeconds: 60,
    });
    expect(SERVICES.api).toEqual({
      machineMaxAgeMs: 2_000,
      meCacheMs: 2_000,
      rpcPerMinutePerIp: 600,
      rpcMaxDataSliceBytes: 65_536,
      rpcMaxConcurrent: 64,
      rpcMaxConcurrentPerIp: 16,
      rpcMaxResponseBytes: 4 * 1024 * 1024,
      rpcCapacityRetryAfterSeconds: 1,
      valuePerMinutePerIp: 60,
      ssePingSeconds: 15,
      sseReplayEvents: 500,
    });
    expect(PARAMS.SERVICES).toBe(SERVICES);
    expect(validateParams().SERVICES).toEqual(SERVICES);
  });

  it("publishes D24 signer and quote settings without losing role rechecks", () => {
    expect(SERVICES.signers).toEqual({
      roleRecheckSeconds: 60,
      evidenceCacheSeconds: 86_400,
    });
    expect(SERVICES.quote).toEqual({
      rateLimitPerMinutePerWallet: 30,
      rateLimitPerMinutePerIp: 60,
    });
    expect(validateParams().SERVICES).toEqual(SERVICES);
  });

  it.each(["transport", "indexer", "api", "signers", "quote"] as const)(
    "validates every %s value through validateParams",
    (group) => {
      for (const key of Object.keys(SERVICES[group])) {
        for (const value of [
          0,
          -1,
          0.5,
          null,
          undefined,
          "1000",
          NaN,
          Infinity,
        ]) {
          expect(() =>
            validateParams({
              ...PARAMS,
              SERVICES: {
                ...SERVICES,
                [group]: { ...SERVICES[group], [key]: value },
              },
            }),
          ).toThrow();
        }
      }
    },
    15_000,
  );

  it("rejects missing and unexpected service keys", () => {
    for (const group of [
      "transport",
      "indexer",
      "api",
      "signers",
      "quote",
    ] as const) {
      expect(() =>
        validateParams({
          ...PARAMS,
          SERVICES: { ...SERVICES, [group]: undefined },
        }),
      ).toThrow();
      expect(() =>
        validateParams({
          ...PARAMS,
          SERVICES: {
            ...SERVICES,
            [group]: { ...SERVICES[group], unexpected: 1 },
          },
        }),
      ).toThrow();
    }
  });

  it("requires per-IP RPC concurrency to fit within process capacity", () => {
    expect(() =>
      validateParams({
        ...PARAMS,
        SERVICES: {
          ...SERVICES,
          api: {
            ...SERVICES.api,
            rpcMaxConcurrent: SERVICES.api.rpcMaxConcurrentPerIp - 1,
          },
        },
      }),
    ).toThrow();
  });

  it("requires the intake lag limit to precede the lag alert", () => {
    const withLag = (maxLagSecondsForIntake: number) => ({
      ...PARAMS,
      SERVICES: {
        ...SERVICES,
        indexer: { ...SERVICES.indexer, maxLagSecondsForIntake },
      },
    });
    expect(() => validateParams(withLag(59))).not.toThrow();
    expect(() => validateParams(withLag(60))).toThrow();
    expect(() => validateParams(withLag(61))).toThrow();
  });

  it("requires the IP quote limit to cover the wallet quote limit", () => {
    const withIpLimit = (rateLimitPerMinutePerIp: number) => ({
      ...PARAMS,
      SERVICES: {
        ...SERVICES,
        quote: { ...SERVICES.quote, rateLimitPerMinutePerIp },
      },
    });
    expect(() => validateParams(withIpLimit(30))).not.toThrow();
    expect(() => validateParams(withIpLimit(29))).toThrow();
  });

  it("keeps the D15 RPC timeout below the signer role recheck interval", () => {
    const withTimeout = (rpcTimeoutMs: number) => ({
      ...PARAMS,
      SERVICES: {
        ...SERVICES,
        transport: { ...SERVICES.transport, rpcTimeoutMs },
      },
    });
    expect(() => validateParams(withTimeout(59_999))).not.toThrow();
    expect(() => validateParams(withTimeout(60_000))).toThrow();
    expect(() => validateParams(withTimeout(60_001))).toThrow();
  });
});

describe("P0 remaining PARAMS issue 3 service settings", () => {
  it("publishes the keeper, stock, monitor and landing groups", () => {
    expect(SERVICES.keeper).toEqual({
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
    });
    expect(SERVICES.stock).toEqual({
      hitlistReportMaxAgeSeconds: 86_400,
      pythSkipAgeSeconds: 45,
    });
    expect(SERVICES.monitor).toEqual({
      alertDedupeSeconds: 600,
      vrfExpiryClusterPerWallet24h: 3,
      stockCapUsageAlertBps: 8_000,
      stockConditionAlertSeconds: 900,
    });
    expect(SERVICES.landing).toEqual({
      cuMarginBps: 2_000,
      tipLamports: MAINNET_RELEASE.landing.tipLamports ?? 1_000_000,
      maxComputeUnitPriceMicroLamports:
        MAINNET_RELEASE.landing.maxComputeUnitPriceMicroLamports,
    });
  });

  it.each(["keeper", "stock", "monitor", "landing"] as const)(
    "validates each %s key and allows null only for pending measurements",
    (group) => {
      for (const key of Object.keys(SERVICES[group])) {
        const withValue = (value: unknown) => ({
          ...PARAMS,
          SERVICES: {
            ...SERVICES,
            [group]: { ...SERVICES[group], [key]: value },
          },
        });
        for (const value of [0, -1, 0.5, undefined, "1000", NaN, Infinity]) {
          expect(() => validateParams(withValue(value))).toThrow();
        }
        if (
          group === "landing" &&
          (key === "tipLamports" || key === "maxComputeUnitPriceMicroLamports")
        ) {
          expect(() => validateParams(withValue(null))).not.toThrow();
          expect(() => validateParams(withValue(10_000))).not.toThrow();
        } else {
          expect(() => validateParams(withValue(null))).toThrow();
        }
      }
      expect(() =>
        validateParams({
          ...PARAMS,
          SERVICES: { ...SERVICES, [group]: undefined },
        }),
      ).toThrow();
      expect(() =>
        validateParams({
          ...PARAMS,
          SERVICES: {
            ...SERVICES,
            [group]: { ...SERVICES[group], unexpected: 1 },
          },
        }),
      ).toThrow();
    },
    15_000,
  );

  it("requires follower retries before the leader failover limit", () => {
    const withRetry = (followerRetrySeconds: number) => ({
      ...PARAMS,
      SERVICES: {
        ...SERVICES,
        keeper: { ...SERVICES.keeper, followerRetrySeconds },
      },
    });
    expect(() => validateParams(withRetry(59))).not.toThrow();
    expect(() => validateParams(withRetry(60))).toThrow();
    expect(() => validateParams(withRetry(61))).toThrow();
  });

  it("keeps sponsored-price reuse below the on-chain price age bound", () => {
    const withAge = (pythSkipAgeSeconds: number) => ({
      ...PARAMS,
      SERVICES: {
        ...SERVICES,
        stock: { ...SERVICES.stock, pythSkipAgeSeconds },
      },
    });
    expect(() =>
      validateParams(withAge(PARAMS.STOCK.pythMaxAgeSeconds - 1)),
    ).not.toThrow();
    expect(() =>
      validateParams(withAge(PARAMS.STOCK.pythMaxAgeSeconds)),
    ).toThrow();
    expect(() =>
      validateParams(withAge(PARAMS.STOCK.pythMaxAgeSeconds + 1)),
    ).toThrow();
    expect(() =>
      validateParams({
        ...PARAMS,
        STOCK: {
          ...PARAMS.STOCK,
          pythMaxAgeSeconds: SERVICES.stock.pythSkipAgeSeconds,
        },
      }),
    ).toThrow();
  });
});
