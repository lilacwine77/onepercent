import type { Clock } from "../clock.js";
import { MARKET, MILLISECONDS_PER_SECOND } from "../params.js";

export function retryDelayMs(attempt: number, clock: Clock): number {
  return (
    clock.random() *
    Math.min(MARKET.http.backoffMaxMs, MARKET.http.backoffBaseMs * 2 ** attempt)
  );
}

export function rateLimitDelayMs(
  reset: string | null,
  clock: Clock,
): number | undefined {
  if (reset === null || reset.trim() === "") return undefined;
  const resetSeconds = Number(reset);
  if (!Number.isFinite(resetSeconds)) return undefined;
  return Math.min(
    MARKET.http.rateLimitWaitMaxMs,
    Math.max(0, resetSeconds * MILLISECONDS_PER_SECOND - clock.nowMs()),
  );
}
