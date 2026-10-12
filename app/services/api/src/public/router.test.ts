import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ConfigResponse,
  MachineResponse,
  MeResponse,
  VerifyResponse,
  StatusResponse,
  FeedAttestResponse,
  SellBackQuoteResponse,
  ValueResponse,
  HealthResponse,
  ErrorResponse,
  Block0Response,
  CreatorFeesResponse,
} from "@onepercent/sdk/api";
import { createPublicRouter, type PublicRouterOptions } from "./router.js";
import { createPublicRpcClient } from "./rpc-transport.js";
import { createSignerProxy } from "./signer.js";
import { loadPublicEnv } from "./env.js";
import { settings } from "./__fixtures__/settings.js";
import * as fixture from "./__fixtures__/responses.js";

function setup(rpc?: PublicRouterOptions["rpc"], api = settings.api) {
  const limit = vi.fn().mockResolvedValue({ ok: true, retryAfterS: 0 });
  const request = vi.fn().mockResolvedValue(7);
  const signer = vi.fn(
    async <T>(
      role: "intake" | "quote",
      _body: unknown,
      _ip: string,
      schema: z.ZodType<T>,
    ) => schema.parse(role === "intake" ? fixture.feed : fixture.quote),
  );
  const status = {
    asOfSlot: 1,
    indexer: { lagSlots: 0 },
    keeper: { leader: false, lastSettleAgeSeconds: null },
    signers: { intake: "unavailable", quote: "unavailable" },
    vrf: fixture.vrf,
  };
  const data = {
    config: vi.fn(async () => fixture.config),
    machine: vi.fn(async () => fixture.machine),
    me: vi.fn(async () => fixture.me),
    verify: vi.fn(async () => fixture.verify),
    status: vi.fn(async () => status),
    block0: vi.fn(async () => ({ status: "pending", asOfSlot: 1 })),
    creatorFees: vi.fn(async (limit: number) => {
      void limit;
      return { asOfSlot: 1, items: [] };
    }),
  };
  const app = createPublicRouter({
    settings: { ...settings, api },
    webOrigin: "https://onepercent.test",
    version: "test",
    commit: "test",
    ipSalt: "test-salt",
    cacheNamespace: "test",
    deck: fixture.otherKey,
    clientIp: (context) => context.req.header("x-test-ip") ?? "127.0.0.1",
    data,
    limiter: { limit },
    rpc: rpc ?? { request },
    signer: async (role, body, ip, schema) =>
      schema.parse(await signer(role, body, ip, schema)),
    cache: { get: async () => null, set: async () => "OK" },
    value: async () => ({
      asOfSlot: 1,
      status: "ok",
      lamports: "123",
      capped: true,
      label: "if_sold_now",
    }),
    events: {
      replayAfter: async () => [],
      confirmed: async (events) => [...events],
    },
  });
  return { app, limit, request, signer, data };
}
const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
describe("public API contract", () => {
  it("bounds creator fee queries before reading the database", async () => {
    const { app, data } = setup();
    for (const limit of ["0", "101", "-1", "1.5", "abc"]) {
      expect(
        (await app.request(`/api/creator-fees?limit=${limit}`)).status,
      ).toBe(400);
    }
    expect(data.creatorFees).not.toHaveBeenCalled();
    expect((await app.request("/api/creator-fees?limit=1")).status).toBe(200);
    expect(data.creatorFees).toHaveBeenCalledWith(1);
    await app.request("/api/creator-fees");
    expect(data.creatorFees).toHaveBeenLastCalledWith(100);
  });
  it("validates every JSON route against its shared SDK schema", async () => {
    const { app } = setup();
    const cases: [string, z.ZodType, unknown?][] = [
      ["/health", HealthResponse],
      ["/api/config", ConfigResponse],
      ["/api/machine", MachineResponse],
      [`/api/me/${fixture.publicKey}`, MeResponse],
      ["/api/verify/0", VerifyResponse],
      ["/api/status", StatusResponse],
      ["/api/block0", Block0Response],
      ["/api/creator-fees", CreatorFeesResponse],
      [`/api/value?mint=${fixture.publicKey}&amount=1`, ValueResponse],
      [
        "/api/feed/attest",
        FeedAttestResponse,
        { wallet: fixture.publicKey, chunks: [[{ mint: fixture.publicKey }]] },
      ],
      [
        "/api/sellback/quote",
        SellBackQuoteResponse,
        { owner: fixture.publicKey, cardIndices: [0] },
      ],
    ];
    for (const [path, schema, body] of cases) {
      const response = await app.request(path, body ? post(body) : undefined);
      expect(response.status, path).toBe(200);
      expect(schema.safeParse(await response.json()).success, path).toBe(true);
    }
  });
  it("rate limits every public RPC method and signer request while internal snapshots remain available", async () => {
    const { app, limit, request, signer } = setup();
    limit.mockResolvedValue({ ok: false, retryAfterS: 17 });
    const response = await app.request(
      "/api/feed/attest",
      post({
        wallet: fixture.publicKey,
        chunks: [[{ mint: fixture.publicKey }]],
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(signer).not.toHaveBeenCalled();
    for (const method of ["getSlot", "getBlockHeight", "getLatestBlockhash"]) {
      const result = await app.request(
        "/api/rpc",
        post({ jsonrpc: "2.0", id: 1, method }),
      );
      expect(result.status).toBe(429);
    }
    expect(request).not.toHaveBeenCalled();
    const me = await app.request(`/api/me/${fixture.publicKey}`);
    expect(me.status).toBe(200);
  });
  it("refuses the 601st account read before it reaches the proxy", async () => {
    const { app, limit, request } = setup();
    let requests = 0;
    limit.mockImplementation(async (_key, max) => ({
      ok: ++requests <= max,
      retryAfterS: 60,
    }));
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [fixture.publicKey],
    };
    for (let count = 0; count < settings.api.rpcPerMinutePerIp; count += 1) {
      expect((await app.request("/api/rpc", post(body))).status).toBe(200);
    }
    const refused = await app.request("/api/rpc", post(body));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("60");
    expect(request).toHaveBeenCalledTimes(settings.api.rpcPerMinutePerIp);
  }, 30_000);
  it("charges IP quotas before malformed JSON and wallet quotas only after validating the wallet", async () => {
    const { app, limit, signer } = setup();
    limit.mockResolvedValue({ ok: false, retryAfterS: 1 });
    for (const path of [
      "/api/rpc",
      "/api/feed/attest",
      "/api/sellback/quote",
    ]) {
      const response = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(response.status).toBe(429);
    }
    limit.mockResolvedValue({ ok: true, retryAfterS: 0 });
    limit.mockClear();
    expect(
      (
        await app.request(
          "/api/feed/attest",
          post({ wallet: "invalid", chunks: [] }),
        )
      ).status,
    ).toBe(400);
    expect(limit).toHaveBeenCalledOnce();
    expect(limit.mock.calls[0]![0]).toContain("feed:ip:");
    limit.mockClear();
    expect(
      (
        await app.request(
          "/api/feed/attest",
          post({ wallet: fixture.publicKey, chunks: [] }),
        )
      ).status,
    ).toBe(400);
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit.mock.calls[1]![0]).toContain(
      `feed:wallet:${fixture.publicKey}`,
    );
    expect(signer).not.toHaveBeenCalled();
  });
  it("honors configured per-IP capacity and releases each slot after completion", async () => {
    const { app, request } = setup(undefined, {
      ...settings.api,
      rpcMaxConcurrentPerIp: 2,
    });
    const release: ((result: number) => void)[] = [];
    request.mockImplementation(
      () => new Promise<number>((resolve) => release.push(resolve)),
    );
    const body = { jsonrpc: "2.0", id: 1, method: "getSlot" };
    const active = [
      app.request("/api/rpc", post(body)),
      app.request("/api/rpc", post(body)),
    ];
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    for (let count = 0; count < 5; count++) {
      const refused = await app.request("/api/rpc", {
        ...post(body),
        body: "{",
      });
      expect(refused.status).toBe(503);
      expect(refused.headers.get("Retry-After")).toBe("1");
      expect(await refused.json()).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "RPC capacity reached" },
      });
    }
    expect(request).toHaveBeenCalledTimes(2);
    const other = app.request("/api/rpc", {
      ...post(body),
      headers: { ...post(body).headers, "x-test-ip": "127.0.0.2" },
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    release[0]!(7);
    expect((await active[0]!).status).toBe(200);
    const next = app.request("/api/rpc", post(body));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    expect((await app.request("/api/rpc", post(body))).status).toBe(503);
    for (const resolve of release.slice(1)) resolve(7);
    for (const response of await Promise.all([active[1]!, other, next]))
      expect(response.status).toBe(200);
    request.mockResolvedValue(7);
    expect((await app.request("/api/rpc", post(body))).status).toBe(200);
  });
  it("admits six parallel page reads for each of ten IPs at production limits", async () => {
    const pending: { init?: RequestInit; resolve(response: Response): void }[] =
      [];
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => pending.push({ init, resolve })),
    );
    const { app } = setup(
      createPublicRpcClient({
        url: "https://rpc.example.test",
        transport: settings.transport,
        api: settings.api,
        fetch: fetcher,
      }),
    );
    const calls = Array.from({ length: 10 }, (_, user) =>
      Array.from({ length: 6 }, (_, read) => {
        const body = {
          jsonrpc: "2.0",
          id: `${user}:${read}`,
          method: "getSlot",
        };
        return app.request("/api/rpc", {
          ...post(body),
          headers: {
            ...post(body).headers,
            "x-test-ip": `127.0.0.${user + 1}`,
          },
        });
      }),
    ).flat();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(60));
    for (const item of pending) {
      const { id } = JSON.parse(String(item.init?.body)) as { id: number };
      item.resolve(Response.json({ jsonrpc: "2.0", id, result: 7 }));
    }
    const responses = await Promise.all(calls);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(
      await Promise.all(responses.map((response) => response.json())),
    ).toEqual(
      Array.from({ length: 10 }, (_, user) =>
        Array.from({ length: 6 }, (_, read) => ({
          jsonrpc: "2.0",
          id: `${user}:${read}`,
          result: 7,
        })),
      ).flat(),
    );
  });
  it("releases IP capacity after invalid requests and provider failures", async () => {
    const { app, request } = setup();
    const body = { jsonrpc: "2.0", id: 1, method: "getSlot" };
    for (let count = 0; count < 5; count++) {
      expect(
        (await app.request("/api/rpc", { ...post(body), body: "{" })).status,
      ).toBe(400);
      request.mockRejectedValueOnce(new Error("provider unavailable"));
      expect(
        await (await app.request("/api/rpc", post(body))).json(),
      ).toHaveProperty("error.code", -32000);
    }
    expect(
      await (await app.request("/api/rpc", post(body))).json(),
    ).toHaveProperty("result", 7);
  });
  it("returns HTTP backpressure when the shared provider concurrency ceiling is full", async () => {
    const pending: { init?: RequestInit; resolve(response: Response): void }[] =
      [];
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => pending.push({ init, resolve })),
    );
    const { app } = setup(
      createPublicRpcClient({
        url: "https://rpc.example.test",
        transport: settings.transport,
        api: settings.api,
        fetch: fetcher,
      }),
    );
    const body = { jsonrpc: "2.0", id: "capacity", method: "getSlot" };
    const active = Array.from(
      { length: settings.api.rpcMaxConcurrent },
      (_, index) =>
        app.request("/api/rpc", {
          ...post(body),
          headers: {
            ...post(body).headers,
            "x-test-ip": `127.0.0.${Math.floor(index / 2) + 1}`,
          },
        }),
    );
    await vi.waitFor(() =>
      expect(fetcher).toHaveBeenCalledTimes(settings.api.rpcMaxConcurrent),
    );
    const refused = await app.request("/api/rpc", {
      ...post(body),
      headers: { ...post(body).headers, "x-test-ip": "127.0.0.99" },
    });
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("1");
    expect(await refused.json()).toEqual({
      jsonrpc: "2.0",
      id: "capacity",
      error: { code: -32000, message: "RPC capacity reached" },
    });
    expect(fetcher).toHaveBeenCalledTimes(settings.api.rpcMaxConcurrent);
    for (const item of pending) {
      const { id } = JSON.parse(String(item.init?.body)) as { id: number };
      item.resolve(Response.json({ jsonrpc: "2.0", id, result: 7 }));
    }
    for (const response of await Promise.all(active))
      expect(response.status).toBe(200);
  });
  it("hashes IPs and keys wallet quotas by the requested wallet", async () => {
    const { app, limit } = setup();
    await app.request(
      "/api/feed/attest",
      post({
        wallet: fixture.publicKey,
        chunks: [[{ mint: fixture.publicKey }]],
      }),
    );
    expect(limit.mock.calls[0]![0]).toMatch(/feed:ip:[0-9a-f]{64}$/);
    expect(limit.mock.calls[0]![0]).not.toContain("127.0.0.1");
    expect(limit.mock.calls[1]).toEqual([
      `onepct:test:limit:feed:wallet:${fixture.publicKey}`,
      30,
      60,
    ]);
  });
  it("rejects invalid inputs, preserves M4 hold 404 and refuses invalid source responses", async () => {
    const { app, data } = setup();
    for (const path of [
      "/api/me/not-key",
      "/api/verify/-1",
      "/api/value?mint=bad&amount=1",
    ]) {
      const r = await app.request(path);
      expect(r.status).toBe(400);
      expect(ErrorResponse.safeParse(await r.json()).success).toBe(true);
    }
    expect((await app.request("/api/hold/attest", post({}))).status).toBe(404);
    data.machine.mockResolvedValue({ ...fixture.machine, asOfSlot: -1 });
    expect((await app.request("/api/machine")).status).toBe(503);
    expect(
      (
        await app.request(
          "/api/feed/attest",
          post({
            wallet: fixture.publicKey,
            chunks: [[{ mint: fixture.publicKey }, { mint: fixture.otherKey }]],
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("permits only the configured CORS origin and SSE resume header", async () => {
    const { app } = setup();
    const accepted = await app.request("/api/stream", {
      method: "OPTIONS",
      headers: {
        origin: "https://onepercent.test",
        "access-control-request-method": "GET",
        "access-control-request-headers": "Last-Event-ID",
      },
    });
    expect(accepted.headers.get("access-control-allow-origin")).toBe(
      "https://onepercent.test",
    );
    expect(accepted.headers.get("access-control-allow-headers")).toContain(
      "Last-Event-ID",
    );
    const refused = await app.request("/health", {
      headers: { origin: "https://else.test" },
    });
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });
});
describe("public key isolation and signer boundary", () => {
  it("rejects a role key and duplicate private bearer tokens", () => {
    const env = {
      WEB_ORIGIN: "https://onepercent.test",
      INTAKE_SIGNER_URL: "http://intake.internal",
      INTAKE_INTERNAL_TOKEN: "a".repeat(32),
      QUOTE_SIGNER_URL: "http://quote.internal",
      QUOTE_INTERNAL_TOKEN: "b".repeat(32),
    };
    expect(() => loadPublicEnv({ ...env, KEEPER_KEYPAIR: "" })).toThrow(
      "KEEPER_KEYPAIR",
    );
    expect(() =>
      loadPublicEnv({
        ...env,
        QUOTE_INTERNAL_TOKEN: env.INTAKE_INTERNAL_TOKEN,
      }),
    ).toThrow("QUOTE_INTERNAL_TOKEN");
    expect(loadPublicEnv(env).flags.PACKS).toBe(false);
  });
  it("sends only the selected bearer and sanitized IP header, validates response, blocks redirects", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(fixture.feed), { status: 200 }),
      );
    const proxy = createSignerProxy({
      settings,
      intake: { url: "http://intake.internal", token: "a".repeat(32) },
      quote: { url: "http://quote.internal", token: "b".repeat(32) },
      fetch: fetcher,
    });
    await proxy(
      "intake",
      { wallet: fixture.publicKey },
      "hashed-ip",
      FeedAttestResponse,
    );
    const init = fetcher.mock.calls[0]![1];
    expect(init.redirect).toBe("error");
    expect(init.headers.authorization).toBe(`Bearer ${"a".repeat(32)}`);
    expect(init.headers["x-client-ip-hash"]).toBe("hashed-ip");
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ secret: "provider-secret" }), {
        status: 500,
      }),
    );
    await expect(
      proxy("quote", {}, "hashed-ip", SellBackQuoteResponse),
    ).rejects.toThrow("signer_unavailable");
  });
});

it("healthy signer policy refusals do not trip the global transport circuit", async () => {
  const fetcher = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ reason: "rate_limited" }), {
        status: 429,
        headers: { "retry-after": "1" },
      }),
  );
  const proxy = createSignerProxy({
    settings,
    intake: { url: "http://intake.internal", token: "a".repeat(32) },
    quote: { url: "http://quote.internal", token: "b".repeat(32) },
    fetch: fetcher,
  });
  for (let i = 0; i <= settings.transport.breakerFailureThreshold; i++)
    await expect(proxy("intake", {}, "ip", FeedAttestResponse)).rejects.toThrow(
      "rate_limited",
    );
  fetcher.mockImplementation(
    async () => new Response(JSON.stringify(fixture.feed), { status: 200 }),
  );
  expect(await proxy("intake", {}, "ip", FeedAttestResponse)).toEqual(
    fixture.feed,
  );
});
