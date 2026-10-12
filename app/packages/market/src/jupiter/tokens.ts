import { z } from "zod";
import { InMemoryTtlCache } from "../cache.js";
import { MARKET } from "../params.js";
import {
  jupiterHeaders,
  jupiterHttp,
  validateMints,
  type JupiterClientOptions,
} from "./price.js";

export const jupiterTokenSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    symbol: z.string(),
    icon: z.string().nullish(),
    decimals: z.number().int().nonnegative(),
    tokenProgram: z.string().nullish(),
    launchpad: z.string().nullish(),
    graduatedPool: z.string().nullish(),
    graduatedAt: z.string().nullish(),
    holderCount: z.number().int().nonnegative().nullish(),
    liquidity: z.number().finite().nullish(),
    usdPrice: z.number().finite().nullish(),
    priceBlockId: z.number().int().nonnegative().nullish(),
    firstPool: z
      .object({ id: z.string(), createdAt: z.string() })
      .passthrough()
      .nullish(),
    audit: z
      .object({
        isSus: z.boolean().optional(),
        mintAuthorityDisabled: z.boolean().optional(),
        freezeAuthorityDisabled: z.boolean().optional(),
        topHoldersPercentage: z.number().finite().optional(),
      })
      .passthrough()
      .nullish(),
    organicScore: z.number().finite().nullish(),
    organicScoreLabel: z.string().nullish(),
    isVerified: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    createdAt: z.string().nullish(),
    updatedAt: z.string().nullish(),
  })
  .passthrough();

export type JupiterToken = z.infer<typeof jupiterTokenSchema>;
export interface JupiterTokensClient {
  getTokens(mints: string[]): Promise<Record<string, JupiterToken | undefined>>;
}

export function createJupiterTokensClient(
  opts: JupiterClientOptions,
): JupiterTokensClient {
  const http = jupiterHttp(opts);
  const cache = opts.cache ?? new InMemoryTtlCache(opts.clock);
  const active = new Map<
    string,
    Promise<Record<string, JupiterToken | undefined>>
  >();

  async function load(
    mints: string[],
  ): Promise<Record<string, JupiterToken | undefined>> {
    const result: Record<string, JupiterToken | undefined> = {};
    const missing: string[] = [];
    const entries = await Promise.all(
      mints.map(async (mint) => ({
        mint,
        cached: await cache.get<JupiterToken | null>(`jup:tokens:v2:${mint}`),
      })),
    );
    for (const { mint, cached } of entries) {
      if (cached === undefined) missing.push(mint);
      else result[mint] = cached ?? undefined;
    }
    for (
      let start = 0;
      start < missing.length;
      start += MARKET.jupiter.tokensMintsPerCall
    ) {
      const chunk = missing.slice(
        start,
        start + MARKET.jupiter.tokensMintsPerCall,
      );
      const url = new URL("/tokens/v2/search", MARKET.jupiter.baseUrl);
      url.searchParams.set("query", chunk.join(","));
      const response = await http.fetchJson(z.array(jupiterTokenSchema), {
        url: url.href,
        headers: jupiterHeaders(opts.env),
      });
      const byMint = new Map(response.map((token) => [token.id, token]));
      await Promise.all(
        chunk.map(async (mint) => {
          const token = byMint.get(mint);
          result[mint] = token;
          await cache.set(
            `jup:tokens:v2:${mint}`,
            token ?? null,
            token ? MARKET.tokenInfo.cacheTtlMs : MARKET.price.missCacheTtlMs,
          );
        }),
      );
    }
    return result;
  }

  return {
    async getTokens(input) {
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
