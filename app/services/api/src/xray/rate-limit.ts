import { timingSafeEqual } from "node:crypto";
import { XRAY } from "@onepercent/eligibility";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfter: number;
}
export interface RateLimiter {
  take(ip: string): RateLimitResult;
}
export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private nextCleanupAt = 0;
  constructor(
    private readonly limit: number = XRAY.rateLimitPerMinutePerIp,
    private readonly now: () => number = Date.now,
  ) {}
  take(ip: string): RateLimitResult {
    const now = this.now();
    // Bound full-map cleanup to once a second; the current bucket is always filtered.
    if (now >= this.nextCleanupAt) {
      this.nextCleanupAt = now + 1_000;
      for (const [key, timestamps] of this.windows)
        if ((timestamps.at(-1) ?? 0) <= now - 60_000) this.windows.delete(key);
    }
    const timestamps = (this.windows.get(ip) ?? []).filter(
      (time) => time > now - 60_000,
    );
    if (timestamps.length >= this.limit)
      return {
        allowed: false,
        count: timestamps.length + 1,
        retryAfter: Math.max(
          1,
          Math.ceil(((timestamps[0] ?? now) + 60_000 - now) / 1000),
        ),
      };
    timestamps.push(now);
    this.windows.set(ip, timestamps);
    return { allowed: true, count: timestamps.length, retryAfter: 0 };
  }
}
export function isBotAuthorized(
  header: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
