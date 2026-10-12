import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cachedRead } from "./cache.js";

describe("snapshot single-flight", () => {
  it("shares concurrent misses, then releases failed and completed reads", async () => {
    const cache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => "OK"),
    };
    let complete!: (value: number) => void;
    const read = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    );
    const options = {
      cache,
      key: "machine",
      schema: z.number(),
      maxAgeMs: 2000,
      read,
    };
    const pending = Array.from({ length: 30 }, () => cachedRead(options));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    complete(7);
    expect(await Promise.all(pending)).toEqual(Array(30).fill(7));
    read.mockRejectedValueOnce(new Error("offline"));
    await expect(cachedRead(options)).rejects.toThrow("offline");
    read.mockResolvedValueOnce(8);
    expect(await cachedRead(options)).toBe(8);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("does not share snapshots between independent runtime caches", async () => {
    const read = vi.fn(async () => 7);
    await Promise.all(
      Array.from({ length: 2 }, () =>
        cachedRead({
          cache: { get: async () => null, set: async () => "OK" },
          key: "machine",
          schema: z.number(),
          maxAgeMs: 2000,
          read,
        }),
      ),
    );
    expect(read).toHaveBeenCalledTimes(2);
  });
});
