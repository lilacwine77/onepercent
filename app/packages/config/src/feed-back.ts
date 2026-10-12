// The Feed back estimate: one number for "what this Dust Card pays when it's pulled".
import { PACK_EDITIONS, PACK_SPLIT_BPS } from "./constants.js";

/**
 * The edition mix the estimate falls back to without recent pulls, and the one the
 * preview's demo uses: of 100 packs opened, 50 The Original, 25 Blue Shift,
 * 15 Signature and 10 After Hours (PACK_EDITIONS order). At today's prices it puts
 * the estimate at ≈0.00575 SOL.
 */
export const FEED_BACK_DEFAULT_MIX = [50, 25, 15, 10] as const;

/**
 * What one fed-back Dust Card pays when a pack pulls it, in lamports: the royalty
 * (PACK_SPLIT_BPS.royaltyPerDustCard, 2%) of the price of the pack that pulls it,
 * weighted by the edition mix. Every pack draws four Dust Cards, so a card's
 * chance to be pulled by an edition is that edition's share of the packs opened.
 *
 * `mix`: packs opened per edition, in PACK_EDITIONS order (any scale). An empty or
 * all-zero mix uses FEED_BACK_DEFAULT_MIX.
 */
export function feedBackEstimate(mix: readonly number[]): bigint {
  const weights = PACK_EDITIONS.map((_, index) => {
    const value = mix[index] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError("The edition mix takes counts of packs.");
    return BigInt(value);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total === 0n) return feedBackEstimate(FEED_BACK_DEFAULT_MIX);
  const weighted = PACK_EDITIONS.reduce(
    (sum, edition, index) => sum + weights[index]! * edition.priceLamports,
    0n,
  );
  return (
    (weighted * BigInt(PACK_SPLIT_BPS.royaltyPerDustCard)) / (total * 10_000n)
  );
}

const royalty = (priceLamports: bigint) =>
  (priceLamports * BigInt(PACK_SPLIT_BPS.royaltyPerDustCard)) / 10_000n;

const prices: bigint[] = PACK_EDITIONS.map((edition) => edition.priceLamports);

/**
 * What one Dust Card can pay when it's pulled: the royalty of the cheapest pack
 * (the floor) and of the dearest one (the most), in lamports.
 */
export const FEED_BACK_RANGE = {
  min: royalty(prices.reduce((low, price) => (price < low ? price : low))),
  max: royalty(prices.reduce((high, price) => (price > high ? price : high))),
} as const;

/**
 * "Up to N×": how many times a bag's sold-now value the most a Dust Card can pay
 * when it's pulled, rounded down. Null without a sold-now value, or when feeding
 * pays less than twice selling (no multiple worth showing).
 */
export function feedUpTo(soldNowLamports: bigint | null): number | null {
  if (soldNowLamports === null || soldNowLamports <= 0n) return null;
  const times = FEED_BACK_RANGE.max / soldNowLamports;
  return times >= 2n ? Number(times) : null;
}

/**
 * The outlook of feeding bags, in lamports: what they would fetch if sold now
 * (bags without a value count nothing), what they are expected to pay when their
 * Dust Cards are pulled (one card per bag, at the edition-mix estimate), and the
 * rent of the emptied token accounts, paid back at once in the Feed transaction.
 */
export function feedOutlook(
  soldNowLamports: readonly (bigint | null)[],
  estimateLamports: bigint,
  rentBackLamports: bigint,
) {
  return {
    soldNow: soldNowLamports.reduce<bigint>(
      (sum, value) => sum + (value ?? 0n),
      0n,
    ),
    whenPulled: estimateLamports * BigInt(soldNowLamports.length),
    rentBack: rentBackLamports,
  };
}
