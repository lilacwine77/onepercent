import { BOT_OPS } from "@onepercent/config";
import {
  hashClientIp,
  SlidingWindowLimiter,
  warnCause,
} from "@onepercent/service-kit";
import { randomBytes } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP } from "node:net";
import type { Context } from "hono";
import type { Clock } from "./store.js";

export interface RateRule {
  limit: number;
  windowMs: number;
}
export type RateResult = { ok: true } | { ok: false; retryAfterS: number };
export interface LinkRateLimiter {
  consume(
    key: string,
    rule: RateRule,
    count?: number,
  ): RateResult | Promise<RateResult>;
}
export const LINK_LIMITS = {
  nonce: {
    limit: BOT_OPS.apiLimits.linkNoncesPerUserPer600s,
    windowMs: 600_000,
  },
  session: {
    limit: BOT_OPS.apiLimits.linkSessionPerIpPer60s,
    windowMs: 60_000,
  },
  verify: { limit: BOT_OPS.apiLimits.linkVerifyPerIpPer60s, windowMs: 60_000 },
} as const;
export const MAX_RATE_LIMIT_ENTRIES = 10_000;

export class InMemoryLinkRateLimiter implements LinkRateLimiter {
  private readonly windows = new Map<
    string,
    { timestamps: number[]; expiresAt: number }
  >();
  private lastCleanup = -Infinity;
  constructor(
    private readonly clock: Clock = Date.now,
    private readonly maxEntries = MAX_RATE_LIMIT_ENTRIES,
  ) {}
  consume(key: string, rule: RateRule, count = 1): RateResult {
    const now = this.clock();
    if (now - this.lastCleanup >= 1_000) {
      this.lastCleanup = now;
      for (const [storedKey, entry] of this.windows)
        if (entry.expiresAt <= now) this.windows.delete(storedKey);
    }
    const current = this.windows.get(key);
    if (current && current.expiresAt <= now) this.windows.delete(key);
    if (!this.windows.has(key) && this.windows.size >= this.maxEntries)
      return { ok: false, retryAfterS: 1 };
    const timestamps = (this.windows.get(key)?.timestamps ?? []).filter(
      (time) => time > now - rule.windowMs,
    );
    if (timestamps.length + count > rule.limit)
      return {
        ok: false,
        retryAfterS: Math.max(
          1,
          Math.ceil(((timestamps[0] ?? now) + rule.windowMs - now) / 1_000),
        ),
      };
    timestamps.push(...Array<number>(count).fill(now));
    this.windows.set(key, { timestamps, expiresAt: now + rule.windowMs });
    return { ok: true };
  }
}

function normalizeIp(address: string): string {
  return address.toLowerCase().startsWith("::ffff:") &&
    isIP(address.slice(7)) === 4
    ? address.slice(7)
    : address.toLowerCase();
}
export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeIp(address);
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return (
    isIP(normalized) === 6 &&
    (normalized === "::1" ||
      /^(fc|fd)/.test(normalized) ||
      /^fe[89ab]/.test(normalized))
  );
}
// Enable only for a header overwritten by the deployment's trusted proxy.
export function requestIp(context: Context, trustedHeader?: string): string {
  if (trustedHeader) {
    const forwarded = context.req.header(trustedHeader)?.split(",")[0]?.trim();
    if (forwarded && isIP(forwarded)) return normalizeIp(forwarded);
  }
  try {
    return normalizeIp(getConnInfo(context).remote.address ?? "unknown");
  } catch (error) {
    warnCause("link_client_ip_unavailable", error);
    return "unknown";
  }
}

export class RedisLinkRateLimiter implements LinkRateLimiter {
  constructor(private readonly limiter: SlidingWindowLimiter) {}
  async consume(key: string, rule: RateRule, count = 1): Promise<RateResult> {
    // Each id reserves one shared token. A refused batch conservatively keeps
    // earlier reservations; it creates no session and cannot exceed the cap.
    for (let i = 0; i < count; i++) {
      const result = await this.limiter.limit(
        `m5:${key}`,
        rule.limit,
        rule.windowMs / 1_000,
      );
      if (!result.ok) return { ok: false, retryAfterS: result.retryAfterS };
    }
    return { ok: true };
  }
}
const localIpSalt = randomBytes(32).toString("hex");
export function clientIpKey(
  context: Context,
  deps: { trustProxyHeader?: string; ipSalt?: string },
): string {
  return hashClientIp(
    deps.ipSalt ?? localIpSalt,
    requestIp(context, deps.trustProxyHeader),
  );
}
