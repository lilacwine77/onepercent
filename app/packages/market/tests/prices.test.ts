import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { type Clock } from "../src/clock.js";
import { type MarketEnv } from "../src/env.js";
import { createJupiterTokensClient } from "../src/jupiter/tokens.js";
import { MARKET, WSOL_MINT } from "../src/params.js";
import { createPriceSource, type PriceSource } from "../src/price-source.js";
import { fixtureFetch } from "../src/testing.js";

const file = (name: string) =>
  new URL(`./fixtures/${name}.json`, import.meta.url);
interface Fixture {
  recordedAt: string;
  request: { url: string };
  response: {
    body: Record<string, { usdPrice: number; blockId?: number | null }>;
  };
}
const read = (name: string) =>
  JSON.parse(readFileSync(file(name), "utf8")) as Fixture;
const mints = (name: string, param = "ids") =>
  new URL(read(name).request.url).searchParams.get(param)!.split(",");
const env: MarketEnv = {
  pythHermesUrl: "https://hermes.pyth.network",
  solanaRpcUrl: "https://rpc.invalid/",
  jupiterApiKey: "fixture-test-credential",
};
function clockAt(ms = Date.parse(read("pyth/latest-sol").recordedAt)) {
  let now = ms;
  const clock: Clock = {
    nowMs: () => now,
    sleep: () => new Promise(() => {}),
    random: () => 0,
  };
  return {
    clock,
    advance: (delta: number) => {
      now += delta;
    },
  };
}
function replay(names: string[]) {
  return vi.fn(fixtureFetch(names.map(file)));
}

describe("PriceSource contract and Jupiter display prices", () => {
  it("exports exactly the interface shared with consumers", () => {
    expectTypeOf<PriceSource>().toEqualTypeOf<{
      getPrices(
        mints: string[],
      ): Promise<
        Record<
          string,
          { usdPrice: number; blockId: number; ageSlots: number } | undefined
        >
      >;
      getTokenInfo(mints: string[]): Promise<
        Record<
          string,
          | {
              symbol: string;
              name: string;
              logoURI?: string;
              launchpad?: string;
              ath?: number;
            }
          | undefined
        >
      >;
      getSolUsd(): Promise<number>;
    }>();
  });

  it("deduplicates 120 mints into three price calls and one slot read, keeping every key", async () => {
    const names = [
      "jupiter/prices-batch-1",
      "jupiter/prices-batch-2",
      "jupiter/prices-batch-3",
    ];
    const requested = names.flatMap((name) => mints(name));
    expect(new Set(requested).size).toBe(120);
    const fetch = replay([...names, "rpc/get-slot"]);
    const source = createPriceSource({ fetch, env, clock: clockAt().clock });
    const result = await source.getPrices([
      ...requested,
      ...requested.slice(0, 20),
    ]);
    expect(Object.keys(result).sort()).toEqual([...requested].sort());
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes("/price/v3")),
    ).toHaveLength(3);
    const slot = (
      JSON.parse(readFileSync(file("rpc/get-slot"), "utf8")) as {
        response: { body: { result: number } };
      }
    ).response.body.result;
    const raw = Object.assign(
      {},
      ...names.map((name) => read(name).response.body),
    ) as Fixture["response"]["body"];
    for (const mint of requested) {
      const price = raw[mint];
      const ageSlots =
        price?.blockId == null ? Infinity : Math.max(0, slot - price.blockId);
      expect(result[mint]).toEqual(
        ageSlots <= MARKET.price.maxAgeSlots
          ? { usdPrice: price!.usdPrice, blockId: price!.blockId, ageSlots }
          : undefined,
      );
    }
    expect(JSON.stringify(result)).not.toContain("liquidity");
  });

  it("validates all inputs before any request and does no I/O for empty input", async () => {
    const fetch = replay(["jupiter/prices-wsol"]);
    const source = createPriceSource({ fetch, env });
    expect(await source.getPrices([])).toEqual({});
    expect(await source.getTokenInfo([])).toEqual({});
    await expect(
      source.getPrices([WSOL_MINT, "invalid"]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      source.getTokenInfo([WSOL_MINT, "invalid"]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops null/absent/too-old slots while accepting the age boundary and future slot", async () => {
    const requested = mints("jupiter/prices-boundaries");
    const source = createPriceSource({
      fetch: replay(["jupiter/prices-boundaries", "rpc/get-slot"]),
      env,
      clock: clockAt().clock,
    });
    const result = await source.getPrices(requested);
    const raw = read("jupiter/prices-boundaries").response.body;
    const values = Object.keys(raw);
    expect(result[values[0]!]).toBeUndefined();
    expect(result[values[1]!]).toBeUndefined();
    expect(result[values[2]!]!.ageSlots).toBe(0);
    expect(result[values[3]!]!.ageSlots).toBe(MARKET.price.maxAgeSlots);
    expect(result[values[4]!]).toBeUndefined();
  });

  it("uses live recorded stale and omitted prices as undefined", async () => {
    for (const name of ["jupiter/prices-stale", "jupiter/prices-omitted"]) {
      const source = createPriceSource({
        fetch: replay([name, "rpc/get-slot"]),
        env,
        clock: clockAt().clock,
      });
      const requested = mints(name);
      expect(await source.getPrices(requested)).toEqual(
        Object.fromEntries(requested.map((mint) => [mint, undefined])),
      );
    }
  });

  it("treats metadata-only (unpriced) entries as undefined without failing the batch", async () => {
    const source = createPriceSource({
      fetch: replay(["jupiter/prices-unpriced", "rpc/get-slot"]),
      env,
      clock: clockAt().clock,
    });
    const [unpriced, priced] = mints("jupiter/prices-unpriced");
    const prices = await source.getPrices([unpriced!, priced!]);
    expect(prices[unpriced!]).toBeUndefined();
    expect(prices[priced!]).toBeDefined();
  });

  it("coalesces concurrent calls, caches hits and misses, and refetches after expiry", async () => {
    const { clock, advance } = clockAt();
    const fetch = replay([
      "jupiter/prices-wsol",
      "jupiter/prices-omitted",
      "rpc/get-slot",
    ]);
    const source = createPriceSource({ fetch, env, clock });
    await Promise.all(
      Array.from({ length: 5 }, () => source.getPrices([WSOL_MINT])),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    advance(100);
    await source.getPrices([WSOL_MINT]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const absent = mints("jupiter/prices-omitted");
    await source.getPrices(absent);
    await source.getPrices(absent);
    expect(fetch).toHaveBeenCalledTimes(3);
    advance(MARKET.price.cacheTtlMs);
    await source.getPrices([WSOL_MINT]);
    expect(fetch).toHaveBeenCalledTimes(5);
    await source.getPrices(absent);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("refreshes the slot while reusing cached price data", async () => {
    const { clock, advance } = clockAt();
    const fetch = replay(["jupiter/prices-wsol", "rpc/get-slot"]);
    const source = createPriceSource({ fetch, env, clock });
    await source.getPrices([WSOL_MINT]);
    advance(MARKET.rpc.slotCacheMs);
    await source.getPrices([WSOL_MINT]);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes("/price/v3")),
    ).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("Tokens v2 projection", () => {
  it("batches 120 mints by 100 and caches complete parsed records", async () => {
    const names = ["jupiter/tokens-batch-1", "jupiter/tokens-batch-2"];
    const requested = names.flatMap((name) => mints(name, "query"));
    const fetch = replay(names);
    const source = createPriceSource({ fetch, env, clock: clockAt().clock });
    const result = await source.getTokenInfo([...requested, requested[0]!]);
    expect(Object.keys(result).sort()).toEqual([...requested].sort());
    expect(fetch).toHaveBeenCalledTimes(2);
    await source.getTokenInfo(requested);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const token of Object.values(result))
      expect(token?.ath).toBeUndefined();
  });

  it("trims labels, only allows https icons, maps launchpad, and discards ATH", async () => {
    const requested = mints("jupiter/tokens-boundaries", "query");
    const fetch = replay(["jupiter/tokens-boundaries"]);
    const source = createPriceSource({ fetch, env, clock: clockAt().clock });
    const result = await source.getTokenInfo(requested);
    const records = (
      JSON.parse(readFileSync(file("jupiter/tokens-boundaries"), "utf8")) as {
        response: {
          body: {
            id: string;
            symbol: string;
            name: string;
            launchpad?: string | null;
          }[];
        };
      }
    ).response.body;
    expect(result[records[0]!.id]).toMatchObject({
      symbol: records[0]!.symbol.trim(),
      name: records[0]!.name.trim(),
      launchpad: "pump.fun",
    });
    expect(result[records[0]!.id]!.logoURI).toMatch(/^https:/);
    expect(result[records[0]!.id]!.ath).toBeUndefined();
    for (const record of records.slice(1, 4))
      expect(result[record.id]!.logoURI).toBeUndefined();
    expect(result[records[4]!.id]!.launchpad).toBeUndefined();
    expect(result[requested.at(-1)!]).toBeUndefined();
  });

  it("retains the full validated record for later evidence gathering", async () => {
    const client = createJupiterTokensClient({
      fetch: replay(["jupiter/tokens-specials"]),
      env,
      clock: clockAt().clock,
    });
    const result = await client.getTokens(
      mints("jupiter/tokens-specials", "query"),
    );
    expect(
      Object.values(result).some((token) => token?.launchpad === "pump.fun"),
    ).toBe(true);
    expect(Object.values(result).some((token) => token?.tokenProgram)).toBe(
      true,
    );
    expect(Object.values(result).some((token) => token?.audit)).toBe(true);
  });
});

describe("SOL display fallback", () => {
  it("reads authenticated fresh Pyth and preserves a configured base path", async () => {
    const fetch = replay(["pyth/latest-sol-prefixed"]);
    const source = createPriceSource({
      fetch,
      env: {
        ...env,
        pythHermesUrl: "https://pyth.dourolabs.app/hermes/",
        pythHermesApiKey: "fixture-test-pyth",
      },
      clock: clockAt().clock,
    });
    const reading = await source.getSolUsdDetailed();
    const raw = (
      JSON.parse(readFileSync(file("pyth/latest-sol"), "utf8")) as {
        response: {
          body: {
            parsed: {
              price: { price: string; expo: number; publish_time: number };
            }[];
          };
        };
      }
    ).response.body.parsed[0]!.price;
    expect(reading).toEqual({
      usd: Number(raw.price) * 10 ** raw.expo,
      source: "pyth",
      publishTime: raw.publish_time,
    });
    expect(await source.getSolUsd()).toBe(reading.usd);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toContain(
      "/hermes/v2/updates/price/latest",
    );
    expect(
      new Headers(fetch.mock.calls[0]![1]!.headers).get("Authorization"),
    ).toBe("Bearer fixture-test-pyth");
  });

  it.each(["latest-sol-stale", "latest-sol-wide", "hermes-unauthorized"])(
    "falls back to fresh Jupiter for %s",
    async (name) => {
      const fetch = replay([
        `pyth/${name}`,
        "jupiter/prices-wsol",
        "rpc/get-slot",
      ]);
      const source = createPriceSource({
        fetch,
        env: { ...env, pythHermesApiKey: "fixture-test-pyth" },
        clock: clockAt().clock,
      });
      expect(await source.getSolUsdDetailed()).toMatchObject({
        source: "jupiter",
        usd: read("jupiter/prices-wsol").response.body[WSOL_MINT]!.usdPrice,
      });
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );

  it("skips live Hermes when no key exists and coalesces fallback requests", async () => {
    const fetch = replay(["jupiter/prices-wsol", "rpc/get-slot"]);
    const source = createPriceSource({ fetch, env, clock: clockAt().clock });
    const result = await Promise.all([
      source.getSolUsd(),
      source.getSolUsd(),
      source.getSolUsdDetailed(),
    ]);
    expect(result[0]).toEqual(result[1]);
    expect(result[2]).toMatchObject({ source: "jupiter" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns PRICE_UNAVAILABLE when both sources fail", async () => {
    const source = createPriceSource({
      fetch: replay([
        "pyth/latest-sol-wide",
        "jupiter/prices-wsol-empty",
        "rpc/get-slot",
      ]),
      env: { ...env, pythHermesApiKey: "fixture-test-pyth" },
      clock: clockAt().clock,
    });
    await expect(source.getSolUsd()).rejects.toMatchObject({
      code: "PRICE_UNAVAILABLE",
    });
  });
});
