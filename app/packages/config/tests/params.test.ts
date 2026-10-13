import { describe, expect, it } from "vitest";
import {
  CARDS_PER_PACK,
  CREATOR_FEE_SPLIT_BPS,
  STOCK,
  CU_LIMITS,
  FEED_RULES,
  HIT_ODDS,
  HIT_TIERS,
  MARKET,
  ONCHAIN_KEYS,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  PARAMS,
  SEASON,
  TOKEN_1PCT,
  validateParams,
} from "../src/index.js";

describe("PARAMS issue 3 Pyth and display bounds", () => {
  it("publishes the upgraded Pyth ids and compiles only the receiver", () => {
    expect(PARAMS.PROGRAM_IDS.pythReceiver).toBe(
      "rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp",
    );
    expect(PARAMS.PROGRAM_IDS.pythPushOracle).toBe(
      "pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou",
    );
    expect(PARAMS.PROGRAM_IDS.pythWormholeReceiver).toBe(
      "HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL",
    );
    expect(
      ONCHAIN_KEYS.filter((entry) => entry.path.startsWith("PROGRAM_IDS.pyth")),
    ).toEqual([{ path: "PROGRAM_IDS.pythReceiver", type: "Pubkey" }]);
  });

  it.each(["pythReceiver", "pythPushOracle", "pythWormholeReceiver"] as const)(
    "requires %s to decode to exactly 32 bytes",
    (name) => {
      for (const value of ["0".repeat(32), "1".repeat(31), "1".repeat(33)]) {
        expect(() =>
          validateParams({
            ...PARAMS,
            PROGRAM_IDS: { ...PARAMS.PROGRAM_IDS, [name]: value },
          }),
        ).toThrow("Pyth program ID must decode to 32 bytes");
      }
      expect(() =>
        validateParams({
          ...PARAMS,
          PROGRAM_IDS: { ...PARAMS.PROGRAM_IDS, [name]: "1".repeat(32) },
        }),
      ).not.toThrow();
    },
  );

  it("rejects duplicate valid Pyth program ids", () => {
    expect(() =>
      validateParams({
        ...PARAMS,
        PROGRAM_IDS: {
          ...PARAMS.PROGRAM_IDS,
          pythPushOracle: PARAMS.PROGRAM_IDS.pythReceiver,
        },
      }),
    ).toThrow("Pyth program IDs must be distinct");
  });

  it("keeps the X-ray display age at least the market estimate age", () => {
    const withAge = (priceMaxAgeSlots: number) => ({
      ...PARAMS,
      XRAY: { ...PARAMS.XRAY, priceMaxAgeSlots },
    });
    expect(() =>
      validateParams(withAge(MARKET.price.maxAgeSlots)),
    ).not.toThrow();
    expect(() => validateParams(withAge(MARKET.price.maxAgeSlots - 1))).toThrow(
      "The X-ray display age must cover the stricter market estimate age",
    );
  });
});

describe("calibrated parameters", () => {
  it("validates season service bounds with only the approved P3 reserve window on-chain", () => {
    expect(PARAMS.BLOCK0.slots).toBe(20);
    for (const patch of [
      { BLOCK0: { slots: 0 } },
      {
        EXECUTOR_POLICY: { ...PARAMS.EXECUTOR_POLICY, minTrancheLamports: 0n },
      },
      {
        EXECUTOR_POLICY: {
          ...PARAMS.EXECUTOR_POLICY,
          burnTrancheSpacingSecondsMin: 19,
        },
      },
      {
        EXECUTOR_POLICY: {
          ...PARAMS.EXECUTOR_POLICY,
          burnTrancheSpacingSecondsMax: 19,
        },
      },
      {
        KEEPER_POLICY: {
          ...PARAMS.KEEPER_POLICY,
          creatorFeeFinalCollectLeadSeconds: 120,
        },
      },
    ])
      expect(() => validateParams({ ...PARAMS, ...patch })).toThrow();
    expect(
      ONCHAIN_KEYS.filter(({ path }) =>
        /^(BLOCK0|EXECUTOR_POLICY|KEEPER_POLICY)\./.test(path),
      ),
    ).toEqual([{ path: "KEEPER_POLICY.solReserveExtraMinutes", type: "i64" }]);
    expect(PARAMS.POST_REVEAL_BUY_DELAY).toBe(30);
    expect(PARAMS.KEEPER_POLICY.revealDelaySecondsMin).toBe(
      PARAMS.POST_REVEAL_BUY_DELAY,
    );
  });
  it("validates measured CU limits", () => {
    expect(CU_LIMITS.feed).toHaveLength(6);
    expect(CU_LIMITS.settle).toHaveLength(2);
    expect(() =>
      validateParams({
        ...PARAMS,
        CU_LIMITS: { ...CU_LIMITS, takeBack: 1_001 },
      }),
    ).toThrow("round to 1,000 CU");
  });
  it("validates the specified M1 constants", () => {
    expect(validateParams()).toEqual(PARAMS);
    expect(HIT_ODDS.blackPpb).toBe(2_500_000);
    expect(FEED_RULES.freshCapPerWallet).toBe(25);
    expect(FEED_RULES.holdRule).toBe("snapshot");
  });

  it("allocates the entire pack price and 800 bps to four dust royalties", () => {
    const royalties = CARDS_PER_PACK.dust * PACK_SPLIT_BPS.royaltyPerDustCard;
    const total = Object.entries(PACK_SPLIT_BPS)
      .filter(([key]) => key !== "royaltyPerDustCard")
      .reduce((sum, [, bps]) => sum + bps, royalties);

    expect(royalties).toBe(800);
    expect(total).toBe(10_000);
    expect(() =>
      validateParams({
        ...PARAMS,
        PACK_SPLIT_BPS: { ...PACK_SPLIT_BPS, stock: 7_201 },
      }),
    ).toThrow("must total 10,000 bps");
  });

  it("rejects a changed royalty even if the full split still balances", () => {
    expect(() =>
      validateParams({
        ...PARAMS,
        PACK_SPLIT_BPS: {
          ...PACK_SPLIT_BPS,
          stock: 7_600,
          royaltyPerDustCard: 100,
        },
      }),
    ).toThrow("Four dust royalties must total 800 bps");
  });

  it("requires increasing pack prices", () => {
    expect(PACK_EDITIONS.map((edition) => edition.priceLamports)).toEqual([
      100_000_000n,
      250_000_000n,
      500_000_000n,
      1_000_000_000n,
    ]);
    expect(() =>
      validateParams({
        ...PARAMS,
        PACK_EDITIONS: [...PACK_EDITIONS].reverse(),
      }),
    ).toThrow("Pack prices must be strictly increasing");
  });

  it("requires increasing hit tier values", () => {
    expect(HIT_TIERS.map((tier) => tier.valueBps)).toEqual([
      5_000, 15_000, 40_000, 150_000,
    ]);
    expect(() =>
      validateParams({ ...PARAMS, HIT_TIERS: [...HIT_TIERS].reverse() }),
    ).toThrow("Hit tier values must be strictly increasing");
  });

  it("reserves the disclosed dev buy for exactly four The 1% cards", () => {
    const cardsTotal =
      TOKEN_1PCT.onePctCardAmount * BigInt(TOKEN_1PCT.onePctCardCount);
    expect(cardsTotal).toBe(40_000_000n * 10n ** 6n);
    expect(cardsTotal).toBe(
      (TOKEN_1PCT.totalSupply * BigInt(TOKEN_1PCT.devBuyBps)) / 10_000n,
    );
    expect(() =>
      validateParams({
        ...PARAMS,
        TOKEN_1PCT: { ...TOKEN_1PCT, onePctCardCount: 3 },
      }),
    ).toThrow("dev buy must exactly fund");
  });

  it("requires zero team allocation", () => {
    expect(TOKEN_1PCT.teamAllocation).toBe(0n);
    expect(() =>
      validateParams({
        ...PARAMS,
        TOKEN_1PCT: { ...TOKEN_1PCT, teamAllocation: 1n },
      }),
    ).toThrow("team token allocation must be zero");
  });

  it("rejects fractional basis points and non-bigint token amounts", () => {
    expect(() =>
      validateParams({
        ...PARAMS,
        PACK_SPLIT_BPS: { ...PACK_SPLIT_BPS, stock: 7_200.5 },
      }),
    ).toThrow();
    expect(() =>
      validateParams({
        ...PARAMS,
        TOKEN_1PCT: { ...TOKEN_1PCT, totalSupply: 1_000_000_000_000_000 },
      }),
    ).toThrow();
  });
});

describe("D37 season schedule", () => {
  it("keeps four quarterly releases inside 48 hours with a six-hour Last Call", () => {
    expect(SEASON.durationDays).toBe(2);
    expect(SEASON.durationSeconds).toBe(172_800);
    expect(TOKEN_1PCT.onePctReleaseOffsetsSeconds).toEqual([
      0, 43_200, 86_400, 129_600,
    ]);
    expect(
      TOKEN_1PCT.onePctReleaseOffsetsSeconds.map(
        (offset) => offset / SEASON.durationSeconds,
      ),
    ).toEqual([0, 0.25, 0.5, 0.75]);
    expect(SEASON.lastCallSeconds).toBe(21_600);
    expect(SEASON.durationSeconds - SEASON.lastCallSeconds).toBeGreaterThan(
      TOKEN_1PCT.onePctReleaseOffsetsSeconds[3],
    );
    expect(validateParams()).toEqual(PARAMS);
  });

  it("rejects a release at or after closing and mismatched day/second units", () => {
    for (const last of [SEASON.durationSeconds, SEASON.durationSeconds + 1]) {
      expect(() =>
        validateParams({
          ...PARAMS,
          TOKEN_1PCT: {
            ...TOKEN_1PCT,
            onePctReleaseOffsetsSeconds: [0, 43_200, 86_400, last],
          },
        }),
      ).toThrow("Release offsets must increase within the season");
    }
    expect(() =>
      validateParams({ ...PARAMS, SEASON: { ...SEASON, durationDays: 3 } }),
    ).toThrow("Season days and seconds must agree");
  });

  it("preserves the independent launch, exit, holder and listing delays", () => {
    expect(SEASON.onAirDelaySeconds).toBe(900);
    expect(SEASON.finalPullDelaySeconds).toBe(600);
    expect(SEASON.sealDelaySeconds).toBe(259_200);
    expect(TOKEN_1PCT.holderTier.continuousHoldSeconds).toBe(86_400);
    expect(PARAMS.HIT_LIST.trendingNoticeSeconds).toBe(86_400);
  });
});

describe("D27 creator-fee parameters", () => {
  it("compiles a separate floor and conserves each collection without creator-fee burn", () => {
    expect(STOCK.creatorFeeFloorLamports).toBe(2_000_000_000n);
    expect(STOCK.targetBaseLamports).toBe(30_000_000_000n);
    expect(CREATOR_FEE_SPLIT_BPS).toEqual({
      belowFloor: { stock: 10_000, burn: 0, team: 0 },
      season: { stock: 5_000, burn: 0, team: 5_000 },
      afterEnd: { stock: 0, burn: 0, team: 10_000 },
    });
    expect(ONCHAIN_KEYS).toContainEqual({
      path: "STOCK.creatorFeeFloorLamports",
      type: "u64",
    });
    expect(PACK_SPLIT_BPS.burn1pct).toBe(500);
    for (const [regime, row] of Object.entries(CREATOR_FEE_SPLIT_BPS)) {
      expect(() =>
        validateParams({
          ...PARAMS,
          CREATOR_FEE_SPLIT_BPS: {
            ...CREATOR_FEE_SPLIT_BPS,
            [regime]: { ...row, stock: row.stock + 1 },
          },
        }),
      ).toThrow("Every creator-fee split must total the denominator");
    }
  });
});
