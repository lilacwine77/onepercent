import { describe, expect, it, vi } from "vitest";
import { RpcError, RpcUnavailable } from "@onepercent/service-kit";
import {
  IndexerStore,
  isDeterministicTransactionError,
  type SqlPool,
} from "./store.js";
import { feedProofFixture } from "./feed-proof.test-data.mjs";

describe("durable transaction processing failures", () => {
  it.each([
    "invalid_buy_packs_data",
    "feed_recovery_invalid",
    "indexer_out_of_order",
    "invalid_event_integer",
  ])("classifies %s as deterministic", (reason) => {
    expect(isDeterministicTransactionError(new Error(reason))).toBe(true);
  });

  it("keeps RPC and database failures retryable", () => {
    for (const error of [
      new RpcUnavailable(),
      new RpcError(-32005),
      Object.assign(new Error("statement timeout"), { code: "57014" }),
      Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
      new Error("database unavailable"),
      new TypeError("fetch failed"),
    ])
      expect(isDeterministicTransactionError(error)).toBe(false);
  });

  it("retains unprocessable transaction events as incomplete and excludes it from applied lag", async () => {
    const { tx, options } = feedProofFixture();
    tx.events = [
      { name: "BagFed", ixIndex: 2n, eventIndex: 0n, data: { mint: "mint" } },
    ];
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes("MAX(t.slot)") ? [{ slot: "7" }] : [],
    }));
    const release = vi.fn();
    const pool = {
      query,
      connect: async () => ({ query, release }),
    } as unknown as SqlPool;
    const alert = vi.fn().mockResolvedValue(undefined);
    const store = new IndexerStore(pool, {
      programId: options.programId,
      royaltyPerDustCardBps: 200,
      alert,
    });
    await store.recordUnprocessable(tx, new Error("indexer_out_of_order"));
    expect(tx.truncated).toBe(true);
    const calls = vi.mocked(pool.query).mock.calls;
    expect(
      calls.find(([sql]) => sql.includes("INSERT INTO cursors"))?.[1],
    ).toEqual([
      `indexer:unprocessable:${tx.signature}`,
      tx.signature,
      String(tx.slot),
    ]);
    const data = calls.find(([sql]) =>
      sql.includes("INSERT INTO chain_events"),
    )?.[1]?.[6];
    expect(JSON.parse(String(data))).toMatchObject({
      _indexer: { incompleteReason: "indexer_out_of_order" },
    });
    expect(alert).toHaveBeenCalledWith("indexer_tx_unprocessable", {
      signature: tx.signature,
      slot: "10",
      reason: "indexer_out_of_order",
    });
    expect(release).toHaveBeenCalledOnce();
    expect(await store.lastAppliedSlot()).toBe(7n);
    expect(
      calls.some(
        ([sql]) =>
          sql.includes("NOT EXISTS") && sql.includes("indexer:unprocessable:"),
      ),
    ).toBe(true);
  });
});
