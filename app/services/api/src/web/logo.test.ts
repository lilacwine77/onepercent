import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB } from "@onepercent/config";
import {
  LogoProxy,
  logoCandidates,
  logoType,
  permittedLogoUrl,
  publicLogoAddress,
  LOGO_CACHE_MAX_BYTES,
  LOGO_NEGATIVE_CACHE_MS,
} from "./logo.js";
const mint = "So11111111111111111111111111111111111111112";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
beforeEach(() =>
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network in unit test");
  }),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("logo proxy", () => {
  it("allows only exact https hosts and true wildcard subdomains", () => {
    for (const url of [
      "https://ipfs.io/ipfs/a",
      "https://one.mypinata.cloud/ipfs/a",
      "https://one.arweave.net/a",
    ])
      expect(permittedLogoUrl(url)).not.toBeNull();
    for (const url of [
      "http://ipfs.io/a",
      "https://ipfs.io.evil.test/a",
      "https://evil.test/a",
      "https://user:pass@ipfs.io/a",
      "https://ipfs.io:8443/a",
      "https://mypinata.cloud/a",
      "https://127.0.0.1/a",
      "https://ipfs.io@127.0.0.1/a",
    ])
      expect(permittedLogoUrl(url)).toBeNull();
  });
  it("tries IPFS content on the allowed gateways, never on an unlisted host", () => {
    const cid = "QmNdTtJauw39u4DzGyTaZ35rRx4VgAxqb91wE89zjyHWd2";
    const v1 = "bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum";
    const hrefs = (uri: string) => logoCandidates(uri).map((url) => url.href);
    expect(hrefs(`https://ipfs.io/ipfs/${cid}`)).toEqual([
      `https://ipfs.io/ipfs/${cid}`,
      `https://ipfs.filebase.io/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
    ]);
    expect(hrefs(`https://${v1}.ipfs.nftstorage.link`)).toEqual([
      `https://ipfs.filebase.io/ipfs/${v1}`,
      `https://gateway.pinata.cloud/ipfs/${v1}`,
      `https://ipfs.io/ipfs/${v1}`,
    ]);
    expect(hrefs(`http://cloudflare-ipfs.com/ipfs/${cid}/logo.png`)).toEqual([
      `https://ipfs.filebase.io/ipfs/${cid}/logo.png`,
      `https://gateway.pinata.cloud/ipfs/${cid}/logo.png`,
      `https://ipfs.io/ipfs/${cid}/logo.png`,
    ]);
    expect(hrefs("https://arweave.net/abc")).toEqual([
      "https://arweave.net/abc",
    ]);
    expect(hrefs("https://evil.test/a.png")).toEqual([]);
    // The unlisted host is never fetched: only the content, on allowed gateways.
    expect(hrefs(`https://evil.test/ipfs/${cid}?u=https://127.0.0.1`)).toEqual([
      `https://ipfs.filebase.io/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
    ]);
    expect(hrefs(`https://evil.test/ipfs/${cid}/../../x`)).toEqual([]);
  });
  it("falls back to the next allowed gateway when one refuses", async () => {
    const cid = "QmNdTtJauw39u4DzGyTaZ35rRx4VgAxqb91wE89zjyHWd2";
    const transport = vi.fn(async (url: URL) => {
      if (url.hostname === "ipfs.io") throw new Error("Logo response refused");
      return png;
    });
    const proxy = new LogoProxy(
      async () => ({
        [mint]: {
          symbol: "",
          name: "",
          decimals: 6,
          logoURI: `https://ipfs.io/ipfs/${cid}`,
        },
      }),
      transport,
    );
    expect(await proxy.get(mint)).toEqual({ bytes: png, type: "image/png" });
    expect(transport.mock.calls.map(([url]) => url.hostname)).toEqual([
      "ipfs.io",
      "ipfs.filebase.io",
    ]);
  });
  it("rejects private and local DNS results, including mapped addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "192.168.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
    ])
      expect(publicLogoAddress(ip)).toBe(false);
    expect(publicLogoAddress("1.1.1.1")).toBe(true);
    expect(publicLogoAddress("2606:4700::1111")).toBe(true);
  });
  it("accepts only PNG/JPEG/WebP/GIF signatures", () => {
    expect(logoType(png)).toBe("image/png");
    expect(logoType(Buffer.from([255, 216, 255]))).toBe("image/jpeg");
    expect(logoType(Buffer.from("RIFF0000WEBP"))).toBe("image/webp");
    expect(logoType(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(logoType(Buffer.from("<svg></svg>"))).toBeNull();
    expect(logoType(Buffer.from("<html>"))).toBeNull();
  });
  it("deduplicates and caches verified bytes for 24 hours", async () => {
    let now = 0;
    const transport = vi.fn(async () => png);
    const proxy = new LogoProxy(
      async () => ({
        [mint]: {
          symbol: "",
          name: "",
          decimals: 6,
          logoURI: "https://ipfs.io/a",
        },
      }),
      transport,
      () => now,
    );
    const results = await Promise.all([proxy.get(mint), proxy.get(mint)]);
    expect(results[0]).toEqual(results[1]);
    await proxy.get(mint);
    expect(transport).toHaveBeenCalledTimes(1);
    now = 86_400_001;
    await proxy.get(mint);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects huge images, unlisted hosts and slow metadata without fetching a forbidden host", async () => {
    const transport = vi.fn(async () => new Uint8Array(WEB.logoMaxBytes + 1));
    const proxy = new LogoProxy(
      async () => ({
        [mint]: {
          symbol: "",
          name: "",
          decimals: 6,
          logoURI: "https://ipfs.io/a",
        },
      }),
      transport,
    );
    expect(await proxy.get(mint)).toBeNull();
    const denied = new LogoProxy(
      async () => ({
        [mint]: {
          symbol: "",
          name: "",
          decimals: 6,
          logoURI: "https://example.invalid/a",
        },
      }),
      transport,
    );
    expect(await denied.get(mint)).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(denied.missedHosts.get("example.invalid")).toBe(1);
    vi.useFakeTimers();
    const slow = new LogoProxy(() => new Promise(() => undefined), transport);
    const result = slow.get(mint);
    await vi.advanceTimersByTimeAsync(WEB.logoTimeoutMs);
    expect(await result).toBeNull();
  });
  it("retries a negative cache entry within five minutes", async () => {
    let now = 0;
    const metadata = vi.fn(async () => ({}));
    const proxy = new LogoProxy(metadata, vi.fn(), () => now);
    await proxy.get(mint);
    expect(proxy.hasCached(mint)).toBe(true);
    now = LOGO_NEGATIVE_CACHE_MS - 1;
    await proxy.get(mint);
    expect(metadata).toHaveBeenCalledTimes(1);
    now += 1;
    expect(proxy.hasCached(mint)).toBe(false);
    await proxy.get(mint);
    expect(metadata).toHaveBeenCalledTimes(2);
    expect(LOGO_NEGATIVE_CACHE_MS).toBeLessThanOrEqual(300_000);
  });
  it("caps total verified bytes at 64 MiB with least recently used eviction", async () => {
    const bytes = new Uint8Array(WEB.logoMaxBytes);
    bytes.set(png);
    const proxy = new LogoProxy(
      async (mints) =>
        Object.fromEntries(
          mints.map((mint) => [
            mint,
            { name: "", symbol: "", decimals: 6, logoURI: "https://ipfs.io/a" },
          ]),
        ),
      async () => bytes,
      () => 0,
    );
    const capacity = Math.floor(LOGO_CACHE_MAX_BYTES / bytes.byteLength);
    for (let i = 0; i < capacity; i++) await proxy.get(String(i));
    await proxy.get("0");
    await proxy.get("extra");
    expect(proxy.hasCached("0")).toBe(true);
    expect(proxy.hasCached("1")).toBe(false);
    expect(proxy.cacheUsage()).toEqual({
      bytes: capacity * bytes.byteLength,
      entries: capacity,
    });
    expect(proxy.cacheUsage().bytes).toBeLessThanOrEqual(64 * 1_024 * 1_024);
  });
});
