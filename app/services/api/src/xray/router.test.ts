import "./test-setup.js";
import { XrayError } from "./error.js";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../app.js";
import { parseEnv } from "../env.js";
import { createXrayRouter, type XrayRouterDependencies } from "./router.js";
import { parseXrayEnv } from "./env.js";
import { canonicalAddress, XrayService } from "./service.js";
import { createXrayDependencies } from "./deps.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { SharePageRenderer, escapeHtml } from "./share-page.js";
import { testSources } from "./test-sources.js";

const address = "11111111111111111111111111111111";
const apiPath = `/api/xray/${address}`;
function dependencies(): XrayRouterDependencies {
  return {
    service: new XrayService(testSources()),
    env: parseXrayEnv({ TRUST_PROXY_HEADER: "cf-connecting-ip" }),
    limiter: new SlidingWindowRateLimiter(),
    turnstile: { verify: vi.fn(async () => true) },
    sharePage: new SharePageRenderer("http://localhost:5173"),
    renderCard: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
  };
}
describe("X-ray HTTP controls", () => {
  it("rejects address lengths outside the base58 public-key bounds", () => {
    expect(canonicalAddress("1".repeat(31))).toBeNull();
    expect(canonicalAddress("z".repeat(45))).toBeNull();
    expect(canonicalAddress("z".repeat(100_000))).toBeNull();
    expect(canonicalAddress(address)).toBe(address);
    const full = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
    expect(canonicalAddress(full)).toBe(full);
  });
  it("requires the explicit SNS flag and rejects the dropped suffix even when enabled", async () => {
    expect(parseXrayEnv({}).XRAY_SNS_ENABLED).toBe(false);
    expect(parseXrayEnv({ XRAY_SNS_ENABLED: "false" }).XRAY_SNS_ENABLED).toBe(
      false,
    );
    expect(() => parseXrayEnv({ XRAY_SNS_ENABLED: "1" })).toThrow(
      /XRAY_SNS_ENABLED/,
    );
    const disabled = createXrayRouter(
      await createXrayDependencies({ XRAY_SOURCE: "fixtures" }),
    );
    expect((await disabled.request("/api/xray/clean.sns")).status).toBe(400);
    const enabled = createXrayRouter(
      await createXrayDependencies({
        XRAY_SOURCE: "fixtures",
        XRAY_SNS_ENABLED: "true",
      }),
    );
    expect((await enabled.request("/api/xray/clean.sns")).status).toBe(200);
    expect((await enabled.request("/api/xray/clean.sol")).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("registers alongside unchanged health routes", async () => {
    const app = createApi(parseEnv({}), { xray: dependencies() });
    expect((await app.request("/health")).status).toBe(200);
    const first = await app.request(apiPath);
    expect(first.status).toBe(200);
    expect((await (await app.request(apiPath)).json()).cached).toBe(true);
    const evm = await app.request(
      "/api/xray/0x52908400098527886E0F7030069857D2E4169EE7",
    );
    expect(evm.status).toBe(400);
    expect(await evm.json()).toEqual({
      error: "evm_not_supported",
      message: "Solana wallets only for now.",
    });
  });
  it("challenges the eleventh API request and excludes image/share crawlers", async () => {
    const deps = dependencies();
    vi.mocked(deps.turnstile.verify).mockResolvedValue(false);
    const app = createXrayRouter(deps);
    for (let i = 0; i < 10; i++)
      expect((await app.request(apiPath)).status).toBe(200);
    expect((await app.request(apiPath)).status).toBe(403);
    expect(deps.turnstile.verify).toHaveBeenCalledTimes(1);
    expect((await app.request(`${apiPath}/card.png`)).status).toBe(200);
    expect((await app.request(`/x/${address}`)).status).toBe(200);
    expect(deps.turnstile.verify).toHaveBeenCalledTimes(1);
  });
  it("limits every route per trusted IP and returns Retry-After", async () => {
    const deps = dependencies();
    const app = createXrayRouter(deps);
    const headers = { "cf-connecting-ip": "192.0.2.1" };
    for (let i = 0; i < 60; i++)
      expect((await app.request(apiPath, { headers })).status).toBe(200);
    for (const path of [apiPath, `${apiPath}/card.png`, `/x/${address}`]) {
      const response = await app.request(path, { headers });
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    }
    expect(
      (
        await app.request(apiPath, {
          headers: { "cf-connecting-ip": "192.0.2.2" },
        })
      ).status,
    ).toBe(200);
  });
  it("uses an unknown bucket without socket info and ignores untrusted forwarded IPs", async () => {
    const deps = dependencies();
    deps.env.TRUST_PROXY_HEADER = undefined;
    deps.limiter = new SlidingWindowRateLimiter(1);
    const app = createXrayRouter(deps);
    expect(
      (
        await app.request(apiPath, {
          headers: { "x-forwarded-for": "192.0.2.1" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(apiPath, {
          headers: { "x-forwarded-for": "192.0.2.2" },
        })
      ).status,
    ).toBe(429);
  });
  it("accepts only a configured exact bearer secret", async () => {
    const deps = dependencies();
    deps.env.BOT_API_SECRET = "test-bot-token";
    deps.limiter = new SlidingWindowRateLimiter(1);
    const app = createXrayRouter(deps);
    await app.request(apiPath);
    expect(
      (
        await app.request(apiPath, {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await app.request(apiPath, {
          headers: { Authorization: "Bearer test-bot-token" },
        })
      ).status,
    ).toBe(200);
    deps.env.BOT_API_SECRET = undefined;
    expect(
      (
        await app.request(apiPath, {
          headers: { Authorization: "Bearer test-bot-token" },
        })
      ).status,
    ).toBe(429);
  });
  it("rejects invalid shares before scan and passes supported image format", async () => {
    const deps = dependencies();
    const scan = vi.spyOn(deps.service, "get");
    const app = createXrayRouter(deps);
    expect((await app.request("/x/invalid")).status).toBe(404);
    expect(scan).not.toHaveBeenCalled();
    expect((await app.request(`${apiPath}/card.png?format=bad`)).status).toBe(
      400,
    );
    const image = await app.request(`${apiPath}/card.png?format=square&v=123`);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(deps.renderCard).toHaveBeenCalledWith(expect.anything(), "square");
  });
  it("serves the app shell, not raw JSON, when a share link's scan fails", async () => {
    const deps = dependencies();
    vi.spyOn(deps.service, "get").mockRejectedValue(
      new XrayError("prices_unavailable", 502),
    );
    const app = createXrayRouter(deps);
    const response = await app.request(`/x/${address}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/text\/html/);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    const html = await response.text();
    expect(html).not.toContain("prices_unavailable");
    expect(html).not.toContain("og:image");
    const invalid = await app.request("/x/invalid");
    expect(invalid.status).toBe(404);
    expect(invalid.headers.get("Content-Type")).toMatch(/text\/html/);
  });
  it("emits OG and Twitter metadata with properly escaped values", async () => {
    const deps = dependencies();
    const result = await deps.service.get(address);
    result.bags = [
      {
        mint: address,
        symbol: '<script>"',
        name: '"name',
        logoUrl: null,
        amountUi: "1",
        decimals: 0,
        tokenProgram: "spl",
        buckets: ["not_in_set"],
      },
    ];
    result.share.landscapeUrl = 'https://example.test/image?name="<script>&';
    const html = await deps.sharePage.render(result);
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain("&quot;&lt;script&gt;&amp;");
    expect(html).not.toContain("<script>");
    expect(escapeHtml("<&>\"'")).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
  it("fetches the HTML shell once and replaces existing social tags", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          '<html><head><meta property="og:title" content="old"></head><body>app</body></html>',
        ),
      );
    const page = new SharePageRenderer(
      "http://localhost:5173",
      "https://example.test/index.html",
      fetcher,
    );
    const result = await new XrayService(testSources()).get(address);
    const html = await page.render(result);
    await page.render(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).toContain("<body>app</body>");
  });
});

describe("rate limiter cleanup cadence", () => {
  it("iterates inactive buckets at most once per second under an IP burst", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(60, () => now);
    const iteration = vi.spyOn(Map.prototype, Symbol.iterator);
    let firstWindow: number;
    let secondWindow: number;
    try {
      for (let index = 0; index < 100; index++) limiter.take(`client-${index}`);
      now = 999;
      limiter.take("last-in-window");
      firstWindow = iteration.mock.calls.length;
      now = 1000;
      limiter.take("next-window");
      secondWindow = iteration.mock.calls.length;
    } finally {
      iteration.mockRestore();
    }
    expect(firstWindow!).toBe(1);
    expect(secondWindow!).toBe(2);
  });
  it("expires the current IP window even between full-map cleanup passes", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(1, () => now);
    expect(limiter.take("current").allowed).toBe(true);
    now = 59_999;
    limiter.take("another");
    expect(limiter.take("current").allowed).toBe(false);
    now = 60_000;
    expect(limiter.take("current")).toMatchObject({ allowed: true, count: 1 });
  });
});
