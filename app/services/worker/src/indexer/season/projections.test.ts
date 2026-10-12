import { describe, expect, it, vi } from "vitest";
import type { IndexedTransaction } from "../store.js";
import { projectSeasonEvent } from "./projections.js";
const tx: IndexedTransaction = {
  signature: "sig",
  slot: 42n,
  txIndex: 1n,
  blockTime: 100,
  err: null,
  truncated: false,
  events: [],
  accountKeys: [],
  instructions: [],
};

describe("season event mirrors", () => {
  it("keeps distinct fee events from the same transaction with exact u64 amounts", async () => {
    const query = vi.fn<
      (
        text: string,
        values?: unknown[],
      ) => Promise<{ rows: Record<string, unknown>[] }>
    >(async () => ({ rows: [] }));
    const event = {
      name: "CreatorFeesCollected",
      ixIndex: 2n,
      eventIndex: 3n,
      data: {
        regime: 1,
        amount: "18446744073709551615",
        from_fee_in: "18446744073709551615",
        from_wsol: "0",
        to_stock: "9223372036854775808",
        to_burn: "0",
        to_team: "9223372036854775807",
        book: "2000000000",
        target: "30000000000",
        ts: "100",
      },
    };
    await projectSeasonEvent({ query }, tx, event);
    await projectSeasonEvent({ query }, tx, { ...event, eventIndex: 4n });
    expect(query.mock.calls[0]?.[1]).toEqual([
      "sig",
      "42",
      "1",
      "2",
      "3",
      "season",
      "18446744073709551615",
      "18446744073709551615",
      "0",
      "9223372036854775808",
      "0",
      "9223372036854775807",
      "2000000000",
      "30000000000",
      new Date(100000),
    ]);
    expect(query.mock.calls[1]?.[1]?.[4]).toBe("4");
  });
  it("does not replace already verified launch history during event replay", async () => {
    const query = vi.fn<
      (
        text: string,
        values?: unknown[],
      ) => Promise<{ rows: Record<string, unknown>[] }>
    >(async () => ({ rows: [] }));
    await projectSeasonEvent({ query }, tx, {
      name: "PoweredOn",
      ixIndex: 0n,
      eventIndex: 0n,
      data: { mint: "mint", launch_pool: "pool", dev_buy: "40000000000000" },
    });
    expect(query.mock.calls[0]?.[0]).toContain(
      "ON CONFLICT(signature) DO NOTHING",
    );
  });
});
