import { describe, expect, it } from "vitest";
import { XrayResultSchema, type XrayResult } from "../src/xray-result.js";

const address = "11111111111111111111111111111111";
const missing: XrayResult["bags"][number] = {
  mint: address,
  symbol: "TEST",
  name: "Test",
  logoUrl: null,
  amountUi: null,
  decimals: null,
  tokenProgram: "spl",
  buckets: ["not_in_set"],
  reasonCode: "mint_missing",
  reason: "Not supported",
};
const result: XrayResult = {
  address,
  chain: "solana",
  scannedAt: "2026-10-08T00:00:00.000Z",
  cached: false,
  counts: {
    bags: 0,
    feedable: 0,
    checkAtFeed: 0,
    notFeedable: 0,
    sellable: 0,
    empty: 0,
    notInSet: 1,
  },
  totals: { sellValueSol: "0", rentBackSol: "0" },
  worst: null,
  bags: [missing],
  emptyAccounts: [],
  card: {
    title: "Suspiciously Clean",
    condition: "Mint",
    oneLiner: "Clean. Suspiciously clean.",
  },
  share: {
    landscapeUrl: "https://example.com/landscape.png",
    squareUrl: "https://example.com/square.png",
    xIntentUrl: "https://example.com/share",
  },
};

describe("X3 X-ray result contract", () => {
  it("accepts legacy results and retains the additive partial-value indicator", () => {
    expect(XrayResultSchema.parse(result).valuesPartial).toBeUndefined();
    for (const valuesPartial of [false, true])
      expect(
        XrayResultSchema.parse({ ...result, valuesPartial }).valuesPartial,
      ).toBe(valuesPartial);
    expect(
      XrayResultSchema.safeParse({ ...result, valuesPartial: "true" }).success,
    ).toBe(false);
  });
  it("retains an absent mint with neither an amount nor a value", () => {
    expect(XrayResultSchema.parse(result).bags).toEqual([missing]);
  });
  it.each([
    "mint_unparseable",
    "unknown_program",
    "decimals",
    "mint_authority",
    "freeze_authority",
    "token_extensions",
  ] as const)(
    "retains null amounts with precise safety failure %s under D8",
    (reasonCode) => {
      const bag = { ...missing, reasonCode };
      expect(
        XrayResultSchema.parse({ ...result, valuesPartial: true, bags: [bag] })
          .bags,
      ).toEqual([bag]);
      for (const change of [
        { amountUi: "1" },
        { decimals: 6 },
        { valueSol: "0" },
        { buckets: ["feedable"] },
        { buckets: ["not_in_set", "sell"] },
      ])
        expect(
          XrayResultSchema.safeParse({
            ...result,
            bags: [{ ...bag, ...change }],
          }).success,
        ).toBe(false);
    },
  );
  it.each([
    { reasonCode: undefined },
    { reasonCode: "not_pump_fun" },
    { reasonCode: "excluded" },
    { reasonCode: "snapshot_at_feed" },
    { reasonCode: "snapshot_not_held" },
    { decimals: 0 },
    { amountUi: "1234" },
    { valueSol: "0" },
    { buckets: ["feedable"] },
    { buckets: ["not_in_set", "sell"] },
  ])("rejects an invalid unreadable-mint representation: %j", (change) => {
    expect(
      XrayResultSchema.safeParse({
        ...result,
        bags: [{ ...missing, ...change }],
      }).success,
    ).toBe(false);
  });
  it("keeps readable-mint amounts required and supports the new count", () => {
    const readable = {
      ...missing,
      reasonCode: "snapshot_at_feed",
      reason: "Final check when you Feed",
      buckets: ["feedable"],
      decimals: 6,
      amountUi: "123.456789",
    };
    expect(
      XrayResultSchema.safeParse({
        ...result,
        counts: { ...result.counts, bags: 1, checkAtFeed: 1, notInSet: 0 },
        bags: [readable],
      }).success,
    ).toBe(true);
    for (const amount of [{ decimals: null }, { amountUi: null }])
      expect(
        XrayResultSchema.safeParse({
          ...result,
          bags: [{ ...readable, ...amount }],
        }).success,
      ).toBe(false);
  });
});
