import "./test-setup.js";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PublicKey } from "@solana/web3.js";
import {
  PROGRAM_IDS,
  PUMP_LAYOUTS,
  WSOL_MINT,
  XRAY,
} from "@onepercent/eligibility";
import {
  PROGRAM_IDS as CONFIG_PROGRAM_IDS,
  PUMP_LAYOUTS as CONFIG_PUMP_LAYOUTS,
} from "@onepercent/config";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { describe, expect, it, vi } from "vitest";
import { HeliusChainSource } from "./helius.js";
import { JupiterPriceSource } from "./price-source.js";
import { XrayService } from "./service.js";
import { createXrayRouter } from "./router.js";
import { parseXrayEnv } from "./env.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { SharePageRenderer } from "./share-page.js";
import { createMarketExitCaps } from "./market-exit-caps.js";

const owner = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
const slot = 500_000_000;
const originCount = 600;
const completedCount = 300;
const rpcUrl = "https://rpc.example.test/";
const key = (label: string) =>
  new PublicKey(createHash("sha256").update(label).digest()).toBase58();
const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const rpcResponse = (result: unknown) =>
  response({ jsonrpc: "2.0", id: 1, result });
interface FixtureAccount {
  owner: string;
  lamports: number;
  data: [string, "base64"];
}
function account(
  data: Buffer,
  program: string = PROGRAM_IDS.splToken,
): FixtureAccount {
  return {
    owner: program,
    lamports: 2_039_280,
    data: [data.toString("base64"), "base64"],
  };
}

// Deterministic public account bytes exercise the production adapters without credentials.
function largeWallet() {
  const mints = Array.from({ length: XRAY.maxTokenAccounts }, (_, index) =>
    key(`scale-mint-${index}`),
  );
  const accounts = new Map<string, FixtureAccount>();
  const curveAddresses = new Map<string, string>();
  const poolAddresses = new Map<string, string>();
  const feeProgram = new PublicKey(
    "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  );
  for (const program of [PROGRAM_IDS.pumpFun, CONFIG_PROGRAM_IDS.pumpSwap]) {
    const address = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_config"), new PublicKey(program).toBuffer()],
      feeProgram,
    )[0].toBase58();
    const fee = Buffer.alloc(109);
    Buffer.from("8f3492bbdb7b4c9b", "hex").copy(fee);
    fee.writeUInt32LE(1, 65);
    const split =
      program === PROGRAM_IDS.pumpFun ? [0n, 95n, 30n] : [20n, 5n, 100n];
    for (const [index, value] of split.entries()) {
      fee.writeBigUInt64LE(value, 41 + index * 8);
      fee.writeBigUInt64LE(value, 85 + index * 8);
    }
    accounts.set(address, account(fee, feeProgram.toBase58()));
  }
  const tokens = mints.map((mint, index) => {
    const mintData = Buffer.alloc(82);
    mintData.writeBigUInt64LE(1_000_000_000_000_000n, 36);
    mintData[44] = 6;
    mintData[45] = 1;
    accounts.set(mint, account(mintData));
    const tokenData = Buffer.alloc(165);
    new PublicKey(mint).toBuffer().copy(tokenData, 0);
    new PublicKey(owner).toBuffer().copy(tokenData, 32);
    tokenData.writeBigUInt64LE(BigInt(index + 1) * 100_000_000_000n, 64);
    tokenData[108] = 1;
    if (index < originCount) {
      const curve = Buffer.alloc(81);
      Buffer.from(PUMP_LAYOUTS.bondingCurveDiscriminatorHex, "hex").copy(curve);
      curve.writeBigUInt64LE(1_000_000_000_000_000n, 8);
      curve.writeBigUInt64LE(100_000_000_000n, 16);
      curve.writeBigUInt64LE(500_000_000_000_000n, 24);
      curve.writeBigUInt64LE(50_000_000_000n, 32);
      curve.writeBigUInt64LE(1_000_000_000_000_000n, 40);
      const complete = index >= originCount - completedCount;
      curve[48] = Number(complete);
      if (complete) {
        curve.writeBigUInt64LE(0n, 24);
        curve.writeBigUInt64LE(0n, 32);
      }
      // Construct fixture PDAs directly so production derivation caches stay cold.
      const curveAddress = PublicKey.findProgramAddressSync(
        [
          Buffer.from(PUMP_LAYOUTS.bondingCurveSeed),
          new PublicKey(mint).toBuffer(),
        ],
        new PublicKey(PROGRAM_IDS.pumpFun),
      )[0].toBase58();
      accounts.set(curveAddress, account(curve, PROGRAM_IDS.pumpFun));
      curveAddresses.set(mint, curveAddress);
      if (complete) {
        const mintBytes = new PublicKey(mint).toBuffer();
        const authority = PublicKey.findProgramAddressSync(
          [Buffer.from("pool-authority"), mintBytes],
          new PublicKey(PROGRAM_IDS.pumpFun),
        )[0];
        const [poolAddress, poolBump] = PublicKey.findProgramAddressSync(
          [
            Buffer.from(CONFIG_PUMP_LAYOUTS.poolSeed),
            Buffer.alloc(2),
            authority.toBuffer(),
            mintBytes,
            new PublicKey(WSOL_MINT).toBuffer(),
          ],
          new PublicKey(CONFIG_PROGRAM_IDS.pumpSwap),
        );
        const baseVault = key(`scale-base-vault-${index}`);
        const quoteVault = key(`scale-quote-vault-${index}`);
        const pool = Buffer.alloc(287);
        Buffer.from(CONFIG_PUMP_LAYOUTS.poolDiscriminatorHex, "hex").copy(pool);
        pool[8] = poolBump;
        authority.toBuffer().copy(pool, 11);
        mintBytes.copy(pool, 43);
        new PublicKey(WSOL_MINT).toBuffer().copy(pool, 75);
        new PublicKey(key(`scale-lp-mint-${index}`)).toBuffer().copy(pool, 107);
        new PublicKey(baseVault).toBuffer().copy(pool, 139);
        new PublicKey(quoteVault).toBuffer().copy(pool, 171);
        pool.writeBigUInt64LE(1_000_000n, 203);
        new PublicKey(owner).toBuffer().copy(pool, 211);
        accounts.set(
          poolAddress.toBase58(),
          account(pool, CONFIG_PROGRAM_IDS.pumpSwap),
        );
        poolAddresses.set(mint, poolAddress.toBase58());
        for (const [address, vaultMint, amount] of [
          [baseVault, mint, 900_000_000_000_000n],
          [quoteVault, WSOL_MINT, 100_000_000_000n],
        ] as const) {
          const data = Buffer.alloc(165);
          new PublicKey(vaultMint).toBuffer().copy(data);
          poolAddress.toBuffer().copy(data, 32);
          data.writeBigUInt64LE(amount, 64);
          data[108] = 1;
          if (vaultMint === WSOL_MINT) {
            data.writeUInt32LE(1, 109);
            data.writeBigUInt64LE(2_039_280n, 113);
          }
          const vault = account(data);
          if (vaultMint === WSOL_MINT) vault.lamports += Number(amount);
          accounts.set(address, vault);
        }
      }
    }
    return {
      pubkey: key(`scale-account-${index}`),
      account: account(tokenData),
    };
  });
  return { mints, accounts, tokens, curveAddresses, poolAddresses };
}

const walletFixture = largeWallet();
function harness(
  mode: "normal" | "limited" | "stalled" | "pool-failed" | "final" = "normal",
) {
  const fixture = {
    ...walletFixture,
    accounts: new Map(walletFixture.accounts),
  };
  if (mode === "final") {
    const nonSolMint = fixture.mints[0]!;
    const nonSolCurve = fixture.curveAddresses.get(nonSolMint)!;
    const nonSolData = Buffer.alloc(115);
    Buffer.from(fixture.accounts.get(nonSolCurve)!.data[0], "base64").copy(
      nonSolData,
    );
    new PublicKey(key("non-sol-quote")).toBuffer().copy(nonSolData, 83);
    fixture.accounts.set(nonSolCurve, account(nonSolData, PROGRAM_IDS.pumpFun));

    const overReserveCurve = fixture.curveAddresses.get(fixture.mints[1]!)!;
    const overReserveData = Buffer.from(
      fixture.accounts.get(overReserveCurve)!.data[0],
      "base64",
    );
    overReserveData.writeBigUInt64LE(1n, 32);
    fixture.accounts.set(
      overReserveCurve,
      account(overReserveData, PROGRAM_IDS.pumpFun),
    );

    const completedMint = fixture.mints[originCount - completedCount]!;
    fixture.accounts.delete(fixture.poolAddresses.get(completedMint)!);
  }
  const rpcCalls: { method: string; params: unknown[] }[] = [];
  const jupiterCalls: { url: URL; at: number; signal?: AbortSignal | null }[] =
    [];
  let activeBatches = 0;
  let maxActiveBatches = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname === "api.jup.ag") {
      jupiterCalls.push({ url, at: Date.now(), signal: options?.signal });
      if (mode === "stalled") return new Promise(() => {});
      await wait(100);
      if (mode === "limited") return response({}, 429);
      const ids = url.searchParams.get("query")?.split(",") ?? [];
      return response(
        ids.map((id) => ({ id, symbol: "PUMP", name: "Pump token" })),
      );
    }
    const body = JSON.parse(String(options?.body)) as {
      method: string;
      params: unknown[];
    };
    rpcCalls.push(body);
    if (body.method === "getMultipleAccounts") {
      activeBatches += 1;
      maxActiveBatches = Math.max(maxActiveBatches, activeBatches);
      await wait(50);
      activeBatches -= 1;
      const addresses = body.params[0] as string[];
      if (
        mode === "pool-failed" &&
        addresses.some(
          (address) =>
            fixture.accounts.get(address)?.owner ===
            CONFIG_PROGRAM_IDS.pumpSwap,
        )
      )
        return response({}, 503);
      return rpcResponse({
        context: { slot },
        value: addresses.map(
          (address) => fixture.accounts.get(address) ?? null,
        ),
      });
    }
    if (mode === "stalled" && body.method === "getAssetsByOwner")
      return new Promise(() => {});
    await wait(50);
    switch (body.method) {
      case "getTokenAccountsByOwner":
        return rpcResponse({
          context: { slot },
          value:
            (body.params[1] as { programId: string }).programId ===
            PROGRAM_IDS.splToken
              ? fixture.tokens
              : [],
        });
      case "getSlot":
        return rpcResponse(slot);
      case "getAssetsByOwner": {
        const { page, limit } = body.params as unknown as {
          page: number;
          limit: number;
        };
        return rpcResponse({
          items: fixture.mints
            .slice((page - 1) * limit, page * limit)
            .map((id, index) => ({
              id,
              content: {
                metadata: { symbol: `T${index}`, name: "On-chain token" },
              },
            })),
        });
      }
      default:
        throw new Error(`Unexpected scale fixture method: ${body.method}`);
    }
  });
  const chain = new HeliusChainSource({ rpcUrl, fetch: fetcher });
  const prices = new JupiterPriceSource(chain, {
    apiKey: "fixture-free-plan",
    fetch: fetcher,
  });
  const service = new XrayService({
    chain,
    prices,
    exitCaps: createMarketExitCaps({ rpcUrl, fetch: fetcher }),
    names: { resolve: async () => null },
    publicWebUrl: "https://web.example.test",
    publicApiUrl: "https://api.example.test",
  });
  const router = createXrayRouter({
    service,
    env: parseXrayEnv({}),
    limiter: new SlidingWindowRateLimiter(),
    turnstile: { verify: async () => true },
    sharePage: new SharePageRenderer("https://web.example.test"),
  });
  return {
    service,
    router,
    fixture,
    fetcher,
    rpcCalls,
    jupiterCalls,
    maxActiveBatches: () => maxActiveBatches,
  };
}

describe("X-ray at the maximum wallet size", () => {
  it(
    "keeps actual CPU and transport time for 2000 accounts under the server budget",
    { timeout: 30_000 },
    async () => {
      const source = harness();
      const started = performance.now();
      const result = await source.service.get(owner);
      const elapsedMs = performance.now() - started;
      console.info("X-ray scale fixture", {
        elapsedMs: Math.round(elapsedMs),
        accounts: XRAY.maxTokenAccounts,
        origins: originCount,
        activeCurves: originCount - completedCount,
        canonicalPools: completedCount,
        jupiterCalls: source.jupiterCalls.length,
      });
      expect(elapsedMs).toBeLessThan(10_000);
      expect(result.bags).toHaveLength(2000);
      expect(result.counts.bags).toBe(originCount);
      expect(result.valuesPartial).not.toBe(true);
      expect(
        result.bags.filter((bag) => bag.valueSol !== undefined),
      ).toHaveLength(originCount);
      expect(source.jupiterCalls).toHaveLength(1);
      expect(source.jupiterCalls[0]?.url.pathname).toBe("/tokens/v2/search");
      expect(
        result.bags.find((bag) => bag.mint === source.fixture.mints[0])
          ?.valueSol,
      ).toBe("0.009874011");
      expect(
        result.bags.find((bag) => bag.mint === source.fixture.mints[599])
          ?.valueSol,
      ).toBe("6.171874998");
    },
  );
  it(
    "finishes 2000 accounts and 600 origins inside 10s using one free-plan Jupiter call",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers();
      const source = harness();
      const started = Date.now();
      let finished = 0;
      const work = source.service.get(owner).then((result) => {
        finished = Date.now();
        return result;
      });
      await vi.advanceTimersByTimeAsync(9_999);
      const result = XrayResultSchema.parse(await work);
      expect(finished - started).toBeLessThan(10_000);
      expect(finished - started).toBeLessThan(2_000);
      expect(result.bags).toHaveLength(2000);
      expect(result.counts.bags).toBe(originCount);
      expect(result.counts.notInSet).toBe(1400);
      expect(result.valuesPartial).not.toBe(true);
      expect(
        result.bags.filter((bag) => bag.valueSol !== undefined),
      ).toHaveLength(originCount);
      expect(
        result.bags
          .filter((bag) => bag.buckets.includes("not_in_set"))
          .every((bag) => bag.valueSol === undefined),
      ).toBe(true);
      expect(source.jupiterCalls).toHaveLength(1);
      expect(source.jupiterCalls[0]?.url.pathname).toBe("/tokens/v2/search");
      const metadataMints =
        source.jupiterCalls[0]!.url.searchParams.get("query")!.split(",");
      expect(metadataMints).toHaveLength(100);
      expect(new Set(metadataMints)).toEqual(
        new Set(source.fixture.mints.slice(500, 600)),
      );
      const batches = source.rpcCalls.filter(
        (call) => call.method === "getMultipleAccounts",
      );
      expect(batches.length).toBeGreaterThanOrEqual(40);
      expect(batches.length).toBeLessThanOrEqual(50);
      expect(
        batches.every(
          (call) =>
            (call.params[0] as string[]).length <= XRAY.accountsPerBatch,
        ),
      ).toBe(true);
      expect(source.maxActiveBatches()).toBeLessThanOrEqual(4);
    },
  );

  it(
    "returns and caches HTTP 200 without partial values during continuous Jupiter metadata 429s",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers();
      const source = harness("limited");
      const work = source.router.request(`/api/xray/${owner}`);
      await vi.advanceTimersByTimeAsync(9_999);
      const reply = await work;
      expect(reply.status).toBe(200);
      const result = XrayResultSchema.parse(await reply.json());
      expect(result.valuesPartial).not.toBe(true);
      expect(result.counts.bags).toBe(originCount);
      expect(
        result.bags.filter((bag) => bag.valueSol !== undefined),
      ).toHaveLength(originCount);
      expect(source.jupiterCalls.length).toBeLessThanOrEqual(4);
      expect(
        source.jupiterCalls.every(
          (call) => call.url.pathname === "/tokens/v2/search",
        ),
      ).toBe(true);
      const again = source.service.get(owner);
      await vi.advanceTimersByTimeAsync(9_999);
      expect((await again).cached).toBe(true);
      expect(
        source.rpcCalls.filter(
          (call) => call.method === "getTokenAccountsByOwner",
        ),
      ).toHaveLength(2);
    },
  );

  it(
    "cuts off stalled optional providers and starts no requests after the deadline",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers();
      const source = harness("stalled");
      const started = Date.now();
      let finished = 0;
      const work = source.service.get(owner).then((result) => {
        finished = Date.now();
        return result;
      });
      await vi.advanceTimersByTimeAsync(9_999);
      const result = await work;
      expect(result.valuesPartial).not.toBe(true);
      expect(result.counts.bags).toBe(originCount);
      expect(
        result.bags.filter((bag) => bag.valueSol !== undefined),
      ).toHaveLength(originCount);
      expect(finished - started).toBeLessThan(10_000);
      const requests = source.fetcher.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(source.fetcher).toHaveBeenCalledTimes(requests);
      expect(source.jupiterCalls.every((call) => call.signal?.aborted)).toBe(
        true,
      );
      expect((await source.service.get(owner)).cached).toBe(true);
      expect(source.fetcher).toHaveBeenCalledTimes(requests);
    },
  );

  it(
    "finishes a cacheable maximum-size HTTP response within 10s despite stalled metadata",
    { timeout: 30_000 },
    async () => {
      vi.useRealTimers();
      const source = harness("stalled");
      const started = performance.now();
      const reply = await source.router.request(`/api/xray/${owner}`);
      const elapsedMs = performance.now() - started;
      console.info("X-ray stalled metadata scale fixture", {
        elapsedMs: Math.round(elapsedMs),
        accounts: XRAY.maxTokenAccounts,
        origins: originCount,
        jupiterCalls: source.jupiterCalls.length,
      });
      expect(elapsedMs).toBeLessThan(10_000);
      expect(reply.status).toBe(200);
      const result = XrayResultSchema.parse(await reply.json());
      expect(result.valuesPartial).not.toBe(true);
      expect(result.bags).toHaveLength(XRAY.maxTokenAccounts);
      expect(result.counts.bags).toBe(originCount);
      expect(
        result.bags.filter((bag) => bag.valueSol !== undefined),
      ).toHaveLength(originCount);
      expect(source.jupiterCalls).toHaveLength(1);
      expect(source.jupiterCalls.every((call) => call.signal?.aborted)).toBe(
        true,
      );
      const requests = source.fetcher.mock.calls.length;
      // Cover another full provider timeout after cancellation, with real timers.
      await wait(5_100);
      expect(source.fetcher).toHaveBeenCalledTimes(requests);
      expect((await source.service.get(owner)).cached).toBe(true);
      expect(source.fetcher).toHaveBeenCalledTimes(requests);
    },
  );

  it(
    "keeps all 600 bag categories and the card while failed pool reads return uncached HTTP 200 partial values",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers();
      const baseline = harness();
      const normalWork = baseline.router.request(`/api/xray/${owner}`);
      await vi.advanceTimersByTimeAsync(9_999);
      const normalReply = await normalWork;
      expect(normalReply.status).toBe(200);
      const normal = XrayResultSchema.parse(await normalReply.json());

      const source = harness("pool-failed");
      const started = Date.now();
      let finished = 0;
      const work = Promise.resolve(
        source.router.request(`/api/xray/${owner}`),
      ).then((reply) => {
        finished = Date.now();
        return reply;
      });
      await vi.advanceTimersByTimeAsync(9_999);
      const reply = await work;
      expect(reply.status).toBe(200);
      const result = XrayResultSchema.parse(await reply.json());
      expect(finished - started).toBeLessThan(10_000);
      expect(result.valuesPartial).toBe(true);
      expect(result.cached).toBe(false);
      expect(result.bags).toHaveLength(XRAY.maxTokenAccounts);
      expect(result.counts.bags).toBe(originCount);
      expect(result.counts.checkAtFeed).toBe(normal.counts.checkAtFeed);
      expect(result.counts.notInSet).toBe(normal.counts.notInSet);
      expect(result.card).toEqual(normal.card);
      const priced = result.bags.filter((bag) => bag.valueSol !== undefined);
      expect(priced).toHaveLength(originCount - completedCount);
      expect(new Set(priced.map((bag) => bag.mint))).toEqual(
        new Set(source.fixture.mints.slice(0, originCount - completedCount)),
      );
      expect(source.jupiterCalls).toHaveLength(1);
      expect(source.maxActiveBatches()).toBeLessThanOrEqual(4);

      const againWork = source.router.request(`/api/xray/${owner}`);
      await vi.advanceTimersByTimeAsync(9_999);
      const againReply = await againWork;
      expect(againReply.status).toBe(200);
      const again = XrayResultSchema.parse(await againReply.json());
      expect(again.cached).toBe(false);
      expect(again.valuesPartial).toBe(true);
      expect(again.counts.bags).toBe(originCount);
      expect(again.card).toEqual(normal.card);
      expect(
        again.bags.filter((bag) => bag.valueSol !== undefined),
      ).toHaveLength(originCount - completedCount);
      expect(
        source.rpcCalls.filter(
          (call) => call.method === "getTokenAccountsByOwner",
        ),
      ).toHaveLength(4);
    },
  );

  it(
    "caches final absent-pool, non-SOL and over-reserve states without marking values partial",
    { timeout: 30_000 },
    async () => {
      vi.useFakeTimers();
      const source = harness("final");
      const started = Date.now();
      let finished = 0;
      const work = Promise.resolve(
        source.router.request(`/api/xray/${owner}`),
      ).then((reply) => {
        finished = Date.now();
        return reply;
      });
      await vi.advanceTimersByTimeAsync(9_999);
      const reply = await work;
      expect(reply.status).toBe(200);
      const result = XrayResultSchema.parse(await reply.json());
      expect(finished - started).toBeLessThan(10_000);
      expect(result.valuesPartial).not.toBe(true);
      expect(result.counts.bags).toBe(originCount);
      expect(result.counts.notInSet).toBe(XRAY.maxTokenAccounts - originCount);
      expect(
        result.bags.filter((bag) => bag.valueSol !== undefined),
      ).toHaveLength(originCount - 3);
      for (const index of [0, 1, originCount - completedCount]) {
        const bag = result.bags.find(
          (item) => item.mint === source.fixture.mints[index],
        );
        expect(bag?.valueSol).toBeUndefined();
        expect(bag?.buckets).toContain("feedable");
      }
      expect(source.jupiterCalls).toHaveLength(1);
      expect(source.maxActiveBatches()).toBeLessThanOrEqual(4);
      const requests = source.fetcher.mock.calls.length;
      const againReply = await source.router.request(`/api/xray/${owner}`);
      expect(againReply.status).toBe(200);
      const again = XrayResultSchema.parse(await againReply.json());
      expect(again.cached).toBe(true);
      expect(again.valuesPartial).not.toBe(true);
      expect(again.card).toEqual(result.card);
      expect(source.fetcher).toHaveBeenCalledTimes(requests);

      // Harness mutations are local; subsequent normal scans use the original bytes.
      const originalPool = walletFixture.poolAddresses.get(
        walletFixture.mints[originCount - completedCount]!,
      )!;
      expect(walletFixture.accounts.has(originalPool)).toBe(true);
      const originalCurve = walletFixture.curveAddresses.get(
        walletFixture.mints[0]!,
      )!;
      expect(
        Buffer.from(
          walletFixture.accounts.get(originalCurve)!.data[0],
          "base64",
        ),
      ).toHaveLength(81);
    },
  );
});
