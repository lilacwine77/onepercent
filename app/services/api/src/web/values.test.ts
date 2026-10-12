import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValuesResponse, wireJson } from "@onepercent/web-api";
import { MARKET } from "@onepercent/config";
import { WebValues, type WebValueSources } from "./values.js";
const mint = "So11111111111111111111111111111111111111112";
function sources(): WebValueSources {
  return {
    metadata: async () => ({
      [mint]: {
        name: "A\u202ecoin\u0000",
        symbol: "T<EST>",
        decimals: 6,
        logoURI: "https://ipfs.io/ipfs/test",
      },
    }),
    prices: {
      getPrices: async () => ({
        [mint]: { usdPrice: 1_000, ageSlots: 1, blockId: 100 },
      }),
      getSolUsd: async () => 100,
    },
    getExitCap: async () => ({
      kind: "pumpswap",
      realQuoteLamports: 100_000n,
      feeBps: 125,
      mayhem: false,
      solQuote: true,
      slot: 100,
    }),
    valueNow: async () => ({
      status: "ok",
      lamports: 42n,
      quoteLamports: 42n,
      capped: false,
      router: "fixture",
      requestId: "fixture",
      fetchedAtMs: 0,
    }),
  };
}
beforeEach(() =>
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network in unit test");
  }),
);
afterEach(() => vi.unstubAllGlobals());
describe("web values", () => {
  it("caps a stale high display price at actual thin pool reserves after fees", async () => {
    const source = sources();
    source.prices.getPrices = async () => ({
      [mint]: {
        usdPrice: 1_000,
        ageSlots: MARKET.price.maxAgeSlots,
        blockId: 100,
      },
    });
    const result = await new WebValues(source).get({
      mode: "est",
      items: [{ mint, amount: 1_000_000n }],
    });
    expect(result.items[0]?.value).toEqual({
      status: "ok",
      lamports: 98_750n,
      capped: true,
      label: "est",
    });
    expect(ValuesResponse.parse(JSON.parse(wireJson(result)))).toEqual(result);
    expect(result.items[0]?.name).toBe("Acoin");
  });
  it("shows no estimate without a readable cap or beyond the market list price-age bound", async () => {
    const source = sources();
    source.getExitCap = async () => ({ kind: "none" });
    expect(
      (
        await new WebValues(source).get({
          mode: "est",
          items: [{ mint, amount: 1n }],
        })
      ).items[0]?.value.status,
    ).toBe("unavailable");
    source.getExitCap = sources().getExitCap;
    source.prices.getPrices = async () => ({
      [mint]: {
        usdPrice: 1_000,
        ageSlots: MARKET.price.maxAgeSlots + 1,
        blockId: 100,
      },
    });
    expect(
      (
        await new WebValues(source).get({
          mode: "est",
          items: [{ mint, amount: 1n }],
        })
      ).items[0]?.value.status,
    ).toBe("unavailable");
  });
  it("uses only X2 executable valueNow for now labels and preserves unavailable reasons", async () => {
    const source = sources();
    source.prices.getPrices = async () => {
      throw new Error("Estimate source must not run");
    };
    expect(
      (
        await new WebValues(source).get({
          mode: "now",
          items: [{ mint, amount: 1n }],
        })
      ).items[0]?.value,
    ).toEqual({
      status: "ok",
      lamports: 42n,
      capped: false,
      label: "if_sold_now",
    });
    source.valueNow = async () => ({
      status: "unavailable",
      reason: "NO_QUOTE",
    });
    expect(
      (
        await new WebValues(source).get({
          mode: "now",
          items: [{ mint, amount: 1n }],
        })
      ).items[0]?.value,
    ).toEqual({ status: "unavailable", reason: "NO_QUOTE" });
  });
  it("never substitutes invented metadata or values after provider failures", async () => {
    const source = sources();
    source.metadata = async () => {
      throw new Error("Unavailable");
    };
    source.valueNow = async () => {
      throw new Error("Unavailable");
    };
    const result = await new WebValues(source).get({
      mode: "now",
      items: [{ mint, amount: 1n }],
    });
    expect(result.items[0]).toMatchObject({
      decimals: null,
      logo: null,
      name: "",
      symbol: "",
      value: { status: "unavailable" },
    });
  });
});
