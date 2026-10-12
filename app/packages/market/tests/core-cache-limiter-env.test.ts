import { describe, expect, it, vi } from "vitest";
import { InMemoryTtlCache } from "../src/cache.js";
import type { Clock } from "../src/clock.js";
import { loadMarketEnv } from "../src/env.js";
import {
  createJupiterLimiter,
  SlidingWindowLimiter,
} from "../src/http/rate-limit.js";
import { MARKET } from "../src/params.js";

function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  const clock: Clock = {
    nowMs: () => now,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
  return {
    clock,
    sleeps,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("cache boundaries", () => {
  it("expires at the exact TTL and returns independent JSON copies", async () => {
    const { clock, advance } = fakeClock();
    const cache = new InMemoryTtlCache({ clock });
    await cache.set("key", { amount: "123" }, 100);
    const first = await cache.get<{ amount: string }>("key");
    if (first) first.amount = "changed";
    expect(await cache.get("key")).toEqual({ amount: "123" });
    advance(99);
    expect(await cache.get("key")).toEqual({ amount: "123" });
    advance(1);
    expect(await cache.get("key")).toBeUndefined();
  });

  it("evicts the least recently used entry and supports deletion", async () => {
    const { clock } = fakeClock();
    const cache = new InMemoryTtlCache({ clock, maxEntries: 2 });
    await cache.set("a", 1, 100);
    await cache.set("b", 2, 100);
    await cache.get("a");
    await cache.set("c", 3, 100);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe(1);
    await cache.delete("a");
    expect(await cache.get("a")).toBeUndefined();
  });

  it("requires JSON-safe values and valid capacity and TTL", async () => {
    const cache = new InMemoryTtlCache();
    await expect(cache.set("amount", 1n, 100)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(cache.set("amount", "1", -1)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(() => new InMemoryTtlCache({ maxEntries: 0 })).toThrow();
  });
});

describe("sliding-window capacity", () => {
  it("waits on the 31st keyless request, with only one warning", async () => {
    const { clock, sleeps } = fakeClock();
    const warn = vi.fn();
    const limiter = createJupiterLimiter({
      env: loadMarketEnv({}),
      clock,
      logger: { warn, debug: vi.fn(), info: vi.fn() },
    });
    await Promise.all(Array.from({ length: 31 }, () => limiter.acquire()));
    expect(sleeps).toEqual([60_000]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("allocates 300 calls per minute to half a developer plan", async () => {
    const { clock, sleeps } = fakeClock();
    const limiter = createJupiterLimiter({
      env: loadMarketEnv({ JUPITER_API_KEY: "synthetic-key" }),
      clock,
      plan: "developer",
      shareBps: 5000,
    });
    expect(limiter.capacity).toBe(300);
    await Promise.all(Array.from({ length: 301 }, () => limiter.acquire()));
    expect(sleeps).toEqual([60_000]);
  });

  it("uses a sliding window rather than a calendar-minute reset", async () => {
    const { clock, sleeps, advance } = fakeClock();
    const limiter = new SlidingWindowLimiter(2, clock);
    await limiter.acquire();
    advance(30_000);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toEqual([30_000, 30_000]);
  });

  it("rejects invalid capacities and shares", () => {
    expect(() => new SlidingWindowLimiter(0)).toThrow();
    expect(() =>
      createJupiterLimiter({ env: loadMarketEnv({}), shareBps: 10_001 }),
    ).toThrow();
  });
});

describe("market environment", () => {
  it("uses the default URL and treats blank optional credentials as missing", () => {
    expect(
      loadMarketEnv({ JUPITER_API_KEY: " ", PYTH_HERMES_API_KEY: "" }),
    ).toEqual({
      pythHermesUrl: MARKET.pyth.defaultHermesUrl,
    });
  });

  it("preserves configured Hermes URL paths and RPC paths", () => {
    expect(
      loadMarketEnv({
        PYTH_HERMES_URL: "https://prices.example.test/hermes",
        SOLANA_RPC_URL: "https://rpc.example.test/private-path",
      }),
    ).toEqual({
      pythHermesUrl: "https://prices.example.test/hermes",
      solanaRpcUrl: "https://rpc.example.test/private-path",
    });
  });

  it("does not include malformed URL values in errors", () => {
    expect(() =>
      loadMarketEnv({ SOLANA_RPC_URL: "synthetic-sensitive-value" }),
    ).toThrow("Invalid SOLANA_RPC_URL");
  });
});
