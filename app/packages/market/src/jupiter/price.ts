import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { InMemoryTtlCache, type TtlCache } from "../cache.js";
import { type Clock } from "../clock.js";
import { type MarketEnv } from "../env.js";
import { MarketError, type MarketLogger } from "../errors.js";
import { createHttpClient, type HttpClient } from "../http/fetch-json.js";
import { createJupiterLimiter } from "../http/rate-limit.js";
import { MARKET, XRAY } from "../params.js";

const priceRecordSchema = z
  .object({
    // Unpriced tokens come back with metadata only: treat them as no price.
    usdPrice: z.number().finite().nonnegative().optional(),
    blockId: z.number().int().nonnegative().nullish(),
    decimals: z.number().int().nonnegative().optional(),
    liquidity: z.number().finite().nullish(),
  })
  .passthrough();
const pricesSchema = z.record(z.string(), priceRecordSchema);

/** Display price only. Provider liquidity is deliberately discarded here. */
export interface JupiterPrice {
  usdPrice: number;
  blockId?: number | null;
}

export interface JupiterClientOptions {
  fetch: typeof fetch;
  env: MarketEnv;
  cache?: TtlCache;
  clock?: Clock;
  logger?: MarketLogger;
  http?: HttpClient;
}

export function validateMints(mints: string[]): string[] {
  for (const mint of mints) {
    try {
      new PublicKey(mint);
    } catch {
      throw new MarketError("INVALID_INPUT", {
        message: "Invalid mint public key",
      });
    }
  }
  return [...new Set(mints)];
}

export function jupiterHeaders(env: MarketEnv): Record<string, string> {
  return env.jupiterApiKey ? { "x-api-key": env.jupiterApiKey } : {};
}

export function jupiterHttp(opts: JupiterClientOptions): HttpClient {
  return (
    opts.http ??
    createHttpClient({
      fetch: opts.fetch,
      clock: opts.clock,
      logger: opts.logger,
      provider: "jupiter",
      secrets: opts.env.jupiterApiKey ? [opts.env.jupiterApiKey] : [],
      limiter: createJupiterLimiter({
        env: opts.env,
        clock: opts.clock,
        logger: opts.logger,
      }),
    })
  );
}

export interface JupiterPriceClient {
  getPrices(mints: string[]): Promise<Record<string, JupiterPrice | undefined>>;
}

export function createJupiterPriceClient(
  opts: JupiterClientOptions,
): JupiterPriceClient {
  const cache = opts.cache ?? new InMemoryTtlCache(opts.clock);
  const http = jupiterHttp(opts);
  const active = new Map<
    string,
    Promise<Record<string, JupiterPrice | undefined>>
  >();

  async function load(
    mints: string[],
  ): Promise<Record<string, JupiterPrice | undefined>> {
    const result: Record<string, JupiterPrice | undefined> = {};
    const missing: string[] = [];
    const entries = await Promise.all(
      mints.map(async (mint) => ({
        mint,
        cached: await cache.get<JupiterPrice | null>(`jup:price:v3:${mint}`),
      })),
    );
    for (const { mint, cached } of entries) {
      if (cached === undefined) missing.push(mint);
      else result[mint] = cached ?? undefined;
    }
    for (let start = 0; start < missing.length; start += XRAY.priceIdsPerCall) {
      const chunk = missing.slice(start, start + XRAY.priceIdsPerCall);
      const url = new URL("/price/v3", MARKET.jupiter.baseUrl);
      url.searchParams.set("ids", chunk.join(","));
      const response = await http.fetchJson(pricesSchema, {
        url: url.href,
        headers: jupiterHeaders(opts.env),
      });
      await Promise.all(
        chunk.map(async (mint) => {
          const raw = response[mint];
          const price =
            raw?.usdPrice != null
              ? { usdPrice: raw.usdPrice, blockId: raw.blockId ?? null }
              : undefined;
          result[mint] = price;
          await cache.set(
            `jup:price:v3:${mint}`,
            price ?? null,
            price ? MARKET.price.cacheTtlMs : MARKET.price.missCacheTtlMs,
          );
        }),
      );
    }
    return result;
  }

  return {
    async getPrices(input) {
      const mints = validateMints(input);
      if (mints.length === 0) return {};
      const key = [...mints].sort().join(",");
      const pending = active.get(key);
      if (pending) return pending;
      const work = load(mints);
      active.set(key, work);
      try {
        return await work;
      } finally {
        active.delete(key);
      }
    },
  };
}
