import {
  HIT_LIST,
  KEEPER_POLICY,
  POST_REVEAL_BUY_DELAY,
  SELL_BACK,
} from "@onepercent/config";
import type { Machine } from "../layouts.js";

export type StockBuyGuardError =
  | "StockBuyPullInFlight"
  | "StockBuyRevealDelay"
  | "StockBuyListingNotice"
  | "StockBuyReserve"
  | "BucketInvalid";
const I64_MAX = (1n << 63n) - 1n;

/** Mirrors the four additional exec_begin guards, not the other exec checks.
 * A passing snapshot cannot replace the execution-time on-chain check.
 */
export function stockBuyGuard(
  m: Machine,
  bucket: number,
  amount: bigint,
  now: bigint,
): StockBuyGuardError | null {
  if (
    (m.keeper_history_version !== 1n && m.last_reveal_ts === 0n) ||
    m.pending_pulls !== 0n ||
    m.unsettled_reveals !== 0n
  )
    return "StockBuyPullInFlight";
  const revealDeadline = m.last_reveal_ts + BigInt(POST_REVEAL_BUY_DELAY);
  if (revealDeadline > I64_MAX || now < revealDeadline)
    return "StockBuyRevealDelay";
  const b = m.buckets[bucket],
    h = m.bucket_history[bucket];
  if (!b || !h) return "BucketInvalid";
  if (b.class === 2) {
    const listedDeadline = h.listed_ts + BigInt(HIT_LIST.trendingNoticeSeconds);
    if (listedDeadline > I64_MAX || now < listedDeadline)
      return "StockBuyListingNotice";
  }
  if (now < 0n || m.keeper_history_version > 2n) return "StockBuyReserve";
  const hour = now / 3600n,
    start = now - BigInt(KEEPER_POLICY.solReserveExtraMinutes * 60);
  if (hour < m.hour_index) return "StockBuyReserve";
  if (
    m.phase !== 2 &&
    m.keeper_history_version === 0n &&
    hour === m.hour_index &&
    start < hour * 3600n
  )
    return "StockBuyReserve";
  const [current, previous] =
    hour === m.hour_index
      ? [m.sb_paid_hour, m.sb_paid_prev_hour]
      : hour === m.hour_index + 1n
        ? [0n, m.sb_paid_hour]
        : [0n, 0n];
  const reserve =
    SELL_BACK.solFloorLamports +
    current +
    (start < hour * 3600n ? previous : 0n);
  return m.stock_sol - amount >= reserve ? null : "StockBuyReserve";
}
