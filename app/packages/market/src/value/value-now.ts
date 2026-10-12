import { PublicKey } from "@solana/web3.js";
import { defaultClock, type Clock } from "../clock.js";
import { MarketError } from "../errors.js";
import { BPS_DENOMINATOR, WSOL_MINT } from "../params.js";

export interface ValueQuote {
  outAmount: bigint;
  router: string;
  requestId: string;
  fetchedAtMs: number;
}

export type ValueExitCap =
  | { kind: "none" }
  | {
      kind: "curve" | "pumpswap";
      realQuoteLamports: bigint;
      feeBps: number;
      mayhem: boolean;
      solQuote: boolean;
      slot: number;
    };

export type ValueUnavailableReason =
  | "NO_QUOTE"
  | "PROVIDER_ERROR"
  | "CAP_UNAVAILABLE"
  | "NON_SOL_QUOTE"
  | "NO_REAL_RESERVES"
  | "QUOTE_EXCEEDS_REAL_RESERVES";

export type ValueNowResult =
  | {
      status: "ok";
      lamports: bigint;
      quoteLamports: bigint;
      capped: boolean;
      capLamports?: bigint;
      router: string;
      requestId: string;
      fetchedAtMs: number;
    }
  | { status: "unavailable"; reason: ValueUnavailableReason };

export type ValueNow = (
  mint: string,
  amount: bigint,
) => Promise<ValueNowResult>;

export interface ValueClient {
  valueNow: ValueNow;
}

export function createValueClient(options: {
  quoteSell(mint: string, amount: bigint): Promise<ValueQuote>;
  getExitCap(mint: string): Promise<ValueExitCap>;
  clock?: Clock;
}): ValueClient {
  const clock = options.clock ?? defaultClock;
  return {
    async valueNow(mint, amount) {
      try {
        new PublicKey(mint);
      } catch {
        throw new MarketError("INVALID_INPUT", {
          message: "Invalid mint public key",
        });
      }
      if (typeof amount !== "bigint" || amount < 0n) {
        throw new MarketError("INVALID_INPUT", {
          message: "Invalid token amount",
        });
      }
      if (mint === WSOL_MINT || amount === 0n) {
        return {
          status: "ok",
          lamports: amount,
          quoteLamports: amount,
          capped: false,
          router: "identity",
          requestId: "",
          fetchedAtMs: clock.nowMs(),
        };
      }
      const [quoteResult, capResult] = await Promise.allSettled([
        Promise.resolve().then(() => options.quoteSell(mint, amount)),
        Promise.resolve().then(() => options.getExitCap(mint)),
      ]);
      if (quoteResult.status === "rejected") {
        return {
          status: "unavailable",
          reason:
            quoteResult.reason instanceof MarketError &&
            quoteResult.reason.code === "NO_ROUTE"
              ? "NO_QUOTE"
              : "PROVIDER_ERROR",
        };
      }
      const quote = quoteResult.value;
      if (quote.outAmount < 0n)
        return { status: "unavailable", reason: "PROVIDER_ERROR" };
      if (capResult.status === "rejected")
        return { status: "unavailable", reason: "CAP_UNAVAILABLE" };
      const cap = capResult.value;
      const base = {
        quoteLamports: quote.outAmount,
        router: quote.router,
        requestId: quote.requestId,
        fetchedAtMs: quote.fetchedAtMs,
      };
      if (cap.kind === "none")
        return {
          status: "ok",
          lamports: quote.outAmount,
          capped: false,
          ...base,
        };
      if (!cap.solQuote)
        return { status: "unavailable", reason: "NON_SOL_QUOTE" };
      if (cap.realQuoteLamports === 0n)
        return { status: "unavailable", reason: "NO_REAL_RESERVES" };
      if (
        cap.realQuoteLamports < 0n ||
        !Number.isSafeInteger(cap.feeBps) ||
        cap.feeBps < 0 ||
        cap.feeBps > BPS_DENOMINATOR
      ) {
        return { status: "unavailable", reason: "CAP_UNAVAILABLE" };
      }
      if (quote.outAmount > cap.realQuoteLamports) {
        return { status: "unavailable", reason: "QUOTE_EXCEEDS_REAL_RESERVES" };
      }
      const capLamports =
        (cap.realQuoteLamports * BigInt(BPS_DENOMINATOR - cap.feeBps)) /
        BigInt(BPS_DENOMINATOR);
      const capped = quote.outAmount > capLamports;
      return {
        status: "ok",
        lamports: capped ? capLamports : quote.outAmount,
        capLamports,
        capped,
        ...base,
      };
    },
  };
}
