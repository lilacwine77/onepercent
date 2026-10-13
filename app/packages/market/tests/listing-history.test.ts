import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { dailyCloseTimes } from "../src/listing/evidence.js";
import { createListingHistoryClient } from "../src/listing/history.js";
import { sigmaDailyBps } from "../src/listing/sigma.js";
import { HIT_LIST, LISTING_HISTORY, SECONDS_PER_DAY } from "../src/params.js";
import { fixtureFetch } from "../src/testing.js";

const folder = new URL("./fixtures/listing-history/", import.meta.url);
function fixture<T>(name: string) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, folder), "utf8")) as {
    recordedAt: string;
    response: { body: T };
  };
}
interface Pool {
  attributes: { address: string; reserve_in_usd: string };
  relationships: {
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
  };
}
interface Ohlcv {
  data: { attributes: { ohlcv_list: number[][] } };
  meta: { base: { address: string }; quote: { address: string } };
}
const pools = fixture<{ data: Pool[] }>("gecko-pools-wif").response.body;
const ohlcvFixture = fixture<Ohlcv>("gecko-ohlcv-wif");
const ohlcv = ohlcvFixture.response.body;
const clock = {
  nowMs: () => Date.parse(ohlcvFixture.recordedAt),
  sleep: () => new Promise<void>(() => {}),
  random: () => 0,
};
const times = dailyCloseTimes(clock.nowMs());
const major = HIT_LIST.launchMajors[0];
const json = (body: unknown) => Response.json(body);
function syntheticFetch(
  options: {
    pools?: { data: Pool[] };
    ohlcv?: Ohlcv;
    nextPage?: { data: Pool[] };
  } = {},
): typeof fetch {
  return vi.fn(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "benchmarks.pyth.network") return jsonUnauthorized();
    if (url.pathname.endsWith("/pools"))
      return json(
        url.searchParams.get("page") === "1"
          ? (options.pools ?? pools)
          : (options.nextPage ?? { data: [] }),
      );
    return json(options.ohlcv ?? ohlcv);
  });
}
const jsonUnauthorized = () => new Response("Unauthorized", { status: 401 });

describe("keyless listing daily history", () => {
  it("falls back from public Benchmarks to recorded daily USD OHLCV and calculates sigma", async () => {
    const fetch = vi.fn(fixtureFetch(folder));
    const result = await createListingHistoryClient({
      fetch,
      clock,
    }).getDailyCloses(major.mint, major.pythFeedId, times);
    const expected = [...ohlcv.data.attributes.ohlcv_list]
      .sort((a, b) => a[0]! - b[0]!)
      .map((row) => row[4]!);
    expect(result.closes).toEqual(expected);
    const returns = expected
      .slice(1)
      .map((close, index) => Math.log(close / expected[index]!));
    const mean =
      returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const sigma = Math.ceil(
      Math.sqrt(
        returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          (returns.length - 1),
      ) * 10_000,
    );
    expect(sigmaDailyBps(result.closes)).toBe(sigma);
    expect(result.source).toContain("GeckoTerminal daily USD OHLCV");
    expect(result.source).toContain(pools.data[0]!.attributes.address);
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, init] of fetch.mock.calls)
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("prefers complete public Benchmarks prices without calling GeckoTerminal", async () => {
    const closes = [100, 110, 100, 110, 100, 110, 100, 110];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("benchmarks.pyth.network");
      const time = Number(url.pathname.split("/").at(-1));
      return json({
        parsed: [
          {
            id: major.pythFeedId,
            price: {
              price: String(closes[times.indexOf(time)]),
              conf: "0",
              expo: 0,
              publish_time: time,
            },
          },
        ],
      });
    });
    const result = await createListingHistoryClient({
      fetch,
      clock,
    }).getDailyCloses(major.mint, major.pythFeedId, times);
    expect(result.closes).toEqual(closes);
    expect(sigmaDailyBps(result.closes)).toBe(1_019);
    expect(result.source).toContain("Pyth Benchmarks");
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it("selects by reserves across pages, supports the major as quote token and rejects unrelated pairs", async () => {
    const next = structuredClone(pools.data[1]!);
    next.attributes.reserve_in_usd = "9000000";
    [next.relationships.base_token, next.relationships.quote_token] = [
      next.relationships.quote_token,
      next.relationships.base_token,
    ];
    const unrelated = structuredClone(pools.data[0]!);
    unrelated.attributes.reserve_in_usd = "999999999";
    unrelated.relationships.base_token.data.id = `solana_${HIT_LIST.launchMajors[1].mint}`;
    const invalidPair = structuredClone(pools.data[0]!);
    invalidPair.attributes.reserve_in_usd = "999999999";
    invalidPair.relationships.quote_token.data.id = `solana_${HIT_LIST.launchMajors[1].mint}`;
    const page = Array.from({ length: LISTING_HISTORY.geckoPoolsPerPage }, () =>
      structuredClone(pools.data[0]!),
    );
    page[0] = unrelated;
    page[1] = invalidPair;
    const candles = structuredClone(ohlcv);
    const fetch = vi.fn(
      syntheticFetch({
        pools: { data: page },
        nextPage: { data: [next] },
        ohlcv: candles,
      }),
    );
    const result = await createListingHistoryClient({
      fetch,
      clock,
    }).getDailyCloses(major.mint, major.pythFeedId, times);
    expect(result.source).toContain(next.attributes.address);
    const url = new URL(String(fetch.mock.calls.at(-1)![0]));
    expect(url.searchParams.get("token")).toBe(major.mint);
    expect(url.searchParams.get("currency")).toBe("usd");
    expect(url.searchParams.get("include_empty_intervals")).toBe("false");
    expect(url.searchParams.get("before_timestamp")).toBe(
      String(times.at(-1)! - 1),
    );
  });

  it("accepts a native USD pair by address", async () => {
    const pool = structuredClone(pools.data[0]!);
    pool.relationships.quote_token.data.id = `solana_${LISTING_HISTORY.usdcMint}`;
    const candles = structuredClone(ohlcv);
    candles.meta.quote.address = LISTING_HISTORY.usdcMint;
    const fetch = syntheticFetch({ pools: { data: [pool] }, ohlcv: candles });
    const result = await createListingHistoryClient({
      fetch,
      clock,
    }).getDailyCloses(major.mint, major.pythFeedId, times);
    expect(result.closes).toHaveLength(8);
  });

  it.each(["missing", "duplicate", "open", "zero", "wrong-token"])(
    "rejects %s OHLCV evidence instead of relaxing the window",
    async (failure) => {
      const candles = structuredClone(ohlcv);
      const rows = candles.data.attributes.ohlcv_list;
      if (failure === "missing") rows.pop();
      if (failure === "duplicate") rows[1] = [...rows[0]!];
      if (failure === "open") rows[0]![0] = times.at(-1)!;
      if (failure === "zero") rows[0]![4] = 0;
      if (failure === "wrong-token")
        candles.meta.base.address = major.pythFeedId;
      const fetch = syntheticFetch({ ohlcv: candles });
      await expect(
        createListingHistoryClient({ fetch, clock }).getDailyCloses(
          major.mint,
          major.pythFeedId,
          times,
        ),
      ).rejects.toThrow();
    },
  );

  it("rejects nonconsecutive, unfinished or misaligned requested days before fetching", async () => {
    const fetch = syntheticFetch();
    const client = createListingHistoryClient({ fetch, clock });
    for (const invalid of [
      times.slice(1),
      times.map((time) => time + 1),
      [...times.slice(0, -1), times.at(-1)! + SECONDS_PER_DAY],
      times.map((time) => time + SECONDS_PER_DAY),
    ]) {
      await expect(
        client.getDailyCloses(major.mint, major.pythFeedId, invalid),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops reprobes after Benchmarks rejects unauthenticated requests", async () => {
    const fetch = vi.fn(syntheticFetch());
    const client = createListingHistoryClient({ fetch, clock });
    await client.getDailyCloses(major.mint, major.pythFeedId, times);
    await client.getDailyCloses(major.mint, major.pythFeedId, times);
    expect(
      fetch.mock.calls.filter(([url]) =>
        String(url).includes("benchmarks.pyth.network"),
      ),
    ).toHaveLength(1);
  });
});
