import { describe, expect, it } from "vitest";
import {
  FEED_BACK_DEFAULT_MIX,
  FEED_BACK_RANGE,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  feedBackEstimate,
  feedOutlook,
  feedUpTo,
} from "../src/index.js";
import * as subpath from "@onepercent/config/feed-back";

const royalty = (price: bigint) =>
  (price * BigInt(PACK_SPLIT_BPS.royaltyPerDustCard)) / 10_000n;

describe("Feed back estimate", () => {
  it("pays the royalty of the only edition opened", () => {
    PACK_EDITIONS.forEach((edition, index) => {
      const mix = [0, 0, 0, 0];
      mix[index] = 7;
      expect(feedBackEstimate(mix)).toBe(royalty(edition.priceLamports));
    });
    expect(feedBackEstimate([1, 0, 0, 0])).toBe(2_000_000n);
    expect(feedBackEstimate([0, 0, 0, 1])).toBe(20_000_000n);
  });

  it("weighs the royalty by the share of packs opened in each edition", () => {
    // 2% of (0.5 × 0.10 + 0.25 × 0.25 + 0.15 × 0.50 + 0.10 × 1.00) SOL.
    expect(feedBackEstimate([50, 25, 15, 10])).toBe(5_750_000n);
    expect(feedBackEstimate([500, 250, 150, 100])).toBe(5_750_000n);
    expect(feedBackEstimate([1, 1, 0, 0])).toBe(3_500_000n);
  });

  it("falls back to the default mix without recent pulls", () => {
    expect(FEED_BACK_DEFAULT_MIX).toEqual([50, 25, 15, 10]);
    expect(feedBackEstimate([])).toBe(feedBackEstimate(FEED_BACK_DEFAULT_MIX));
    expect(feedBackEstimate([0, 0, 0, 0])).toBe(5_750_000n);
  });

  it("stays between the cheapest and the dearest pack's royalty", () => {
    for (const mix of [
      [3, 0, 0, 1],
      [0, 9, 2, 0],
      [1, 1, 1, 1],
    ]) {
      const estimate = feedBackEstimate(mix);
      expect(estimate).toBeGreaterThanOrEqual(2_000_000n);
      expect(estimate).toBeLessThanOrEqual(20_000_000n);
    }
  });

  it("refuses counts that are not whole numbers of packs", () => {
    expect(() => feedBackEstimate([-1, 0, 0, 0])).toThrow(RangeError);
    expect(() => feedBackEstimate([0.5, 0, 0, 0])).toThrow(RangeError);
  });

  it("is the same function on its browser-safe subpath", () => {
    expect(subpath.feedBackEstimate).toBe(feedBackEstimate);
    expect(subpath.FEED_BACK_DEFAULT_MIX).toBe(FEED_BACK_DEFAULT_MIX);
  });
});

describe("Feed outlook", () => {
  it("bounds a Dust Card's payout by the cheapest and the dearest pack", () => {
    expect(FEED_BACK_RANGE).toEqual({ min: 2_000_000n, max: 20_000_000n });
  });

  it("puts the most a Dust Card pays against the bag's sold-now value", () => {
    // ≈0.0003 SOL if sold now: up to 66× (0.02 / 0.0003, rounded down).
    expect(feedUpTo(300_000n)).toBe(66);
    expect(feedUpTo(258_000n)).toBe(77);
    expect(feedUpTo(10_000_000n)).toBe(2);
  });

  it("shows no multiple without a value or when feeding pays less than twice selling", () => {
    expect(feedUpTo(null)).toBeNull();
    expect(feedUpTo(0n)).toBeNull();
    expect(feedUpTo(10_000_001n)).toBeNull();
    expect(feedUpTo(3_880_000_000n)).toBeNull();
  });

  it("adds what the bags fetch now, what their cards should pay and the rent back", () => {
    expect(
      feedOutlook([300_000n, null, 2_000_000n], 5_750_000n, 70_000_000n),
    ).toEqual({
      soldNow: 2_300_000n,
      whenPulled: 17_250_000n,
      rentBack: 70_000_000n,
    });
    expect(feedOutlook([], 5_750_000n, 0n)).toEqual({
      soldNow: 0n,
      whenPulled: 0n,
      rentBack: 0n,
    });
  });
});
