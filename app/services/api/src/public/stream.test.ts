import type { ServiceRuntime, StreamEvent } from "@onepercent/service-kit";
import { redisEventId } from "@onepercent/service-kit";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { feedEvent } from "./__fixtures__/stream.js";
import { settings } from "./__fixtures__/settings.js";
import { createPublicEvents } from "./events.js";
import { PublicStreamHub, publicStream } from "./stream.js";
import { PublicHttpError } from "./signer.js";

function source(events: StreamEvent[] = [feedEvent()]) {
  return {
    replayAfter: vi.fn(async (cursor?: string) => (cursor ? [] : events)),
    confirmed: vi.fn(async (rows: readonly StreamEvent[]) => [...rows]),
  };
}
const limits = { maxClients: 3, maxClientsPerIp: 2, queuedEventsPerClient: 2 };

describe("shared public SSE poller", () => {
  it("delivers a block-0 marker only while its canonical SQL record exists", async () => {
    const data = {
      name: "IndexerBlock0Ready",
      signature: "1".repeat(64),
      asOfSlot: "63",
    };
    const event = {
      id: "63-4294967295-4294967295",
      event: "block0",
      data,
    } as const;
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          slot: "63",
          tx_index: "4294967295",
          event_index: "4294967295",
          name: data.name,
          signature: data.signature,
          data: {},
        },
      ],
    });
    const runtime = { redis: {}, pool: { query } } as unknown as Pick<
      ServiceRuntime,
      "redis" | "pool"
    >;
    const events = createPublicEvents(runtime, settings);
    expect(await events.confirmed([event])).toEqual([event]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await events.confirmed([event])).toEqual([]);
    expect(await events.confirmed([{ ...event, event: "phase" }])).toEqual([]);
  });
  it("restarts polling after the last client closes during an in-flight read", async () => {
    vi.useFakeTimers();
    const io = source();
    const hub = new PublicStreamHub(io, settings);
    try {
      const first = await hub.open("a");
      let release!: (events: StreamEvent[]) => void;
      io.replayAfter.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const polling = hub.poll();
      first.close();
      release([]);
      await polling;
      const reads = io.replayAfter.mock.calls.length;
      const next = await hub.open("a");
      expect(io.replayAfter).toHaveBeenCalledTimes(reads + 1);
      await vi.advanceTimersByTimeAsync(settings.indexer.pollMs);
      expect(io.replayAfter).toHaveBeenCalledTimes(reads + 2);
      next.close();
      await vi.advanceTimersByTimeAsync(settings.indexer.pollMs * 2);
      expect(io.replayAfter).toHaveBeenCalledTimes(reads + 2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("uses one XRANGE and one confirmation SQL per tick for N clients", async () => {
    const event = feedEvent();
    const xrange = vi
      .fn()
      .mockResolvedValueOnce([
        [redisEventId(event.id), ["event", JSON.stringify(event)]],
      ])
      .mockResolvedValue([]);
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          slot: "1",
          tx_index: "0",
          event_index: "0",
          name: event.data.name,
          signature: event.data.signature,
          data: event.data,
        },
      ],
    });
    const runtime = { redis: { xrange }, pool: { query } } as unknown as Pick<
      ServiceRuntime,
      "redis" | "pool"
    >;
    const hub = new PublicStreamHub(
      createPublicEvents(runtime, settings),
      settings,
      { autoPoll: false },
    );
    const clients = await Promise.all(
      Array.from({ length: 50 }, (_, n) => hub.open(`ip-${n}`)),
    );
    expect(xrange).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(clients.every((client) => client.initial.length === 1)).toBe(true);
    await Promise.all([hub.poll(), hub.poll()]);
    expect(xrange).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(2);
    expect(xrange).toHaveBeenLastCalledWith(
      "onepct:events",
      "(1-0",
      "+",
      "COUNT",
      500,
    );
    for (const client of clients) client.close();
  });

  it("reuses shared retained replay with an exclusive Last-Event-ID", async () => {
    const io = source([feedEvent("2-0-0"), feedEvent("2-0-1")]);
    const hub = new PublicStreamHub(io, settings, { autoPoll: false });
    const first = await hub.open("ip-a");
    const resumed = await hub.open("ip-b", "2-0-0");
    expect(resumed.initial.map((event) => event.id)).toEqual(["2-0-1"]);
    expect(io.replayAfter).toHaveBeenCalledOnce();
    expect(io.confirmed).toHaveBeenCalledOnce();
    first.close();
    resumed.close();
  });

  it("enforces global and per-IP admission before sending SSE headers, then releases slots", async () => {
    const hub = new PublicStreamHub(source(), settings, {
      autoPoll: false,
      limits,
    });
    const a = await hub.open("a"),
      b = await hub.open("a"),
      c = await hub.open("b");
    await expect(hub.open("a")).rejects.toMatchObject({
      status: 429,
      code: "stream_capacity",
    });
    const app = new Hono().get("/api/stream", (context) =>
      publicStream(context, hub, "c"),
    );
    app.onError((error, context) =>
      error instanceof PublicHttpError
        ? context.json({ error: error.code }, error.status)
        : context.text("error", 500),
    );
    const rejected = await app.request("/api/stream");
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("Content-Type")).toContain("application/json");
    b.close();
    const replacement = await hub.open("a");
    await expect(hub.open("b")).rejects.toMatchObject({ status: 429 });
    a.close();
    c.close();
    replacement.close();
  });

  it("disconnects a slow client at the queue bound while an active peer continues", async () => {
    const io = source();
    const hub = new PublicStreamHub(io, settings, { autoPoll: false, limits });
    const slow = await hub.open("a"),
      fast = await hub.open("b");
    const disconnected = vi.fn();
    slow.onClose(disconnected);
    for (let slot = 2; slot <= 4; slot++) {
      const waiting = fast.next();
      io.replayAfter.mockResolvedValueOnce([feedEvent(`${slot}-0-0`)]);
      await hub.poll();
      expect((await waiting)?.event).toBe("feed");
    }
    expect(slow.closed).toBe(true);
    expect(disconnected).toHaveBeenCalledOnce();
    expect(await slow.next()).toBeNull();
    expect(fast.closed).toBe(false);
    fast.close();
  });

  it("advances past rejected raw IDs and approximate Redis trim overflow without starvation", async () => {
    const configured = {
      ...settings,
      api: { ...settings.api, sseReplayEvents: 2 },
    };
    const io = source([feedEvent("1-0-0"), feedEvent("2-0-0")]);
    io.confirmed.mockImplementation(async (rows) =>
      rows.filter((event) => event.id !== "2-0-0"),
    );
    const hub = new PublicStreamHub(io, configured, { autoPoll: false });
    const client = await hub.open("a");
    expect(client.initial.map((event) => event.id)).toEqual(["1-0-0"]);
    io.replayAfter.mockResolvedValueOnce([
      feedEvent("3-0-0"),
      feedEvent("4-0-0"),
    ]);
    await hub.poll();
    expect(io.replayAfter).toHaveBeenLastCalledWith("2-0-0");
    expect(io.confirmed.mock.calls.at(-1)?.[0]).toHaveLength(4);
    const newer = await hub.open("b");
    expect(newer.initial.map((event) => event.id)).toEqual(["3-0-0", "4-0-0"]);
    await hub.poll();
    expect(io.replayAfter).toHaveBeenLastCalledWith("4-0-0");
    expect(io.confirmed.mock.calls.at(-1)?.[0]).toHaveLength(2);
    client.close();
    newer.close();
  });

  it("rechecks queued outcomes before delivery and stops clients when confirmation fails", async () => {
    const io = source();
    const hub = new PublicStreamHub(io, settings, { autoPoll: false });
    const client = await hub.open("a");
    io.replayAfter.mockResolvedValueOnce([feedEvent("2-0-0")]);
    await hub.poll();
    io.confirmed.mockResolvedValueOnce([feedEvent()]);
    await hub.poll();
    io.replayAfter.mockResolvedValueOnce([feedEvent("3-0-0")]);
    await hub.poll();
    expect(((await client.next()) as { id: string }).id).toBe("3-0-0");
    io.confirmed.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(hub.poll()).rejects.toThrow("database unavailable");
    expect(client.closed).toBe(true);
    const restarted = await hub.open("a");
    expect(io.replayAfter).toHaveBeenLastCalledWith(undefined);
    restarted.close();
  });
});
