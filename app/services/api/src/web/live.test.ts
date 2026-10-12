import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SERVICES } from "@onepercent/config";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { EventsResponse, HighlightsResponse } from "@onepercent/web-api";
import { createPublicEvents } from "../public/events.js";
import { loadPublicSettings } from "../public/settings.js";
import type { PublicEventSource } from "../public/stream.js";
import { pollEvents } from "./events.js";
import { createHighlights } from "./highlights.js";
import { createWebDependencies } from "./deps.js";
import { createWebRouter } from "./router.js";
import { ItemLimiter } from "./limits.js";

const wallet = "11111111111111111111111111111111";
const sig = "1".repeat(64);
const event = {
  id: "12-1-0",
  event: "feed",
  data: {
    name: "BagFed",
    depositor: wallet,
    mint: wallet,
    amount: "99",
    deck_index: 1,
    deposit: "1",
    fresh_in_deck: 1,
    asOfSlot: "12",
    signature: sig,
  },
};
beforeEach(() =>
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network in unit test");
  }),
);
afterEach(() => vi.unstubAllGlobals());

describe("confirmed events polling", () => {
  it("uses the same canonical confirmation as SSE and rejects malformed cursors", async () => {
    const source = {
      replayAfter: vi.fn().mockResolvedValue([event]),
      confirmed: vi.fn().mockResolvedValue([event]),
    } as PublicEventSource;
    expect(
      EventsResponse.parse(await pollEvents(source, "11-1-0")),
    ).toHaveLength(1);
    expect(source.replayAfter).toHaveBeenCalledWith("11-1-0");
    expect(source.confirmed).toHaveBeenCalledWith([event]);
    await expect(pollEvents(source, "invalid")).rejects.toMatchObject({
      status: 400,
    });
    expect(source.replayAfter).toHaveBeenCalledTimes(1);
  });
  it("does not serve a Redis payload with matching IDs when canonical DB data differs", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            slot: "12",
            tx_index: "1",
            event_index: "0",
            name: "BagFed",
            signature: sig,
            data: {
              depositor: wallet,
              mint: wallet,
              amount: "7",
              deck_index: 1,
              deposit: "1",
              fresh_in_deck: 1,
            },
          },
        ],
      }),
    };
    const source = createPublicEvents(
      { pool, redis: {} } as unknown as ServiceRuntime,
      loadPublicSettings(),
    );
    const confirmed = await source.confirmed([event] as never);
    expect(confirmed[0]?.data.amount).toBe("7");
    expect(pool.query.mock.calls[0]![0]).toContain(
      "t.commitment IN ('confirmed','finalized') AND t.err IS NULL",
    );
    pool.query.mockResolvedValue({ rows: [] });
    expect(await source.confirmed([event] as never)).toEqual([]);
  });
  it("enforces the replay window rather than returning an oversized body", async () => {
    const source = {
      replayAfter: async () =>
        Array.from({ length: SERVICES.api.sseReplayEvents + 1 }, () => event),
      confirmed: async () => [],
    } as unknown as PublicEventSource;
    await expect(pollEvents(source)).rejects.toThrow("stream_window_exceeded");
  });
});

describe("Highlights read-only query", () => {
  it("keeps exact u64 values and ranks confirmed stocked values using numeric arithmetic", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          seq: "18446744073709551615",
          edition: 0,
          tier: 4,
          who: wallet,
          hit_value: "9007199254740993",
          sig,
          ts: "1791495010",
        },
      ],
    });
    const load = createHighlights(
      { query } as Pick<ServiceRuntime["pool"], "query">,
      () => new Date("2026-10-09T16:32:45Z"),
    );
    const result = await load("today");
    expect(result[0]?.seq).toBe(18446744073709551615n);
    expect(result[0]?.hitValueLamports).toBe(9007199254740993n);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("k.hit_value DESC, k.hit_value/prices.price DESC");
    expect(sql).toContain("t.err IS NULL");
    expect(values[2]).toEqual(new Date("2026-10-09T00:00:00Z"));
    expect(values[1]).toEqual([1, 2, 3, 4]);
    await load("season");
    expect(query.mock.calls[1]![1][2]).toBeNull();
  });
});

describe("M3.3 web endpoints", () => {
  function setup() {
    const deps = createWebDependencies({
      XRAY_SOURCE: "fixtures",
      LOG_LEVEL: "silent",
    });
    deps.events = vi.fn(async () => EventsResponse.parse([event]));
    deps.highlights = vi.fn(async () =>
      HighlightsResponse.parse([
        {
          seq: "1",
          tier: "silver",
          edition: "original",
          who: wallet,
          hitValueLamports: "1",
          sig,
          ts: 1,
        },
      ]),
    );
    return { deps, router: createWebRouter(deps) };
  }
  it("serves schema-valid no-store responses and validates every query field", async () => {
    const { router, deps } = setup();
    const response = await router.request("/api/events?after=1-0-0");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(EventsResponse.parse(await response.json())).toHaveLength(1);
    expect(deps.events).toHaveBeenCalledWith("1-0-0");
    const highlights = await router.request("/api/highlights?window=today");
    expect(HighlightsResponse.parse(await highlights.json())).toHaveLength(1);
    for (const url of [
      "/api/events?after=no",
      "/api/events?wallet=abc",
      "/api/highlights?window=hour",
      "/api/highlights",
    ])
      expect((await router.request(url)).status).toBe(400);
  });
  it("bounds admission and returns unavailable when stores are absent", async () => {
    const { router, deps } = setup();
    deps.liveLimiter = new ItemLimiter(1);
    expect((await router.request("/api/events")).status).toBe(200);
    expect((await router.request("/api/highlights?window=season")).status).toBe(
      429,
    );
    const absent = createWebRouter(
      createWebDependencies({ LOG_LEVEL: "silent" }),
    );
    expect((await absent.request("/api/events")).status).toBe(503);
    expect((await absent.request("/api/highlights?window=season")).status).toBe(
      503,
    );
  });
});
