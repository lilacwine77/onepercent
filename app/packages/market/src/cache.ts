import { defaultClock, type Clock } from "./clock.js";
import { MarketError } from "./errors.js";
import { CACHE_MAX_ENTRIES } from "./params.js";

export interface TtlCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Entry {
  json: string;
  expiresAtMs: number;
}

export class InMemoryTtlCache implements TtlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly clock: Clock;
  private readonly maxEntries: number;

  constructor(options: Clock | { clock?: Clock; maxEntries?: number } = {}) {
    this.clock = "nowMs" in options ? options : (options.clock ?? defaultClock);
    this.maxEntries =
      "nowMs" in options
        ? CACHE_MAX_ENTRIES
        : (options.maxEntries ?? CACHE_MAX_ENTRIES);
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new MarketError("INVALID_INPUT", {
        message: "Cache capacity must be a positive integer",
      });
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAtMs <= this.clock.nowMs()) return undefined;
    this.entries.set(key, entry);
    return JSON.parse(entry.json) as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new MarketError("INVALID_INPUT", { message: "Invalid cache TTL" });
    }
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      throw new MarketError("INVALID_INPUT", {
        message: "Cache values must be JSON safe",
      });
    }
    if (json === undefined) {
      throw new MarketError("INVALID_INPUT", {
        message: "Cache values must be JSON safe",
      });
    }
    this.entries.delete(key);
    this.entries.set(key, { json, expiresAtMs: this.clock.nowMs() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
