import "./test-setup.js";
import { describe, expect, it } from "vitest";
import { buildShareLinks, sharePageUrl } from "./share.js";
import { XrayService } from "./service.js";
import { createXrayRouter } from "./router.js";
import { parseXrayEnv } from "./env.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { SharePageRenderer } from "./share-page.js";
import { testSources } from "./test-sources.js";
import { xraySegments } from "@onepercent/eligibility/copy";
import { XrayError } from "./error.js";

const address = "11111111111111111111111111111111";
const options = {
  publicWebUrl: "https://example.test",
  publicApiUrl: "https://api.example.test",
  scannedAt: "2026-10-08T12:00:00.000Z",
  bags: 2,
  title: "Certified Bagholder",
};
describe("referral links", () => {
  it("pins all share links, defaulting to the scanned address", () => {
    expect(sharePageUrl(address, options.publicWebUrl)).toBe(
      `https://example.test/x/${address}?ref=${address}`,
    );
    const links = buildShareLinks(address, options);
    expect(links.landscapeUrl).toBe(
      `https://api.example.test/api/xray/${address}/card.png?format=landscape&v=1791460800&ref=${address}`,
    );
    expect(links.squareUrl).toBe(
      `https://api.example.test/api/xray/${address}/card.png?format=square&v=1791460800&ref=${address}`,
    );
    expect(links.xIntentUrl).toBe(
      `https://x.com/intent/post?text=X-ray+%E2%9C%B3+2+bags+%E2%9C%B3+Certified+Bagholder&url=https%3A%2F%2Fexample.test%2Fx%2F${address}%3Fref%3D${address}`,
    );
  });
  it("keeps valid aliases and addresses, rejects invalid codes", () => {
    for (const ref of ["alice_1", address, "<script>", "UPPER", ""]) {
      const expected = ref === "alice_1" ? ref : address;
      const links = buildShareLinks(address, { ...options, ref });
      for (const image of [links.landscapeUrl, links.squareUrl])
        expect(new URL(image).searchParams.get("ref")).toBe(expected);
      const page = new URL(new URL(links.xIntentUrl).searchParams.get("url")!);
      expect(page.searchParams.get("ref")).toBe(expected);
    }
  });
  it("pins singular share text and copy-backed error variables", () => {
    const links = buildShareLinks(address, { ...options, bags: 1 });
    expect(new URL(links.xIntentUrl).searchParams.get("text")).toBe(
      "X-ray ✳ 1 bag ✳ Certified Bagholder",
    );
    expect(new XrayError("rate_limited", 429, { s: "23" }).message).toBe(
      "Too many X-rays from here. Try again in 23 s.",
    );
    expect(new XrayError("wallet_too_large", 422).message).toBe(
      "This wallet has more than 2,000 token accounts. X-ray can’t read it yet.",
    );
  });
  it("shares one address scan across referrals without contaminating cached links", async () => {
    const deps = testSources();
    const service = new XrayService(deps);
    const [alice, bob] = await Promise.all([
      service.get(address, { ref: "alice" }),
      service.get(address, { ref: "bob" }),
    ]);
    expect(new URL(alice.share.landscapeUrl).searchParams.get("ref")).toBe(
      "alice",
    );
    expect(new URL(bob.share.landscapeUrl).searchParams.get("ref")).toBe("bob");
    const cached = await service.get(address);
    expect(cached.cached).toBe(true);
    expect(new URL(cached.share.landscapeUrl).searchParams.get("ref")).toBe(
      address,
    );
    expect(deps.chain.getTokenAccounts).toHaveBeenCalledTimes(1);
  });
  it("keeps the request referral on API links and share page metadata", async () => {
    const service = new XrayService(testSources());
    const app = createXrayRouter({
      service,
      env: parseXrayEnv({}),
      limiter: new SlidingWindowRateLimiter(),
      turnstile: { verify: async () => true },
      sharePage: new SharePageRenderer(options.publicWebUrl),
    });
    const response = await app.request(`/api/xray/${address}?ref=alice`);
    const result = await response.json();
    expect(new URL(result.share.landscapeUrl).searchParams.get("ref")).toBe(
      "alice",
    );
    const html = await (await app.request(`/x/${address}?ref=bob`)).text();
    expect(html).toContain(
      `property="og:url" content="https://example.test/x/${address}?ref=bob"`,
    );
    expect(html).toContain("&amp;ref=bob");
    expect(html).toContain(
      `property="og:description" content="${xraySegments(result)}"`,
    );
    expect(html).toContain(">View the X-ray</a>");
  });
});
