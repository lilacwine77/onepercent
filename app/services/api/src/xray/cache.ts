import { XRAY_CACHE_MAX_ENTRIES } from "@onepercent/eligibility";

export interface CacheStore<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlS: number): void;
}

export class MemoryCache<T> implements CacheStore<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();
  constructor(
    private readonly maxEntries: number = XRAY_CACHE_MAX_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, ttlS: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + ttlS * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
