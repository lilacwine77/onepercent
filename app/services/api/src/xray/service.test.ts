import "./test-setup.js";
import { describe, expect, it, vi } from "vitest";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { MemoryCache } from "./cache.js";
import { XrayService, canonicalAddress } from "./service.js";
import { parseXrayEnv } from "./env.js";
import { testSources } from "./test-sources.js";

const address = "11111111111111111111111111111111";
describe("X-ray scan service", () => {
  it("validates input, permits PDAs and canonicalizes a resolved name", async () => {
    const deps = testSources();
    const service = new XrayService({ ...deps, snsEnabled: true });
    expect(canonicalAddress(address)).toBe(address);
    expect(canonicalAddress("not valid")).toBeNull();
    await expect(
      service.get("0x52908400098527886E0F7030069857D2E4169EE7"),
    ).rejects.toMatchObject({
      code: "evm_not_supported",
      status: 400,
      message: "Solana wallets only for now.",
    });
    await expect(service.get("invalid")).rejects.toMatchObject({
      code: "invalid_address",
      status: 400,
    });
    const result = await service.get(" TEST.SNS ");
    expect(deps.names.resolve).toHaveBeenCalledWith("test.sns");
    expect(XrayResultSchema.parse(result).address).toBe(address);
  });
  it("uses a single flight, then an immutable timestamp on cache hits", async () => {
    const deps = testSources();
    const service = new XrayService(deps);
    const [a, b] = await Promise.all([
      service.get(address),
      service.get(address),
    ]);
    expect(a).toEqual(b);
    expect(deps.chain.getTokenAccounts).toHaveBeenCalledTimes(1);
    const cached = await service.get(address);
    expect(cached).toEqual({ ...a, cached: true });
    expect(a.cached).toBe(false);
  });
  it("maintains zero-wallet counts and exact totals", async () => {
    const result = await new XrayService(testSources()).get(address);
    expect(result.counts).toEqual({
      bags: 0,
      feedable: 0,
      checkAtFeed: 0,
      notFeedable: 0,
      sellable: 0,
      empty: 0,
      notInSet: 0,
    });
    expect(result.totals).toEqual({ sellValueSol: "0", rentBackSol: "0" });
    expect(result.worst).toBeNull();
    expect(result.card.title).toBe("Suspiciously Clean");
  });
  it("does not request SOL prices and caches the scan independently of them", async () => {
    const deps = testSources();
    const service = new XrayService(deps);
    vi.mocked(deps.prices.getSolUsd).mockRejectedValueOnce(
      new Error("provider down"),
    );
    expect((await service.get(address)).valuesPartial).not.toBe(true);
    expect((await service.get(address)).cached).toBe(true);
    expect(deps.prices.getSolUsd).not.toHaveBeenCalled();
    expect(deps.chain.getTokenAccounts).toHaveBeenCalledTimes(1);
  });
  it("maps chain failure and oversize wallets without leaking provider errors", async () => {
    const deps = testSources();
    const service = new XrayService(deps);
    vi.mocked(deps.chain.getTokenAccounts).mockRejectedValueOnce(
      new Error("private provider URL"),
    );
    await expect(service.get(address)).rejects.toMatchObject({
      code: "upstream_failed",
      status: 502,
    });
    vi.mocked(deps.chain.getTokenAccounts).mockResolvedValueOnce(
      Array.from({ length: 2001 }, () => ({
        address,
        owner: address,
        lamports: 0n,
        data: new Uint8Array(),
      })),
    );
    await expect(service.get(address)).rejects.toMatchObject({
      code: "wallet_too_large",
      status: 422,
    });
  });
  it("bounds name resolution and chain work by deadline, never caching late completion", async () => {
    vi.useFakeTimers();
    const deps = testSources();
    const service = new XrayService({
      ...deps,
      deadlineMs: 10,
      snsEnabled: true,
    });
    let complete: (() => void) | undefined;
    vi.mocked(deps.chain.getTokenAccounts).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () => resolve([]);
        }),
    );
    const promise = service.get(address);
    const assertion = expect(promise).rejects.toMatchObject({
      code: "scan_timeout",
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    complete?.();
    await vi.advanceTimersByTimeAsync(0);
    expect((await service.get(address)).cached).toBe(false);
    vi.mocked(deps.names.resolve).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    const named = expect(service.get("slow.sns")).rejects.toMatchObject({
      code: "scan_timeout",
    });
    await vi.advanceTimersByTimeAsync(11);
    await named;
  });
  it("returns distinct missing-name and fixture-wallet errors", async () => {
    const deps = testSources();
    deps.names.resolve.mockResolvedValue(null as unknown as string);
    await expect(
      new XrayService({ ...deps, snsEnabled: true }).get("missing.sns"),
    ).rejects.toMatchObject({ code: "name_not_found", status: 404 });
    const fixture = new XrayService({ ...deps, allowedAddresses: new Set() });
    await expect(fixture.get(address)).rejects.toMatchObject({
      code: "not_in_fixtures",
      status: 404,
    });
  });
});
describe("X-ray local state", () => {
  it("expires entries and evicts the least recently accessed value", () => {
    let now = 0;
    const cache = new MemoryCache<number>(2, () => now);
    cache.set("a", 1, 1);
    cache.set("b", 2, 1);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3, 1);
    expect(cache.get("b")).toBeUndefined();
    now = 1000;
    expect(cache.get("a")).toBeUndefined();
  });
  it("defaults to fixtures without credentials and validates environment without leaking values", () => {
    expect(
      parseXrayEnv({ HELIUS_API_KEY: "", JUPITER_MAX_RPS: "" }).XRAY_SOURCE,
    ).toBe("fixtures");
    expect(
      parseXrayEnv({
        HELIUS_API_KEY: "test",
        TURNSTILE_SECRET: "test-only-turnstile",
      }).XRAY_SOURCE,
    ).toBe("live");
    expect(() => parseXrayEnv({ XRAY_SOURCE: "live" })).toThrow(/HELIUS/);
    try {
      parseXrayEnv({ HELIUS_RPC_URL: "secret-text" });
    } catch (error) {
      expect(String(error)).not.toContain("secret-text");
    }
    expect(() => parseXrayEnv({ JUPITER_MAX_RPS: "0" })).toThrow(
      /JUPITER_MAX_RPS/,
    );
  });
});

describe("scan isolation and deadlines", () => {
  it("does not expose cached nested data to in-process consumers", async () => {
    const service = new XrayService(testSources());
    const first = await service.getRecord(address);
    first.result.counts.bags = 100;
    first.result.totals.sellValueSol = "99";
    first.coins.push({ ticker: "ALTERED", drawdownPct: 99 });
    const second = await service.getRecord(address);
    expect(second.result.counts.bags).toBe(0);
    expect(second.result.totals.sellValueSol).toBe("0");
    expect(second.coins).toEqual([]);
  });
  it("starts no later provider stage after a timed-out call returns", async () => {
    vi.useFakeTimers();
    try {
      const deps = testSources();
      let finish: (() => void) | undefined;
      vi.mocked(deps.chain.getTokenAccounts).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve([]);
          }),
      );
      const service = new XrayService({ ...deps, deadlineMs: 10 });
      const pending = expect(service.get(address)).rejects.toMatchObject({
        code: "scan_timeout",
      });
      await vi.advanceTimersByTimeAsync(11);
      await pending;
      finish?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(deps.chain.getAccounts).not.toHaveBeenCalled();
      expect(deps.chain.getMetadata).not.toHaveBeenCalled();
      expect(deps.prices.getPrices).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
