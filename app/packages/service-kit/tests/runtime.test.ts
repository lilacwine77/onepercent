import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import { runtimeEnvSchema } from "../src/env.js";

const state = vi.hoisted(() => ({
  failMetrics: false,
  pool: {
    on: vi.fn(),
    end: vi.fn(async () => {}),
    query: vi.fn(async () => {}),
  },
  db: { fixture: "database" },
  redis: {
    on: vi.fn(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    ping: vi.fn(async () => "PONG"),
  },
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), flush: vi.fn() },
  loggerOptions: undefined as undefined | { secretValues: string[] },
  alertOptions: undefined as undefined | { db: unknown },
  dbOptions: undefined as undefined | Record<string, unknown>,
  redisOptions: undefined as undefined | Record<string, unknown>,
  rpcOptions: undefined as undefined | Record<string, unknown>,
  leaderOptions: undefined as
    undefined | { onLeader?: (signal: AbortSignal) => void | Promise<void> },
  readConfig: vi.fn(),
  notify: vi.fn(async () => {}),
}));

vi.mock("@onepercent/db", () => ({
  createDatabase: (options: Record<string, unknown>) => {
    state.dbOptions = options;
    return { pool: state.pool, db: state.db };
  },
}));
vi.mock("../src/redis.js", () => ({
  createRedis: (_url: string, options: Record<string, unknown>) => {
    state.redisOptions = options;
    return state.redis;
  },
}));
vi.mock("../src/rpc.js", () => ({
  JsonRpcClient: class {
    constructor(options: Record<string, unknown>) {
      state.rpcOptions = options;
    }
    ready = async () => {};
  },
}));
vi.mock("../src/keys.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/keys.js")>()),
  configRoleReader: () => state.readConfig,
}));
vi.mock("../src/leader.js", () => ({
  KeeperLeader: class {
    constructor(options: {
      onLeader?: (signal: AbortSignal) => void | Promise<void>;
    }) {
      state.leaderOptions = options;
    }
    async start() {
      await state.leaderOptions?.onLeader?.(new AbortController().signal);
    }
    async stop() {}
  },
}));
vi.mock("../src/log.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/log.js")>()),
  createServiceLogger: (
    _base: unknown,
    options: { secretValues: string[] },
  ) => {
    state.loggerOptions = options;
    return state.logger;
  },
}));
vi.mock("../src/metrics.js", async () => {
  const { Registry } = await import("prom-client");
  return {
    createMetrics: () => {
      if (state.failMetrics) throw new Error("metrics_initialization_failed");
      return { registry: new Registry(), keeperIsLeader: { set: vi.fn() } };
    },
  };
});
vi.mock("../src/alert.js", () => ({
  AlertService: class {
    constructor(options: { db: unknown }) {
      state.alertOptions = options;
    }
    alert = state.notify;
  },
}));

function env() {
  return runtimeEnvSchema.parse({
    DATABASE_URL: "postgres://user:encoded%21password@localhost/test",
    REDIS_URL: "redis://:redis-password@localhost:6379",
    RPC_URL: "http://localhost:8899?api-key=provider-secret",
    LOG_IP_SALT: "test-salt",
    PROGRAM_ID: Keypair.generate().publicKey.toBase58(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.failMetrics = false;
  state.loggerOptions = undefined;
  state.alertOptions = undefined;
  state.readConfig.mockReset();
  state.leaderOptions = undefined;
});
afterEach(() => vi.useRealTimers());

it("closes each acquired dependency when runtime initialization fails", async () => {
  state.failMetrics = true;
  await expect(
    createRuntime({
      service: "api",
      role: "public",
      env: env(),
      sourceEnv: {},
    }),
  ).rejects.toThrow("metrics_initialization_failed");
  expect(state.redis.disconnect).toHaveBeenCalledOnce();
  expect(state.pool.end).toHaveBeenCalledOnce();
  expect(state.redis.connect).not.toHaveBeenCalled();
});

it("passes the drizzle database to alerts and makes shutdown idempotent", async () => {
  const runtime = await createRuntime({
    service: "api",
    role: "public",
    env: env(),
    sourceEnv: {},
  });
  expect(state.alertOptions?.db).toBe(state.db);
  expect((await runtime.health.request("/health")).status).toBe(200);
  const first = runtime.stop();
  expect(runtime.stop()).toBe(first);
  expect((await runtime.health.request("/health")).status).toBe(503);
  await first;
  expect(state.redis.disconnect).toHaveBeenCalledOnce();
  expect(state.pool.end).toHaveBeenCalledOnce();
});

it("supplies runtime provider credentials to the logger without retaining keypairs", async () => {
  const runtime = await createRuntime({
    service: "api",
    role: "public",
    env: env(),
    sourceEnv: {
      HELIUS_API_KEY: "bare-provider-secret",
      INTERNAL_TOKEN: "internal-secret",
    },
  });
  expect(state.loggerOptions?.secretValues).toEqual(
    expect.arrayContaining([
      "bare-provider-secret",
      "internal-secret",
      "encoded!password",
      "redis-password",
      "provider-secret",
    ]),
  );
  await runtime.stop();
});

it("uses the independent transport configuration for each dependency", async () => {
  const runtime = await createRuntime({
    service: "api",
    role: "public",
    env: env(),
    sourceEnv: {},
  });
  expect(state.dbOptions).toMatchObject({
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });
  expect(state.redisOptions).toMatchObject({
    connectTimeout: 2_000,
    commandTimeout: 2_000,
  });
  expect(state.rpcOptions).toMatchObject({
    timeoutMs: 10_000,
    failureThreshold: 5,
    recoverMs: 30_000,
  });
  expect(state.alertOptions).toMatchObject({ timeoutMs: 5_000 });
  await runtime.stop();
});

it("passes the keeper job callback through the runtime leadership boundary", async () => {
  const pair = Keypair.generate();
  state.readConfig.mockResolvedValue({
    addresses: { keeper: pair.publicKey },
    disabledRoles: 0,
  });
  const onLeader = vi.fn();
  const runtime = await createRuntime({
    service: "worker",
    role: "keeper",
    env: env(),
    sourceEnv: { KEEPER_KEYPAIR: JSON.stringify([...pair.secretKey]) },
    onLeader,
  });
  expect(state.leaderOptions?.onLeader).toBe(onLeader);
  expect(onLeader).toHaveBeenCalledWith(expect.any(AbortSignal));
  await runtime.stop();
});

it("keeps role health continuously available over three intervals with 500ms RPC latency", async () => {
  vi.useFakeTimers();
  const pair = Keypair.generate();
  const starts: number[] = [];
  state.readConfig.mockImplementation(async () => {
    starts.push(performance.now());
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { addresses: { "intake-signer": pair.publicKey }, disabledRoles: 0 };
  });
  const creating = createRuntime({
    service: "api",
    role: "intake-signer",
    env: env(),
    sourceEnv: { INTAKE_SIGNER_KEYPAIR: JSON.stringify([...pair.secretKey]) },
  });
  await vi.advanceTimersByTimeAsync(500);
  const runtime = await creating;
  const observations: boolean[] = [];
  const sample = setInterval(
    () => observations.push(runtime.guard!.status().ok),
    250,
  );
  try {
    await vi.advanceTimersByTimeAsync(180_000);
    expect(observations).toHaveLength(720);
    expect(observations.every(Boolean)).toBe(true);
    expect(starts).toEqual([0, 50_000, 100_000, 150_000]);
    expect((await runtime.health.request("/health")).status).toBe(200);
  } finally {
    clearInterval(sample);
    await runtime.stop();
  }
});

it.each(["stalled", "failed"])(
  "lets role authorization lapse after expiry with a %s Config read",
  async (outcome) => {
    vi.useFakeTimers();
    const pair = Keypair.generate();
    state.readConfig
      .mockResolvedValueOnce({
        addresses: { "intake-signer": pair.publicKey },
        disabledRoles: 0,
      })
      .mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            if (outcome === "failed")
              setTimeout(() => reject(new Error("rpc_unavailable")), 10_000);
          }),
      );
    const runtime = await createRuntime({
      service: "api",
      role: "intake-signer",
      env: env(),
      sourceEnv: { INTAKE_SIGNER_KEYPAIR: JSON.stringify([...pair.secretKey]) },
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(runtime.guard!.status()).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.guard!.status()).toEqual({
      ok: false,
      reason: "config_unavailable",
    });
    expect(() => runtime.key!.signMessage(new Uint8Array())).toThrow(
      "config_unavailable",
    );
    expect((await runtime.health.request("/health")).status).toBe(503);
    await runtime.stop();
  },
);
