import "./test-setup.js";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import {
  PROGRAM_IDS,
  WSOL_MINT,
  XRAY_PRICE_MAX_AGE_SLOTS,
  XRAY,
} from "@onepercent/eligibility";
import { MARKET, SERVICES } from "@onepercent/config";
import { HeliusChainSource, ChainSourceError } from "./helius.js";
import { JupiterPriceSource, PriceSourceError } from "./price-source.js";
import { SnsNameResolver } from "./names.js";
import {
  DomainDoesNotExist,
  DomainExpired,
  resolve,
} from "@bonfida/spl-name-service";

vi.mock("@bonfida/spl-name-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bonfida/spl-name-service")>()),
  resolve: vi.fn(),
}));
const owner = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
const mint = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const endpoint = "https://example.test/?api-key=never-expose";
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const rpcReply = (result: unknown) => reply({ jsonrpc: "2.0", id: 1, result });
async function fixture(name: string): Promise<unknown> {
  return z
    .object({ response: z.unknown() })
    .parse(
      JSON.parse(
        await readFile(
          new URL(`./__fixtures__/${name}.json`, import.meta.url),
          "utf8",
        ),
      ),
    ).response;
}
function request(options: RequestInit | undefined): {
  method: string;
  params: unknown[];
} {
  return JSON.parse(String(options?.body)) as {
    method: string;
    params: unknown[];
  };
}

describe("recorded Helius boundaries", () => {
  it("queries both programs in base64 and decodes synthetic accounts derived from recorded bytes", async () => {
    const bodies = await Promise.all(
      ["spl", "token2022"].map((kind) =>
        fixture(`helius-getTokenAccountsByOwner-${kind}-synthetic`),
      ),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(bodies[0]))
      .mockResolvedValueOnce(reply(bodies[1]));
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const accounts = await chain.getTokenAccounts(owner);
    expect(accounts.length).toBeGreaterThan(12);
    expect(
      accounts.some(
        (account) =>
          account.owner === PROGRAM_IDS.splToken && account.data.length === 165,
      ),
    ).toBe(true);
    expect(
      accounts.some(
        (account) =>
          account.owner === PROGRAM_IDS.token2022 &&
          account.data.length === 170,
      ),
    ).toBe(true);
    expect(typeof accounts[0]?.lamports).toBe("bigint");
    for (const [index, programId] of [
      PROGRAM_IDS.splToken,
      PROGRAM_IDS.token2022,
    ].entries()) {
      expect(request(fetcher.mock.calls[index]?.[1])).toEqual({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          owner,
          { programId },
          { encoding: "base64", commitment: "confirmed" },
        ],
      });
    }
  });
  it("accepts real empty responses, recorded slot/time and recorded public mint responses", async () => {
    const bodies = await Promise.all(
      [
        "helius-getTokenAccountsByOwner-spl",
        "helius-getTokenAccountsByOwner-token2022",
        "helius-getSlot",
        "helius-getBlockTime",
        "helius-getMultipleAccounts",
      ].map(fixture),
    );
    const fetcher = vi.fn<typeof fetch>();
    for (const body of bodies) fetcher.mockResolvedValueOnce(reply(body));
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    expect(await chain.getTokenAccounts(owner)).toEqual([]);
    expect(await chain.getSlot()).toBeGreaterThan(0);
    expect(await chain.getBlockTime(1)).toBeGreaterThan(0);
    const addresses = ["a", "b", "c"];
    const accounts = await chain.getAccounts(addresses);
    expect([...accounts.keys()]).toEqual(addresses);
    expect(accounts.get("a")?.data.length).toBeGreaterThan(0);
  });
  it("batches account lookups by 100 and rejects mismatched response lengths", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const addresses = request(options).params[0] as string[];
      return rpcReply({
        context: { slot: 1 },
        value: addresses.map(() => null),
      });
    });
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const addresses = Array.from({ length: 205 }, (_, index) => String(index));
    expect((await chain.getAccounts(addresses)).size).toBe(205);
    expect(
      fetcher.mock.calls.map(
        (call) => (request(call[1]).params[0] as string[]).length,
      ),
    ).toEqual([100, 100, 5]);
    fetcher.mockResolvedValueOnce(
      rpcReply({ context: { slot: 1 }, value: [] }),
    );
    await expect(chain.getAccounts(["a"])).rejects.toBeInstanceOf(
      ChainSourceError,
    );
  });
  it("bounds account fanout at four and retains successful batches after an RPC failure", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const addresses = request(options).params[0] as string[];
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active -= 1;
      if (addresses[0] === "100") return reply({ error: { code: -32000 } });
      return rpcReply({
        context: { slot: 1 },
        value: addresses.map(() => null),
      });
    });
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const addresses = Array.from({ length: 1000 }, (_, index) => String(index));
    const work = chain.getAccountsPartial(addresses);
    await vi.advanceTimersByTimeAsync(150);
    const result = await work;
    expect(maximum).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(result.accounts.size).toBe(900);
    expect(result.accounts.has("100")).toBe(false);
    expect(result.accounts.get("0")).toBeNull();
    expect(result.failed).toEqual(addresses.slice(100, 200));
  });
  it("stops account batches on caller cancellation and preserves completed evidence", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const addresses = request(options).params[0] as string[];
      if (addresses[0] !== "0") return new Promise(() => {});
      return rpcReply({
        context: { slot: 1 },
        value: addresses.map(() => null),
      });
    });
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const controller = new AbortController();
    const addresses = Array.from({ length: 1000 }, (_, index) => String(index));
    const work = chain.getAccountsPartial(addresses, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(5);
    controller.abort();
    const result = await work;
    expect(result.accounts.size).toBe(100);
    expect(result.failed).toEqual(addresses.slice(100));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.every((call) => call[1]?.signal?.aborted)).toBe(
      true,
    );
  });
  it("shares four account batch permits across overlapping reads and cancels queued calls", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const addresses = request(options).params[0] as string[];
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active -= 1;
      return rpcReply({
        context: { slot: 1 },
        value: addresses.map(() => null),
      });
    });
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const controller = new AbortController();
    const first = chain.getAccountsPartial(
      Array.from({ length: 600 }, (_, index) => `a${index}`),
    );
    const second = chain.getAccountsPartial(
      Array.from({ length: 600 }, (_, index) => `b${index}`),
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(4);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect((await first).accounts.size).toBe(600);
    expect((await second).failed).toHaveLength(600);
    expect(maximum).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(
      fetcher.mock.calls.every((call) =>
        (request(call[1]).params[0] as string[])[0]!.startsWith("a"),
      ),
    ).toBe(true);
  });
  it("parses recorded DAS and requests another page when the first one is full", async () => {
    const real = await fixture("helius-getAssetsByOwner");
    const derived = z
      .object({ result: z.object({ items: z.array(z.unknown()) }) })
      .parse(await fixture("helius-getAssetsByOwner-synthetic"));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        rpcReply({
          items: Array.from({ length: 1000 }, () => derived.result.items[0]),
        }),
      )
      .mockResolvedValueOnce(reply(real));
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    expect((await chain.getMetadata(owner)).size).toBe(1);
    expect(request(fetcher.mock.calls[1]?.[1]).params).toMatchObject({
      ownerAddress: owner,
      page: 2,
      limit: 1000,
      options: { showFungible: true, showZeroBalance: true },
    });
  });
  it("caps DAS at 1.5s, retains completed pages and stops after caller cancellation", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        rpcReply({
          items: Array.from({ length: 1000 }, () => ({
            id: mint,
            content: { metadata: { symbol: "TEST" } },
          })),
        }),
      )
      .mockImplementation(() => new Promise(() => {}));
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const started = Date.now();
    const work = chain.getMetadata(owner);
    await vi.advanceTimersByTimeAsync(1500);
    expect(Date.now() - started).toBe(1500);
    expect((await work).get(mint)?.symbol).toBe("TEST");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    const controller = new AbortController();
    const cancelled = chain.getMetadata(owner, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await cancelled).toEqual(new Map());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
  });
  it.each([-32004, -32016, -32007, -32009])(
    "retries a lagging Helius node (%s) without changing the read context",
    async (code) => {
      vi.useFakeTimers();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(reply({ error: { code } }))
        .mockResolvedValueOnce(rpcReply(123));
      const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
      const read = chain.getBlockTime(456);
      await vi.advanceTimersByTimeAsync(
        SERVICES.transport.rpcNodeLagBackoffMaxMs,
      );
      expect(await read).toBe(123);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const calls = fetcher.mock.calls.map(([, options]) => request(options));
      expect(calls[0]).toMatchObject({ method: "getBlockTime", params: [456] });
      expect(calls[1]).toEqual(calls[0]);
    },
  );
  it("bounds Helius node-lag retries and does not retry other RPC rejections", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => reply({ error: { code: -32016 } }));
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const read = expect(chain.getSlot()).rejects.toBeInstanceOf(
      ChainSourceError,
    );
    await vi.advanceTimersByTimeAsync(
      SERVICES.transport.rpcNodeLagMaxAttempts *
        SERVICES.transport.rpcNodeLagBackoffMaxMs,
    );
    await read;
    expect(fetcher).toHaveBeenCalledTimes(
      SERVICES.transport.rpcNodeLagMaxAttempts,
    );
    fetcher.mockClear();
    fetcher.mockImplementation(async () => reply({ error: { code: -32602 } }));
    await expect(chain.getSlot()).rejects.toBeInstanceOf(ChainSourceError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries once on 429/5xx, sanitizes malformed bodies and actually stops hung calls", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply({}, 429))
      .mockResolvedValueOnce(rpcReply(123));
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const retry = chain.getSlot();
    await vi.advanceTimersByTimeAsync(301);
    expect(await retry).toBe(123);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(reply({ result: { secret: endpoint } }));
    await expect(chain.getSlot()).rejects.toThrow(
      "Chain provider request failed",
    );
    fetcher.mockImplementationOnce(() => new Promise(() => {}));
    const stalled = expect(chain.getSlot()).rejects.toBeInstanceOf(
      ChainSourceError,
    );
    await vi.advanceTimersByTimeAsync(5000);
    await stalled;
    expect(fetcher.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
  });
  it("sums snapshot owner/mint balances, treats no history as zero, and leaves malformed evidence unknown", async () => {
    const recorded = await fixture("helius-getTransactionsForAddress");
    const derived = await fixture("helius-getTransactionsForAddress-synthetic");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(derived))
      .mockResolvedValueOnce(reply(recorded))
      .mockResolvedValueOnce(rpcReply({ data: [{ slot: 1, meta: null }] }));
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const result = await chain.getSnapshotEvidence(
      owner,
      [mint, "empty", "unknown"],
      454619967,
    );
    expect(result.get(mint)).toEqual({ balanceAtS: 42n });
    expect(result.get("empty")).toEqual({ balanceAtS: 0n });
    expect(result.get("unknown")).toEqual({ balanceAtS: null });
    expect(request(fetcher.mock.calls[0]?.[1]).params[1]).toEqual({
      transactionDetails: "full",
      encoding: "jsonParsed",
      sortOrder: "desc",
      commitment: "finalized",
      limit: 1,
      maxSupportedTransactionVersion: 1,
      filters: {
        slot: { lte: 454619967 },
        tokenAccounts: "balanceChanged",
        tokenTransfer: { mint },
      },
    });
  });
  it("bounds snapshot fanout at eight and returns unknown at the 2.5s total deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const chain = new HeliusChainSource({ rpcUrl: endpoint, fetch: fetcher });
    const work = chain.getSnapshotEvidence(
      owner,
      Array.from({ length: 20 }, (_, index) => String(index)),
      1,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(2500);
    const result = await work;
    expect(result.size).toBe(20);
    expect([...result.values()].every((item) => item.balanceAtS === null)).toBe(
      true,
    );
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(fetcher.mock.calls.every((call) => call[1]?.signal?.aborted)).toBe(
      true,
    );
  });
});

describe("recorded Jupiter boundaries", () => {
  it("uses the approved host/header and computes ages from the current slot after response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(await fixture("jupiter-prices")));
    const getSlot = vi.fn(async () => 454620967);
    const source = new JupiterPriceSource(
      { getSlot },
      { apiKey: "test-provider-token", fetch: fetcher },
    );
    const prices = await source.getPrices([mint, "missing"]);
    expect(prices[mint]?.ageSlots).toBe(454620967 - prices[mint]!.blockId);
    expect(prices.missing).toBeUndefined();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://api.jup.ag/price/v3?ids=${mint}%2Cmissing`,
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      "x-api-key": "test-provider-token",
    });
    expect(fetcher.mock.invocationCallOrder[0]).toBeLessThan(
      getSlot.mock.invocationCallOrder[0]!,
    );
  });
  it("does not treat null/future block IDs as fresh or fabricate an ATH from token metadata", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply({
          null: { usdPrice: 1, blockId: null },
          future: { usdPrice: 1, blockId: 101 },
          valid: { usdPrice: 1, blockId: 99 },
        }),
      )
      .mockResolvedValueOnce(reply(await fixture("jupiter-tokens")));
    const source = new JupiterPriceSource(
      { getSlot: async () => 100 },
      { maxRps: 1000, fetch: fetcher },
    );
    expect(await source.getPrices(["null", "future", "valid"])).toEqual({
      null: undefined,
      future: undefined,
      valid: { usdPrice: 1, blockId: 99, ageSlots: 1 },
    });
    const tokens = await source.getTokenInfo([mint, "missing"]);
    expect(tokens[mint]?.symbol).toBeTruthy();
    expect(tokens[mint]?.ath).toBeUndefined();
    expect(tokens.missing).toBeUndefined();
  });
  it("treats metadata-only entries as unpriced without failing the batch", async () => {
    // Jupiter now lists unpriced tokens with metadata only (seen live on 2026-10-09).
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      reply({
        unpriced: { createdAt: "2026-10-01T00:00:00Z", decimals: 6 },
        launchpad: {
          createdAt: "2026-10-01T00:00:00Z",
          decimals: 6,
          liquidity: 0,
          launchpad: "pump.fun",
        },
        valid: { usdPrice: 2, blockId: 99, decimals: 6 },
      }),
    );
    const source = new JupiterPriceSource(
      { getSlot: async () => 100 },
      { maxRps: 1000, fetch: fetcher },
    );
    expect(await source.getPrices(["unpriced", "launchpad", "valid"])).toEqual({
      unpriced: undefined,
      launchpad: undefined,
      valid: { usdPrice: 2, blockId: 99, ageSlots: 1 },
    });
  });
  it("chunks 50 price IDs and 100 token searches, and skips empty requests", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      reply(String(url).includes("/price/") ? {} : []),
    );
    const source = new JupiterPriceSource(
      { getSlot: async () => 100 },
      { maxRps: 1000, fetch: fetcher },
    );
    await source.getPrices([]);
    await source.getTokenInfo([]);
    expect(fetcher).not.toHaveBeenCalled();
    await source.getPrices(
      Array.from({ length: 51 }, (_, index) => String(index)),
    );
    await source.getTokenInfo(
      Array.from({ length: 101 }, (_, index) => String(index)),
    );
    expect(
      fetcher.mock.calls.map(
        (call) =>
          new URL(String(call[0])).searchParams
            .values()
            .next()
            .value?.split(",").length,
      ),
    ).toEqual([50, 1, 100, 1]);
  });
  it("serializes keyless requests at 0.5 RPS without sending an empty API key", async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async () => {
      times.push(Date.now());
      return reply([]);
    });
    const source = new JupiterPriceSource(
      { getSlot: async () => 1 },
      { fetch: fetcher },
    );
    const work = Promise.all([
      source.getTokenInfo(["a"]),
      source.getTokenInfo(["b"]),
      source.getTokenInfo(["c"]),
    ]);
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await work;
    expect(times.map((time) => time - times[0]!)).toEqual([0, 2000, 4000]);
    expect(
      fetcher.mock.calls.every(
        (call) => Object.keys(call[1]?.headers ?? {}).length === 0,
      ),
    ).toBe(true);
  });
  it("caches successful token metadata per mint for the configured TTL and only requests misses", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const requested = new URL(String(url)).searchParams
        .get("query")!
        .split(",");
      return reply(
        requested
          .filter((id) => id !== "missing")
          .map((id) => ({ id, symbol: id, name: `Token ${id}` })),
      );
    });
    const source = new JupiterPriceSource(
      { getSlot: async () => 1 },
      { maxRps: 1000, fetch: fetcher },
    );
    const first = await source.getTokenInfo(["a", "missing"]);
    first.a!.symbol = "changed";
    expect((await source.getTokenInfo(["a"])).a?.symbol).toBe("a");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const mixed = source.getTokenInfo(["a", "b", "missing", "b"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await mixed).toMatchObject({
      a: { symbol: "a" },
      b: { symbol: "b" },
      missing: undefined,
    });
    expect(
      new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get("query"),
    ).toBe("b,missing");
    await vi.advanceTimersByTimeAsync(MARKET.tokenInfo.cacheTtlMs);
    expect((await source.getTokenInfo(["a"])).a?.symbol).toBe("a");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not cache malformed token responses or cache hits for an aborted caller", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply([{ id: "a", symbol: 1, name: "bad" }]))
      .mockResolvedValueOnce(
        reply([{ id: "a", symbol: "A", name: "Token A" }]),
      );
    const source = new JupiterPriceSource(
      { getSlot: async () => 1 },
      { maxRps: 1000, fetch: fetcher },
    );
    await expect(source.getTokenInfo(["a"])).rejects.toBeInstanceOf(
      PriceSourceError,
    );
    const retry = source.getTokenInfo(["a"]);
    await vi.advanceTimersByTimeAsync(1);
    expect((await retry).a?.symbol).toBe("A");
    const controller = new AbortController();
    controller.abort();
    await expect(
      source.getTokenInfo(["a"], controller.signal),
    ).rejects.toBeInstanceOf(PriceSourceError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cancels token metadata transport and does not cache a response arriving after abort", async () => {
    vi.useFakeTimers();
    let complete: ((response: Response) => void) | undefined;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce(
        reply([{ id: "a", symbol: "FRESH", name: "Fresh" }]),
      );
    const source = new JupiterPriceSource(
      { getSlot: async () => 1 },
      { maxRps: 1000, fetch: fetcher },
    );
    const controller = new AbortController();
    const cancelled = expect(
      source.getTokenInfo(["a"], controller.signal),
    ).rejects.toBeInstanceOf(PriceSourceError);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await cancelled;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    complete?.(reply([{ id: "a", symbol: "LATE", name: "Late" }]));
    await vi.advanceTimersByTimeAsync(1);
    expect((await source.getTokenInfo(["a"])).a?.symbol).toBe("FRESH");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds the token metadata cache and evicts the least recently used mint", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      reply(
        new URL(String(url)).searchParams
          .get("query")!
          .split(",")
          .map((id) => ({ id, symbol: id, name: id })),
      ),
    );
    const source = new JupiterPriceSource(
      { getSlot: async () => 1 },
      { maxRps: 1000, fetch: fetcher },
    );
    const work = source.getTokenInfo(
      Array.from({ length: XRAY.cacheMaxEntries + 1 }, (_, index) =>
        String(index),
      ),
    );
    await vi.advanceTimersByTimeAsync(100);
    await work;
    const requests = fetcher.mock.calls.length;
    await source.getTokenInfo(["1"]);
    expect(fetcher).toHaveBeenCalledTimes(requests);
    await source.getTokenInfo(["0"]);
    expect(fetcher).toHaveBeenCalledTimes(requests + 1);
  });
  it("retries a transport failure once then continues its serial queue", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply({}, 503))
      .mockResolvedValueOnce(reply([]))
      .mockResolvedValueOnce(reply([]));
    const source = new JupiterPriceSource(
      { getSlot: async () => 1 },
      { apiKey: "test", fetch: fetcher },
    );
    const work = Promise.all([
      source.getTokenInfo(["a"]),
      source.getTokenInfo(["b"]),
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    await work;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("expires queued calls without spending more requests and remains usable afterward", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async () => reply([]));
    const source = new JupiterPriceSource(
      { getSlot: async () => 1 },
      { fetch: fetcher },
    );
    const work = Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        source.getTokenInfo([String(index)]),
      ),
    );
    await vi.advanceTimersByTimeAsync(10001);
    const results = await work;
    expect(
      results.filter((item) => item.status === "rejected").length,
    ).toBeGreaterThan(0);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(5);
    await source.getTokenInfo(["fresh"]);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(6);
  });
  it("does not use stale SOL/USD and redacts malformed, network and stalled failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply({ [WSOL_MINT]: { usdPrice: 100, blockId: 1 } }),
      )
      .mockRejectedValueOnce(new Error(endpoint));
    const source = new JupiterPriceSource(
      { getSlot: async () => XRAY_PRICE_MAX_AGE_SLOTS + 2 },
      { maxRps: 1000, fetch: fetcher },
    );
    await expect(source.getSolUsd()).rejects.toBeInstanceOf(PriceSourceError);
    await expect(source.getPrices([mint])).rejects.toThrow(
      "Price provider request failed",
    );
    vi.useFakeTimers();
    const stalledFetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const stalledSource = new JupiterPriceSource(
      { getSlot: async () => 1 },
      { fetch: stalledFetcher },
    );
    const stalled = expect(
      stalledSource.getTokenInfo([mint]),
    ).rejects.toBeInstanceOf(PriceSourceError);
    await vi.advanceTimersByTimeAsync(5000);
    await stalled;
    expect(stalledFetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

describe("SNS resolution", () => {
  it("is disabled by default and never resolves unsupported names", async () => {
    const mocked = vi.mocked(resolve);
    mocked.mockReset();
    expect(await new SnsNameResolver(endpoint).resolve("test.sns")).toBeNull();
    expect(
      await new SnsNameResolver(endpoint, true).resolve("test.sol"),
    ).toBeNull();
    expect(mocked).not.toHaveBeenCalled();
  });
  it("normalizes accepted names, disallows PDA resolution, and sanitizes failures", async () => {
    const resolver = new SnsNameResolver(endpoint, true);
    const mocked = vi.mocked(resolve);
    mocked.mockReset();
    mocked.mockResolvedValueOnce(new PublicKey(owner));
    expect(await resolver.resolve("TEST.SNS")).toBe(owner);
    expect(mocked).toHaveBeenLastCalledWith(expect.anything(), "test.sns", {
      allowPda: false,
    });
    expect(await resolver.resolve("bad/name.sns")).toBeNull();
    const absent = new DomainDoesNotExist(endpoint);
    expect(absent.name).toBe("SNSError");
    mocked.mockRejectedValueOnce(absent);
    expect(await resolver.resolve("absent.sns")).toBeNull();
    mocked.mockRejectedValueOnce(new DomainExpired(endpoint));
    expect(await resolver.resolve("past.sns")).toBeNull();
    mocked.mockRejectedValueOnce(
      Object.assign(new Error(endpoint), { name: "DomainDoesNotExist" }),
    );
    expect(await resolver.resolve("missing.sns")).toBeNull();
    mocked.mockRejectedValueOnce(
      Object.assign(new Error(endpoint), { name: "DomainExpired" }),
    );
    expect(await resolver.resolve("expired.sns")).toBeNull();
    mocked.mockRejectedValueOnce(new Error(endpoint));
    await expect(resolver.resolve("failed.sns")).rejects.toThrow(
      "Chain provider request failed",
    );
  });
});
