import { STOCK } from "@onepercent/config";
import { u64, U64_MAX } from "../bytes.js";
import { BUCKET_CLASS, FINAL_CLAIM_FLAGS } from "../constants.js";
import type { Binder, Machine } from "../layouts.js";

/** Floor shares never distribute the indivisible remainder. */
export function finalShare(pool: bigint, spend: bigint, total: bigint): bigint {
  u64(pool);
  u64(spend);
  u64(total);
  if (total === 0n) return 0n;
  const share = (pool * spend) / total;
  return share > U64_MAX ? U64_MAX : share;
}

/** Remaining claimable shares, including claimed bits and on-chain pool caps. */
export function finalShares(
  machine: Pick<
    Machine,
    | "final_sol_total"
    | "final_pool_sol"
    | "final_1pct_total"
    | "final_pool_1pct"
    | "total_spend"
    | "buckets"
  >,
  binder: Pick<Binder, "season_spend" | "flags">,
): { sol: bigint; onePct: bigint; buckets: bigint[] } {
  const capped = (pool: bigint, remaining: bigint): bigint => {
    const share = finalShare(pool, binder.season_spend, machine.total_spend);
    return share < remaining ? share : remaining;
  };
  const tokensClaimed = (binder.flags & FINAL_CLAIM_FLAGS.tokens) !== 0;
  return {
    sol:
      binder.flags & FINAL_CLAIM_FLAGS.sol
        ? 0n
        : capped(machine.final_sol_total, machine.final_pool_sol),
    onePct: tokensClaimed
      ? 0n
      : capped(machine.final_1pct_total, machine.final_pool_1pct),
    buckets: Array.from({ length: STOCK.maxBuckets }, (_, index) => {
      const bucket = machine.buckets[index];
      return tokensClaimed || !bucket || bucket.class === BUCKET_CLASS.empty
        ? 0n
        : capped(bucket.final_pool, bucket.amount);
    }),
  };
}
