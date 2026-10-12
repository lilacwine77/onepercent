import { expect, it, vi } from "vitest";
import type { RuntimeEnv, ServiceRuntime } from "@onepercent/service-kit";
import { createHealthApp, createMetrics } from "@onepercent/service-kit";
import {
  startKeeperWorker,
  loadVrfDecoder,
  type KeeperBootstrapDependencies,
} from "./bootstrap.js";

// PARAMS/M1 fixture inputs, never production fallbacks.
const config = {
  SERVICES: {
    keeper: {
      scanSeconds: 10,
      closeVaultPassSeconds: 3600,
      teamWithdrawSeconds: 3600,
      sendMaxAttempts: 5,
      backoffBaseMs: 500,
      backoffMaxMs: 30000,
      settleBacklogAlertSeconds: 60,
      settleP95TargetSeconds: 5,
    },
    monitor: { vrfExpiryClusterPerWallet24h: 3 },
    landing: { cuMarginBps: 2000, maxComputeUnitPriceMicroLamports: null },
  },
  TX_LIMITS: { settlePacksPerTx: 2, maxTxBytes: 1232 },
  VRF: { timeoutSeconds: 300 },
  MONITOR: {
    vrfQueueOccupancyAlertBps: 5000,
    vrfExpiriesPerThousandRipsAlert: 1,
  },
  CU_LIMITS: { settle: [28000, 53000], refundPull: 13000 },
};
const env = { PROGRAM_ID: "11111111111111111111111111111111" } as RuntimeEnv;
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function aborted(signal: AbortSignal): Promise<void> {
  return signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
}
function harness(leader = false) {
  const events: string[] = [];
  const sourceTerm = new AbortController();
  let authorized = true;
  const guard = {
    stop: vi.fn(() => {
      authorized = false;
      events.push("guard-stopped");
    }),
    status: () => ({ ok: authorized }),
  };
  const key = {
    destroy: vi.fn(() => {
      events.push("key-destroyed");
    }),
  };
  const originalStop = vi.fn(async () => {
    events.push("pool-closed");
  });
  const runtime = {
    role: "keeper",
    env,
    guard,
    key,
    leader: {
      stop: vi.fn(async () => {
        events.push("leader-stopped");
        sourceTerm.abort();
      }),
    },
    logger: { error: vi.fn() },
    pool: {},
    rpc: {},
    alerts: {},
    stop: originalStop,
  } as unknown as ServiceRuntime;
  runtime.health = createHealthApp({
    version: "test",
    commit: "test",
    registry: createMetrics().registry,
    guard: runtime.guard,
    checks: {
      db: async () => true,
      redis: async () => true,
      rpc: async () => true,
    },
    timeoutMs: 100,
  });
  let watchSignal: AbortSignal | undefined;
  const factory = vi.fn<NonNullable<KeeperBootstrapDependencies["runtime"]>>(
    async (options) => {
      events.push("runtime-created");
      if (leader)
        void Promise.resolve(options.onLeader?.(sourceTerm.signal)).catch(
          () => undefined,
        );
      return runtime;
    },
  );
  const keeper = vi.fn<NonNullable<KeeperBootstrapDependencies["keeper"]>>(
    () => {
      events.push("keeper-attached");
      return {
        onLeader: async (signal) => {
          events.push("term-started");
          await aborted(signal);
          events.push("term-drained");
        },
      };
    },
  );
  const watchdog = vi.fn<NonNullable<KeeperBootstrapDependencies["watchdog"]>>(
    async (options) => {
      watchSignal = options.signal;
      events.push("watchdog-started");
      await aborted(options.signal);
      events.push("watchdog-drained");
    },
  );
  const decoder = vi.fn(async () => undefined);
  const dependencies = { runtime: factory, keeper, watchdog, decoder };
  return {
    events,
    runtime,
    guard,
    key,
    originalStop,
    factory,
    keeper,
    watchdog,
    dependencies,
    sourceTerm,
    watchSignal: () => watchSignal,
  };
}

it.each(["reject", "return"])(
  "fails readiness and releases leadership when the keeper term unexpectedly %ss",
  async (mode) => {
    const h = harness(true);
    const ended = deferred();
    h.keeper.mockReturnValue({
      onLeader: async () => {
        await ended.promise;
        if (mode === "reject") throw new Error("stock_cluster_mismatch");
      },
    });
    const runtime = await startKeeperWorker(
      { env, configModule: config },
      h.dependencies,
    );
    expect((await runtime.health.request("/ready")).status).toBe(200);
    ended.resolve();
    await vi.waitFor(() => expect(h.originalStop).toHaveBeenCalledOnce());
    expect((await runtime.health.request("/ready")).status).toBe(503);
    expect(h.sourceTerm.signal.aborted).toBe(true);
    expect(runtime.leader!.stop).toHaveBeenCalledOnce();
    expect(h.watchSignal()?.aborted).toBe(true);
  },
);

it("ignores a late rejection from a cancelled keeper term", async () => {
  const h = harness(true);
  const ended = deferred();
  h.keeper.mockReturnValue({
    onLeader: async () => {
      await ended.promise;
      throw new Error("old_term_failed");
    },
  });
  const runtime = await startKeeperWorker(
    { env, configModule: config },
    h.dependencies,
  );
  h.sourceTerm.abort();
  ended.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  expect(h.originalStop).not.toHaveBeenCalled();
  expect((await runtime.health.request("/ready")).status).toBe(200);
  await runtime.stop();
});

it("releases the leader and fails readiness before a failed K1 sibling finishes draining", async () => {
  const h = harness(true);
  const started = deferred();
  const drain = deferred();
  let fail!: (error: unknown) => void;
  h.keeper.mockImplementation((_runtime, _config, options) => {
    fail = options!.onFailure!;
    return {
      onLeader: async () => {
        started.resolve();
        await drain.promise;
      },
    };
  });
  const runtime = await startKeeperWorker(
    { env, configModule: config },
    h.dependencies,
  );
  await started.promise;
  fail(new Error("stock_cluster_mismatch"));
  expect(h.sourceTerm.signal.aborted).toBe(true);
  expect(runtime.leader!.stop).toHaveBeenCalledOnce();
  expect((await runtime.health.request("/ready")).status).toBe(503);
  expect(h.originalStop).not.toHaveBeenCalled();
  drain.resolve();
  await runtime.stop();
  expect(h.originalStop).toHaveBeenCalledOnce();
});

it("rejects missing M1/P0 config before opening resources or loading the decoder", async () => {
  const h = harness();
  await expect(
    startKeeperWorker({ env, configModule: {} }, h.dependencies),
  ).rejects.toThrow();
  expect(h.factory).not.toHaveBeenCalled();
  expect(h.dependencies.decoder).not.toHaveBeenCalled();
});

it("runs the lifetime watchdog on a follower and drains it before closing the pool", async () => {
  const h = harness();
  const runtime = await startKeeperWorker(
    { env, configModule: config },
    h.dependencies,
  );
  expect(h.watchdog).toHaveBeenCalledOnce();
  expect(h.events).not.toContain("term-started");
  const stopped = runtime.stop();
  expect(h.watchSignal()?.aborted).toBe(true);
  expect(h.guard.stop).toHaveBeenCalledOnce();
  expect(h.key.destroy).toHaveBeenCalledOnce();
  expect(h.originalStop).not.toHaveBeenCalled();
  expect(runtime.stop()).toBe(stopped);
  await stopped;
  expect(h.originalStop).toHaveBeenCalledOnce();
  expect(h.events.indexOf("watchdog-drained")).toBeLessThan(
    h.events.indexOf("pool-closed"),
  );
});

it("supports early onLeader and waits for every term and watchdog before shared teardown", async () => {
  const h = harness(true);
  const termStarted = deferred();
  const termDrain = deferred();
  const watchDrain = deferred();
  let termSignal: AbortSignal | undefined;
  h.keeper.mockImplementation(() => {
    h.events.push("keeper-attached");
    return {
      onLeader: async (signal) => {
        termSignal = signal;
        h.events.push("term-started");
        termStarted.resolve();
        await aborted(signal);
        await termDrain.promise;
        h.events.push("term-drained");
      },
    };
  });
  h.watchdog.mockImplementation(async ({ signal }) => {
    await aborted(signal);
    await watchDrain.promise;
    h.events.push("watchdog-drained");
  });
  const runtime = await startKeeperWorker(
    { env, configModule: config },
    h.dependencies,
  );
  await termStarted.promise;
  expect(h.events.indexOf("term-started")).toBeGreaterThan(
    h.events.indexOf("keeper-attached"),
  );
  const stopped = runtime.stop();
  expect(termSignal?.aborted).toBe(true);
  expect(h.guard.stop).toHaveBeenCalledOnce();
  expect(h.key.destroy).toHaveBeenCalledOnce();
  expect(h.originalStop).not.toHaveBeenCalled();
  termDrain.resolve();
  await Promise.resolve();
  expect(h.originalStop).not.toHaveBeenCalled();
  watchDrain.resolve();
  await stopped;
  expect(h.events.at(-1)).toBe("pool-closed");
});

it("cleans up an early leader waiting for attach when startup fails", async () => {
  const h = harness(true);
  h.keeper.mockImplementation(() => {
    throw new Error("keeper_start_failed");
  });
  await expect(
    startKeeperWorker({ env, configModule: config }, h.dependencies),
  ).rejects.toThrow("keeper_start_failed");
  expect(h.originalStop).toHaveBeenCalledOnce();
  expect(h.guard.stop).toHaveBeenCalledOnce();
  expect(h.key.destroy).toHaveBeenCalledOnce();
  expect(h.watchdog).not.toHaveBeenCalled();
  expect(h.events).not.toContain("term-started");
});

it("cleans up after watchdog startup failure and passes the official decoder through", async () => {
  const h = harness(true);
  const decode = vi.fn(() => ({
    capacityBytes: 1,
    usedBytes: 0,
    items: 0,
    oldestItemTs: null,
    oldestItemSlot: null,
  }));
  h.watchdog.mockImplementation(() => {
    throw new Error("watchdog_start_failed");
  });
  await expect(
    startKeeperWorker(
      { env, configModule: config },
      { ...h.dependencies, decoder: async () => decode },
    ),
  ).rejects.toThrow("watchdog_start_failed");
  expect(h.keeper).toHaveBeenCalledWith(h.runtime, config, {
    decodeVrfQueue: decode,
    onFailure: expect.any(Function),
    extensions: [expect.any(Function)],
  });
  expect(h.originalStop).toHaveBeenCalledOnce();
});

it("treats only resolution of the absent S4 subpath as an unavailable decoder", async () => {
  const missing = Object.assign(new Error("subpath unavailable"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
  const importer = vi.fn(async () => ({}));
  const resolver = vi.fn(() => {
    throw missing;
  });
  await expect(loadVrfDecoder(importer, resolver)).resolves.toBeUndefined();
  expect(resolver).toHaveBeenCalledExactlyOnceWith("@onepercent/sdk/verify");
  expect(importer).not.toHaveBeenCalled();
  await expect(
    loadVrfDecoder(importer, () => {
      throw new Error("resolver failed");
    }),
  ).rejects.toThrow("keeper_vrf_module_unavailable");
});

it("rejects an installed decoder's internal missing export even with the same error code", async () => {
  const resolved = "file:///fixture/sdk/dist/verify/index.js";
  for (const code of [
    "ERR_MODULE_NOT_FOUND",
    "ERR_PACKAGE_PATH_NOT_EXPORTED",
  ]) {
    const sourceError = Object.assign(
      new Error("internal module dependency unavailable"),
      { code },
    );
    const importer = vi.fn(async () => {
      throw sourceError;
    });
    const error = await loadVrfDecoder(importer, () => resolved).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("keeper_vrf_module_unavailable");
    expect((error as Error).cause).toBeUndefined();
    expect(importer).toHaveBeenCalledExactlyOnceWith(resolved);
  }
});

it("validates a resolved decoder export before returning it", async () => {
  const resolve = () => "file:///fixture/sdk/dist/verify/index.js";
  await expect(
    loadVrfDecoder(async () => ({ decodeVrfQueue: null }), resolve),
  ).rejects.toThrow("keeper_vrf_decoder_invalid");
  const decode = () => ({
    capacityBytes: 1,
    usedBytes: 0,
    items: 0,
    oldestItemTs: null,
    oldestItemSlot: null,
  });
  await expect(
    loadVrfDecoder(async () => ({ decodeVrfQueue: decode }), resolve),
  ).resolves.toBe(decode);
});
