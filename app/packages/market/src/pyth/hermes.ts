import { z } from "zod";
import { InMemoryTtlCache, type TtlCache } from "../cache.js";
import { type Clock } from "../clock.js";
import { type MarketEnv } from "../env.js";
import { MarketError, type MarketLogger } from "../errors.js";
import { createHttpClient, type HttpClient } from "../http/fetch-json.js";
import { SlidingWindowLimiter } from "../http/rate-limit.js";
import { MARKET } from "../params.js";

const integerString = z.string().regex(/^-?\d+$/);
const priceSchema = z
  .object({
    price: integerString,
    conf: z.string().regex(/^\d+$/),
    expo: z.number().int(),
    publish_time: z.number().int().nonnegative(),
  })
  .passthrough();

export const pythPriceUpdateSchema = z
  .object({
    id: z.string(),
    price: priceSchema,
    ema_price: priceSchema.optional(),
    metadata: z
      .object({ slot: z.number().int().nonnegative().nullish() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type PythPriceUpdate = z.infer<typeof pythPriceUpdateSchema>;

export interface PythHermesClient {
  getLatest(feedId: string): Promise<PythPriceUpdate | undefined>;
  getHistorical(
    feedId: string,
    publishTime: number,
  ): Promise<PythPriceUpdate | undefined>;
}

export interface PythHermesOptions {
  fetch: typeof fetch;
  env: MarketEnv;
  cache?: TtlCache;
  clock?: Clock;
  logger?: MarketLogger;
  http?: HttpClient;
}

export function createPythHermesClient(
  opts: PythHermesOptions,
): PythHermesClient {
  const cache = opts.cache ?? new InMemoryTtlCache(opts.clock);
  const http =
    opts.http ??
    createHttpClient({
      fetch: opts.fetch,
      clock: opts.clock,
      logger: opts.logger,
      provider: "pyth",
      secrets: opts.env.pythHermesApiKey ? [opts.env.pythHermesApiKey] : [],
      limiter: new SlidingWindowLimiter(
        MARKET.pyth.requestsPerMinute,
        opts.clock,
      ),
    });
  const active = new Map<string, Promise<PythPriceUpdate | undefined>>();

  async function load(
    feedId: string,
    publishTime?: number,
  ): Promise<PythPriceUpdate | undefined> {
    const route = publishTime === undefined ? "latest" : String(publishTime);
    const key = `pyth:${route}:${feedId}`;
    const cached = await cache.get<PythPriceUpdate | null>(key);
    if (cached !== undefined) return cached ?? undefined;
    if (!opts.env.pythHermesApiKey) {
      throw new MarketError("PROVIDER_AUTH", {
        provider: "pyth",
        message: "Hermes credentials are unavailable",
      });
    }
    const base = opts.env.pythHermesUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/v2/updates/price/${route}`);
    url.searchParams.append("ids[]", feedId);
    url.searchParams.set("parsed", "true");
    const response = await http.fetchJson(
      z.object({ parsed: z.array(pythPriceUpdateSchema) }).passthrough(),
      {
        url: url.href,
        headers: { Authorization: `Bearer ${opts.env.pythHermesApiKey}` },
      },
    );
    const update = response.parsed.find(
      (entry) => entry.id.replace(/^0x/, "").toLowerCase() === feedId,
    );
    if (
      update &&
      publishTime !== undefined &&
      update.price.publish_time < publishTime
    ) {
      throw new MarketError("PROVIDER_SCHEMA", {
        provider: "pyth",
        message: "Historical update predates requested time",
      });
    }
    await cache.set(
      key,
      update ?? null,
      update ? MARKET.solUsd.cacheTtlMs : MARKET.price.missCacheTtlMs,
    );
    return update;
  }

  async function read(
    input: string,
    publishTime?: number,
  ): Promise<PythPriceUpdate | undefined> {
    const feedId = input.replace(/^0x/, "").toLowerCase();
    if (!/^[\da-f]+$/.test(feedId)) {
      throw new MarketError("INVALID_INPUT", {
        provider: "pyth",
        message: "Invalid Pyth feed id",
      });
    }
    if (
      publishTime !== undefined &&
      (!Number.isSafeInteger(publishTime) || publishTime < 0)
    ) {
      throw new MarketError("INVALID_INPUT", {
        provider: "pyth",
        message: "Invalid historical timestamp",
      });
    }
    const key = `${feedId}:${publishTime ?? "latest"}`;
    const pending = active.get(key);
    if (pending) return pending;
    const work = load(feedId, publishTime);
    active.set(key, work);
    try {
      return await work;
    } finally {
      active.delete(key);
    }
  }
  return {
    getLatest: (feedId) => read(feedId),
    getHistorical: (feedId, publishTime) => read(feedId, publishTime),
  };
}
