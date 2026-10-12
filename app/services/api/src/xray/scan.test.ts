import "./test-setup.js";
import { describe, expect, it, vi } from "vitest";
import { createFixtureSources } from "./fixture-source.js";
import { scanWallet } from "./scan.js";
import {
  bondingCurvePda,
  checkPumpOrigin,
  WSOL_MINT,
} from "@onepercent/eligibility";
import type { ExitCapSource } from "./provider-types.js";
import { XrayService } from "./service.js";
import { createXrayRouter } from "./router.js";
import { parseXrayEnv } from "./env.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { SharePageRenderer } from "./share-page.js";

const origins = {
  publicWebUrl: "http://localhost:5173",
  publicApiUrl: "http://localhost:3000",
};
const mint = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const getExitCap: ExitCapSource["getExitCap"] = async () => ({ kind: "none" });
const valuesFor = (holdings: readonly { mint: string }[]) => ({
  partial: false,
  values: new Map(
    holdings.map(({ mint: id }) => [
      id,
      { lamports: 2_970_000n, slot: 454620967 },
    ]),
  ),
});
describe("scan boundary regressions", () => {
  it("keeps missing and unreadable mint amounts unavailable without failing the scan", async () => {
    for (const missing of [true, false]) {
      const sources = await createFixtureSources();
      const getAccounts = sources.chain.getAccounts;
      sources.chain.getAccounts = async (addresses) => {
        const records = await getAccounts(addresses);
        const account = records.get(mint);
        if (account)
          records.set(
            mint,
            missing ? null : { ...account, data: new Uint8Array([1, 2]) },
          );
        return records;
      };
      const { result } = await scanWallet(sources.owners.trencher!, {
        ...sources,
        ...origins,
      });
      expect(result.bags.find((bag) => bag.mint === mint)).toMatchObject({
        decimals: null,
        amountUi: null,
        reasonCode: missing ? "mint_missing" : "mint_unparseable",
        buckets: ["not_in_set"],
      });
      expect(result.bags.find((bag) => bag.mint === mint)).not.toHaveProperty(
        "valueSol",
      );
      expect(result.counts.bags).toBe(
        result.counts.feedable +
          result.counts.checkAtFeed +
          result.counts.notFeedable,
      );
    }
  });
  it("has no uncapped display path, even with fresh prices and a readable live curve", async () => {
    const sources = await createFixtureSources();
    const { result } = await scanWallet(sources.owners.trencher!, {
      ...sources,
      ...origins,
      exitCaps: undefined,
    });
    expect(
      result.bags.every(
        (bag) => bag.valueSol === undefined && !bag.buckets.includes("sell"),
      ),
    ).toBe(true);
    expect(result.totals.sellValueSol).toBe("0");
  });
  it("values origin bags from reserve proceeds without requesting token prices", async () => {
    const sources = await createFixtureSources();
    const prices = vi.spyOn(sources.prices, "getPrices");
    const { result } = await scanWallet(sources.owners.trencher!, {
      ...sources,
      ...origins,
      exitCaps: {
        getExitCap,
        getSellValues: async (holdings) => valuesFor(holdings),
      },
    });
    expect(result.bags.find((bag) => bag.mint === mint)?.valueSol).toBe(
      "0.00297",
    );
    expect(prices).not.toHaveBeenCalled();
  });
  it("omits unsupported reserves without discarding the wallet", async () => {
    const sources = await createFixtureSources();
    const { result } = await scanWallet(sources.owners.trencher!, {
      ...sources,
      ...origins,
      exitCaps: {
        getExitCap,
        getSellValues: async () => ({ values: new Map(), partial: false }),
      },
    });
    expect(result.counts.bags).toBe(12);
    expect(result.bags.every((bag) => bag.valueSol === undefined)).toBe(true);
  });
  it.each(["error", "timeout"])(
    "returns an uncached partial scan on reserve %s and recovers next time",
    async (failure) => {
      const sources = await createFixtureSources();
      vi.useFakeTimers();
      const accounts = vi.spyOn(sources.chain, "getTokenAccounts");
      let unavailable = true;
      const service = new XrayService({
        ...sources,
        ...origins,
        exitCaps: {
          getExitCap,
          async getSellValues(holdings) {
            if (!unavailable) return valuesFor(holdings);
            if (failure === "error")
              throw new Error("private provider details");
            return new Promise(() => {});
          },
        },
      });
      const owner = sources.owners.trencher!;
      const pending = service.get(owner);
      await vi.advanceTimersByTimeAsync(failure === "timeout" ? 9_501 : 1);
      const partial = await pending;
      expect(partial.valuesPartial).toBe(true);
      expect(partial.bags.every((bag) => bag.valueSol === undefined)).toBe(
        true,
      );
      unavailable = false;
      const recovered = service.get(owner);
      await vi.advanceTimersByTimeAsync(1);
      expect((await recovered).cached).toBe(false);
      expect((await service.get(owner)).cached).toBe(true);
      expect(accounts).toHaveBeenCalledTimes(2);
    },
  );
  it("requests reserves only for proved origin mints and bounds metadata to bags", async () => {
    const sources = await createFixtureSources();
    const getSellValues = vi.fn(
      async (holdings: readonly { mint: string; amount: bigint }[]) =>
        valuesFor(holdings),
    );
    const getTokenInfo = vi.spyOn(sources.prices, "getTokenInfo");
    await scanWallet(sources.owners.trencher!, {
      ...sources,
      ...origins,
      exitCaps: { getExitCap, getSellValues },
    });
    const requested = getSellValues.mock.calls[0]![0].map(
      (holding) => holding.mint,
    );
    expect(requested).toContain(mint);
    const curveAddresses = requested.map((id) =>
      bondingCurvePda(id).toBase58(),
    );
    const curves = await sources.chain.getAccounts(curveAddresses);
    for (const id of requested)
      expect(
        checkPumpOrigin(id, curves.get(bondingCurvePda(id).toBase58()) ?? null),
      ).toBe(true);
    const nonOrigin = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    expect(requested).not.toContain(nonOrigin);
    expect(getTokenInfo.mock.calls[0]![0].length).toBeLessThanOrEqual(100);
    expect(getTokenInfo.mock.calls[0]![0]).not.toContain(nonOrigin);
  });
  it("separates snapshot-confirmed counts from every unchecked bag", async () => {
    const sources = await createFixtureSources();
    const { result } = await scanWallet(sources.owners.trencher!, {
      ...sources,
      ...origins,
      slotS: undefined,
    });
    expect(result.counts.feedable).toBe(0);
    expect(result.counts.checkAtFeed).toBe(result.counts.bags);
    expect(result.bags.every((bag) => bag.mint !== WSOL_MINT)).toBe(true);
  });
  it.each(["mints", "curves"])(
    "rejects a failed %s batch with HTTP 502 and never caches a clean result",
    async (phase) => {
      const sources = await createFixtureSources();
      const inventory = vi.spyOn(sources.chain, "getTokenAccounts");
      sources.chain.getAccountsPartial = async (addresses) => {
        const accounts = await sources.chain.getAccounts(addresses);
        const fail = addresses.includes(mint) === (phase === "mints");
        if (fail) accounts.delete(addresses[0]!);
        return { accounts, failed: fail ? [addresses[0]!] : [] };
      };
      const reserves = vi.fn(async (holdings: readonly { mint: string }[]) =>
        valuesFor(holdings),
      );
      const service = new XrayService({
        ...sources,
        ...origins,
        exitCaps: { getExitCap, getSellValues: reserves },
      });
      const router = createXrayRouter({
        service,
        env: parseXrayEnv({}),
        limiter: new SlidingWindowRateLimiter(),
        turnstile: { verify: async () => true },
        sharePage: new SharePageRenderer(origins.publicWebUrl),
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const reply = await router.request(
          `/api/xray/${sources.owners.trencher!}`,
        );
        expect(reply.status).toBe(502);
        const body = await reply.json();
        expect(body.error).toBe("upstream_failed");
        expect(body).not.toHaveProperty("card");
      }
      expect(inventory).toHaveBeenCalledTimes(2);
      expect(reserves).not.toHaveBeenCalled();
    },
  );
  it.each(["mints", "curves"])(
    "rejects aborted essential %s reads",
    async (phase) => {
      const sources = await createFixtureSources();
      vi.useFakeTimers();
      sources.chain.getAccountsPartial = async (addresses) => {
        if (addresses.includes(mint) === (phase === "mints"))
          return new Promise(() => {});
        return {
          accounts: await sources.chain.getAccounts(addresses),
          failed: [],
        };
      };
      const service = new XrayService({ ...sources, ...origins });
      const pending = expect(
        service.get(sources.owners.trencher!),
      ).rejects.toMatchObject({
        code: "scan_timeout",
        status: 502,
      });
      await vi.advanceTimersByTimeAsync(9_999);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("starts curve reads while independent mint batches are still pending", async () => {
    const sources = await createFixtureSources();
    let finishMints: (() => void) | undefined;
    const phases: string[] = [];
    sources.chain.getAccountsPartial = async (addresses) => {
      const accounts = await sources.chain.getAccounts(addresses);
      if (addresses.includes(mint)) {
        phases.push("mints:start");
        await new Promise<void>((resolve) => {
          finishMints = resolve;
        });
        phases.push("mints:end");
      } else {
        phases.push("curves:start");
        finishMints?.();
      }
      return { accounts, failed: [] };
    };
    const { result } = await scanWallet(sources.owners.trencher!, {
      ...sources,
      ...origins,
    });
    expect(result.counts.bags).toBe(12);
    expect(phases).toEqual(["mints:start", "curves:start", "mints:end"]);
  });
  it("leaves essential enrichment time after a slow token inventory within the server deadline", async () => {
    const sources = await createFixtureSources();
    vi.useFakeTimers();
    const read = sources.chain.getTokenAccounts;
    sources.chain.getTokenAccounts = async (owner, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 8_200));
      return read(owner, signal);
    };
    const service = new XrayService({
      ...sources,
      ...origins,
      exitCaps: {
        getExitCap,
        getSellValues: async (holdings) => valuesFor(holdings),
      },
    });
    const pending = service.get(sources.owners.trencher!);
    await vi.advanceTimersByTimeAsync(9_999);
    const result = await pending;
    expect(result.counts.bags).toBe(12);
    expect(result.valuesPartial).not.toBe(true);
  });
  it("retains reserve batches and identical membership/card when reserve reads expire", async () => {
    const sources = await createFixtureSources();
    const complete = await scanWallet(sources.owners.trencher!, {
      ...sources,
      ...origins,
      exitCaps: {
        getExitCap,
        getSellValues: async (holdings) => valuesFor(holdings),
      },
    });
    vi.useFakeTimers();
    const service = new XrayService({
      ...sources,
      ...origins,
      exitCaps: {
        getExitCap,
        async getSellValues(_holdings, context) {
          await new Promise<void>((resolve) =>
            context!.signal!.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
          return { ...valuesFor([{ mint }]), partial: true };
        },
      },
    });
    const pending = service.get(sources.owners.trencher!);
    await vi.advanceTimersByTimeAsync(9_999);
    const result = await pending;
    expect(result.valuesPartial).toBe(true);
    expect(result.counts.bags).toBe(complete.result.counts.bags);
    expect(result.counts.checkAtFeed).toBe(complete.result.counts.checkAtFeed);
    expect(result.card).toEqual(complete.result.card);
    expect(result.bags.find((bag) => bag.mint === mint)?.valueSol).toBe(
      "0.00297",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    "NO_ROUTE",
    "NON_SOL_QUOTE",
    "QUOTE_EXCEEDS_REAL_RESERVES",
  ] as const)(
    "caches final %s omissions without a partial banner or different card",
    async (reason) => {
      const sources = await createFixtureSources();
      const full = await scanWallet(sources.owners.trencher!, {
        ...sources,
        ...origins,
        exitCaps: {
          getExitCap,
          getSellValues: async (holdings) => valuesFor(holdings),
        },
      });
      const inventory = vi.spyOn(sources.chain, "getTokenAccounts");
      const service = new XrayService({
        ...sources,
        ...origins,
        exitCaps: {
          getExitCap,
          getSellValues: async (holdings) => ({
            partial: false,
            values: new Map(holdings.map(({ mint: id }) => [id, { reason }])),
          }),
        },
      });
      const result = await service.get(sources.owners.trencher!);
      expect(result.valuesPartial).not.toBe(true);
      expect(result.counts.bags).toBe(12);
      expect(result.card).toEqual(full.result.card);
      expect(result.bags.every((bag) => bag.valueSol === undefined)).toBe(true);
      expect((await service.get(sources.owners.trencher!)).cached).toBe(true);
      expect(inventory).toHaveBeenCalledTimes(1);
    },
  );
  it("caches results despite metadata failures and never asks for SOL/USD", async () => {
    const sources = await createFixtureSources();
    vi.spyOn(sources.chain, "getMetadata").mockRejectedValue(
      new Error("Response is too big"),
    );
    vi.spyOn(sources.prices, "getTokenInfo").mockRejectedValue(
      new Error("HTTP 429"),
    );
    const sol = vi.spyOn(sources.prices, "getSolUsd");
    const service = new XrayService({
      ...sources,
      ...origins,
      exitCaps: {
        getExitCap,
        getSellValues: async (holdings) => valuesFor(holdings),
      },
    });
    const result = await service.get(sources.owners.trencher!);
    expect(result.valuesPartial).not.toBe(true);
    expect(result.counts.bags).toBe(12);
    expect(
      result.bags.find(
        (bag) => bag.mint === "ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump",
      ),
    ).toMatchObject({ symbol: "CATCRAFT", name: "CATCRAFT", logoUrl: null });
    expect((await service.get(sources.owners.trencher!)).cached).toBe(true);
    expect(sol).not.toHaveBeenCalled();
  });
  it("does not become partial when no in-set bag needs a reserve value", async () => {
    const sources = await createFixtureSources();
    vi.useFakeTimers();
    vi.spyOn(sources.chain, "getSlot").mockImplementation(
      () => new Promise(() => {}),
    );
    const reserves = vi.fn(async () => {
      throw new Error("Unexpected reserve lookup");
    });
    const service = new XrayService({
      ...sources,
      ...origins,
      exitCaps: { getExitCap, getSellValues: reserves },
    });
    const pending = service.get(sources.owners.mixed!);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.counts.bags).toBe(0);
    expect(result.valuesPartial).not.toBe(true);
    expect((await service.get(sources.owners.mixed!)).cached).toBe(true);
    expect(reserves).not.toHaveBeenCalled();
  });
});
