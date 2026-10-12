import "./setup.js";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@onepercent/db";
import {
  BOT_OPS,
  BLINKS_OPS,
  SERVICES,
  validateBotParams,
} from "@onepercent/config";
import { assertBotKeyIsolation } from "../keyguard.js";
import {
  BotLock,
  botDatabaseOptions,
  databaseReady,
  healthServer,
} from "../runtime.js";

type Pool = ReturnType<typeof createDatabase>["pool"];
afterEach(() => {
  vi.useRealTimers();
});
it("matches the service-kit public name guard without importing it in the bot runtime", async () => {
  const path = new URL(
    "../../../../packages/service-kit/dist/env.js",
    import.meta.url,
  );
  const module = (await import(/* @vite-ignore */ fileURLToPath(path))) as {
    assertKeyIsolation(role: string, env: NodeJS.ProcessEnv): void;
  };
  for (const name of [
    "FOO_KEYPAIR",
    "X_PRIVATE_KEY",
    "SECRET_KEY",
    "MY_MNEMONIC",
    "SEED_PHRASE",
    "foo_keypair",
    "BOT_API_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "DATABASE_URL",
  ]) {
    const expected =
      /(?:_KEYPAIR$|PRIVATE_KEY|SECRET_KEY|MNEMONIC|SEED_PHRASE)/i.test(name);
    for (const value of ["", "opaque_fixture"]) {
      const env = { [name]: value };
      if (expected) {
        expect(() => module.assertKeyIsolation("public", env)).toThrow(name);
        expect(() => assertBotKeyIsolation(env)).toThrow(name);
      } else {
        expect(() => module.assertKeyIsolation("public", env)).not.toThrow();
        expect(() => assertBotKeyIsolation(env)).not.toThrow();
      }
    }
  }
});
it("uses D14 database budgets and fails readiness on a query error", async () => {
  const options = botDatabaseOptions("postgres://localhost/test");
  expect(options.statement_timeout).toBe(
    SERVICES.transport.dbStatementTimeoutMs,
  );
  expect(options.query_timeout).toBe(SERVICES.transport.dbStatementTimeoutMs);
  expect(options.connectionTimeoutMillis).toBe(
    SERVICES.transport.dbStatementTimeoutMs,
  );
  expect(options.keepAlive).toBe(true);
  expect(await databaseReady()).toBe(true);
  expect(
    await databaseReady({
      query: vi.fn(async () => {
        throw new Error("private");
      }),
    } as unknown as Pool),
  ).toBe(false);
});
it("returns health and readiness states without opening a network socket", async () => {
  const state = { polling: false, lock: false, stopping: false };
  const ready = vi.fn(async () => true);
  const server = healthServer(state, ready);
  async function request(url: string, method = "GET") {
    return new Promise<{ status: number; body: unknown }>((resolve) => {
      let status = 0;
      const response = {
        writeHead(code: number) {
          status = code;
          return response;
        },
        end(body?: string) {
          resolve({ status, body: body ? JSON.parse(body) : undefined });
        },
      };
      server.emit("request", { url, method }, response);
    });
  }
  expect((await request("/health")).status).toBe(503);
  state.lock = true;
  state.polling = true;
  expect(await request("/health")).toEqual({
    status: 200,
    body: { ok: true, polling: true, lock: true },
  });
  expect((await request("/ready")).status).toBe(200);
  ready.mockResolvedValue(false);
  expect((await request("/ready")).status).toBe(503);
  state.stopping = true;
  expect((await request("/health")).status).toBe(503);
  expect((await request("/health", "POST")).status).toBe(404);
  expect((await request("/unknown")).status).toBe(404);
  server.close();
});
it("sets the dedicated idle timeout before locking and keeps the connection active every five seconds", async () => {
  vi.useFakeTimers();
  const emitter = new EventEmitter();
  const client = Object.assign(emitter, {
    query: vi.fn(async (statement: string) => {
      if (statement === "SET idle_session_timeout = '30s'") {
        expect(emitter.listenerCount("error")).toBe(1);
        expect(emitter.listenerCount("end")).toBe(1);
      }
      return { rows: [{ acquired: false }] };
    }),
    release: vi.fn(),
  });
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  const lost = vi.fn();
  const wait = vi.fn(async () => {
    client.query.mockResolvedValue({ rows: [{ acquired: true }] });
  });
  const lock = new BotLock(pool, lost, wait);
  const controller = new AbortController();
  expect(await lock.acquire(controller.signal)).toBe(true);
  expect(client.query.mock.calls).toEqual([
    ["SET idle_session_timeout = '30s'"],
    ["SELECT pg_try_advisory_lock(hashtext('onepct:bot')) AS acquired"],
    ["SELECT pg_try_advisory_lock(hashtext('onepct:bot')) AS acquired"],
  ]);
  expect(wait).toHaveBeenCalledWith(
    BOT_OPS.lockRetrySeconds * 1000,
    controller.signal,
  );
  expect(BOT_OPS.lockRetrySeconds).toBe(5);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(client.query).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(client.query).toHaveBeenLastCalledWith("SELECT 1");
  expect(client.query).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(client.query).toHaveBeenCalledTimes(5);
  expect(client.release).not.toHaveBeenCalled();
  client.emit("error", new Error("private details"));
  expect(lost).toHaveBeenCalledOnce();
  await lock.release();
  expect(client.release).toHaveBeenCalledWith(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(client.query).toHaveBeenCalledTimes(5);
});
it("does not acquire a lock after idle-timeout configuration fails and releases the session during cleanup", async () => {
  const client = Object.assign(new EventEmitter(), {
    query: vi
      .fn()
      .mockRejectedValueOnce(new Error("session configuration failed"))
      .mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  });
  const lock = new BotLock(
    { connect: vi.fn(async () => client) } as unknown as Pool,
    vi.fn(),
  );
  await expect(lock.acquire(new AbortController().signal)).rejects.toThrow(
    "session configuration failed",
  );
  expect(client.query.mock.calls).toEqual([
    ["SET idle_session_timeout = '30s'"],
  ]);
  await lock.release();
  expect(client.release).toHaveBeenCalledWith(true);
});
it("unlocks a healthy dedicated connection and aborts a waiting follower", async () => {
  vi.useFakeTimers();
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
    release: vi.fn(),
  });
  const lock = new BotLock(
    { connect: vi.fn(async () => client) } as unknown as Pool,
    () => {},
  );
  expect(await lock.acquire(new AbortController().signal)).toBe(true);
  await lock.release();
  expect(client.query).toHaveBeenLastCalledWith(
    "SELECT pg_advisory_unlock(hashtext('onepct:bot'))",
  );
  client.query.mockResolvedValue({ rows: [{ acquired: false }] });
  const follower = new BotLock(
    { connect: vi.fn(async () => client) } as unknown as Pool,
    () => {},
  );
  const controller = new AbortController();
  const promise = follower.acquire(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await promise).toBe(false);
  await follower.release();
});

type MutableOps = {
  userLimits: { updatesPer60s: number };
  telegram: { groupMaxPerMinute: number };
  notify: {
    maxAgeSeconds: { hit: number; royalty: number };
    priority: { onePct: number; royalty: number; hit: number };
  };
  digestHourUtc: number;
  apiLimits: { goSessionsPerUserPer600s: number };
  groupLimits: { repliesPer60s: number };
};
describe("issued M5 operations validation", () => {
  it("accepts zero special priorities and all issued values", () => {
    expect(validateBotParams()).toEqual({ bot: BOT_OPS, blinks: BLINKS_OPS });
  });
  it.each([
    (v: MutableOps) => {
      v.userLimits.updatesPer60s = 0;
    },
    (v: MutableOps) => {
      v.telegram.groupMaxPerMinute = 21;
    },
    (v: MutableOps) => {
      v.notify.maxAgeSeconds.hit = 4000;
    },
    (v: MutableOps) => {
      v.notify.maxAgeSeconds.royalty = 30000;
    },
    (v: MutableOps) => {
      v.notify.priority.onePct = 1;
    },
    (v: MutableOps) => {
      v.notify.priority.royalty = 2;
    },
    (v: MutableOps) => {
      v.notify.priority.hit = 3;
    },
    (v: MutableOps) => {
      v.digestHourUtc = 24;
    },
    (v: MutableOps) => {
      v.digestHourUtc = -1;
    },
    (v: MutableOps) => {
      v.apiLimits.goSessionsPerUserPer600s = 29;
    },
    (v: MutableOps) => {
      v.groupLimits.repliesPer60s = 20;
    },
  ])("rejects an invalid operational invariant %#", (mutate) => {
    const value = structuredClone(BOT_OPS);
    mutate(value);
    expect(() => validateBotParams(value)).toThrow();
  });
  it("validates every Blink operation value", () => {
    for (const key of Object.keys(BLINKS_OPS))
      expect(() =>
        validateBotParams(BOT_OPS, { ...BLINKS_OPS, [key]: 0 }),
      ).toThrow();
  });
});
it("continues resource cleanup after an unlock failure", async () => {
  const { closeBotRuntime } = await import("../runtime.js");
  const release = vi.fn(async () => {
    throw new Error("unlock failed");
  });
  const health = vi.fn(async () => {});
  const database = vi.fn(async () => {});
  expect(await closeBotRuntime(release, health, database)).toBe(false);
  expect(health).toHaveBeenCalledOnce();
  expect(database).toHaveBeenCalledOnce();
});
it("handles a connection error emitted while releasing the lock", async () => {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
    release: vi.fn(),
  });
  const lost = vi.fn();
  const lock = new BotLock(
    { connect: vi.fn(async () => client) } as unknown as Pool,
    lost,
  );
  expect(await lock.acquire(new AbortController().signal)).toBe(true);
  client.query.mockImplementation(async () => {
    client.emit("error", new Error("closed"));
    throw new Error("unlock failed");
  });
  await expect(lock.release()).rejects.toThrow("unlock failed");
  expect(client.release).toHaveBeenCalledWith(true);
  expect(lost).not.toHaveBeenCalled();
});
