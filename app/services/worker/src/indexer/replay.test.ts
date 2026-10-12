import { describe, expect, it, vi } from "vitest";
import { replayIndexer } from "./replay.js";
import { IndexerStore } from "./store.js";
import { MIRROR_TABLES } from "./projections.js";

function setup() {
  const client = {
    query: vi.fn<(sql: string) => Promise<{ rows: Record<string, unknown>[] }>>(
      async () => ({ rows: [] }),
    ),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => client),
  };
  const store = new IndexerStore(pool, {
    programId: "program",
    royaltyPerDustCardBps: 137,
  });
  vi.spyOn(store, "replay").mockResolvedValue(undefined);
  const reconciler = {
    reconcile: vi.fn(async () => undefined),
    reconcileDeck: vi.fn(async () => undefined),
  };
  return { store, pool, client, reconciler };
}

describe("offline replay hashes", () => {
  it("sets UTC on the same session used to hash every mirror", async () => {
    const x = setup();
    const result = await replayIndexer({
      store: x.store,
      reconciler: x.reconciler,
      argv: ["--from-slot", "42"],
    });
    expect(result.fromSlot).toBe("42");
    expect(Object.keys(result.hashes)).toEqual([...MIRROR_TABLES]);
    expect(x.store.replay).toHaveBeenCalledWith(42n);
    expect(x.pool.connect).toHaveBeenCalledOnce();
    expect(x.pool.query).not.toHaveBeenCalled();
    expect(x.client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "SET TIME ZONE 'UTC'",
      ...MIRROR_TABLES.map(
        (table) =>
          `SELECT to_jsonb(t)::text AS data FROM ${table} t ORDER BY to_jsonb(t)::text`,
      ),
    ]);
    expect(x.client.release).toHaveBeenCalledOnce();
  });

  it("releases the hash session when its query fails", async () => {
    const x = setup();
    const failure = new Error("hash_query_failed");
    x.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(failure);
    await expect(
      replayIndexer({
        store: x.store,
        reconciler: x.reconciler,
        argv: ["--from-slot", "0"],
      }),
    ).rejects.toBe(failure);
    expect(x.client.release).toHaveBeenCalledOnce();
  });
});
