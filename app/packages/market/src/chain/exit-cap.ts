import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { Clock } from "../clock.js";
import type { MarketEnv } from "../env.js";
import { MarketError, type MarketLogger } from "../errors.js";
import { createHttpClient, type HttpClient } from "../http/fetch-json.js";
import { SlidingWindowLimiter } from "../http/rate-limit.js";
import {
  MARKET,
  PROGRAM_IDS,
  PUMP_LAYOUTS,
  RPC_JSON_VERSION,
  STOCK,
  WSOL_MINT,
} from "../params.js";
import {
  decodeBondingCurve,
  decodePumpPool,
  deriveBondingCurve,
  deriveCanonicalPool,
  hasDiscriminator,
  type BondingCurveFields,
  type PumpPoolFields,
} from "./pump-layouts.js";
import { createSellValuesReader } from "./sell-values.js";

export interface ChainClientOptions {
  fetch: typeof fetch;
  env: MarketEnv;
  clock?: Clock;
  logger?: MarketLogger;
  http?: HttpClient;
  rpc?: ChainRpc;
}
export interface ChainRpc {
  call<T>(schema: z.ZodType<T>, method: string, params: unknown[]): Promise<T>;
}
export function createChainRpc(opts: ChainClientOptions): ChainRpc {
  if (opts.rpc) return opts.rpc;
  const http =
    opts.http ??
    createHttpClient({
      fetch: opts.fetch,
      clock: opts.clock,
      logger: opts.logger,
      provider: "solana",
      secrets: opts.env.solanaRpcUrl ? [opts.env.solanaRpcUrl] : [],
      limiter: new SlidingWindowLimiter(
        MARKET.rpc.requestsPerMinute,
        opts.clock,
      ),
    });
  return {
    async call(schema, method, params) {
      if (!opts.env.solanaRpcUrl)
        throw new MarketError("INVALID_INPUT", {
          message: "SOLANA_RPC_URL is required for live calls",
        });
      const envelope = z
        .object({ jsonrpc: z.literal(RPC_JSON_VERSION), result: schema })
        .passthrough();
      const body = await http.fetchJson(envelope, {
        url: opts.env.solanaRpcUrl,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: RPC_JSON_VERSION,
          id: 1,
          method,
          params,
        }),
      });
      return body.result;
    },
  };
}
export const rpcContextSchema = z
  .object({ slot: z.number().int().nonnegative() })
  .passthrough();
export const integerAmountSchema = z.string().regex(/^\d+$/);
const accountSchema = z
  .object({
    owner: z.string(),
    data: z.tuple([z.string(), z.literal("base64")]),
  })
  .passthrough();
const accountResult = z
  .object({ context: rpcContextSchema, value: accountSchema.nullable() })
  .passthrough();
const balanceResult = z
  .object({
    context: rpcContextSchema,
    value: z
      .object({
        amount: integerAmountSchema,
        decimals: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();
export type CurveReading = BondingCurveFields & {
  address: string;
  slot: number;
};
export type PoolReading = PumpPoolFields & {
  address: string;
  slot: number;
  realQuoteLamports: bigint;
};
export type ExitCap =
  | { kind: "none" }
  | {
      kind: "curve" | "pumpswap";
      realQuoteLamports: bigint;
      feeBps: number;
      mayhem: boolean;
      solQuote: boolean;
      slot: number;
    };
export interface ExitCapClient {
  getSellValues: ReturnType<typeof createSellValuesReader>;
  getCurve(mint: string): Promise<CurveReading | undefined>;
  getCanonicalPool(mint: string): Promise<PoolReading | undefined>;
  getExitCap(mint: string): Promise<ExitCap>;
}
export function createExitCapClient(opts: ChainClientOptions): ExitCapClient {
  const rpc = createChainRpc(opts);
  const client: ExitCapClient = {
    getSellValues: createSellValuesReader(rpc),
    async getCurve(mint) {
      const address = deriveBondingCurve(mint);
      const result = await rpc.call(accountResult, "getAccountInfo", [
        address,
        { encoding: "base64", commitment: "confirmed" },
      ]);
      if (!result.value || result.value.owner !== PROGRAM_IDS.pumpFun)
        return undefined;
      const data = Buffer.from(result.value.data[0], "base64");
      if (!hasDiscriminator(data, PUMP_LAYOUTS.bondingCurveDiscriminatorHex))
        return undefined;
      return {
        ...decodeBondingCurve(data),
        address,
        slot: result.context.slot,
      };
    },
    async getCanonicalPool(mint) {
      const address = deriveCanonicalPool(mint);
      const result = await rpc.call(accountResult, "getAccountInfo", [
        address,
        { encoding: "base64", commitment: "confirmed" },
      ]);
      if (!result.value || result.value.owner !== PROGRAM_IDS.pumpSwap)
        return undefined;
      const data = Buffer.from(result.value.data[0], "base64");
      if (!hasDiscriminator(data, PUMP_LAYOUTS.poolDiscriminatorHex))
        return undefined;
      const pool = decodePumpPool(data);
      if (pool.baseMint !== mint || pool.index !== 0)
        throw new MarketError("PROVIDER_SCHEMA", { provider: "solana" });
      const balance = await rpc.call(balanceResult, "getTokenAccountBalance", [
        pool.quoteTokenAccount,
        { commitment: "confirmed" },
      ]);
      return {
        ...pool,
        address,
        slot: Math.min(result.context.slot, balance.context.slot),
        realQuoteLamports: BigInt(balance.value.amount),
      };
    },
    async getExitCap(mint) {
      deriveBondingCurve(mint);
      try {
        const curve = await client.getCurve(mint);
        if (!curve) return { kind: "none" };
        if (!curve.complete)
          return {
            kind: "curve",
            realQuoteLamports: curve.realQuoteReserves,
            feeBps: MARKET.exitCap.curveFeeBps,
            mayhem: curve.mayhem,
            solQuote: curve.quoteMint === PublicKey.default.toBase58(),
            slot: curve.slot,
          };
        const pool = await client.getCanonicalPool(mint);
        if (!pool) return { kind: "none" };
        return {
          kind: "pumpswap",
          realQuoteLamports: pool.realQuoteLamports,
          feeBps: STOCK.trendingPoolFeeAllowanceBps,
          mayhem: pool.mayhem,
          solQuote: pool.quoteMint === WSOL_MINT,
          slot: pool.slot,
        };
      } catch {
        throw new MarketError("EXIT_CAP_UNAVAILABLE", { provider: "solana" });
      }
    },
  };
  return client;
}
