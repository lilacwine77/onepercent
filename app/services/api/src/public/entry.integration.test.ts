import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureSources } from "../xray/fixture-source.js";
import * as fixtures from "./__fixtures__/responses.js";
import { feedEvent } from "./__fixtures__/stream.js";
import type { StreamEvent } from "@onepercent/service-kit";

const boundary = vi.hoisted(() => ({
  publicFetch: undefined as
    undefined | ((request: Request) => Response | Promise<Response>),
  realSettings: false,
  settingsLoads: 0,
  healthStatus: 200 as 200 | 503,
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  stop: vi.fn(async () => undefined),
  close: vi.fn(),
  shutdown: vi.fn(),
  startupFailure: vi.fn(),
  rateEval: vi.fn(async () => [1, 0]),
}));

// These tests retain the actual bootstrap, role/env checks, API assembly and router.
// Only external I/O, the image renderer and explicit unavailable-config cases are fixtures.
vi.mock("../cards/render.js", () => ({ renderCardPng: vi.fn() }));
vi.mock("@hono/node-server", () => ({
  serve: (options: { fetch: typeof boundary.publicFetch }) => {
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
      role: string;
      env: { APP_VERSION: string; GIT_COMMIT: string };
    }) => ({
      role: options.role,
      env: options.env,
      key: undefined,
      health: new Hono().get("/health", (context) =>
        context.json(
          {
            ok: boundary.healthStatus === 200,
            version: options.env.APP_VERSION,
            commit: options.env.GIT_COMMIT,
          },
          boundary.healthStatus,
        ),
      ),
      logger: boundary.logger,
      stop: boundary.stop,
      redis: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => "OK"),
        eval: boundary.rateEval,
      },
      rpc: {
        request: vi.fn(() => {
          throw new Error("Unexpected chain call");
        }),
      },
    }),
    listenRuntime: () => ({ close: boundary.close }),
    installShutdown: boundary.shutdown,
    reportStartupFailure: boundary.startupFailure,
  };
});
vi.mock("./data/index.js", () => {
  return {
    createPublicData: (
      options: Parameters<typeof import("./data/index.js").createPublicData>[0],
    ) => ({
      config: async () => {
        if (!boundary.realSettings) return fixtures.config;
        // Load after each reset so the bootstrap case sees that case's config mock.
        const actual =
          await vi.importActual<typeof import("./data/index.js")>(
            "./data/index.js",
          );
        return actual.createPublicData(options).config();
      },
      machine: async () => fixtures.machine,
      me: async () => fixtures.me,
      verify: async () => fixtures.verify,
      status: async () => {
        throw new Error("Unexpected status call");
      },
    }),
  };
});
vi.mock("./events.js", () => ({
  createPublicEvents: () => ({
    replayAfter: async (id?: string) => (id ? [] : [feedEvent()]),
    confirmed: async (events: readonly StreamEvent[]) => [...events],
  }),
}));
vi.mock("./value.js", () => ({
  createPublicValue: () => async () => ({
    asOfSlot: 1,
    status: "ok",
    lamports: "1",
    capped: false,
    label: "if_sold_now",
  }),
}));
vi.mock("./vrf.js", () => ({ createPublicVrf: () => vi.fn() }));

const fullEnv = {
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
  INTAKE_SIGNER_URL: "http://intake-signer.railway.internal",
  QUOTE_SIGNER_URL: "http://quote-signer.railway.internal",
  INTAKE_INTERNAL_TOKEN: "i".repeat(32),
  QUOTE_INTERNAL_TOKEN: "q".repeat(32),
};

beforeEach(() => {
  vi.resetModules();
  // Recreate the original settings module against each case's config mock.
  vi.doMock("./settings.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./settings.js")>();
    const { settings } = await import("./__fixtures__/settings.js");
    return {
      ...actual,
      loadPublicSettings: () => {
        boundary.settingsLoads += 1;
        return boundary.realSettings
          ? actual.loadPublicSettings()
          : { ...settings, indexer: { pollMs: 1 } };
      },
    };
  });
  vi.clearAllMocks();
  boundary.publicFetch = undefined;
  boundary.realSettings = false;
  boundary.settingsLoads = 0;
  boundary.healthStatus = 200;
  for (const [name, value] of Object.entries(fullEnv)) vi.stubEnv(name, value);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network disabled in entry integration");
    }),
  );
});
afterEach(async () => {
  // A test timeout does not cancel the entrypoint's top-level await. Finish its
  // imports before changing the environment or mocks used by the next boot.
  await vi.dynamicImportSettled();
  vi.doUnmock("./settings.js");
  vi.doUnmock("@onepercent/config");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function request(path: string, init?: RequestInit) {
  expect(boundary.publicFetch).toBeDefined();
  return boundary.publicFetch!(new Request(`http://api.example${path}`, init));
}

describe("S4 production entry composition", () => {
  it("serves S4 with X1/X3 using fixture config and retains S0 as sole health owner", async () => {
    await import("../index.js");
    expect(boundary.startupFailure).not.toHaveBeenCalled();
    expect(boundary.settingsLoads).toBe(0);
    expect(boundary.shutdown).toHaveBeenCalledOnce();
    expect((await request("/health")).status).toBe(200);
    expect(await (await request("/api/machine")).json()).toEqual(
      fixtures.machine,
    );
    expect(await (await request("/api/verify/0")).json()).toEqual(
      fixtures.verify,
    );
    expect(boundary.settingsLoads).toBe(1);
    const abort = new AbortController();
    const streamed = await request("/api/stream", { signal: abort.signal });
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = streamed.body!.getReader();
    try {
      const frame = new TextDecoder().decode((await reader.read()).value);
      expect(frame).toContain("id: 1-0-0");
      expect(frame).toContain("event: feed");
      expect(frame).toContain('"asOfSlot":1');
    } finally {
      abort.abort();
      await reader.cancel();
    }
    expect((await request("/actions.json")).status).toBe(200);
    const xray = await createFixtureSources();
    expect((await request(`/api/xray/${xray.owners.clean}`)).status).toBe(200);
    boundary.healthStatus = 503;
    expect((await request("/health")).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  }, 30_000);

  it("serves B14 bootstrap config while other S4 routes keep 503 for missing G1/P0 exports", async () => {
    vi.doMock("@onepercent/config", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@onepercent/config")>();
      return {
        ...actual,
        SERVICES: { transport: actual.SERVICES.transport },
        ONCHAIN_KEYS: undefined,
        resolveOnchainKey: undefined,
        INTAKE: undefined,
        TX_LIMITS: undefined,
      };
    });
    boundary.realSettings = true;
    vi.stubEnv("CLUSTER", "mainnet-beta");
    vi.stubEnv("FLAG_XRAY", "on");
    vi.stubEnv("FLAG_BLINKS_XRAY", "on");
    await import("../index.js");
    const config = await request("/api/config");
    expect(config.status).toBe(200);
    expect(config.headers.get("Cache-Control")).toBe("no-store");
    expect(await config.json()).toEqual({
      cluster: "mainnet-beta",
      programId: fullEnv.PROGRAM_ID,
      flags: { ...fixtures.flags, XRAY: true, BLINKS_XRAY: true },
      asOfSlot: null,
      paramsHash: null,
      phase: null,
      roles: null,
      vrf: null,
      season: null,
      paused: null,
    });
    expect(boundary.settingsLoads).toBe(0);
    expect(boundary.startupFailure).not.toHaveBeenCalled();
    expect((await request("/health")).status).toBe(200);
    expect((await request("/actions.json")).status).toBe(200);
    const xray = await createFixtureSources();
    expect((await request(`/api/xray/${xray.owners.clean}`)).status).toBe(200);
    for (const path of ["/api/machine", "/api/verify/0", "/api/stream"]) {
      const response = await request(path);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        asOfSlot: null,
        error: { code: "public_parameters_unavailable" },
      });
    }
    expect(boundary.settingsLoads).toBe(3);
    const hold = await request("/api/hold/attest", { method: "POST" });
    expect(hold.status).toBe(404);
    expect(await hold.json()).toEqual({
      asOfSlot: null,
      error: { code: "not_available" },
    });
    expect(boundary.settingsLoads).toBe(3);
    expect(fetch).not.toHaveBeenCalled();
  }, 30_000);

  it("preserves wildcard Actions CORS and the browser origin with SSE/retry headers", async () => {
    await import("../index.js");
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
    }
    for (const [path, allowedHeaders] of [
      ["/api/stream", "Content-Type,Last-Event-ID"],
      ["/api/machine", "Content-Type"],
      ["/api/xray/example", "Content-Type,cf-turnstile-response"],
    ] as const) {
      const allowed = await request(path, {
        method: "OPTIONS",
        headers: {
          Origin: fullEnv.WEB_ORIGIN,
          "Access-Control-Request-Headers": "Last-Event-ID",
        },
      });
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
        fullEnv.WEB_ORIGIN,
      );
      expect(allowed.headers.get("Access-Control-Allow-Headers")).toBe(
        allowedHeaders,
      );
      expect(allowed.headers.get("Access-Control-Expose-Headers")).toContain(
        "Retry-After",
      );
      const denied = await request(path, {
        method: "OPTIONS",
        headers: { Origin: "https://outside.example" },
      });
      expect(denied.headers.has("Access-Control-Allow-Origin")).toBe(false);
    }
    expect(
      (
        await request("/api/machine", {
          headers: { Origin: "https://outside.example" },
        })
      ).headers.has("Access-Control-Allow-Origin"),
    ).toBe(false);
  });

  it.each([
    [
      "shared signer token",
      "QUOTE_INTERNAL_TOKEN",
      fullEnv.INTAKE_INTERNAL_TOKEN,
    ],
    ["short signer token", "INTAKE_INTERNAL_TOKEN", "too-short"],
    [
      "URL credentials",
      "INTAKE_SIGNER_URL",
      "http://user:password@intake-signer.railway.internal",
    ],
    [
      "URL query",
      "QUOTE_SIGNER_URL",
      "http://quote-signer.railway.internal?token=not-allowed",
    ],
    [
      "URL fragment",
      "QUOTE_SIGNER_URL",
      "http://quote-signer.railway.internal#not-allowed",
    ],
  ])(
    "fails eager public credential validation for %s before config is loaded",
    async (_name, variable, value) => {
      boundary.realSettings = true;
      vi.stubEnv(variable!, value);
      await import("../index.js");
      expect(boundary.startupFailure).toHaveBeenCalledOnce();
      expect(boundary.publicFetch).toBeUndefined();
      expect(boundary.settingsLoads).toBe(0);
      expect(boundary.stop).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["INTAKE_SIGNER_URL"],
    ["INTAKE_INTERNAL_TOKEN"],
    ["QUOTE_SIGNER_URL"],
    ["QUOTE_INTERNAL_TOKEN"],
    [
      "INTAKE_SIGNER_URL",
      "INTAKE_INTERNAL_TOKEN",
      "QUOTE_SIGNER_URL",
      "QUOTE_INTERNAL_TOKEN",
    ],
  ])(
    "keeps public routes up with missing signer configuration %j",
    async (...missing) => {
      for (const variable of missing) vi.stubEnv(variable, undefined);
      await import("../index.js");
      expect(boundary.startupFailure).not.toHaveBeenCalled();
      expect(boundary.shutdown).toHaveBeenCalledOnce();
      expect((await request("/health")).status).toBe(200);
      expect((await request("/actions.json")).status).toBe(200);
      expect((await request("/api/config")).status).toBe(200);
      expect((await request("/api/machine")).status).toBe(200);
      const xray = await createFixtureSources();
      expect((await request(`/api/xray/${xray.owners.clean}`)).status).toBe(
        200,
      );
      for (const [signer, path, body] of [
        [
          "intake",
          "/api/feed/attest",
          {
            wallet: fixtures.publicKey,
            chunks: [[{ mint: fixtures.otherKey }]],
          },
        ],
        [
          "quote",
          "/api/sellback/quote",
          {
            owner: fixtures.publicKey,
            cardIndices: [0],
          },
        ],
      ] as const) {
        if (!missing.some((name) => name.startsWith(signer.toUpperCase())))
          continue;
        const response = await request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          asOfSlot: null,
          error: { code: "signer_unavailable" },
        });
        expect(boundary.logger.warn).toHaveBeenCalledWith(
          { reason: "signer_configuration_missing", signer },
          "public signer unavailable",
        );
        expect(boundary.logger.warn).toHaveBeenCalledWith(
          {
            reason: "signer_unavailable",
            cause: { code: "signer_unavailable", detail: "signer_unavailable" },
          },
          "public request unavailable",
        );
      }
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not capture future Web lane routes", async () => {
    const { createApi } = await import("../app.js");
    const { loadApiRole } = await import("../roles.js");
    const { createRuntime } = await import("@onepercent/service-kit");
    const { env } = loadApiRole();
    const runtime = await createRuntime({
      service: "api",
      role: "public",
      env,
    });
    const app = createApi(env, {
      publicRuntime: runtime,
      health: runtime.health.fetch,
    });
    expect(app.routes.filter((route) => route.path === "/health")).toHaveLength(
      1,
    );
    const { registerPublic } = await import("./index.js");
    const bare = new Hono();
    registerPublic(bare, runtime);
    for (const path of [
      "/api/values",
      "/api/logo/example",
      "/api/web/config",
      "/api/beacon",
    ]) {
      for (const method of ["GET", "POST"]) {
        expect((await bare.request(path, { method })).status).toBe(404);
      }
    }
  });

  it("preserves Node socket bindings when dispatching to the public router", async () => {
    const { createApi } = await import("../app.js");
    const { loadApiRole } = await import("../roles.js");
    const { createRuntime, hashClientIp } =
      await import("@onepercent/service-kit");
    const { env } = loadApiRole();
    const runtime = await createRuntime({
      service: "api",
      role: "public",
      env,
    });
    const app = createApi(env, {
      publicRuntime: runtime,
      health: runtime.health.fetch,
    });
    for (const remoteAddress of ["192.0.2.10", "192.0.2.11"]) {
      const response = await app.fetch(
        new Request(
          `http://api.example/api/value?mint=${fixtures.publicKey}&amount=1`,
        ),
        {
          incoming: {
            socket: { remoteAddress, remotePort: 1234, remoteFamily: "IPv4" },
          },
        },
      );
      expect(response.status).toBe(200);
      expect(boundary.rateEval).toHaveBeenLastCalledWith(
        expect.any(String),
        1,
        expect.stringContaining(
          hashClientIp(fullEnv.LOG_IP_SALT, remoteAddress),
        ),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
      );
    }
  });

  it.each([
    {
      trusted: "X-Real-IP",
      forwarded: ["192.0.2.10", "2001:db8::11"],
      expected: ["192.0.2.10", "2001:db8::11"],
    },
    {
      trusted: undefined,
      forwarded: ["192.0.2.10", "192.0.2.11"],
      expected: ["100.64.0.8", "100.64.0.8"],
    },
    {
      trusted: "X-Real-IP",
      forwarded: ["invalid", "192.0.2.10, 192.0.2.11"],
      expected: ["unknown", "unknown"],
    },
  ])(
    "uses only the configured single-address proxy header for RPC limits ($trusted, $forwarded)",
    async ({ trusted, forwarded, expected }) => {
      vi.stubEnv("TRUST_PROXY_HEADER", trusted);
      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        const { id } = JSON.parse(String(init?.body));
        return Response.json({ jsonrpc: "2.0", id, result: 123 });
      });
      const { createApi } = await import("../app.js");
      const { loadApiRole } = await import("../roles.js");
      const { createRuntime, hashClientIp } =
        await import("@onepercent/service-kit");
      const { env } = loadApiRole();
      const runtime = await createRuntime({
        service: "api",
        role: "public",
        env,
      });
      const app = createApi(env, {
        publicRuntime: runtime,
        health: runtime.health.fetch,
      });
      for (const [index, address] of forwarded.entries()) {
        const response = await app.fetch(
          new Request("http://api.example/api/rpc", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-real-ip": address,
              "x-forwarded-for": "203.0.113.99, 10.0.0.1",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: index,
              method: "getBlockHeight",
              params: [],
            }),
          }),
          {
            incoming: {
              socket: {
                remoteAddress: "100.64.0.8",
                remotePort: 1234,
                remoteFamily: "IPv4",
              },
            },
          },
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: index, result: 123 });
        expect(boundary.rateEval).toHaveBeenLastCalledWith(
          expect.any(String),
          1,
          `onepct:${env.CLUSTER}:${env.PROGRAM_ID}:limit:rpc:ip:${hashClientIp(fullEnv.LOG_IP_SALT, expected[index]!)}`,
          600,
          60_000,
          expect.any(String),
        );
      }
    },
  );
});
