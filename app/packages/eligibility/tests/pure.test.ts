import { describe, expect, it } from "vitest";
import {
  amountToUi,
  referralCode,
  cardTicker,
  cleanText,
  formatPct,
  formatSolDisplay,
  lamportsToSol,
  shortAddress,
  solToLamports,
} from "../src/format.js";
import { evaluateSnapshot } from "../src/snapshot.js";
import { estimateValueLamports } from "../src/value.js";
import { cardCopy, fnv1a32 } from "../src/card-copy.js";
import {
  CARD_LINES,
  CARD_TITLES,
  feedableLabel,
  reasonText,
  xrayLine,
} from "../src/copy.js";
import type { XrayResult } from "../src/xray-result.js";

describe("exact display formatting", () => {
  it("keeps only the documented referral code formats", () => {
    expect(referralCode("11111111111111111111111111111111")).toBe(
      "11111111111111111111111111111111",
    );
    expect(referralCode("collector_1")).toBe("collector_1");
    for (const value of [
      null,
      undefined,
      "ab",
      "Collector",
      "name-with-dash",
      "a".repeat(17),
      "0".repeat(32),
      " foo ",
      "<script>",
    ])
      expect(referralCode(value)).toBeUndefined();
  });
  it("keeps arbitrary precision amounts and exact SOL units", () => {
    expect(lamportsToSol(10_000_000_000_000_000_001n)).toBe(
      "10000000000.000000001",
    );
    expect(lamportsToSol(1n)).toBe("0.000000001");
    expect(amountToUi(123456789012345678901n, 6)).toBe(
      "123456789012345.678901",
    );
    expect(amountToUi(100n, 0)).toBe("100");
    expect(amountToUi(1000000n, 6)).toBe("1");
    expect(solToLamports("10000000000.000000001")).toBe(
      10_000_000_000_000_000_001n,
    );
    expect(() => solToLamports("0.0000000001")).toThrow();
  });
  it.each([
    ["412.6099", "412.6"],
    ["1", "1"],
    ["0.849999999", "0.84"],
    ["0.1", "0.10"],
    ["0.01001", "0.01"],
    ["0.00619999", "0.0061"],
    ["0.009999999", "0.0099"],
    ["0.000000019", "0.000000019"],
    ["0.00203928", "0.0020"],
    ["0.000000001", "0.0000000010"],
    ["0", "0"],
  ])("floors %s to %s", (input, expected) => {
    expect(formatSolDisplay(input)).toBe(expected);
    expect(formatSolDisplay(solToLamports(input))).toBe(expected);
  });
  it("cleans metadata controls, bidi and invisible text", () => {
    expect(cleanText(" \u0001A\u0085B\u202eC\u2069D\u200bE\ufeffF ", 32)).toBe(
      "ABCDEF",
    );
    expect(cleanText("123456789", 4)).toBe("1234");
    expect(cleanText("😀😀😀", 5)).toBe("😀😀");
    expect(cardTicker("$foo-very_long12!", "mint")).toBe("FOOVERYLON");
    expect(cardTicker("$!", "Abcd12345")).toBe("Abcd");
    expect(shortAddress("7xKp123456789d2Qa")).toBe("7xKp…d2Qa");
    expect(formatPct(99.6)).toBe("−99.6%");
    expect(formatPct(0)).toBe("0.0%");
  });
});
describe("snapshot evidence", () => {
  it("evaluates all branches in priority order", () => {
    expect(evaluateSnapshot(undefined)).toBe("unchecked");
    expect(
      evaluateSnapshot(undefined, { balanceAtS: 1n, mintFirstSeenSlot: 999 }),
    ).toBe("unchecked");
    expect(
      evaluateSnapshot(100, { balanceAtS: 1n, mintFirstSeenSlot: 101 }),
    ).toBe("not_held");
    expect(evaluateSnapshot(100)).toBe("unknown");
    expect(evaluateSnapshot(100, { balanceAtS: null })).toBe("unknown");
    expect(evaluateSnapshot(100, { balanceAtS: 1n })).toBe("held");
    expect(evaluateSnapshot(100, { balanceAtS: 0n })).toBe("not_held");
  });
});
describe("display estimates", () => {
  const input = {
    amountRaw: 2_000_000n,
    decimals: 9,
    usdPrice: 100,
    solUsd: 100,
    ageSlots: 0,
    exitCapLamports: 10_000_000n,
  };
  it("preserves the sell boundary, cap and price freshness boundary", () => {
    expect(estimateValueLamports(input)).toBe(2_000_000n);
    expect(estimateValueLamports({ ...input, amountRaw: 1_999_999n })).toBe(
      1_999_999n,
    );
    expect(estimateValueLamports({ ...input, exitCapLamports: 12n })).toBe(12n);
    expect(estimateValueLamports({ ...input, exitCapLamports: 0n })).toBe(0n);
    expect(estimateValueLamports({ ...input, ageSlots: 54_000 })).toBe(
      2_000_000n,
    );
    expect(
      estimateValueLamports({ ...input, ageSlots: 54_001 }),
    ).toBeUndefined();
  });
  it("omits estimates without usable data or when explicitly skipped", () => {
    expect(
      estimateValueLamports({ ...input, usdPrice: undefined }),
    ).toBeUndefined();
    expect(estimateValueLamports({ ...input, solUsd: 0 })).toBeUndefined();
    expect(estimateValueLamports({ ...input, skip: true })).toBeUndefined();
    expect(
      estimateValueLamports({ ...input, exitCapLamports: undefined }),
    ).toBeUndefined();
    expect(
      estimateValueLamports({ ...input, exitCapLamports: null }),
    ).toBeUndefined();
    expect(
      estimateValueLamports({ ...input, exitCapLamports: -1n }),
    ).toBeUndefined();
    expect(estimateValueLamports({ ...input, decimals: null })).toBeUndefined();
    for (const ageSlots of [undefined, -1, NaN, Infinity, 0.5])
      expect(estimateValueLamports({ ...input, ageSlots })).toBeUndefined();
  });
  it("keeps a high stale-but-allowed price below a fee-adjusted thin pool cap", () => {
    expect(
      estimateValueLamports({
        ...input,
        amountRaw: 1_000_000_000_000n,
        usdPrice: 1_000_000,
        ageSlots: 50_000,
        exitCapLamports: 1_975_001n,
      }),
    ).toBe(1_975_001n);
  });
});
describe("deterministic card copy", () => {
  const base = {
    address: "11111111111111111111111111111111",
    bags: 10,
    dust: 0,
    empties: 0,
    worst: null,
  };
  it.each([
    [0, "Mint"],
    [1, "Near Mint"],
    [3, "Near Mint"],
    [4, "Lightly Played"],
    [10, "Lightly Played"],
    [11, "Played"],
    [30, "Played"],
    [31, "Heavily Played"],
    [80, "Heavily Played"],
    [81, "Damaged"],
  ] as const)("condition at %s bags", (bags, condition) =>
    expect(cardCopy({ ...base, bags }).condition).toBe(condition),
  );
  it("applies title precedence and the seventy percent dust boundary", () => {
    expect(
      cardCopy({ ...base, bags: 0, worst: { ticker: "X", drawdownPct: 100 } })
        .title,
    ).toBe(CARD_TITLES.clean);
    expect(
      cardCopy({
        ...base,
        bags: 80,
        dust: 80,
        worst: { ticker: "X", drawdownPct: 99.5 },
      }).title,
    ).toBe(CARD_TITLES.lastDecimal);
    expect(cardCopy({ ...base, bags: 50, dust: 50 }).title).toBe(
      CARD_TITLES.collector,
    );
    expect(cardCopy({ ...base, dust: 7 }).title).toBe(CARD_TITLES.dust);
    expect(cardCopy({ ...base, dust: 6 }).title).toBe(CARD_TITLES.holder);
  });
  it("uses a known FNV-1a vector and only eligible templates", () => {
    expect(fnv1a32("hello")).toBe(0x4f9f2cab);
    expect(cardCopy(base)).toEqual(cardCopy(base));
    const always = [
      CARD_LINES.collection,
      CARD_LINES.tops,
      CARD_LINES.charts,
      CARD_LINES.hands,
    ];
    for (let index = 0; index < 100; index += 1)
      expect(always).toContain(
        cardCopy({ ...base, address: `${index}` }).oneLiner,
      );
    const complete = new Set(
      Array.from(
        { length: 100 },
        (_, index) =>
          cardCopy({
            ...base,
            address: `${index}`,
            dust: 4,
            empties: 5,
            worst: { ticker: "TEST", drawdownPct: 96 },
          }).oneLiner,
      ),
    );
    expect(complete).toContain(CARD_LINES.holding);
    expect(complete).toContain(CARD_LINES.counts(10, 4, 5));
    expect(complete).toContain(CARD_LINES.worst("TEST", 96));
    expect(cardCopy({ ...base, bags: 0 }).oneLiner).toBe(CARD_LINES.clean);
  });
  it("derives the public Feed label and UTC reason date", () => {
    expect(feedableLabel()).toBe("0.002–0.02 SOL when it’s pulled");
    expect(reasonText("snapshot_not_held", "2026-10-22T23:59:00Z")).toBe(
      "Not feedable this season (bought after Oct 22)",
    );
    expect(reasonText("snapshot_at_feed")).toBe("Final check when you Feed");
  });
  it.each([
    ["not_pump_fun", "Not from pump.fun"],
    ["token_extensions", "Not supported (token extensions)"],
    ["mint_authority", "Not supported (mint authority still set)"],
    ["freeze_authority", "Not supported (freeze authority still set)"],
    ["decimals", "Not supported (more than 9 decimals)"],
    ["unknown_program", "Not supported (unknown token program)"],
    ["mint_unparseable", "Not supported (unreadable mint)"],
    ["mint_missing", "Not supported (mint not found)"],
    ["excluded", "Not in the set (SOL and $1PCT stay out)"],
    ["snapshot_not_held", "Not feedable this season"],
  ] as const)(
    "maps the public %s reason to its exact copy key",
    (code, expected) => {
      expect(reasonText(code)).toBe(expected);
    },
  );
  it("omits zero segments and uses singular counts", () => {
    const minimal = {
      address: base.address,
      counts: { bags: 0, feedable: 0, checkAtFeed: 0, sellable: 0, empty: 0 },
      totals: { sellValueSol: "0", rentBackSol: "0" },
    } as XrayResult;
    expect(xrayLine(minimal)).toBe("X-ray: 1111…1111");
    expect(
      xrayLine({
        ...minimal,
        counts: {
          ...minimal.counts,
          bags: 1,
          feedable: 1,
          checkAtFeed: 2,
          sellable: 1,
          empty: 1,
        },
        totals: { sellValueSol: "0.123", rentBackSol: "0.00203928" },
      }),
    ).toBe(
      "X-ray: 1111…1111 ✳ 1 bag ✳ 1 feedable ✳ 2 to check at Feed ✳ 1 has a bid ≈0.12 SOL est. ✳ 1 empty account ≈0.0020 SOL rent back",
    );
  });
});
