import { createHash } from "node:crypto";
export const WEB_LIMITER_MAX_IPS = 10_000;
const WINDOW_MS = 60_000;
interface Bucket {
  entries: { count: number; at: number }[];
  lastAcceptedAt: number;
}
export class ItemLimiter {
  // In insertion order of the last accepted request, so expiry examines only the oldest prefix.
  private readonly windows = new Map<string, Bucket>();
  constructor(
    private readonly maximum: number,
    private readonly now: () => number = Date.now,
  ) {}
  take(ip: string, count = 1): { allowed: boolean; retryAfter: number } {
    const now = this.now();
    for (;;) {
      const first = this.windows.entries().next().value;
      if (!first || first[1].lastAcceptedAt > now - WINDOW_MS) break;
      this.windows.delete(first[0]);
    }
    const key = createHash("sha256").update(ip).digest("hex");
    const entries = (this.windows.get(key)?.entries ?? []).filter(
      (entry) => entry.at > now - WINDOW_MS,
    );
    const used = entries.reduce((total, entry) => total + entry.count, 0);
    if (
      used + count > this.maximum ||
      (!this.windows.has(key) && this.windows.size >= WEB_LIMITER_MAX_IPS)
    ) {
      let available = this.maximum - used;
      let until = now + WINDOW_MS;
      for (const entry of entries) {
        available += entry.count;
        until = entry.at + WINDOW_MS;
        if (available >= count) break;
      }
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((until - now) / 1_000)),
      };
    }
    entries.push({ count, at: now });
    this.windows.delete(key);
    this.windows.set(key, { entries, lastAcceptedAt: now });
    return { allowed: true, retryAfter: 0 };
  }
}
