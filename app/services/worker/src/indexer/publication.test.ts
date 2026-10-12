import { describe, expect, it, vi } from "vitest";
import { EventPublisher } from "./publication.js";
import type { SqlExecutor } from "./store.js";
import type { StreamEvent } from "@onepercent/service-kit";

function setup() {
  const cursors = new Map<string, string | null>();
  const rows = [0, 1, 2].map((n) => ({
    signature: `sig${n}`,
    slot: "100",
    tx_index: String(n),
    ix_index: "0",
    event_index: "0",
    name: "BagFed",
    data: { amount: "18446744073709551615", _indexer: { holder: "private" } },
  }));
  const pool: SqlExecutor = {
    query: vi.fn(async (text, values) => {
      if (text.startsWith("SELECT name"))
        return {
          rows: cursors.has("indexer:stream-reset")
            ? [{ name: "indexer:stream-reset" }]
            : [],
        };
      if (text.startsWith("SELECT last_signature"))
        return {
          rows: cursors.has("indexer:published")
            ? [{ last_signature: cursors.get("indexer:published") }]
            : [],
        };
      if (text.startsWith("SELECT e.slot"))
        return {
          rows: rows
            .filter(
              (row) => !cursors.has(`indexer:unprocessable:${row.signature}`),
            )
            .slice()
            .reverse()
            .slice(Number(values?.[0]), Number(values?.[0]) + 1),
        };
      if (text.startsWith("SELECT e.*"))
        return {
          rows: rows
            .filter(
              (row) => !cursors.has(`indexer:unprocessable:${row.signature}`),
            )
            .filter(
              (r) =>
                BigInt(r.slot) > BigInt(String(values?.[0])) ||
                (BigInt(r.slot) === BigInt(String(values?.[0])) &&
                  BigInt(r.tx_index) > BigInt(String(values?.[1]))),
            )
            .slice(0, Number(values?.[4])),
        };
      if (text.startsWith("DELETE")) {
        cursors.delete(
          text.includes("published")
            ? "indexer:published"
            : "indexer:stream-reset",
        );
        return { rows: [] };
      }
      if (text.includes("INSERT INTO cursors")) {
        cursors.set(
          text.includes("published")
            ? "indexer:published"
            : "indexer:stream-reset",
          values?.[0] === undefined ? null : String(values[0]),
        );
        return { rows: [] };
      }
      throw new Error(text);
    }),
  };
  const delivered: StreamEvent[] = [];
  const stream = {
    publish: vi.fn(async (event: StreamEvent) => {
      delivered.push(event);
    }),
  };
  const recovery = {
    clear: vi.fn(async () => {
      delivered.length = 0;
    }),
    exists: vi.fn(async () => true),
  };
  return {
    pool,
    cursors,
    rows,
    stream,
    recovery,
    delivered,
    publisher: new EventPublisher(pool, stream, 2, recovery),
  };
}
describe("durable event outbox", () => {
  it("orders the internal Block-0 notice after its scanned slot and before subsequent program events", async () => {
    const x = setup();
    Object.assign(x.rows[2]!, {
      name: "IndexerBlock0Ready",
      tx_index: "4294967295",
      ix_index: "-1",
      event_index: "4294967295",
      data: {},
    });
    await x.publisher.flush();
    expect(x.delivered.at(-1)).toEqual({
      id: "100-4294967295-4294967295",
      event: "block0",
      data: { name: "IndexerBlock0Ready", signature: "sig2", asOfSlot: "100" },
    });
    x.rows.push({
      ...x.rows[0]!,
      signature: "next",
      slot: "101",
      tx_index: "0",
    });
    await x.publisher.flush();
    expect(x.delivered.at(-1)?.id).toBe("101-0-0");
    expect(x.delivered).toHaveLength(4);
  });
  it("keeps recovered instruction evidence private while advancing the outbox", async () => {
    const x = setup();
    x.rows[1]!.name = "IndexerFeedRecovered";
    x.rows[1]!.event_index = "-1";
    await x.publisher.flush();
    expect(x.delivered.map((event) => event.id)).toEqual([
      "100-0-0",
      "100-2-0",
    ]);
    expect(x.cursors.get("indexer:published")).toBe("100:2:0:0");
  });
  it("publishes compact confirmed event data in order and resumes its checkpoint", async () => {
    const x = setup();
    await x.publisher.flush();
    await x.publisher.flush();
    expect(x.delivered.map((e) => e.id)).toEqual([
      "100-0-0",
      "100-1-0",
      "100-2-0",
    ]);
    expect(x.delivered[0]?.data).toEqual({
      amount: "18446744073709551615",
      name: "BagFed",
      signature: "sig0",
      asOfSlot: "100",
    });
    expect(x.cursors.get("indexer:published")).toBe("100:2:0:0");
  });
  it("does not advance the checkpoint when Redis fails", async () => {
    const x = setup();
    x.stream.publish.mockRejectedValueOnce(new Error("offline"));
    await expect(x.publisher.flush()).rejects.toThrow("offline");
    expect(x.cursors.has("indexer:published")).toBe(false);
    await x.publisher.flush();
    expect(x.delivered).toHaveLength(3);
  });
  it("rebuilds lower/same IDs after a fork; interruption retains a restart marker", async () => {
    const x = setup();
    await x.publisher.flush();
    x.cursors.set("indexer:stream-reset", null);
    x.rows[0]!.signature = "replacement";
    x.rows.splice(1);
    x.stream.publish.mockRejectedValueOnce(new Error("offline"));
    await expect(x.publisher.flush()).rejects.toThrow();
    expect(x.cursors.has("indexer:stream-reset")).toBe(true);
    await x.publisher.flush();
    expect(x.recovery.clear).toHaveBeenCalledTimes(2);
    expect(x.delivered).toHaveLength(1);
    expect(x.delivered[0]?.data.signature).toBe("replacement");
    expect(x.cursors.has("indexer:stream-reset")).toBe(false);
  });
  it("recovers Redis data loss despite an advanced SQL publish checkpoint", async () => {
    const x = setup();
    await x.publisher.flush();
    x.delivered.length = 0;
    x.recovery.exists.mockResolvedValue(false);
    await x.publisher.flush();
    expect(x.delivered.map((event) => event.id)).toEqual([
      "100-1-0",
      "100-2-0",
    ]);
    expect(x.recovery.clear).toHaveBeenCalledOnce();
  });
});

it("never labels administrative or diagnostic events as public phase or reveal actions", async () => {
  const x = setup();
  x.rows[0]!.name = "ConfigChanged";
  x.rows[1]!.name = "CallbackSkipped";
  x.rows[2]!.name = "RoyaltyPaid";
  await x.publisher.flush();
  expect(x.delivered).toEqual([]);
  expect(x.cursors.get("indexer:published")).toBe("100:2:0:0");
});

it("bounds reset publication even when the historical backlog contains thousands of rows", async () => {
  const x = setup();
  x.rows.splice(
    0,
    x.rows.length,
    ...Array.from({ length: 1000 }, (_, n) => ({
      ...x.rows[0]!,
      signature: `sig${n}`,
      slot: "100",
      tx_index: String(n),
      ix_index: "0",
      event_index: "0",
      name: "BagFed",
      data: { amount: "1", _indexer: { holder: "private" } },
    })),
  );
  x.cursors.set("indexer:stream-reset", null);
  await x.publisher.flush();
  expect(x.delivered.map((event) => event.id)).toEqual([
    "100-998-0",
    "100-999-0",
  ]);
  expect(x.stream.publish).toHaveBeenCalledTimes(2);
});

it("excludes quarantined transactions from normal publication and reset history", async () => {
  const x = setup();
  x.cursors.set("indexer:unprocessable:sig1", null);
  await x.publisher.flush();
  expect(x.delivered.map((event) => event.id)).toEqual(["100-0-0", "100-2-0"]);
  x.cursors.set("indexer:stream-reset", null);
  await x.publisher.flush();
  expect(x.delivered.map((event) => event.id)).toEqual(["100-0-0", "100-2-0"]);
  const queries = vi
    .mocked(x.pool.query)
    .mock.calls.map(([query]) => query)
    .filter((query) => query.startsWith("SELECT e."));
  expect(
    queries.every((query) =>
      query.includes(
        "NOT EXISTS (SELECT 1 FROM cursors c WHERE c.name='indexer:unprocessable:'||e.signature)",
      ),
    ),
  ).toBe(true);
});
