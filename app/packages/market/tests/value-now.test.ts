import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createExitCapClient } from "../src/chain/exit-cap.js";
import { MarketError } from "../src/errors.js";
import { createJupiterSwapClient } from "../src/jupiter/swap.js";
import { HIT_LIST, MARKET, WSOL_MINT } from "../src/params.js";
import { fixtureFetch } from "../src/testing.js";
import {
  createValueClient,
  type ValueExitCap,
  type ValueQuote,
} from "../src/value/value-now.js";

// Pure decision vectors: these dependencies do not perform transport I/O.
const mint = HIT_LIST.launchMajors[0]!.mint;
const quoted = (outAmount: bigint): ValueQuote => ({
  outAmount,
  router: "metis",
  requestId: "vector",
  fetchedAtMs: 1234,
});
const curve = (
  patch: Partial<Exclude<ValueExitCap, { kind: "none" }>> = {},
): ValueExitCap => ({
  kind: "curve",
  realQuoteLamports: 10_000n,
  feeBps: 125,
  mayhem: false,
  solQuote: true,
  slot: 1,
  ...patch,
});
function client(outAmount: bigint, cap: ValueExitCap = { kind: "none" }) {
  const quoteSell = vi.fn(async () => quoted(outAmount));
  const getExitCap = vi.fn(async () => cap);
  return {
    ...createValueClient({ quoteSell, getExitCap }),
    quoteSell,
    getExitCap,
  };
}

describe("executable value decisions", () => {
  it("leaves a major quote uncapped and preserves provider metadata", async () => {
    expect(await client(101n).valueNow(mint, 9n)).toEqual({
      status: "ok",
      lamports: 101n,
      quoteLamports: 101n,
      capped: false,
      router: "metis",
      requestId: "vector",
      fetchedAtMs: 1234,
    });
  });

  it.each([
    [9_874n, 9_874n, false],
    [9_875n, 9_875n, false],
    [9_876n, 9_875n, true],
    [10_000n, 9_875n, true],
  ])(
    "caps quote %s at real reserves less fees",
    async (out, expected, capped) => {
      expect(await client(out, curve()).valueNow(mint, 1n)).toMatchObject({
        status: "ok",
        lamports: expected,
        quoteLamports: out,
        capLamports: 9_875n,
        capped,
      });
    },
  );

  it.each([
    [10_001n, curve(), "QUOTE_EXCEEDS_REAL_RESERVES"],
    [0n, curve({ realQuoteLamports: 0n }), "NO_REAL_RESERVES"],
    [1n, curve({ solQuote: false }), "NON_SOL_QUOTE"],
  ] as const)(
    "fails closed for %s with an unusable cap",
    async (amount, cap, reason) => {
      expect(await client(amount, cap).valueNow(mint, 1n)).toEqual({
        status: "unavailable",
        reason,
      });
    },
  );

  it("uses the same real-vault fee cap for a completed pool", async () => {
    expect(
      await client(
        999n,
        curve({ kind: "pumpswap", realQuoteLamports: 1_000n, feeBps: 150 }),
      ).valueNow(mint, 1n),
    ).toMatchObject({ status: "ok", lamports: 985n, capped: true });
  });

  it.each([
    ["NO_ROUTE", "NO_QUOTE"],
    ["PROVIDER_HTTP", "PROVIDER_ERROR"],
  ] as const)("maps failed quote %s to %s", async (code, reason) => {
    const value = createValueClient({
      quoteSell: async () => {
        throw new MarketError(code);
      },
      getExitCap: async () => ({ kind: "none" }),
    });
    expect(await value.valueNow(mint, 1n)).toEqual({
      status: "unavailable",
      reason,
    });
  });

  it("never uses the quote when the cap could not be fetched", async () => {
    const value = createValueClient({
      quoteSell: async () => quoted(1n),
      getExitCap: async () => {
        throw new MarketError("EXIT_CAP_UNAVAILABLE");
      },
    });
    expect(await value.valueNow(mint, 1n)).toEqual({
      status: "unavailable",
      reason: "CAP_UNAVAILABLE",
    });
  });

  it("starts the quote and cap concurrently", async () => {
    let finishQuote!: (quote: ValueQuote) => void;
    let finishCap!: (cap: ValueExitCap) => void;
    const quoteSell = vi.fn(
      () =>
        new Promise<ValueQuote>((resolve) => {
          finishQuote = resolve;
        }),
    );
    const getExitCap = vi.fn(
      () =>
        new Promise<ValueExitCap>((resolve) => {
          finishCap = resolve;
        }),
    );
    const pending = createValueClient({ quoteSell, getExitCap }).valueNow(
      mint,
      1n,
    );
    await Promise.resolve();
    expect(quoteSell).toHaveBeenCalledOnce();
    expect(getExitCap).toHaveBeenCalledOnce();
    finishQuote(quoted(1n));
    finishCap({ kind: "none" });
    await expect(pending).resolves.toMatchObject({
      status: "ok",
      lamports: 1n,
    });
  });

  it("returns wSOL and zero amounts without requests", async () => {
    const value = client(99n);
    expect(await value.valueNow(WSOL_MINT, 19n)).toMatchObject({
      status: "ok",
      lamports: 19n,
      router: "identity",
    });
    expect(await value.valueNow(mint, 0n)).toMatchObject({
      status: "ok",
      lamports: 0n,
      router: "identity",
    });
    expect(value.quoteSell).not.toHaveBeenCalled();
    expect(value.getExitCap).not.toHaveBeenCalled();
  });

  it("rejects invalid input before requests", async () => {
    const value = client(99n);
    await expect(value.valueNow(mint, -1n)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(value.valueNow("invalid", 1n)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(value.quoteSell).not.toHaveBeenCalled();
  });

  it.each([
    [
      "swap-sell-wif",
      "curve-wif-absent",
      { status: "ok", lamports: 1_910_846n, capped: false },
    ],
    [
      "swap-curve-cap-boundary",
      "curve-166-live",
      {
        status: "ok",
        lamports: 1n,
        quoteLamports: 2n,
        capLamports: 1n,
        capped: true,
      },
    ],
    [
      "swap-curve-above-reserves",
      "curve-166-live",
      { status: "unavailable", reason: "QUOTE_EXCEEDS_REAL_RESERVES" },
    ],
  ] as const)(
    "composes %s with the recorded RPC account",
    async (swapName, accountName, expected) => {
      // Curve quote variants are explicitly synthetic boundaries, not live execution claims.
      const swapPath = new URL(
        `./fixtures/jupiter/${swapName}.json`,
        import.meta.url,
      );
      const rpcPath = new URL(
        `./fixtures/rpc/${accountName}.json`,
        import.meta.url,
      );
      const recorded = JSON.parse(readFileSync(swapPath, "utf8")) as {
        recordedAt: string;
        request: { url: string };
      };
      const request = new URL(recorded.request.url);
      const fetch = vi.fn(fixtureFetch([swapPath, rpcPath]));
      const options = {
        fetch,
        env: {
          jupiterApiKey: "fixture-test-credential",
          solanaRpcUrl: "https://rpc.invalid/",
          pythHermesUrl: MARKET.pyth.defaultHermesUrl,
        },
        clock: {
          nowMs: () => Date.parse(recorded.recordedAt),
          random: () => 0,
          sleep: () => new Promise<void>(() => {}),
        },
      };
      const swap = createJupiterSwapClient(options);
      const caps = createExitCapClient(options);
      const values = createValueClient({
        quoteSell: swap.quoteSell,
        getExitCap: caps.getExitCap,
      });
      expect(
        await values.valueNow(
          request.searchParams.get("inputMint")!,
          BigInt(request.searchParams.get("amount")!),
        ),
      ).toMatchObject(expected);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});
