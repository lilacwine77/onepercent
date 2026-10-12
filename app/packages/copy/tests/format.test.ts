import { describe, expect, it } from "vitest";
import {
  amount,
  packPrice,
  depositCost,
  ripTotal,
  count,
  countUngrouped,
  countdown,
  dateUtc,
  formatSolDisplay,
  mult,
  pct,
  pctBps,
  short,
  shortTv,
  sol,
  solCost,
  solExact,
  solSigned,
  timeUtc,
  ticker,
} from "../src/index.js";

describe("exact numeric copy formatters", () => {
  it.each([
    [0n, "0", "0"],
    [1n, "0.000000001", "0.000000001"],
    [2_039_280n, "0.00203", "0.00204"],
    [6_199_999n, "0.00619", "0.0062"],
    [849_999_999n, "0.84", "0.85"],
    [1_000_000_001n, "1", "1.01"],
    [412_609_900_000n, "412.6", "412.61"],
    [10_000_000_000_000_000_001n, "10000000000", "10000000000.01"],
  ])(
    "floors receipts and ceils costs from %s lamports",
    (value, receipt, cost) => {
      expect(sol(value)).toBe(receipt);
      expect(solCost(value)).toBe(cost);
      expect(sol(solExact(value))).toBe(receipt);
    },
  );
  it("preserves the established X1 formatter for its existing rendered snapshots", () => {
    expect(formatSolDisplay("0.00203928")).toBe("0.0020");
    expect(formatSolDisplay("0.1")).toBe("0.10");
  });
  it("keeps exact amounts beyond the safe integer range", () => {
    expect(amount(12_043_310_000_000_001n, 9)).toBe("12,043,310.000000001");
    expect(count(9_007_199_254_740_993n)).toBe("9,007,199,254,740,993");
    expect(countUngrouped(61_240n)).toBe("61240");
    expect(solExact(1n)).toBe("0.000000001");
    expect(solSigned(1_000_000_000n)).toBe("+1.00");
    expect(solSigned(-21_000_000n)).toBe("−0.03");
  });
  it("formats percentages, multipliers, tickers and address contexts", () => {
    expect(pct(-96.4)).toBe("−96.4%");
    expect(pct(2)).toBe("2.0%");
    expect(pctBps(200)).toBe("2.0%");
    expect(pctBps(50)).toBe("0.5%");
    expect(mult(10)).toBe("×10");
    expect(ticker("$wif-very_long_123")).toBe("$WIFVERYLON");
    expect(short("7xKp123456789d2Qa")).toBe("7xKp…d2Qa");
    expect(shortTv("7xKp123456789d2Qa")).toBe("7xK…Qa");
  });
  it("formats explicit UTC instants and a clock-free countdown", () => {
    expect(dateUtc("2026-10-26T18:00:00+02:00")).toBe("Oct 26");
    expect(timeUtc("2026-10-26T18:00:00+02:00")).toBe("16:00 UTC");
    expect(countdown(86_461)).toBe("1d 00:01:01");
    expect(countdown(-1)).toBe("00:00:00");
  });
  it("refuses invalid or imprecise inputs", () => {
    expect(() => count(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => sol(-1n)).toThrow();
    expect(() => solCost("0.0000000001")).toThrow();
    expect(() => amount(-1n)).toThrow();
    expect(() => pct(NaN)).toThrow();
    expect(() => dateUtc("bad date")).toThrow();
  });
});

it("formats pack prices exactly and never understates preview totals", () => {
  expect(packPrice(100_000_000n)).toBe("0.10");
  expect(packPrice(1_000_000_000n)).toBe("1.00");
  expect(() => packPrice(100_000_001n)).toThrow(RangeError);
  expect(depositCost(4872n)).toBe("0.000005");
  for (const [amount, expected] of [
    [500_509_872n, "0.501"],
    [501_000_000n, "0.501"],
    [501_000_001n, "0.502"],
    [0n, "0"],
    [1n, "0.001"],
    [10_000_000_000_000_000_001n, "10000000000.001"],
  ] as const)
    expect(ripTotal(amount)).toBe(expected);
});
