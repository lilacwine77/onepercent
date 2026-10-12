import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVICES } from "@onepercent/config";
import { RpcError, type ServiceRuntime } from "@onepercent/service-kit";
import { attachIndexerShutdown, createIndexer } from "./index.js";
import { indexerEnvSchema, indexerSettingsSchema } from "./settings.js";
import { IndexerTelemetry } from "./telemetry.js";
import { SolanaTxSource } from "./source.js";
import { IndexerStore } from "./store.js";
import { EventPublisher } from "./publication.js";
import { LogsWakeup } from "./wakeup.js";
import { IndexerEngine } from "./engine.js";
import { IndexerMaintenance } from "./maintenance.js";

afterEach(() => vi.restoreAllMocks());

describe("indexer lifecycle", () => {
  it("drains active indexer work before closing shared runtime resources once", async () => {
    let release: () => void = () => {};
    const drained = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stopRuntime = vi.fn(async () => undefined);
    const runtime = { stop: stopRuntime };
    const indexer = { stop: vi.fn(() => drained) };
    attachIndexerShutdown(runtime, indexer);
    const stopping = runtime.stop();
    expect(runtime.stop()).toBe(stopping);
    expect(indexer.stop).toHaveBeenCalledOnce();
    expect(stopRuntime).not.toHaveBeenCalled();
    release();
    await stopping;
    expect(stopRuntime).toHaveBeenCalledOnce();
  });

  it("closes runtime resources even if the indexer cannot drain", async () => {
    const stopRuntime = vi.fn(async () => undefined);
    const runtime = { stop: stopRuntime };
    attachIndexerShutdown(runtime, {
      stop: async () => {
        throw new Error("drain_failed");
      },
    });
    await expect(runtime.stop()).rejects.toThrow("drain_failed");
    expect(stopRuntime).toHaveBeenCalledOnce();
  });

  it("accepts shared operational config without monitoring thresholds", () => {
    expect(indexerSettingsSchema.safeParse(SERVICES).success).toBe(true);
  });

  it("accepts an absent or empty optional fallback and rejects malformed URLs", () => {
    expect(indexerEnvSchema.parse({})).toEqual({});
    expect(indexerEnvSchema.parse({ INDEXER_RPC_URL_FALLBACK: "" })).toEqual({
      INDEXER_RPC_URL_FALLBACK: undefined,
    });
    expect(
      indexerEnvSchema.safeParse({ INDEXER_RPC_URL_FALLBACK: "invalid" })
        .success,
    ).toBe(false);
  });

  it("reports the poll cause safely and keeps the existing stale-status fallback", async () => {
    const x = telemetry();
    const warning = vi.fn();
    const failure = Object.assign(
      new Error(
        'relation "chain_events" does not exist at postgres://postgres:password@localhost/app',
      ),
      { code: "42P01" },
    );
    vi.spyOn(LogsWakeup.prototype, "start").mockImplementation(() => undefined);
    vi.spyOn(IndexerMaintenance.prototype, "start").mockImplementation(
      () => undefined,
    );
    vi.spyOn(IndexerEngine.prototype, "poll").mockRejectedValue(failure);
    vi.spyOn(SolanaTxSource.prototype, "confirmedSlot").mockResolvedValue(100n);
    vi.spyOn(SolanaTxSource.prototype, "blockTime").mockResolvedValue(1_000);
    const stale = vi
      .spyOn(IndexerTelemetry.prototype, "stale")
      .mockResolvedValue(undefined);
    const runtime = {
      ...x.runtime,
      role: "indexer",
      logger: { warn: warning },
      pool: x.pool,
      env: {
        PROGRAM_ID: "11111111111111111111111111111111",
        RPC_URL: "http://localhost:8899",
      },
    } as unknown as ServiceRuntime;
    const indexer = createIndexer(runtime, {
      services: SERVICES,
      royaltyPerDustCardBps: 137,
      env: { INDEXER_RPC_URL_FALLBACK: "http://localhost:8898" },
    });
    try {
      await expect(indexer.start()).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        {
          reason: "indexer_poll_failed",
          cause: {
            code: "42P01",
            detail: 'relation "chain_events" does not exist at <redacted>',
          },
        },
        "indexer poll failed",
      );
      expect(stale).toHaveBeenCalledExactlyOnceWith(100n, 1_000);
    } finally {
      await indexer.stop();
    }
  });
});

function telemetry(vrfAlerts?: {
  expiryCluster: number;
  expiriesPerThousand: number;
}) {
  const values = new Map<string, string>();
  const set = vi.fn(async (key: string, value: string) => {
    values.set(key, value);
    return "OK";
  });
  const alert = vi.fn(async () => undefined);
  const runtime = {
    redis: {
      set,
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      del: vi.fn(async (key: string) => values.delete(key)),
    },
    alerts: { alert },
    metrics: { indexerLagSlots: { set: vi.fn() } },
  } as unknown as ConstructorParameters<typeof IndexerTelemetry>[0];
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes("FROM season_launches")
      ? []
      : [{ buyer: "wallet", refunds: "3", opened: "10" }],
  }));
  const pool = {
    query,
  } as unknown as ConstructorParameters<typeof IndexerTelemetry>[1];
  const instance = new IndexerTelemetry(runtime, pool, {
    lagAlertSeconds: SERVICES.indexer.lagAlertSeconds,
    vrfAlerts,
  });
  return { instance, runtime, pool, set, alert, query, values };
}

describe("indexer VRF monitoring boundary", () => {
  it("persists statistics and freshness without inventing alert thresholds", async () => {
    const x = telemetry();
    await x.instance.healthy(100n, 80n, 1000, 1000, 100n);
    expect(x.query).toHaveBeenCalledOnce();
    const vrf = x.set.mock.calls.find(([key]) => key === "onepct:indexer:vrf");
    expect(JSON.parse(vrf![1] as string)).toEqual({
      opened: "10",
      refunds: "3",
      expiriesPerThousand: "300",
      asOfSlot: "100",
    });
    expect(x.alert).not.toHaveBeenCalled();
  });

  it("uses explicitly supplied M6.1 thresholds when available", async () => {
    const x = telemetry({ expiryCluster: 3, expiriesPerThousand: 10 });
    await x.instance.healthy(100n, 80n, 1000, 1000, 100n);
    expect(x.alert).toHaveBeenCalledWith(
      "vrf_expiry_cluster:wallet",
      "warning",
      { buyer: "wallet", refunds: "3" },
    );
    expect(x.alert).toHaveBeenCalledWith("vrf_expiry_rate", "warning", {
      opened: "10",
      refunds: "3",
    });
  });
});

describe("indexer lag", () => {
  it.each([-32004, -32016, -32007, -32009])(
    "defers node lag %s without a failed poll or refreshed scan evidence",
    async (code) => {
      const x = telemetry();
      await x.instance.healthy(90n, 80n, 990, 990, 90n);
      const previous = JSON.parse(x.values.get("onepct:indexer:status")!);
      vi.spyOn(SolanaTxSource.prototype, "finalizedSlot")
        .mockRejectedValueOnce(new RpcError(code))
        .mockResolvedValue(95n);
      vi.spyOn(SolanaTxSource.prototype, "confirmedSlot").mockResolvedValue(
        100n,
      );
      vi.spyOn(SolanaTxSource.prototype, "blockTime").mockResolvedValue(1000);
      vi.spyOn(SolanaTxSource.prototype, "transactions").mockResolvedValue([]);
      vi.spyOn(IndexerStore.prototype, "pendingFinality").mockResolvedValue([]);
      vi.spyOn(IndexerStore.prototype, "cursor").mockResolvedValue({
        lastSignature: "old",
        lastSlot: 80n,
      });
      vi.spyOn(IndexerStore.prototype, "lastAppliedSlot").mockResolvedValue(
        80n,
      );
      vi.spyOn(EventPublisher.prototype, "flush").mockResolvedValue(undefined);
      const runtime = {
        ...x.runtime,
        role: "indexer",
        logger: { warn: vi.fn() },
        pool: x.pool,
        env: {
          PROGRAM_ID: "11111111111111111111111111111111",
          RPC_URL: "http://localhost:8899",
        },
      } as unknown as ServiceRuntime;
      const indexer = createIndexer(runtime, {
        services: SERVICES,
        royaltyPerDustCardBps: 137,
        env: {},
      });
      try {
        await expect(indexer.engine.poll()).resolves.toBeUndefined();
        expect(
          JSON.parse(x.values.get("onepct:indexer:status")!),
        ).toMatchObject({
          available: false,
          reason: "rpc_node_lag",
          scanSlot: "90",
          lastEventSlot: "80",
          chainTime: 990,
          checkedAt: previous.checkedAt,
        });
        await expect(indexer.engine.poll()).resolves.toBeUndefined();
        const recovered = JSON.parse(x.values.get("onepct:indexer:status")!);
        expect(recovered).toMatchObject({ scanSlot: "100", lagSlots: "0" });
        expect(recovered.available).toBeUndefined();
        expect(runtime.logger.warn).not.toHaveBeenCalled();
      } finally {
        await indexer.stop();
      }
    },
  );

  it("reports confirmed minus scanned slots and block time lag on successful and failed polls", async () => {
    const x = telemetry();
    await x.instance.healthy(100n, 80n, 1060, 1000, 95n);
    expect(JSON.parse(x.values.get("onepct:indexer:status")!)).toMatchObject({
      asOfSlot: "95",
      scanSlot: "95",
      lastEventSlot: "80",
      confirmedSlot: "100",
      chainTime: 1000,
      lagSlots: "5",
      lagSeconds: 60,
    });
    expect(x.values.get("onepct:indexer:lag_slots")).toBe("5");
    expect(x.alert).toHaveBeenCalledWith("indexer_lag", "warning", {
      lagSlots: "5",
      lagSeconds: 60,
    });
    await x.instance.stale(130n, 1090);
    expect(JSON.parse(x.values.get("onepct:indexer:status")!)).toMatchObject({
      available: false,
      asOfSlot: "95",
      scanSlot: "95",
      lastEventSlot: "80",
      confirmedSlot: "130",
      confirmedTime: 1090,
      chainTime: 1000,
      lagSlots: "35",
      lagSeconds: 90,
    });
    expect(x.alert).toHaveBeenLastCalledWith("indexer_lag", "warning", {
      lagSlots: "35",
      lagSeconds: 90,
    });
  });
  it.each([20n, 0n])(
    "an idle poll at the tip has no lag or alert with last event at %s",
    async (lastEventSlot) => {
      const x = telemetry();
      const confirmed = vi
        .spyOn(SolanaTxSource.prototype, "confirmedSlot")
        .mockResolvedValue(1000n);
      vi.spyOn(SolanaTxSource.prototype, "finalizedSlot").mockResolvedValue(
        900n,
      );
      vi.spyOn(SolanaTxSource.prototype, "transactions").mockResolvedValue([]);
      const blockTime = vi
        .spyOn(SolanaTxSource.prototype, "blockTime")
        .mockImplementation(async (slot) => {
          if (slot === 1000n) return 1000;
          if (slot === 1100n) return 1060;
          if (slot === 20n) return 600; // Last transaction was 400 seconds ago.
          return null;
        });
      vi.spyOn(IndexerStore.prototype, "pendingFinality").mockResolvedValue([]);
      vi.spyOn(IndexerStore.prototype, "cursor").mockResolvedValue({
        lastSignature: lastEventSlot === 0n ? null : "old",
        lastSlot: lastEventSlot,
      });
      vi.spyOn(IndexerStore.prototype, "lastAppliedSlot").mockResolvedValue(
        lastEventSlot,
      );
      vi.spyOn(EventPublisher.prototype, "flush").mockResolvedValue(undefined);
      const runtime = {
        ...x.runtime,
        role: "indexer",
        logger: { warn: vi.fn() },
        pool: x.pool,
        env: {
          PROGRAM_ID: "11111111111111111111111111111111",
          RPC_URL: "http://localhost:8899",
        },
      } as unknown as ServiceRuntime;
      const indexer = createIndexer(runtime, {
        services: SERVICES,
        royaltyPerDustCardBps: 137,
        env: { INDEXER_RPC_URL_FALLBACK: "http://localhost:8898" },
      });
      try {
        await indexer.engine.poll();
        expect(
          JSON.parse(x.values.get("onepct:indexer:status")!),
        ).toMatchObject({
          asOfSlot: "1000",
          scanSlot: "1000",
          lastEventSlot: lastEventSlot.toString(),
          confirmedSlot: "1000",
          chainTime: 1000,
          lagSlots: "0",
          lagSeconds: 0,
        });
        expect(x.values.get("onepct:indexer:lag_slots")).toBe("0");
        expect(x.runtime.metrics.indexerLagSlots.set).toHaveBeenCalledWith(0);
        expect(blockTime).toHaveBeenCalledExactlyOnceWith(1000n);
        expect(x.alert).not.toHaveBeenCalled();
        expect(runtime.logger.warn).not.toHaveBeenCalled();

        // A tip that advances during the next scan still reports actual lag.
        confirmed.mockResolvedValueOnce(1000n).mockResolvedValueOnce(1100n);
        await indexer.engine.poll();
        expect(
          JSON.parse(x.values.get("onepct:indexer:status")!),
        ).toMatchObject({
          asOfSlot: "1000",
          lastEventSlot: lastEventSlot.toString(),
          confirmedSlot: "1100",
          chainTime: 1000,
          confirmedTime: 1060,
          lagSlots: "100",
          lagSeconds: 60,
        });
        expect(x.alert).toHaveBeenCalledWith("indexer_lag", "warning", {
          lagSlots: "100",
          lagSeconds: 60,
        });
      } finally {
        await indexer.stop();
      }
    },
  );
  it("does not invent zero seconds when a scanned block time is unavailable", async () => {
    const x = telemetry();
    await x.instance.healthy(100n, 0n, 1060, null, 95n);
    expect(JSON.parse(x.values.get("onepct:indexer:status")!)).toMatchObject({
      lagSlots: "5",
      lagSeconds: null,
    });
    expect(x.alert).not.toHaveBeenCalled();
  });
});
