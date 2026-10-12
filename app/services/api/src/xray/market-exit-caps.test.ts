import "./test-setup.js";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { lamportsToSol, type RawAccount } from "@onepercent/eligibility";
import { curveSellValue, decodeBondingCurve } from "@onepercent/market";
import { fixtureFetch } from "@onepercent/market/testing";
import { createMarketExitCaps } from "./market-exit-caps.js";
import { createXrayDependencies } from "./deps.js";
import { createFixtureSources } from "./fixture-source.js";
import { HeliusChainSource } from "./helius.js";
import { JupiterPriceSource } from "./price-source.js";

const rpcUrl = "https://rpc.invalid/";
const file = (name: string) =>
  new URL(
    `../../../../packages/market/tests/fixtures/rpc/${name}.json`,
    import.meta.url,
  );
const recordedSchema = z.object({
  provenance: z.object({ mint: z.string() }).optional(),
  request: z.object({ body: z.object({ params: z.array(z.unknown()) }) }),
  response: z.object({
    body: z.object({
      result: z.object({
        context: z.object({ slot: z.number() }),
        value: z.object({
          owner: z.string(),
          lamports: z.number(),
          data: z.tuple([z.string(), z.string()]),
        }),
      }),
    }),
  }),
});
async function curve(name: string) {
  return recordedSchema.parse(JSON.parse(await readFile(file(name), "utf8")));
}
const cases = {
  curve: ["curve-166-live"],
  pool: ["curve-151-pqc", "pool-pqc", "vault-pqc"],
  absent: ["curve-150-pnut", "pool-pnut-absent"],
};
afterEach(() => vi.restoreAllMocks());

describe("X2 exit reserve adapter", () => {
  it("returns a partial batch at the lookup deadline and suppresses later retries", async () => {
    vi.useFakeTimers();
    const recorded = await curve("curve-81-a");
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          status: 429,
          headers: {
            "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 60),
          },
        }),
    );
    const source = createMarketExitCaps({ rpcUrl, fetch: fetcher });
    const work = source.getSellValues!([
      { mint: recorded.provenance!.mint, amount: 100n },
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await work;
    expect(result.partial).toBe(true);
    expect(result.values.get(recorded.provenance!.mint)?.reason).toBe("UNREAD");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns X2 curve and canonical PumpSwap evidence without applying a second fee", async () => {
    for (const [kind, names] of Object.entries(cases).filter(
      ([kind]) => kind !== "absent",
    )) {
      const recorded = await curve(names[0]!);
      const fetcher = vi.fn(fixtureFetch(names.map(file)));
      const source = createMarketExitCaps({ rpcUrl, fetch: fetcher });
      const cap = await source.getExitCap(recorded.provenance!.mint);
      expect(cap.kind).toBe(kind === "curve" ? "curve" : "pumpswap");
      if (cap.kind === "none") throw new Error("Expected reserve evidence");
      expect(cap.solQuote).toBe(true);
      expect(cap.realQuoteLamports).toBeGreaterThan(0n);
      expect(Number.isSafeInteger(cap.feeBps)).toBe(true);
      if (kind === "pool") expect(cap.realQuoteLamports).toBe(253476777794n);
      expect(fetcher).toHaveBeenCalledTimes(kind === "curve" ? 1 : 3);
    }
  });
  it("keeps missing canonical pools distinct from unavailable RPC evidence", async () => {
    const absent = await curve(cases.absent[0]!);
    expect(
      await createMarketExitCaps({
        rpcUrl,
        fetch: fixtureFetch(cases.absent.map(file)),
      }).getExitCap(absent.provenance!.mint),
    ).toEqual({ kind: "none" });
    const recorded = await curve("curve-81-a");
    await expect(
      createMarketExitCaps({
        rpcUrl,
        fetch: fixtureFetch(file("curve-rpc-error")),
      }).getExitCap(recorded.provenance!.mint),
    ).rejects.toMatchObject({ code: "EXIT_CAP_UNAVAILABLE" });
  });
  it("aborts a stalled lookup at 5s and emits no later market retries", async () => {
    vi.useFakeTimers();
    const recorded = await curve("curve-81-a");
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const source = createMarketExitCaps({ rpcUrl, fetch: fetcher });
    const assertion = expect(
      source.getExitCap(recorded.provenance!.mint),
    ).rejects.toMatchObject({ code: "EXIT_CAP_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not let a provider retry delay send a request after the lookup expires", async () => {
    vi.useFakeTimers();
    const recorded = await curve("curve-81-a");
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          status: 429,
          headers: {
            "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 60),
          },
        }),
    );
    const assertion = expect(
      createMarketExitCaps({ rpcUrl, fetch: fetcher }).getExitCap(
        recorded.provenance!.mint,
      ),
    ).rejects.toMatchObject({ code: "EXIT_CAP_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("shares the market RPC limit and suppresses expired requests awaiting admission", async () => {
    vi.useFakeTimers();
    const recorded = await curve("curve-81-a");
    const fetcher = vi.fn(fixtureFetch(file("curve-81-a")));
    const source = createMarketExitCaps({ rpcUrl, fetch: fetcher });
    // Pins the current market operational budget; this does not introduce a new limit.
    const work = Promise.allSettled(
      Array.from({ length: 601 }, () =>
        source.getExitCap(recorded.provenance!.mint),
      ),
    );
    await vi.advanceTimersByTimeAsync(5000);
    const results = await work;
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(600);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(600);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(600);
  }, 30_000);
});

describe("X-ray runtime cap wiring", () => {
  it("wires batched reserve sale values into a live scan without token prices", async () => {
    const sources = await createFixtureSources();
    const recorded = await curve("curve-81-a");
    const mint = recorded.provenance!.mint;
    const curveAddress = z.string().parse(recorded.request.body.params[0]);
    const curveValue = recorded.response.body.result.value;
    // A synthetic live reserve balance gives this wiring fixture a sellable bag.
    const curveData = Buffer.from(curveValue.data[0], "base64");
    curveData.writeBigUInt64LE(10_000_000_000n, 32);
    const curveAccount: RawAccount = {
      address: curveAddress,
      owner: curveValue.owner,
      lamports: BigInt(curveValue.lamports),
      data: curveData,
    };
    const owner = sources.owners.trencher!;
    const token = (await sources.chain.getTokenAccounts(owner))[0]!;
    const originalMint = new PublicKey(token.data.subarray(0, 32)).toBase58();
    const originalMintAccount = (
      await sources.chain.getAccounts([originalMint])
    ).get(originalMint)!;
    // Synthetic holding and mint bytes isolate API wiring from the wallet scan.
    const data = Buffer.from(token.data);
    new PublicKey(mint).toBuffer().copy(data, 0);
    const amount = 100_000_000_000n;
    data.writeBigUInt64LE(amount, 64);
    vi.spyOn(HeliusChainSource.prototype, "getTokenAccounts").mockResolvedValue(
      [{ ...token, data }],
    );
    vi.spyOn(
      HeliusChainSource.prototype,
      "getAccountsPartial",
    ).mockImplementation(async (addresses) => ({
      accounts: new Map(
        addresses.map((address) => [
          address,
          address === mint
            ? { ...originalMintAccount, address: mint }
            : address === curveAddress
              ? curveAccount
              : null,
        ]),
      ),
      failed: [],
    }));
    vi.spyOn(HeliusChainSource.prototype, "getSlot").mockResolvedValue(
      recorded.response.body.result.context.slot,
    );
    vi.spyOn(HeliusChainSource.prototype, "getMetadata").mockResolvedValue(
      new Map(),
    );
    const getPrices = vi.spyOn(JupiterPriceSource.prototype, "getPrices");
    vi.spyOn(JupiterPriceSource.prototype, "getTokenInfo").mockResolvedValue(
      {},
    );
    vi.spyOn(JupiterPriceSource.prototype, "getSolUsd").mockResolvedValue(100);
    const fetcher = vi.fn(fixtureFetch(file("sell-fee-configs")));
    vi.stubGlobal("fetch", fetcher);
    const { service } = await createXrayDependencies({
      XRAY_SOURCE: "live",
      HELIUS_RPC_URL: rpcUrl,
      TURNSTILE_SECRET: "test-only-turnstile",
    });
    const result = await service.get(owner);
    const expected = curveSellValue(
      decodeBondingCurve(Buffer.from(curveAccount.data)),
      amount,
    ).lamports!;
    expect(result.bags[0]?.valueSol).toBe(lamportsToSol(expected));
    expect(getPrices).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps fixture mode offline and honors an injected cap source", async () => {
    const sources = await createFixtureSources();
    const getExitCap = vi.fn(async () => ({ kind: "none" as const }));
    const getSellValues = vi.fn(async () => ({
      values: new Map(),
      partial: true,
    }));
    const { service } = await createXrayDependencies(
      { XRAY_SOURCE: "fixtures" },
      undefined,
      { exitCaps: { getExitCap, getSellValues } },
    );
    const result = await service.get(sources.owners.trencher!);
    expect(result.counts.bags).toBeGreaterThan(0);
    expect(result.bags.every((bag) => bag.valueSol === undefined)).toBe(true);
    expect(getSellValues).toHaveBeenCalled();
    expect(getExitCap).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
