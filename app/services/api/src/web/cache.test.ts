import { MARKET } from "@onepercent/config";
import { describe, expect, it, vi } from "vitest";
import {
  cacheExitCaps,
  cacheMetadata,
  WEB_SOURCE_CACHE_MAX_ENTRIES,
} from "./cache.js";
const token = { name: "Token", symbol: "T", decimals: 6 };
describe("web provider caches", () => {
  it("batches missing metadata and deduplicates overlapping mints until TTL expiry", async () => {
    let now = 0;
    const load = vi.fn(async (mints: string[]) =>
      Object.fromEntries(
        mints.map((mint) => [mint, mint === "missing" ? undefined : token]),
      ),
    );
    const metadata = cacheMetadata(load, () => now);
    expect(
      await Promise.all([metadata(["a", "b"]), metadata(["b", "c"])]),
    ).toEqual([
      { a: token, b: token },
      { b: token, c: token },
    ]);
    expect(load.mock.calls).toEqual([[["a", "b"]], [["c"]]]);
    await metadata(["a", "b", "c", "missing"]);
    await metadata(["missing"]);
    expect(load).toHaveBeenCalledTimes(3);
    now = MARKET.price.cacheTtlMs;
    await metadata(["a"]);
    expect(load).toHaveBeenCalledTimes(4);
  });
  it("deduplicates reserve reads for one slot-cache interval and retries failures", async () => {
    let now = 0;
    const cap = { kind: "none" } as const;
    const load = vi.fn(async () => cap);
    const read = cacheExitCaps(load, () => now);
    await Promise.all([read("a"), read("a")]);
    await read("a");
    expect(load).toHaveBeenCalledTimes(1);
    now = MARKET.rpc.slotCacheMs;
    load.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(read("a")).rejects.toThrow("Unavailable");
    expect(await read("a")).toEqual(cap);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("does not cache metadata provider errors", async () => {
    const load = vi
      .fn(async () => ({ a: token }))
      .mockRejectedValueOnce(new Error("Unavailable"));
    const metadata = cacheMetadata(load);
    await expect(metadata(["a"])).rejects.toThrow("Unavailable");
    expect(await metadata(["a"])).toEqual({ a: token });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("evicts least recently used metadata at the bounded entry capacity", async () => {
    const load = vi.fn(async (mints: string[]) =>
      Object.fromEntries(mints.map((mint) => [mint, token])),
    );
    const metadata = cacheMetadata(load, () => 0);
    const mints = Array.from(
      { length: WEB_SOURCE_CACHE_MAX_ENTRIES },
      (_, index) => String(index),
    );
    await metadata(mints);
    await metadata(["0"]);
    await metadata(["extra"]);
    await metadata(["0"]);
    expect(load).toHaveBeenCalledTimes(2);
    await metadata(["1"]);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
