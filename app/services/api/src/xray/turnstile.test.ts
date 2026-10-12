import "./test-setup.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WEB } from "@onepercent/config";
import { XRAY } from "@onepercent/eligibility";
import {
  CloudflareTurnstileVerifier,
  NoopTurnstileVerifier,
} from "./turnstile.js";
import { parseXrayEnv } from "./env.js";
import { createXrayDependencies } from "./deps.js";
import { createXrayRouter } from "./router.js";
import { XrayService } from "./service.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { SharePageRenderer } from "./share-page.js";
import { testSources } from "./test-sources.js";

afterEach(() => vi.useRealTimers());
const webOrigin = "https://onepercent.test";
const hostname = new URL(webOrigin).hostname;
const fakeSecret = "test-only-turnstile-secret";

describe("Cloudflare Turnstile verification", () => {
  it.each([
    undefined,
    null,
    "other.test",
    "onepercent.test.attacker.test",
    "attacker.test@onepercent.test",
  ])(
    "rejects an accepted token for an absent or different hostname (%s)",
    async (receivedHostname) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ success: true, hostname: receivedHostname }),
        );
      expect(
        await new CloudflareTurnstileVerifier(
          fakeSecret,
          webOrigin,
          fetcher,
        ).verify("token", "192.0.2.15"),
      ).toBe(false);
    },
  );
  it.each(["unknown", "", "192.0.2.15, 192.0.2.16"])(
    "omits remoteip when it is not a single known IP (%s)",
    async (ip) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ success: true, hostname }));
      expect(
        await new CloudflareTurnstileVerifier(
          fakeSecret,
          webOrigin,
          fetcher,
        ).verify("token", ip),
      ).toBe(true);
      expect(
        (fetcher.mock.calls[0]![1]!.body as URLSearchParams).has("remoteip"),
      ).toBe(false);
    },
  );
  it("posts only the documented form fields and accepts a literal success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true, hostname }));
    const verifier = new CloudflareTurnstileVerifier(
      fakeSecret,
      webOrigin,
      fetcher,
    );
    expect(await verifier.verify("challenge-token", "192.0.2.15")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      secret: fakeSecret,
      response: "challenge-token",
      remoteip: "192.0.2.15",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("refuses missing, empty and oversized tokens before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const verifier = new CloudflareTurnstileVerifier(
      fakeSecret,
      webOrigin,
      fetcher,
    );
    for (const token of [
      undefined,
      "",
      "x".repeat(WEB.turnstileTokenMaxLength + 1),
    ])
      expect(await verifier.verify(token, "192.0.2.15")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([false, "true", 1, undefined, null])(
    "fails closed when success is %s",
    async (success) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ success }));
      expect(
        await new CloudflareTurnstileVerifier(
          fakeSecret,
          webOrigin,
          fetcher,
        ).verify("token", "192.0.2.15"),
      ).toBe(false);
    },
  );
  it("fails closed on bad HTTP responses, invalid JSON and network failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ success: true, hostname }, { status: 502 }),
      )
      .mockResolvedValueOnce(new Response("unreadable", { status: 200 }))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const verifier = new CloudflareTurnstileVerifier(
      fakeSecret,
      webOrigin,
      fetcher,
    );
    for (let index = 0; index < 3; index++)
      expect(await verifier.verify("token", "192.0.2.15")).toBe(false);
  });
  it("returns false and aborts at the configured deadline even when fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const pending = new CloudflareTurnstileVerifier(
      fakeSecret,
      webOrigin,
      fetcher,
    ).verify("token", "192.0.2.15");
    await vi.advanceTimersByTimeAsync(WEB.turnstileTimeoutMs);
    expect(await pending).toBe(false);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears its deadline after an accepted response", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ success: true, hostname }));
    expect(
      await new CloudflareTurnstileVerifier(
        fakeSecret,
        webOrigin,
        fetcher,
      ).verify("token", "192.0.2.15"),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });
});

describe("live boot and the eleventh request", () => {
  it("requires a Turnstile secret for explicit or inferred live mode", async () => {
    for (const input of [
      { XRAY_SOURCE: "live", HELIUS_RPC_URL: "https://rpc.example.test" },
      { HELIUS_API_KEY: "test-only-provider" },
      { HELIUS_RPC_URL: "https://rpc.example.test", TURNSTILE_SECRET: "" },
    ]) {
      expect(() => parseXrayEnv(input)).toThrow("TURNSTILE_SECRET");
      await expect(createXrayDependencies(input)).rejects.toThrow(
        "TURNSTILE_SECRET",
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("installs the real verifier in live mode and keeps the no-op in fixtures only", async () => {
    const live = await createXrayDependencies({
      XRAY_SOURCE: "live",
      HELIUS_RPC_URL: "https://rpc.example.test",
      TURNSTILE_SECRET: fakeSecret,
    });
    expect(live.turnstile).toBeInstanceOf(CloudflareTurnstileVerifier);
    const fixtures = await createXrayDependencies({ XRAY_SOURCE: "fixtures" });
    expect(fixtures.turnstile).toBeInstanceOf(NoopTurnstileVerifier);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the real verifier after ten scans; only an accepted token resumes the scan", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: false }))
      .mockResolvedValueOnce(Response.json({ success: true, hostname }));
    const service = new XrayService(testSources());
    const scan = vi.spyOn(service, "get");
    const app = createXrayRouter({
      service,
      env: parseXrayEnv({ TRUST_PROXY_HEADER: "cf-connecting-ip" }),
      limiter: new SlidingWindowRateLimiter(),
      turnstile: new CloudflareTurnstileVerifier(
        fakeSecret,
        webOrigin,
        fetcher,
      ),
      sharePage: new SharePageRenderer("https://example.test"),
    });
    const path = "/api/xray/11111111111111111111111111111111";
    const headers = { "cf-connecting-ip": "192.0.2.15" };
    for (let index = 0; index < XRAY.turnstileAfterRequests; index++)
      expect((await app.request(path, { headers })).status).toBe(200);
    const missing = await app.request(path, { headers });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({
      error: "turnstile_required",
      message: "One quick check, then the X-ray runs.",
    });
    expect(fetcher).not.toHaveBeenCalled();
    const rejected = await app.request(path, {
      headers: { ...headers, "cf-turnstile-response": "rejected-token" },
    });
    expect(rejected.status).toBe(403);
    expect(scan).toHaveBeenCalledTimes(XRAY.turnstileAfterRequests);
    const accepted = await app.request(path, {
      headers: { ...headers, "cf-turnstile-response": "accepted-token" },
    });
    expect(accepted.status).toBe(200);
    expect(scan).toHaveBeenCalledTimes(XRAY.turnstileAfterRequests + 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
