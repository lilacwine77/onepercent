import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebConfigResponse, ValuesResponse } from "@onepercent/web-api";
import { WEB } from "@onepercent/config";
import { createWebDependencies } from "./deps.js";
import { createWebRouter } from "./router.js";
import { BeaconCounters } from "./beacon.js";
import { WebValues } from "./values.js";
import { LogoProxy } from "./logo.js";
import { ItemLimiter } from "./limits.js";
import { createApi } from "../app.js";
const mint = "So11111111111111111111111111111111111111112";
beforeEach(() =>
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network in unit test");
  }),
);
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const deps = createWebDependencies({
    XRAY_SOURCE: "fixtures",
    WEB_ORIGIN: "https://web.test",
    LOG_LEVEL: "silent",
  });
  const increment = vi.fn(async () => undefined);
  deps.counters = new BeaconCounters({ increment }, () =>
    Date.UTC(2026, 9, 8, 12),
  );
  return { deps, increment, app: createWebRouter(deps) };
}
const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
describe("web routes", () => {
  it("serves public web config and fails fast on invalid addresses", async () => {
    const { app } = setup();
    const response = await app.request("/api/web/config");
    expect(WebConfigResponse.parse(await response.json())).toEqual({
      lookupTable: null,
      adminMultisig: null,
      flags: { XRAY: false },
    });
    expect(() =>
      createWebDependencies({ PROTOCOL_LUT_ADDRESS: "wrong" }),
    ).toThrow();
  });
  it("returns schema-valid unavailable values when no recorded provider exists", async () => {
    const { app } = setup();
    const response = await app.request(
      "/api/values",
      post({ mode: "est", items: [{ mint, amount: "1" }] }),
    );
    expect(response.status).toBe(200);
    expect(
      ValuesResponse.parse(await response.json()).items[0]?.value.status,
    ).toBe("unavailable");
  });
  it("counts est and now items atomically in the same bucket", async () => {
    const { app, deps } = setup();
    deps.values = new WebValues({
      ...deps.values.sources,
      valueNow: async () => ({ status: "unavailable", reason: "NO_QUOTE" }),
    });
    const request = (mode: "now" | "est", amount: number) =>
      app.request(
        "/api/values",
        post({
          mode,
          items: Array.from({ length: amount }, () => ({ mint, amount: "1" })),
        }),
      );
    for (let i = 0; i < 4; i += 1)
      expect((await request(i % 2 ? "now" : "est", 50)).status).toBe(200);
    expect((await request("now", 40)).status).toBe(200);
    const blocked = await request("now", 1);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect((await request("est", 1)).status).toBe(429);
  });
  it("rejects malformed, oversize and extra request fields", async () => {
    const { app } = setup();
    for (const body of [
      { mode: "now", items: [{ mint, amount: "-1" }] },
      { mode: "now", items: [], wallet: mint },
    ])
      expect((await app.request("/api/values", post(body))).status).toBe(400);
    expect(
      (await app.request("/api/values", post({ padding: "a".repeat(20_000) })))
        .status,
    ).toBe(400);
  });
  it("stores only hourly bounded counters and rejects identifiers or free text", async () => {
    const { app, increment } = setup();
    expect(
      (
        await app.request(
          "/api/beacon",
          post({ event: "page_view", route: "xray" }),
        )
      ).status,
    ).toBe(204);
    expect(increment).toHaveBeenCalledWith(
      "2026-10-08T12",
      "event=page_view:route=xray",
    );
    expect(
      (
        await app.request(
          "/api/beacon",
          post({ event: "page_view", route: "xray", mint }),
        )
      ).status,
    ).toBe(400);
    expect(increment).toHaveBeenCalledTimes(1);
  });
  it("limits analytics and surfaces unavailable storage honestly", async () => {
    const { app } = setup();
    for (let i = 0; i < WEB.beaconPerMinutePerIp; i += 1)
      expect(
        (
          await app.request(
            "/api/beacon",
            post({ event: "page_view", route: "home" }),
          )
        ).status,
      ).toBe(204);
    expect(
      (
        await app.request(
          "/api/beacon",
          post({ event: "page_view", route: "home" }),
        )
      ).status,
    ).toBe(429);
    expect(
      (
        await createWebRouter(createWebDependencies()).request(
          "/api/beacon",
          post({ event: "page_view", route: "home" }),
        )
      ).status,
    ).toBe(503);
  });
  it("serves verified logo bytes with nosniff and caches, malformed mints return 404", async () => {
    const { deps } = setup();
    deps.logos = new LogoProxy(
      async () => ({
        [mint]: {
          symbol: "",
          name: "",
          decimals: 9,
          logoURI: "https://ipfs.io/a",
        },
      }),
      async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const app = createWebRouter(deps);
    const response = await app.request(`/api/logo/${mint}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await app.request("/api/logo/bad")).status).toBe(404);
  });
  it("charges logo misses per IP but serves cached bytes and negative entries after exhaustion", async () => {
    const { deps } = setup();
    const missing = "11111111111111111111111111111111";
    const other = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const metadata = vi.fn(async () => ({
      [mint]: {
        name: "",
        symbol: "",
        decimals: 9,
        logoURI: "https://ipfs.io/a",
      },
    }));
    deps.logoLimiter = new ItemLimiter(2);
    deps.logos = new LogoProxy(
      metadata,
      async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    deps.trustedProxyHeader = "x-real-ip";
    const app = createWebRouter(deps);
    const logo = (address: string, ip = "192.0.2.1") =>
      app.request(`/api/logo/${address}`, { headers: { "x-real-ip": ip } });
    expect((await logo(mint)).status).toBe(200);
    expect((await logo(missing)).status).toBe(404);
    const blocked = await logo(other);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect((await logo(mint)).status).toBe(200);
    expect((await logo(missing)).status).toBe(404);
    expect(metadata).toHaveBeenCalledTimes(2);
    expect((await logo(other, "192.0.2.2")).status).toBe(404);
    expect(metadata).toHaveBeenCalledTimes(3);
  });
  it("reports a redacted upstream cause while preserving the public error response", async () => {
    const { deps } = setup();
    deps.logger = { warn: vi.fn() };
    deps.counters = new BeaconCounters({
      increment: async () => {
        throw new Error(
          "upstream failed https://private.test/path?token=secret",
        );
      },
    });
    const response = await createWebRouter(deps).request(
      "/api/beacon",
      post({ event: "page_view", route: "home" }),
    );
    expect(response.status).toBe(503);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      {
        reason: "web_route_failed",
        route: "beacon",
        cause: { code: "Error", detail: "upstream failed <redacted>" },
      },
      "Web request failed",
    );
    expect(await response.text()).not.toContain("secret");
  });
  it("permits configured-origin POST preflights and keeps the unused swap route absent", async () => {
    const { deps } = setup();
    const app = createApi(
      { WEB_ORIGIN: deps.webOrigin, APP_VERSION: "test", GIT_COMMIT: "test" },
      { web: deps },
    );
    const response = await app.request("/api/values", {
      method: "OPTIONS",
      headers: {
        Origin: "https://web.test",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST",
    );
    expect((await app.request("/api/send", post({ tx: "AQ==" }))).status).toBe(
      400,
    );
    expect((await app.request("/api/swap/sell")).status).toBe(404);
  });
});
