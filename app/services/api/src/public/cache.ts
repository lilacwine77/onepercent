import { warnCause } from "@onepercent/service-kit";
import { z } from "zod";

export interface PublicCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttl: number): Promise<unknown>;
}
const inflight = new WeakMap<PublicCache, Map<string, Promise<unknown>>>();

/** Age starts before the chain read; slow reads and stale cache hits are rejected. */
interface ReadOptions<T> {
  cache: PublicCache;
  key: string;
  maxAgeMs: number;
  schema: z.ZodType<T>;
  read(): Promise<unknown>;
  now?: () => number;
}

export async function cachedRead<T>(options: ReadOptions<T>): Promise<T> {
  let reads = inflight.get(options.cache);
  if (!reads) {
    reads = new Map();
    inflight.set(options.cache, reads);
  }
  const pending = reads.get(options.key);
  if (pending) return options.schema.parse(await pending);
  const read = load(options);
  reads.set(options.key, read);
  try {
    return await read;
  } finally {
    reads.delete(options.key);
  }
}

async function load<T>(options: ReadOptions<T>): Promise<T> {
  const now = options.now ?? Date.now;
  const envelope = z.object({
    startedAt: z.number().int().safe(),
    value: options.schema,
  });
  try {
    const raw = await options.cache.get(options.key);
    if (raw) {
      const parsed = envelope.safeParse(JSON.parse(raw));
      if (
        parsed.success &&
        now() >= parsed.data.startedAt &&
        now() - parsed.data.startedAt < options.maxAgeMs
      )
        return parsed.data.value;
    }
  } catch (error) {
    warnCause("public_cache_read_failed", error);
    /* Redis failure must not block a fresh chain read. */
  }
  const startedAt = now();
  const value = options.schema.parse(await options.read());
  const elapsed = now() - startedAt;
  if (elapsed < 0 || elapsed >= options.maxAgeMs)
    throw new Error("snapshot_too_old");
  try {
    await options.cache.set(
      options.key,
      JSON.stringify({ startedAt, value }),
      "PX",
      options.maxAgeMs - elapsed,
    );
  } catch (error) {
    warnCause("public_cache_write_failed", error);
    /* The freshly validated chain response is still usable. */
  }
  if (now() < startedAt || now() - startedAt >= options.maxAgeMs)
    throw new Error("snapshot_too_old");
  return value;
}
