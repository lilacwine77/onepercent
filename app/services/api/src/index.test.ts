import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureSources } from "./xray/fixture-source.js";
import { loadApiRole } from "./roles.js";

const boundary = vi.hoisted(() => ({
  publicFetch: undefined as
    undefined | ((request: Request) => Response | Promise<Response>),
  healthStatus: 200 as 200 | 503,
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  stop: vi.fn(async () => undefined),
  close: vi.fn(),
  runtime: vi.fn(),
  shutdown: vi.fn(),
  startupFailure: vi.fn(),
}));
// The image engine has its own rendering suite; this boot test performs no PNG request.
vi.mock("./cards/render.js", () => ({
  renderCardPng: vi.fn(() => {
    throw new Error("Unexpected image render in entrypoint test");
  }),
}));
// S4 exercises the real public registration in public/entry.integration.test.ts.
vi.mock("./public/index.js", () => ({ registerPublic: vi.fn() }));
vi.mock("@hono/node-server", () => ({
  serve: (options: {
    fetch: (request: Request) => Response | Promise<Response>;
  }) => {
    boundary.publicFetch = options.fetch;
    return { close: boundary.close };
  },
}));
vi.mock("@onepercent/service-kit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@onepercent/service-kit")>();
  return {
    ...actual,
    createRuntime: async (options: {
      env: { APP_VERSION: string; GIT_COMMIT: string };
    }) => {
      boundary.runtime(options);
      const health = new Hono().get("/health", (context) =>
        context.json(
          {
            ok: boundary.healthStatus === 200,
            version: options.env.APP_VERSION,
            commit: options.env.GIT_COMMIT,
          },
          boundary.healthStatus,
        ),
      );
      return {
        health,
        logger: boundary.logger,
        stop: boundary.stop,
        env: options.env,
        pool: { query: vi.fn(), connect: vi.fn() },
        redis: {},
      };
    },
    listenRuntime: () => ({ close: boundary.close }),
    installShutdown: boundary.shutdown,
    reportStartupFailure: boundary.startupFailure,
  };
});

// The boot boundary retains real route wiring with offline storage/limiter adapters.
// Persistent behavior and retention are covered by the M5 store/factory contracts.
vi.mock("./link/store-pg.js", async () => {
  const { InMemoryLinkStore } = await import("./link/store.js");
  return {
    PgLinkStore: class extends InMemoryLinkStore {
      constructor() {
        super();
      }
    },
  };
});
vi.mock("./go/store-pg.js", async () => {
  const { InMemoryGoStore } = await import("./go/store.js");
  return {
    PgGoStore: class extends InMemoryGoStore {
      constructor() {
        super();
      }
    },
  };
});
vi.mock("./link/ratelimit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./link/ratelimit.js")>();
  return {
    ...actual,
    RedisLinkRateLimiter: class extends actual.InMemoryLinkRateLimiter {
      constructor() {
        super();
      }
    },
  };
});

const completeEnv = {
  ROLE: "public",
  DATABASE_URL: "postgresql://localhost/onepercent-test",
  REDIS_URL: "redis://localhost:6379",
  RPC_URL: "https://rpc.example.test",
  PROGRAM_ID: "11111111111111111111111111111111",
  LOG_IP_SALT: "local-test-salt",
  APP_VERSION: "test-version",
  GIT_COMMIT: "test-commit",
  WEB_ORIGIN: "https://onepercent.example",
  XRAY_SOURCE: "fixtures",
  TURNSTILE_SECRET: "turnstile-test-token",
  BOT_API_SECRET: "b".repeat(32),
  HELIUS_API_KEY: "helius-test-token",
  JUPITER_API_KEY: "jupiter-test-token",
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  boundary.publicFetch = undefined;
  boundary.healthStatus = 200;
  for (const [name, value] of Object.entries(completeEnv))
    vi.stubEnv(name, value);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network disabled in API entrypoint test");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function request(path: string, init?: RequestInit) {
  expect(boundary.publicFetch).toBeDefined();
  return boundary.publicFetch!(new Request(`http://api.example${path}`, init));
}

describe("public API entrypoint", () => {
  it("boots with provider and shared secrets, then serves S0 health and existing X1/X3 routes", async () => {
    await import("./index.js");
    expect(boundary.startupFailure).not.toHaveBeenCalled();
    expect(boundary.runtime).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "public",
        env: expect.objectContaining({
          BOT_API_SECRET: completeEnv.BOT_API_SECRET,
          TURNSTILE_SECRET: completeEnv.TURNSTILE_SECRET,
          HELIUS_API_KEY: completeEnv.HELIUS_API_KEY,
          JUPITER_API_KEY: completeEnv.JUPITER_API_KEY,
        }),
      }),
    );
    expect(boundary.shutdown).toHaveBeenCalledOnce();
    const health = await request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      version: completeEnv.APP_VERSION,
      commit: completeEnv.GIT_COMMIT,
    });
    const actions = await request("/actions.json");
    expect(actions.status).toBe(200);
    expect(await actions.json()).toHaveProperty("rules");
    expect((await request("/api/actions/xray")).status).toBe(200);
    const fixtures = await createFixtureSources();
    expect(
      (await request(`/api/xray/${fixtures.owners.trencher}`)).status,
    ).toBe(200);
    const nonceResponse = await request("/api/link/nonce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${completeEnv.BOT_API_SECRET}`,
      },
      body: JSON.stringify({
        telegramUserId: 1,
        botUsername: "onepercent_test_bot",
      }),
    });
    expect(nonceResponse.status).toBe(201);
    const session = (await nonceResponse.json()) as { nonce: string };
    expect((await request(`/api/link/session/${session.nonce}`)).status).toBe(
      200,
    );
    expect(boundary.logger.info).toHaveBeenCalledWith({}, expect.any(String));
    expect(fetch).not.toHaveBeenCalled();
    boundary.healthStatus = 503;
    expect((await request("/health")).status).toBe(503);
  }, 15_000);

  it("preserves Actions wildcard CORS and confines browser CORS to the configured origin", async () => {
    await import("./index.js");
    for (const path of ["/actions.json", "/api/actions/xray"]) {
      const response = await request(path, {
        method: "OPTIONS",
        headers: {
          Origin: "https://dial.to",
          "Access-Control-Request-Method": "POST",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("X-Action-Version")).toBe("2.4");
    }
    for (const path of [
      "/health",
      "/api/xray/example",
      `/api/link/session/${"a".repeat(32)}`,
    ]) {
      const allowed = await request(path, {
        method: "OPTIONS",
        headers: { Origin: completeEnv.WEB_ORIGIN },
      });
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
        completeEnv.WEB_ORIGIN,
      );
      const denied = await request(path, {
        method: "OPTIONS",
        headers: { Origin: "https://outside.example" },
      });
      expect(denied.headers.has("Access-Control-Allow-Origin")).toBe(false);
    }
  });

  it("retains key isolation without making an exception for the previous verifier name", () => {
    const previousName = ["TURNSTILE", "SECRET", "KEY"].join("_");
    expect(() => loadApiRole({ ...completeEnv, [previousName]: "" })).toThrow(
      previousName,
    );
    expect(() => loadApiRole({ ...completeEnv, KEEPER_KEYPAIR: "" })).toThrow(
      "KEEPER_KEYPAIR",
    );
    expect(loadApiRole(completeEnv).env.BOT_API_SECRET).toBe(
      completeEnv.BOT_API_SECRET,
    );
  });

  it("validates shared credentials and an exact browser origin at the entry boundary", () => {
    for (const origin of [
      "*",
      "https://onepercent.example/",
      "https://onepercent.example/path",
      "https://onepercent.example?query=1",
      "https://onepercent.example#fragment",
      "https://user:password@onepercent.example",
    ]) {
      expect(() => loadApiRole({ ...completeEnv, WEB_ORIGIN: origin })).toThrow(
        "WEB_ORIGIN",
      );
    }
    expect(() =>
      loadApiRole({ ...completeEnv, BOT_API_SECRET: "x".repeat(31) }),
    ).toThrow("BOT_API_SECRET");
  });
});
