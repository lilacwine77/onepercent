import { describe, expect, it } from "vitest";
import * as p from "../src/params.js";
describe("PARAMS.md mirrored values", () => {
  it("pins every mirrored field and every approved operational limit", () => {
    expect(p.LAMPORTS_PER_SOL).toBe(1_000_000_000n);
    expect(p.BPS_DENOMINATOR).toBe(10_000);
    expect(p.PACK_EDITIONS.map((edition) => edition.priceLamports)).toEqual([
      100_000_000n,
      250_000_000n,
      500_000_000n,
      1_000_000_000n,
    ]);
    expect(p.PACK_SPLIT_BPS).toEqual({ royaltyPerDustCard: 200 });
    expect(p.FEED_RULES).toEqual({
      maxMintDecimals: 9,
      allowedToken2022Extensions: ["MetadataPointer", "TokenMetadata"],
    });
    expect(p.XRAY).toEqual({
      cacheSeconds: 86400,
      rateLimitPerMinutePerIp: 60,
      turnstileAfterRequests: 10,
      accountsPerBatch: 100,
      priceIdsPerCall: 50,
      sellMinLamports: 2_000_000n,
      priceMaxAgeSlots: 54_000,
      maxTokenAccounts: 2_000,
      cacheMaxEntries: 5_000,
    });
    expect(p.PROGRAM_IDS).toEqual({
      pumpFun: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      splToken: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    });
    expect(p.PUMP_LAYOUTS).toEqual({
      bondingCurveSeed: "bonding-curve",
      bondingCurveDiscriminatorHex: "17b7f83760d8ac60",
    });
    expect(p.WSOL_MINT).toBe("So11111111111111111111111111111111111111112");
    expect(p.UI).toEqual({ tickerMaxChars: 10 });
    expect([
      p.XRAY_PRICE_MAX_AGE_SLOTS,
      p.XRAY_MAX_TOKEN_ACCOUNTS,
      p.XRAY_CACHE_MAX_ENTRIES,
    ]).toEqual([54000, 2000, 5000]);
  });
});
