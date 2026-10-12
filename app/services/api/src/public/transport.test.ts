import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RpcError } from "@onepercent/service-kit";
import { validateRpcRequest, proxyRpc } from "./rpc.js";
import { cachedRead } from "./cache.js";
import {
  confirmedReplay,
  parseEventCursor,
  PublicStreamHub,
} from "./stream.js";
import { revealEvent, settleEvent } from "./__fixtures__/stream.js";

const key = "11111111111111111111111111111111";
const deck = "So11111111111111111111111111111111111111112";
const sig = "1".repeat(64);
function rpc(method: string, params: unknown[] = []) {
  return { jsonrpc: "2.0", id: 7, method, params };
}
describe("read-only public RPC", () => {
  it.each([
    "sendTransaction",
    "requestAirdrop",
    "getProgramAccounts",
    "getBlock",
    "constructor",
    "__proto__",
    "toString",
  ])("refuses %s", (method) => {
    expect(() => validateRpcRequest(rpc(method), deck, 65536)).toThrow();
  });
  it("protects Deck in single, multiple and simulation output reads", () => {
    for (const [method, params] of [
      ["getAccountInfo", [deck]],
      ["getMultipleAccounts", [[key, deck]]],
      ["getAccountInfo", [deck, { dataSlice: { offset: 0, length: 65537 } }]],
      [
        "getMultipleAccounts",
        [
          [deck],
          { dataSlice: { offset: 0, length: 3 }, encoding: "jsonParsed" },
        ],
      ],
      [
        "simulateTransaction",
        [
          "AQ==",
          {
            encoding: "base64",
            accounts: { encoding: "base64", addresses: [deck] },
          },
        ],
      ],
    ] as [string, unknown[]][])
      expect(() =>
        validateRpcRequest(rpc(method, params), deck, 65536),
      ).toThrow();
    expect(
      validateRpcRequest(
        rpc("getAccountInfo", [
          deck,
          { encoding: "base64", dataSlice: { offset: 0, length: 65536 } },
        ]),
        deck,
        65536,
      ).method,
    ).toBe("getAccountInfo");
    expect(() =>
      validateRpcRequest(
        rpc("getMultipleAccounts", [Array.from({ length: 101 }, () => key)]),
        deck,
        65536,
      ),
    ).toThrow();
  });
  it("normalizes D11 defaults and refuses widening history requests", () => {
    expect(
      validateRpcRequest(rpc("getSignaturesForAddress", [key]), deck, 65536)
        .params[1],
    ).toEqual({ limit: 10, commitment: "confirmed" });
    expect(
      validateRpcRequest(rpc("getTransaction", [sig]), deck, 65536).params[1],
    ).toEqual({ commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    expect(
      validateRpcRequest(rpc("getBlockHeight"), deck, 65536).params,
    ).toEqual([]);
    for (const params of [
      [key, { limit: 11 }],
      [key, { commitment: "processed" }],
      [key, { limit: 0 }],
    ])
      expect(() =>
        validateRpcRequest(rpc("getSignaturesForAddress", params), deck, 65536),
      ).toThrow();
    expect(() =>
      validateRpcRequest(
        rpc("getTransaction", [sig, { maxSupportedTransactionVersion: 1 }]),
        deck,
        65536,
      ),
    ).toThrow();
    expect(() => validateRpcRequest([rpc("getSlot")], deck, 65536)).toThrow();
  });
  it("preserves JSON-RPC IDs and never returns provider error details", async () => {
    const body = validateRpcRequest(rpc("getSlot"), deck, 65536);
    expect(
      await proxyRpc({ request: vi.fn().mockResolvedValue(123) }, body),
    ).toEqual({ jsonrpc: "2.0", id: 7, result: 123 });
    const value = await proxyRpc(
      { request: vi.fn().mockRejectedValue(new RpcError(-32602)) },
      body,
    );
    expect(value).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32602, message: "RPC request failed" },
    });
  });
});
describe("snapshot cache", () => {
  it("rejects expired/future entries, slow chain reads and failed cache writes", async () => {
    let now = 3000;
    const get = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ startedAt: 0, value: 4 }));
    const set = vi.fn().mockResolvedValue("OK");
    const read = vi.fn().mockResolvedValue(5);
    const options = {
      cache: { get, set },
      key: "machine",
      maxAgeMs: 2000,
      schema: z.number(),
      read,
      now: () => now,
    };
    expect(await cachedRead(options)).toBe(5);
    expect(set).toHaveBeenCalledWith(
      "machine",
      JSON.stringify({ startedAt: 3000, value: 5 }),
      "PX",
      2000,
    );
    get.mockResolvedValue(JSON.stringify({ startedAt: 9999, value: 7 }));
    set.mockRejectedValue(new Error("offline"));
    expect(await cachedRead(options)).toBe(5);
    get.mockResolvedValue(null);
    read.mockImplementation(async () => {
      now += 2000;
      return 6;
    });
    await expect(cachedRead(options)).rejects.toThrow("snapshot_too_old");
  });
});
describe("confirmed SSE replay", () => {
  it("validates cursor and excludes entries rolled back after publication", async () => {
    expect(parseEventCursor("8-2-1")).toBe("8-2-1");
    expect(() => parseEventCursor("8-4294967296-1")).toThrow();
    expect(() => parseEventCursor("bad\nevent:reveal")).toThrow();
    const rows = [revealEvent("8-2-1", "9"), settleEvent("8-2-2", "9")];
    const source = {
      replayAfter: vi.fn().mockResolvedValue(rows),
      confirmed: vi.fn(async (events: readonly (typeof rows)[number][]) =>
        events.filter((e) => e.event === "settle"),
      ),
    };
    expect(await confirmedReplay(source, "8-1-0")).toEqual({
      rows,
      confirmed: [rows[1]],
    });
    expect(source.replayAfter).toHaveBeenCalledWith("8-1-0");
  });
});

it("SSE resumes after the supplied id and emits only confirmed payloads with a numeric slot", async () => {
  const { Hono } = await import("hono");
  const { publicStream } = await import("./stream.js");
  const { settings } = await import("./__fixtures__/settings.js");
  const rows = [
    {
      ...revealEvent("8-2-1", "9"),
      data: { ...revealEvent("8-2-1", "9").data, asOfSlot: 999 },
    },
  ];
  const replayAfter = vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
  const hub = new PublicStreamHub(
    { replayAfter, confirmed: async (events) => [...events] },
    settings,
    { autoPoll: false },
  );
  const app = new Hono().get("/api/stream", (c) =>
    publicStream(c, hub, "hashed-ip"),
  );
  const response = await app.request("/api/stream", {
    headers: { "Last-Event-ID": "8-1-0" },
  });
  const reader = response.body!.getReader();
  const frame = new TextDecoder().decode((await reader.read()).value);
  expect(replayAfter).toHaveBeenCalledWith(undefined);
  expect(frame).toContain("event: reveal");
  expect(frame).toContain("id: 8-2-1");
  expect(frame).toContain('"asOfSlot":8');
  expect(frame).not.toContain("999");
  await reader.cancel();
});
