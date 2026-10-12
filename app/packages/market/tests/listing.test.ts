import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  dailyCloseTimes,
  majorSellProbeAmount,
  type MajorEvidence,
  type PythReading,
  type TrendingEvidence,
} from "../src/listing/evidence.js";
import { evaluateMajor, evaluateTrending } from "../src/listing/evaluate.js";
import {
  listingReportSchema,
  parseListingReport,
  serializeListingReport,
} from "../src/listing/report.js";
import { sigmaDailyBps } from "../src/listing/sigma.js";
import { HIT_LIST, MARKET, STOCK } from "../src/params.js";
import {
  createPythHermesClient,
  type PythPriceUpdate,
} from "../src/pyth/hermes.js";
import { fixtureFetch } from "../src/testing.js";

const file = (name: string) =>
  new URL(`./fixtures/${name}.json`, import.meta.url);
function fixture<T>(name: string) {
  return JSON.parse(readFileSync(file(name), "utf8")) as {
    recordedAt: string;
    request: { url: string };
    response: { body: T };
  };
}
const latest = fixture<{ parsed: PythPriceUpdate[] }>("pyth/latest-wif");
const nowMs = Date.parse(latest.recordedAt);
const nowSec = Math.floor(nowMs / 1_000);
const dayMs = 86_400_000;
const tokenRecords = fixture<{ id: string; name: string; symbol: string }[]>(
  "jupiter/tokens-majors",
).response.body;
const token = tokenRecords.find(
  (entry) => entry.id === HIT_LIST.launchMajors[0].mint,
)!;

function major(): MajorEvidence {
  return {
    mint: token.id,
    symbol: token.symbol,
    mintSafe: true,
    pyth: {
      ...latest.response.body.parsed[0]!.price,
      price: "10000",
      conf: "100",
      publish_time: nowSec - STOCK.pythMaxAgeSeconds,
    },
    firstPoolCreatedAtMs: nowMs - HIT_LIST.majorBar.minAgeDays * dayMs,
    externalDepthUsd: HIT_LIST.majorBar.minLiquidityUsd,
    sellRecoveryBps: BigInt(HIT_LIST.majorBar.sell150SolMinRecoveryBps),
    dailySigmaBps: HIT_LIST.majorBar.maxDailySigmaBps,
    capLamports: 1_000n,
    excludedHolders: null,
    jupiterTopHoldersPercentage: null,
  };
}
function trending(): TrendingEvidence {
  return {
    mint: token.id,
    symbol: token.symbol,
    mintSafe: true,
    pumpOrigin: true,
    graduatedPool: token.id,
    canonicalPool: token.id,
    graduatedAtMs: nowMs - HIT_LIST.trendingBar.minGraduatedDays * dayMs,
    realQuoteLamports: HIT_LIST.trendingBar.minPoolQuoteLamports,
    holderCount: HIT_LIST.trendingBar.minHolders,
    top10Bps: BigInt(HIT_LIST.trendingBar.maxTop10Bps),
    organicScore: HIT_LIST.trendingBar.minOrganicScore,
    auditNotSus: true,
    curveMayhem: false,
    poolMayhem: false,
    curveSolQuote: true,
    poolSolQuote: true,
    capLamports: 123n,
    excludedHolders: [
      { address: token.id, owner: token.id, amount: 321n, reason: "off-curve" },
    ],
    jupiterTopHoldersPercentage: 12,
  };
}

const majorCases: [string, Partial<MajorEvidence>, Partial<MajorEvidence>][] = [
  ["never_listed", { symbol: "PUMP" }, { symbol: null }],
  ["mint_is_safe", { mintSafe: false }, { mintSafe: null }],
  [
    "pyth_fresh",
    {
      pyth: {
        ...major().pyth!,
        publish_time: nowSec - STOCK.pythMaxAgeSeconds - 1,
      },
    },
    { pyth: null },
  ],
  ["pyth_conf", { pyth: { ...major().pyth!, conf: "101" } }, { pyth: null }],
  [
    "age_days",
    { firstPoolCreatedAtMs: major().firstPoolCreatedAtMs! + 1 },
    { firstPoolCreatedAtMs: null },
  ],
  [
    "liquidity_usd",
    { externalDepthUsd: HIT_LIST.majorBar.minLiquidityUsd - 1 },
    { externalDepthUsd: null },
  ],
  [
    "sell150_recovery_bps",
    { sellRecoveryBps: BigInt(HIT_LIST.majorBar.sell150SolMinRecoveryBps - 1) },
    { sellRecoveryBps: null },
  ],
  [
    "sigma_daily_bps",
    { dailySigmaBps: HIT_LIST.majorBar.maxDailySigmaBps + 1 },
    { dailySigmaBps: null },
  ],
];
const trendingCases: [
  string,
  Partial<TrendingEvidence>,
  Partial<TrendingEvidence>,
][] = [
  ["never_listed", { symbol: "1PCT" }, { symbol: null }],
  ["pump_origin", { pumpOrigin: false }, { pumpOrigin: null }],
  ["mint_is_safe", { mintSafe: false }, { mintSafe: null }],
  [
    "graduated_canonical_days",
    { graduatedAtMs: trending().graduatedAtMs! + 1 },
    { graduatedAtMs: null },
  ],
  [
    "pool_real_quote_lamports",
    { realQuoteLamports: HIT_LIST.trendingBar.minPoolQuoteLamports - 1n },
    { realQuoteLamports: null },
  ],
  [
    "holders",
    { holderCount: HIT_LIST.trendingBar.minHolders - 1 },
    { holderCount: null },
  ],
  [
    "top10_bps",
    { top10Bps: BigInt(HIT_LIST.trendingBar.maxTop10Bps) + 1n },
    { top10Bps: null },
  ],
  [
    "organic_score",
    { organicScore: HIT_LIST.trendingBar.minOrganicScore - 1 },
    { organicScore: null },
  ],
  ["not_sus", { auditNotSus: false }, { auditNotSus: null }],
  ["not_mayhem", { poolMayhem: true }, { curveMayhem: null }],
  ["sol_quote", { poolSolQuote: false }, { curveSolQuote: null }],
];

describe("listing criteria at the published boundaries", () => {
  it.each(majorCases)(
    "MAJOR %s passes, fails and fails closed when missing",
    (id, failure, missing) => {
      expect(evaluateMajor(major(), nowMs).pass).toBe(true);
      const failed = evaluateMajor({ ...major(), ...failure }, nowMs);
      expect(failed.criteria.find((entry) => entry.id === id)!.pass).toBe(
        false,
      );
      expect(failed.pass).toBe(false);
      const absent = evaluateMajor({ ...major(), ...missing }, nowMs);
      expect(absent.criteria.find((entry) => entry.id === id)).toMatchObject({
        pass: false,
        observed: null,
      });
    },
  );

  it.each(trendingCases)(
    "TRENDING %s passes, fails and fails closed when missing",
    (id, failure, missing) => {
      expect(evaluateTrending(trending(), nowMs).pass).toBe(true);
      const failed = evaluateTrending({ ...trending(), ...failure }, nowMs);
      expect(failed.criteria.find((entry) => entry.id === id)!.pass).toBe(
        false,
      );
      expect(failed.pass).toBe(false);
      const absent = evaluateTrending({ ...trending(), ...missing }, nowMs);
      expect(absent.criteria.find((entry) => entry.id === id)).toMatchObject({
        pass: false,
        observed: null,
      });
    },
  );

  it("requires the exact canonical pool, both clean flags and both SOL quote mints", () => {
    for (const change of [
      { graduatedPool: "different" },
      { curveMayhem: true },
      { curveSolQuote: false },
    ]) {
      expect(evaluateTrending({ ...trending(), ...change }, nowMs).pass).toBe(
        false,
      );
    }
  });

  it("round-trips a strict report with decimal bigint strings", () => {
    const report = evaluateTrending(trending(), nowMs);
    expect(parseListingReport(serializeListingReport(report))).toEqual(report);
    expect(report.info.capLamports).toBe("123");
    expect(report.info.excludedHolders![0]!.amount).toBe("321");
    expect(() =>
      listingReportSchema.parse({ ...report, undocumented: true }),
    ).toThrow();
  });
});

describe("Pyth probe integers and sample volatility", () => {
  it("normalizes exponents and floors only the final 150 SOL conversion", () => {
    const reading = (price: string, expo: number): PythReading => ({
      ...latest.response.body.parsed[0]!.price,
      price,
      expo,
    });
    // SOL=125.25 USD, token=0.03 USD, decimals=6: 626250 tokens in base units.
    expect(
      majorSellProbeAmount(reading("12525", -2), reading("3", -2), 6),
    ).toBe(626_250_000_000n);
    // Different exponents produce exactly the same rational conversion.
    expect(
      majorSellProbeAmount(reading("12525000000", -8), reading("30", -3), 6),
    ).toBe(626_250_000_000n);
    expect(majorSellProbeAmount(reading("1", -2), reading("7", 1), 0)).toBe(0n);
    expect(
      majorSellProbeAmount(reading("1", -2_000_000_000), reading("7", 1), 0),
    ).toBe(0n);
    expect(() =>
      majorSellProbeAmount(reading("1", 2_000_000_000), reading("7", 1), 0),
    ).toThrow("u64");
  });

  it("matches the hand-computed seven-return sample statistic", () => {
    const closes = [100, 110, 100, 110, 100, 110, 100, 110];
    // Four +log(1.1), three -log(1.1): sample variance = 8/7 * log(1.1)^2.
    const expected = Math.ceil(Math.sqrt(8 / 7) * Math.log(1.1) * 10_000);
    expect(expected).toBe(1_019);
    expect(sigmaDailyBps(closes)).toBe(expected);
    expect(sigmaDailyBps(Array(8).fill(100))).toBe(0);
    expect(() => sigmaDailyBps([1, 2])).toThrow();
    expect(() => sigmaDailyBps([0, 1, 1, 1, 1, 1, 1, 1])).toThrow();
  });

  it("keeps the statistic finite for extreme positive finite closes", () => {
    const closes = Array.from({ length: 8 }, (_, index) =>
      index % 2 === 0 ? Number.MIN_VALUE : Number.MAX_VALUE,
    );
    const magnitude = Math.log(Number.MAX_VALUE) - Math.log(Number.MIN_VALUE);
    const expected = Math.ceil(Math.sqrt(8 / 7) * magnitude * 10_000);
    expect(Number.isFinite(sigmaDailyBps(closes))).toBe(true);
    expect(sigmaDailyBps(closes)).toBe(expected);
  });

  it("reads eight synthetic historical fixtures at strictly prior UTC midnights", async () => {
    const fetch = vi.fn(
      fixtureFetch(
        Array.from({ length: 8 }, (_, i) => file(`pyth/historical-wif-${i}`)),
      ),
    );
    const client = createPythHermesClient({
      fetch,
      env: {
        pythHermesUrl: MARKET.pyth.defaultHermesUrl,
        pythHermesApiKey: "fixture-only",
      },
      clock: {
        nowMs: () => nowMs,
        sleep: () => new Promise(() => {}),
        random: () => 0,
      },
    });
    const times = dailyCloseTimes(nowMs);
    expect(times).toHaveLength(8);
    expect(times.every((time) => time < nowSec && time % 86_400 === 0)).toBe(
      true,
    );
    const updates = await Promise.all(
      times.map((time) =>
        client.getHistorical(HIT_LIST.launchMajors[0].pythFeedId, time),
      ),
    );
    expect(
      sigmaDailyBps(
        updates.map(
          (entry) => Number(entry!.price.price) * 10 ** entry!.price.expo,
        ),
      ),
    ).toBe(1_019);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(dailyCloseTimes(times.at(-1)! * 1_000).at(-1)).toBe(
      times.at(-1)! - 86_400,
    );
  });

  it("rejects historical data published before the requested timestamp", async () => {
    const data = fixture("pyth/historical-before-request");
    const time = Number(new URL(data.request.url).pathname.split("/").at(-1));
    const client = createPythHermesClient({
      fetch: fixtureFetch(file("pyth/historical-before-request")),
      env: {
        pythHermesUrl: MARKET.pyth.defaultHermesUrl,
        pythHermesApiKey: "fixture-only",
      },
    });
    await expect(
      client.getHistorical(HIT_LIST.launchMajors[0].pythFeedId, time),
    ).rejects.toMatchObject({ code: "PROVIDER_SCHEMA" });
  });
});
