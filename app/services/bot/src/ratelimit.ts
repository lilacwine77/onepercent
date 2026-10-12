import { ExpiringMap, MEMORY_ENTRY_LIMIT } from "./memory.js";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
export interface RateRule {
  name: string;
  limit: number;
  windowMs: number;
}
export interface RateLimiter {
  consume(
    key: string,
    rule: RateRule,
  ): { ok: true } | { ok: false; retryAfterS: number };
}
// TODO(Redis): share counters across bot replicas.
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows: ExpiringMap<
    string,
    { count: number; until: number }
  >;
  constructor(
    private readonly clock: Pick<Clock, "now">,
    maxEntries = MEMORY_ENTRY_LIMIT,
  ) {
    this.windows = new ExpiringMap(() => clock.now(), maxEntries);
  }
  consume(
    key: string,
    rule: RateRule,
  ): { ok: true } | { ok: false; retryAfterS: number } {
    const now = this.clock.now();
    const id = `${rule.name}:${key}`;
    const state = this.windows.get(id) ?? {
      count: 0,
      until: now + rule.windowMs,
    };
    if (!this.windows.set(id, state, state.until))
      return { ok: false, retryAfterS: 1 };
    if (state.count >= rule.limit)
      return {
        ok: false,
        retryAfterS: Math.max(1, Math.ceil((state.until - now) / 1000)),
      };
    state.count++;
    return { ok: true };
  }
}
