import { z } from "zod";
import { InMemoryTtlCache, type TtlCache } from "../cache.js";
import { type Clock } from "../clock.js";
import { type MarketEnv } from "../env.js";
import { MarketError, type MarketLogger } from "../errors.js";
import { createHttpClient, type HttpClient } from "../http/fetch-json.js";
import { SlidingWindowLimiter } from "../http/rate-limit.js";
import { MARKET } from "../params.js";

export interface SlotClient {
  getSlot(): Promise<number>;
}

export function createSlotClient(opts: {
  fetch: typeof fetch;
  env: MarketEnv;
  cache?: TtlCache;
  clock?: Clock;
  logger?: MarketLogger;
  http?: HttpClient;
}): SlotClient {
  const cache = opts.cache ?? new InMemoryTtlCache(opts.clock);
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
  const schema = z
    .object({
      jsonrpc: z.literal("2.0"),
      result: z.number().int().nonnegative(),
    })
    .passthrough();
  let pending: Promise<number> | undefined;
  async function load(): Promise<number> {
    const cached = await cache.get<number>("rpc:slot:confirmed");
    if (cached !== undefined) return cached;
    if (!opts.env.solanaRpcUrl) {
      throw new MarketError("INVALID_INPUT", {
        provider: "solana",
        message: "SOLANA_RPC_URL is required for live calls",
      });
    }
    const response = await http.fetchJson(schema, {
      url: opts.env.solanaRpcUrl,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSlot",
        params: [{ commitment: "confirmed" }],
      }),
    });
    await cache.set(
      "rpc:slot:confirmed",
      response.result,
      MARKET.rpc.slotCacheMs,
    );
    return response.result;
  }
  return {
    async getSlot() {
      if (pending) return pending;
      pending = load();
      try {
        return await pending;
      } finally {
        pending = undefined;
      }
    },
  };
}
