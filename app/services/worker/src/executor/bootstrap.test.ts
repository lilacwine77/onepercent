import { PublicKey } from "@solana/web3.js";
import {
  createHealthApp,
  createMetrics,
  type KeeperLeaderOptions,
  type RuntimeEnv,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { beforeEach, expect, it, vi } from "vitest";
import { startExecutorWorker } from "./bootstrap.js";

const state = vi.hoisted(() => ({
  options: undefined as KeeperLeaderOptions | undefined,
  controller: undefined as AbortController | undefined,
  assertCluster: vi.fn(),
  lookupTable: vi.fn(),
  executor: vi.fn(),
  stopLeader: vi.fn(),
}));

vi.mock("@onepercent/service-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@onepercent/service-kit")>()),
  KeeperLeader: class {
    constructor(options: KeeperLeaderOptions) {
      state.options = options;
    }
    async start() {
      state.controller = new AbortController();
      void Promise.resolve(
        state.options!.onLeader!(state.controller.signal),
      ).catch(() => undefined);
    }
    assertLeader() {
      state.controller!.signal.throwIfAborted();
    }
    stop() {
      return state.stopLeader();
    }
  },
  TxSender: class {},
}));
vi.mock("./source.js", () => ({
  ExecutorSource: class {
    assertCluster = state.assertCluster;
    lookupTable = state.lookupTable;
  },
}));
vi.mock("./store.js", () => ({ PostgresExecutorStore: class {} }));
vi.mock("./engine.js", () => ({
  Executor: class {
    onLeader = state.executor;
  },
}));

const env = {
  CLUSTER: "devnet",
  PROGRAM_ID: new PublicKey(Buffer.alloc(32, 41)).toBase58(),
  RPC_URL: "http://127.0.0.1:8899",
  DATABASE_URL: "postgresql://127.0.0.1/fixture",
} as RuntimeEnv;
const sourceEnv = { PROTOCOL_LOOKUP_TABLE: PublicKey.default.toBase58() };

function deferred() {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_resolve, failed) => {
    reject = failed;
  });
  return { promise, reject };
}

function harness() {
  let authorized = true;
  const guard = {
    stop: vi.fn(() => {
      authorized = false;
    }),
    assertAuthorized: vi.fn(),
    status: () => ({ ok: authorized }),
  };
  const key = { publicKey: PublicKey.default, destroy: vi.fn() };
  const originalStop = vi.fn(async () => undefined);
  const runtime = {
    role: "executor",
    env,
    guard,
    key,
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
  return { runtime, guard, key, originalStop };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.options = undefined;
  state.controller = undefined;
  state.assertCluster.mockReset().mockResolvedValue(undefined);
  state.lookupTable.mockReset().mockResolvedValue({ state: {} });
  state.executor.mockReset().mockImplementation(
    (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  );
  state.stopLeader.mockReset().mockImplementation(async () => {
    state.controller?.abort();
  });
});

it("fails readiness and releases the lock after an RPC rejection inside the acquired term", async () => {
  const h = harness();
  const rpc = deferred();
  state.assertCluster
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(rpc.promise);
  const runtime = await startExecutorWorker(
    { env, sourceEnv },
    { runtime: async () => h.runtime },
  );
  expect(state.options?.lockKey).toBe("onepct:executor");
  expect((await runtime.health.request("/ready")).status).toBe(200);
  rpc.reject(new Error("rpc_unavailable"));
  await vi.waitFor(() => expect(h.originalStop).toHaveBeenCalledOnce());
  expect((await runtime.health.request("/ready")).status).toBe(503);
  expect(state.controller?.signal.aborted).toBe(true);
  expect(state.stopLeader).toHaveBeenCalledOnce();
  expect(h.key.destroy).toHaveBeenCalled();
  expect(state.executor).not.toHaveBeenCalled();
});

it("fails readiness when the executor business loop unexpectedly resolves", async () => {
  const h = harness();
  state.executor.mockResolvedValueOnce(undefined);
  const runtime = await startExecutorWorker(
    { env, sourceEnv },
    { runtime: async () => h.runtime },
  );
  await vi.waitFor(() => expect(h.originalStop).toHaveBeenCalledOnce());
  expect((await runtime.health.request("/ready")).status).toBe(503);
  expect(state.controller?.signal.aborted).toBe(true);
  expect(state.stopLeader).toHaveBeenCalledOnce();
});

it("does not stop a replacement term when an old RPC call rejects late", async () => {
  const h = harness();
  const oldRpc = deferred();
  state.assertCluster
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(oldRpc.promise);
  const runtime = await startExecutorWorker(
    { env, sourceEnv },
    { runtime: async () => h.runtime },
  );
  state.controller!.abort();
  state.controller = new AbortController();
  const nextTerm = state.options!.onLeader!(state.controller.signal);
  await vi.waitFor(() => expect(state.executor).toHaveBeenCalledOnce());
  oldRpc.reject(new Error("old_rpc_failure"));
  await new Promise((resolve) => setImmediate(resolve));
  expect(h.originalStop).not.toHaveBeenCalled();
  expect(state.stopLeader).not.toHaveBeenCalled();
  expect(state.controller.signal.aborted).toBe(false);
  expect((await runtime.health.request("/ready")).status).toBe(200);
  await runtime.stop();
  await nextTerm;
});
