import { expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import { EventStream, redisEventId, SlidingWindowLimiter } from "./redis.js";

it("uses one atomic Lua call, server time, and unique members for a sliding limit", async () => {
  const evalCommand = vi
    .fn()
    .mockResolvedValueOnce([1, 0])
    .mockResolvedValueOnce([0, 12]);
  const limiter = new SlidingWindowLimiter({ eval: evalCommand } as Pick<
    Redis,
    "eval"
  >);
  expect(await limiter.limit("test:wallet", 30, 60)).toEqual({
    ok: true,
    retryAfterS: 0,
  });
  expect(await limiter.limit("test:wallet", 30, 60)).toEqual({
    ok: false,
    retryAfterS: 12,
  });
  expect(evalCommand).toHaveBeenCalledTimes(2);
  expect(evalCommand.mock.calls[0]![0]).toContain("redis.call('TIME')");
  expect(evalCommand.mock.calls[0]!.slice(1, 5)).toEqual([
    1,
    "test:wallet",
    30,
    60_000,
  ]);
  expect(evalCommand.mock.calls[0]![5]).not.toBe(evalCommand.mock.calls[1]![5]);
  await expect(limiter.limit("test", 0, 60)).rejects.toThrow();
});

it("encodes public event order losslessly into Redis's two-part IDs", () => {
  expect(redisEventId("100-0-1")).toBe("100-1");
  expect(redisEventId("100-1-2")).toBe("100-4294967298");
  expect(redisEventId("100-4294967295-4294967295")).toBe(
    "100-18446744073709551615",
  );
  for (const id of [
    "invalid",
    "100-4294967296-0",
    "18446744073709551616-0-0",
    "0-0-0",
  ])
    expect(() => redisEventId(id)).toThrow();
});

it("keeps public IDs on SSE replay and refuses corrupt Redis payloads", async () => {
  const event = {
    id: "100-1-2",
    event: "reveal" as const,
    data: { seq: "42" },
  };
  const redis = {
    xadd: vi.fn().mockResolvedValue("100-4294967298"),
    xrange: vi
      .fn()
      .mockResolvedValue([
        ["100-4294967298", ["event", JSON.stringify(event)]],
      ]),
  };
  const stream = new EventStream(
    redis as unknown as Pick<Redis, "xadd" | "xrange">,
    { key: "onepct:events", maxLength: 500 },
  );
  await stream.publish(event);
  expect(redis.xadd).toHaveBeenCalledWith(
    "onepct:events",
    "MAXLEN",
    "~",
    500,
    "100-4294967298",
    "event",
    JSON.stringify(event),
  );
  expect(await stream.replayAfter("100-0-1")).toEqual([event]);
  expect(redis.xrange).toHaveBeenCalledWith(
    "onepct:events",
    "(100-1",
    "+",
    "COUNT",
    500,
  );
  redis.xrange.mockResolvedValue([["101-1", ["event", JSON.stringify(event)]]]);
  await expect(stream.replayAfter()).rejects.toThrow("ID mismatch");
});

it("treats a duplicate or older published cursor as success while preserving other failures", async () => {
  const rows: Array<[string, string[]]> = [];
  const redis = {
    xadd: vi.fn(
      async (
        _key,
        _maxlen,
        _approximate,
        _length,
        id: string,
        _field,
        value: string,
      ) => {
        if (rows.length && id <= rows[rows.length - 1]![0])
          throw new Error(
            "ERR The ID specified in XADD is equal or smaller than the target stream top item",
          );
        rows.push([id, ["event", value]]);
        return id;
      },
    ),
    xrange: vi.fn(async () => rows),
  };
  const stream = new EventStream(
    redis as unknown as Pick<Redis, "xadd" | "xrange">,
    { key: "onepct:events", maxLength: 500 },
  );
  const events = [
    { id: "100-0-1", event: "feed" as const, data: { seq: "1" } },
    { id: "101-0-1", event: "reveal" as const, data: { seq: "1" } },
  ];
  for (const event of events) await stream.publish(event);
  const first = await stream.replayAfter();
  for (const event of events) await stream.publish(event);
  expect(await stream.replayAfter()).toEqual(first);
  expect(rows).toHaveLength(2);
  redis.xadd.mockRejectedValueOnce(new Error("connection unavailable"));
  await expect(stream.publish(events[1]!)).rejects.toThrow(
    "connection unavailable",
  );
});
