export const MEMORY_ENTRY_LIMIT = 10_000;
export const MEMORY_CLEANUP_INTERVAL_MS = 1_000;

// Operational bounds only. Active entries are never evicted to make room.
export class ExpiringMap<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private lastCleanup = -Infinity;
  constructor(
    private readonly now: () => number,
    private readonly maxEntries = MEMORY_ENTRY_LIMIT,
  ) {}

  get(key: K): V | undefined {
    const now = this.now();
    this.cleanup(now);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, expiresAt: number): boolean {
    this.cleanup(this.now());
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries)
      return false;
    this.entries.set(key, { value, expiresAt });
    return true;
  }

  private cleanup(now: number): void {
    if (now - this.lastCleanup < MEMORY_CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;
    for (const [key, entry] of this.entries)
      if (entry.expiresAt <= now) this.entries.delete(key);
  }
}
