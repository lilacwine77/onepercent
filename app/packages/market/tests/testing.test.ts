import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createHttpClient } from "../src/http/fetch-json.js";
import { WSOL_MINT } from "../src/params.js";
import { createStaticPriceSource, fixtureFetch } from "../src/testing.js";

const file = (name: string) =>
  new URL(`./fixtures/${name}.json`, import.meta.url);

describe("consumer test adapters", () => {
  it("creates a deterministic PriceSource with defensive copies and requested missing keys", async () => {
    const source = createStaticPriceSource({
      prices: { [WSOL_MINT]: { usdPrice: 100, blockId: 1234, ageSlots: 2 } },
      tokenInfo: { [WSOL_MINT]: { symbol: "SOL", name: "Solana" } },
      solUsd: 100,
    });
    const unknown = "11111111111111111111111111111111";
    const prices = await source.getPrices([WSOL_MINT, unknown, WSOL_MINT]);
    expect(Object.keys(prices)).toEqual([WSOL_MINT, unknown]);
    expect(prices[unknown]).toBeUndefined();
    prices[WSOL_MINT]!.usdPrice = 1;
    expect((await source.getPrices([WSOL_MINT]))[WSOL_MINT]!.usdPrice).toBe(
      100,
    );
    expect(await source.getTokenInfo([WSOL_MINT])).toEqual({
      [WSOL_MINT]: { symbol: "SOL", name: "Solana" },
    });
    expect(await source.getSolUsd()).toBe(100);
    expect(await source.getPrices([])).toEqual({});
    await expect(source.getPrices(["invalid"])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("matches query parameters independently of ordering", async () => {
    const fixture = JSON.parse(
      readFileSync(file("pyth/latest-sol"), "utf8"),
    ) as { request: { url: string }; response: { body: unknown } };
    const url = new URL(fixture.request.url);
    const entries = [...url.searchParams.entries()].reverse();
    url.search = new URLSearchParams(entries).toString();
    const response = await fixtureFetch(file("pyth/latest-sol"))(url);
    expect(await response.json()).toEqual(fixture.response.body);
  });

  it("matches sanitized RPC URLs by method and params independently of id", async () => {
    const fixture = JSON.parse(readFileSync(file("rpc/get-slot"), "utf8")) as {
      response: { body: unknown };
    };
    const response = await fixtureFetch(file("rpc/get-slot"))(
      "https://rpc.example.invalid/private-route?credential=fixture-only",
      {
        method: "POST",
        body: JSON.stringify({
          id: 42,
          method: "getSlot",
          params: [{ commitment: "confirmed" }],
          jsonrpc: "2.0",
        }),
      },
    );
    expect(await response.json()).toEqual(fixture.response.body);
  });

  it("preserves a missing fixture diagnostic through HTTP without exposing a URL or retrying", async () => {
    const http = createHttpClient({
      fetch: fixtureFetch(file("rpc/get-slot")),
      provider: "test",
    });
    await expect(
      http.fetchJson(z.unknown(), {
        url: "https://example.invalid/private-secret?credential=hidden",
      }),
    ).rejects.toThrow("missing fixture");
    await expect(
      fixtureFetch(file("rpc/get-slot"))(
        "https://example.invalid/private-secret?credential=hidden",
      ),
    ).rejects.not.toThrow("private-secret");
  });

  it("reports a removed fixture as a nonretryable missing fixture error", () => {
    expect(() => fixtureFetch(file("removed-private-path"))).toThrowError(
      expect.objectContaining({
        code: "PROVIDER_SCHEMA",
        message: "missing fixture",
        retryable: false,
      }),
    );
  });

  it("keeps the network guard active", async () => {
    await expect(
      globalThis.fetch("https://api.jup.ag/price/v3"),
    ).rejects.toThrow("network disabled in tests");
  });
});
