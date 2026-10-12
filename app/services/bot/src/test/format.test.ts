import "./setup.js";
import { describe, expect, it } from "vitest";
import {
  BOT as CONFIG_BOT,
  UI as CONFIG_UI,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
} from "@onepercent/config";
import {
  formatSol,
  formatSolReceipt,
  formatSolDisplay,
  formatUnits,
  escapeHtml,
  sanitizeTicker,
  shortAddress,
} from "../format.js";
import { feedCopy, xrayCopy } from "../copy.js";
import { BOT, RATE_RULES, UI } from "../limits.js";
import { parseEnv } from "../env.js";
import { parseReferral, normalizeXrayInput } from "../referral.js";
import { FakeClock, ADDRESS, fixture } from "./harness.js";
import { InMemoryRateLimiter } from "../ratelimit.js";

describe("exact decimal formatting and config values", () => {
  it.each([
    ["412.6099", "412.6"],
    ["1", "1"],
    ["0.849999", "0.84"],
    ["0.1", "0.10"],
    ["0.01001", "0.01"],
    ["0.00619999", "0.0061"],
    ["0.009999999", "0.0099"],
    ["0.002039", "0.0020"],
    ["0.000000019", "0.000000019"],
    ["0.000000001", "0.0000000010"],
    ["0", "0"],
    ["18446744073.709551615", "18446744073.7"],
    ["9007199254740993.129999999", "9007199254740993.12"],
  ])("floors estimate %s to X1 display %s without floats", (input, output) => {
    expect(formatSolDisplay(input!)).toBe(output);
    const [whole, fraction = ""] = input!.split(".");
    expect(formatSolDisplay(BigInt(whole + fraction.padEnd(9, "0")))).toBe(
      output,
    );
  });
  it("uses floor formatting in both approximate X-ray value labels", () => {
    const text = xrayCopy(
      {
        ...fixture,
        counts: { ...fixture.counts, sellable: 1, empty: 1 },
        totals: { sellValueSol: "0.849999", rentBackSol: "0.002039" },
      },
      ADDRESS,
    );
    expect(text).toContain("1 has a bid ≈0.84 SOL est.");
    expect(text).toContain("1 empty account ≈0.0020 SOL rent back");
  });
  it("rejects invalid estimate amounts before display", () => {
    for (const value of ["NaN", "-1", "1e9", "0.0000000001", -1n])
      expect(() => formatSolDisplay(value)).toThrow();
  });
  it.each([
    ["0.7912", "0.79"],
    ["412.6", "412.6"],
    ["1", "1"],
    ["0.0061", "0.0061"],
    ["0.002039", "0.00204"],
    ["0", "0"],
    ["9007199254740993.123456789", "9007199254740993.12"],
    ["0.000000001", "0.000000001"],
  ])("formats %s as %s without floating point", (input, output) => {
    expect(formatSol(input!)).toBe(output);
  });
  it("handles bigint lamports and rejects non-decimals", () => {
    expect(formatSol(791_200_000n)).toBe("0.79");
    expect(formatUnits(123_456_789n, 6)).toBe("123.456789");
    for (const value of ["NaN", "-1", "1e9", "0.0000000001"])
      expect(() => formatSol(value)).toThrow();
  });
  it("sanitizes symbols, escapes HTML and pins address lengths", () => {
    expect(sanitizeTicker('<a href="x">')).toBe("AHREFX");
    expect(sanitizeTicker("abcdefghijkl")).toBe("ABCDEFGHIJ");
    expect(escapeHtml('<a & "b">')).toBe("&lt;a &amp; &quot;b&quot;&gt;");
    expect(shortAddress(ADDRESS)).toBe("7xKp…d2Qa");
    expect(shortAddress(ADDRESS, true)).toBe("7xK…Qa");
  });
  it("uses the canonical parameters and derives royalties from config", () => {
    expect(BOT).toBe(CONFIG_BOT);
    expect(UI).toBe(CONFIG_UI);
    const royalties = PACK_EDITIONS.map((p) =>
      formatSol(
        (p.priceLamports * BigInt(PACK_SPLIT_BPS.royaltyPerDustCard)) / 10_000n,
      ),
    );
    expect(feedCopy()).toContain(
      `${royalties[0]}–${royalties.at(-1)} SOL to you when it’s pulled.`,
    );
    expect(RATE_RULES).toMatchObject({
      update: { name: "update", limit: 20, windowMs: 60_000 },
      xray: { name: "xray", limit: 6, windowMs: 60_000 },
      link: { name: "link", limit: 3, windowMs: 600_000 },
    });
  });
  it("allows only referral wallets or lowercase aliases within Telegram's payload limit", () => {
    expect(parseReferral(`ref_${ADDRESS}`)).toBe(ADDRESS);
    expect(parseReferral("ref_maker_1")).toBe("maker_1");
    for (const input of [
      "",
      "ref_ABCD",
      "ref_ab",
      "ref_bad-name",
      "ref_" + "a".repeat(61),
      "bad_maker",
      "ref_maker extra",
    ])
      expect(parseReferral(input)).toBeNull();
    expect(normalizeXrayInput(" Alice.SOL ")).toBeNull();
    expect(normalizeXrayInput(" Alice.SNS ")).toBe("Alice.SNS");
    expect(normalizeXrayInput("bad/name.sol")).toBeNull();
  });
  it("does not share counters across users, groups or rules", () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter(clock);
    for (let n = 0; n < 6; n++)
      expect(limiter.consume("42", RATE_RULES.xray).ok).toBe(true);
    expect(limiter.consume("42", RATE_RULES.xray)).toEqual({
      ok: false,
      retryAfterS: 60,
    });
    for (const key of ["43", "42:-100", "42:-200"])
      expect(limiter.consume(key, RATE_RULES.xray).ok).toBe(true);
    expect(limiter.consume("42", RATE_RULES.link).ok).toBe(true);
    clock.advance(60_000);
    expect(limiter.consume("42", RATE_RULES.xray).ok).toBe(true);
  });
  it("accepts only clean origins and protects the public wallet target", () => {
    expect(parseEnv({}).PUBLIC_WEB_URL).toBe("http://localhost:5173");
    expect(
      parseEnv({ PUBLIC_API_URL: "http://api.internal:3000" }).PUBLIC_API_URL,
    ).toBe("http://api.internal:3000");
    for (const url of [
      "http://onepercent.test",
      "https://user:pass@onepercent.test",
      "https://onepercent.test/path",
      "https://onepercent.test/?q=1",
      "https://onepercent.test/#bad",
    ])
      expect(() => parseEnv({ PUBLIC_WEB_URL: url })).toThrow();
    expect(() => parseEnv({ BOT_API_SECRET: "short" })).toThrow();
  });
});

it("groups all X-ray counts through the local shared-copy formatter", () => {
  const result = {
    ...fixture,
    counts: {
      ...fixture.counts,
      bags: 1234,
      feedable: 1000,
      checkAtFeed: 1001,
      empty: 2345,
      sellable: 1234,
    },
  };
  const text = xrayCopy(result, ADDRESS);
  for (const value of [
    "1,234 bags",
    "1,000 feedable",
    "1,001 to check",
    "2,345 empty",
    "1,234 have a bid",
  ])
    expect(text).toContain(value);
});

it.each([
  [1_234_567n, "0.00123"],
  [100_000_000n, "0.1"],
  [849_999_999n, "0.84"],
  [1n, "0.000000001"],
  [0n, "0"],
] as const)("matches M3 receipt formatting %s", (value, expected) => {
  expect(formatSolReceipt(value)).toBe(expected);
});
