import { readFile } from "node:fs/promises";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { WEB } from "@onepercent/config/web";
import * as schemas from "../src/index.js";
beforeAll(() =>
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network in unit test");
  }),
);
afterAll(() => vi.unstubAllGlobals());
const fixtures = {
  "values-request": schemas.ValuesRequest,
  "values-response": schemas.ValuesResponse,
  "logo-params": schemas.LogoParams,
  "web-config": schemas.WebConfigResponse,
  "swap-request": schemas.SwapSellRequest,
  "swap-response": schemas.SwapSellResponse,
  "send-request": schemas.SendRequest,
  "send-response": schemas.SendResponse,
  "events-request": schemas.EventsRequest,
  "events-response": schemas.EventsResponse,
  "highlights-request": schemas.HighlightsRequest,
  "highlights-response": schemas.HighlightsResponse,
  "royalties-request": schemas.RoyaltiesRequest,
  "royalties-response": schemas.RoyaltiesResponse,
  beacon: schemas.BeaconEvent,
  config: schemas.ConfigResponse,
};
describe("web API contracts", () => {
  for (const [file, schema] of Object.entries(fixtures))
    it(`parses ${file}`, async () => {
      const input: unknown = JSON.parse(
        await readFile(
          new URL(`../fixtures/${file}.json`, import.meta.url),
          "utf8",
        ),
      );
      expect(schema.safeParse(input).success).toBe(true);
    });
  it("validates u64 and exact public-key byte lengths without browser crypto dependencies", () => {
    expect(schemas.U64String.parse("18446744073709551615")).toBe(
      (1n << 64n) - 1n,
    );
    for (const value of ["18446744073709551616", "-1", "1.0", 1])
      expect(schemas.U64String.safeParse(value).success).toBe(false);
    expect(schemas.PublicKeyString.safeParse("1".repeat(32)).success).toBe(
      true,
    );
    expect(schemas.PublicKeyString.safeParse("1".repeat(33)).success).toBe(
      false,
    );
  });
  it("rejects oversized batches, partial configs and identifier-bearing beacons", () => {
    expect(
      schemas.ValuesRequest.safeParse({
        mode: "now",
        items: Array.from({ length: WEB.valuesBatchMax + 1 }, () => ({
          mint: "1".repeat(32),
          amount: "1",
        })),
      }).success,
    ).toBe(false);
    expect(
      schemas.ConfigResponse.safeParse({ flags: { XRAY: true } }).success,
    ).toBe(false);
    expect(
      schemas.BeaconEvent.safeParse({
        event: "page_view",
        route: "xray",
        wallet: "1".repeat(32),
      }).success,
    ).toBe(false);
    expect(
      schemas.BeaconEvent.safeParse({ event: "page_view", route: "/x/secret" })
        .success,
    ).toBe(false);
    expect(
      schemas.BeaconEvent.safeParse({
        event: "tx_error",
        flow: "rip",
        code: "signature payload",
      }).success,
    ).toBe(false);
  });
  it("checks royalty memos precisely", () => {
    expect(schemas.parseRoyaltyMemo("1pct:roy:18446744073709551615")).toBe(
      (1n << 64n) - 1n,
    );
    for (const value of [
      "1pct:roy:18446744073709551616",
      "1pct:roy:12x",
      "prefix1pct:roy:12",
      "1pct:roy:-1",
      "1pct:roy:12\n",
      "1pct:roy:12\r\n",
      "1pct:roy:12 trailing",
    ])
      expect(schemas.parseRoyaltyMemo(value)).toBeNull();
  });
  it("bounds send payloads by decoded Solana packet size", () => {
    expect(schemas.SendRequest.safeParse({ tx: "" }).success).toBe(false);
    expect(
      schemas.SendRequest.safeParse({ tx: "A".repeat(1_644) }).success,
    ).toBe(false);
    expect(
      schemas.SendRequest.safeParse({ tx: "A".repeat(1_643) + "=" }).success,
    ).toBe(true);
  });
  it("accepts the exact S0 event envelope without invented top-level metadata", () => {
    const envelope = { id: "100-1-2", event: "reveal", data: { seq: "42" } };
    expect(schemas.StreamEvent.parse(envelope)).toEqual(envelope);
    for (const event of [
      "feed",
      "takeBack",
      "pullOpened",
      "reveal",
      "settle",
      "refund",
      "sellBack",
      "stock",
      "phase",
    ])
      expect(
        schemas.StreamEvent.safeParse({ ...envelope, event }).success,
      ).toBe(true);
    for (const extra of [
      { asOfSlot: "100" },
      { sig: "1".repeat(64) },
      { ts: 0 },
    ])
      expect(
        schemas.StreamEvent.safeParse({ ...envelope, ...extra }).success,
      ).toBe(false);
    for (const invalid of [
      { ...envelope, id: "bad" },
      { ...envelope, data: [] },
      { ...envelope, event: "ping" },
    ])
      expect(schemas.EventsResponse.safeParse([invalid]).success).toBe(false);
  });
  it("accepts idless ping objects and validates an optional timestamp", () => {
    for (const ping of [
      {},
      { ts: 0 },
      { event: "ping", id: "ignored", data: {} },
    ])
      expect(schemas.StreamPing.safeParse(ping).success).toBe(true);
    for (const invalid of [null, [], "ping", { ts: "0" }, { ts: -1 }])
      expect(schemas.StreamPing.safeParse(invalid).success).toBe(false);
  });
  it("does not accept the unused web-vitals event", () => {
    expect(
      schemas.BeaconEvent.safeParse({
        event: "web_vitals",
        route: "xray",
        lcpMs: 100,
        cls: 0,
        inpMs: 100,
      }).success,
    ).toBe(false);
  });
});
