import { MARKET } from "@onepercent/config";
import type { ValueExitCap } from "@onepercent/market";
import type { TokenMetadata } from "./values.js";
export const WEB_SOURCE_CACHE_MAX_ENTRIES = 5_000;
class Cache<T> {
  private readonly entries = new Map<string, { until: number; value: T }>();
  constructor(
    private readonly ttl: number,
    private readonly now: () => number,
  ) {}
  get(key: string): { value: T } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.until <= this.now()) {
      this.entries.delete(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }
  set(key: string, value: T) {
    this.entries.delete(key);
    if (this.entries.size >= WEB_SOURCE_CACHE_MAX_ENTRIES)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, until: this.now() + this.ttl });
  }
}
/** Keeps provider batching while deduplicating overlapping requests by mint. */
export function cacheMetadata(
  load: (mints: string[]) => Promise<Record<string, TokenMetadata | undefined>>,
  now: () => number = Date.now,
) {
  const cache = new Cache<TokenMetadata | undefined>(
    MARKET.price.cacheTtlMs,
    now,
  );
  const pending = new Map<string, Promise<TokenMetadata | undefined>>();
  return async (
    mints: string[],
  ): Promise<Record<string, TokenMetadata | undefined>> => {
    const result: Record<string, TokenMetadata | undefined> = {};
    const missing: string[] = [];
    const waiting = new Map<string, Promise<TokenMetadata | undefined>>();
    for (const mint of new Set(mints)) {
      const hit = cache.get(mint);
      if (hit) result[mint] = hit.value;
      else if (pending.has(mint)) waiting.set(mint, pending.get(mint)!);
      else missing.push(mint);
    }
    if (missing.length) {
      const batch = Promise.resolve().then(() => load(missing));
      for (const mint of missing) {
        const work = batch
          .then((tokens) => {
            const value = tokens[mint];
            cache.set(mint, value);
            return value;
          })
          .finally(() => pending.delete(mint));
        pending.set(mint, work);
        waiting.set(mint, work);
      }
    }
    await Promise.all(
      [...waiting].map(async ([mint, work]) => {
        result[mint] = await work;
      }),
    );
    return result;
  };
}
/** Failed reads are never cached as valid zero reserves. */
export function cacheExitCaps(
  load: (mint: string) => Promise<ValueExitCap>,
  now: () => number = Date.now,
) {
  const cache = new Cache<ValueExitCap>(MARKET.rpc.slotCacheMs, now);
  const pending = new Map<string, Promise<ValueExitCap>>();
  return (mint: string): Promise<ValueExitCap> => {
    const hit = cache.get(mint);
    if (hit) return Promise.resolve(hit.value);
    const active = pending.get(mint);
    if (active) return active;
    const work = Promise.resolve()
      .then(() => load(mint))
      .then((value) => {
        cache.set(mint, value);
        return value;
      })
      .finally(() => pending.delete(mint));
    pending.set(mint, work);
    return work;
  };
}
