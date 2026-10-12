import type { ServiceRuntime, StreamEvent } from "@onepercent/service-kit";
import { describe, expect, it, vi } from "vitest";
import { settings } from "./__fixtures__/settings.js";
import { feedEvent } from "./__fixtures__/stream.js";
import { createPublicEvents } from "./events.js";
function source(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  const runtime = { redis: {}, pool: { query } } as unknown as Pick<
    ServiceRuntime,
    "redis" | "pool"
  >;
  return { ...createPublicEvents(runtime, settings), query };
}
function row(event: StreamEvent) {
  const [slot, tx_index, event_index] = event.id.split("-");
  return {
    slot,
    tx_index,
    event_index,
    name: event.data.name,
    signature: event.data.signature,
    data: { ...event.data, _indexer: { internal: true } },
  };
}
describe("canonical SSE confirmation", () => {
  it("confirms ReferralRedirected from the final shared event ABI", async () => {
    const sample = feedEvent("7-0-0");
    const redirect: StreamEvent = {
      id: sample.id,
      event: "settle",
      data: {
        name: "ReferralRedirected",
        seq: "1",
        pack: 0,
        referrer: "11111111111111111111111111111111",
        amount: "2000000",
        signature: sample.data.signature,
        asOfSlot: "7",
      },
    };
    expect(await source([row(redirect)]).confirmed([redirect])).toEqual([
      redirect,
    ]);
  });
  it("replaces Redis payloads with confirmed database fields in one batched query", async () => {
    const real = feedEvent("1-0-0", "5"),
      next = feedEvent("2-0-0", "9");
    const events = source([row(real), row(next)]);
    const forged = {
      ...real,
      data: { ...real.data, amount: "999", internal: "not public" },
    };
    expect(await events.confirmed([forged, next])).toEqual([real, next]);
    expect(events.query).toHaveBeenCalledOnce();
    expect(events.query.mock.calls[0]?.[0]).toContain("t.err IS NULL");
    expect(events.query.mock.calls[0]?.[1]).toEqual([
      JSON.stringify([
        { slot: "1", tx_index: "0", event_index: "0" },
        { slot: "2", tx_index: "0", event_index: "0" },
      ]),
    ]);
  });
  it("rejects stale fork signatures, mismatched categories and unknown payload fields", async () => {
    const real = feedEvent();
    const events = source([row(real)]);
    const stale = {
      ...real,
      data: { ...real.data, signature: "1".repeat(63) + "2" },
    };
    expect(await events.confirmed([stale])).toEqual([]);
    expect(await events.confirmed([{ ...real, event: "reveal" }])).toEqual([]);
    const unknown = row(real);
    unknown.data = { ...unknown.data, unknown: true } as typeof unknown.data;
    expect(await source([unknown]).confirmed([real])).toEqual([]);
  });
  it("does not run a query when Redis and retained history are empty", async () => {
    const events = source([]);
    expect(await events.confirmed([])).toEqual([]);
    expect(events.query).not.toHaveBeenCalled();
  });
  it("skips S1 non-public events in retained Redis history without dropping public events", async () => {
    const real = feedEvent("2-0-0");
    const administrative: StreamEvent = {
      id: "1-0-0",
      event: "phase",
      data: {
        name: "Pong",
        version: 1,
        signature: real.data.signature,
        asOfSlot: "1",
      },
    };
    const events = source([row(administrative), row(real)]);
    expect(await events.confirmed([administrative, real])).toEqual([real]);
    expect(events.query).toHaveBeenCalledOnce();
  });
});
