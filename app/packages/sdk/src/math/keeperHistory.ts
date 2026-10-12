import type { Machine } from "../layouts.js";
import { rotateHour } from "./index.js";

const MAX = (1n << 64n) - 1n;

/** Read-only upper bounds; null means the requested history cannot be proved.
 * Pass the raw Machine and a Clock from the same coherent chain observation.
 * A MAX inflow is a saturation sentinel, not an exact amount.
 */
export function keeperWindowBounds(
  machine: Machine,
  now: bigint,
  windowSeconds: bigint,
): { payouts: bigint; inflows: bigint[] } | null {
  if (
    machine.keeper_history_version > 2n ||
    windowSeconds <= 0n ||
    windowSeconds > 3600n ||
    now - windowSeconds <= machine.keeper_history_started_ts ||
    now < 0n ||
    machine.hour_index > now / 3600n
  )
    return null;
  const m = rotateHour(machine, now);
  if (m.keeper_history_version !== 1n) return null;
  const previous = now - windowSeconds < (now / 3600n) * 3600n;
  const inflows: bigint[] = [];
  for (const h of m.bucket_history) {
    if (h.sb_inflow_hour === MAX || (previous && h.sb_inflow_prev_hour === MAX))
      return null;
    inflows.push(h.sb_inflow_hour + (previous ? h.sb_inflow_prev_hour : 0n));
  }
  return {
    payouts: m.sb_paid_hour + (previous ? m.sb_paid_prev_hour : 0n),
    inflows,
  };
}
