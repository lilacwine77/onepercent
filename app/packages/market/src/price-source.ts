import { InMemoryTtlCache, type TtlCache } from "./cache.js";
import { defaultClock, type Clock } from "./clock.js";
import { type MarketEnv } from "./env.js";
import { MarketError, noopLogger, type MarketLogger } from "./errors.js";
import { createHttpClient } from "./http/fetch-json.js";
import { createJupiterLimiter, type JupiterPlan } from "./http/rate-limit.js";
import { createJupiterPriceClient, validateMints } from "./jupiter/price.js";
import { createJupiterTokensClient } from "./jupiter/tokens.js";
import {
  BPS_DENOMINATOR,
  DECIMAL_RADIX,
  HIT_LIST,
  MARKET,
  MILLISECONDS_PER_SECOND,
  STOCK,
  WSOL_MINT,
} from "./params.js";
import { createPythHermesClient } from "./pyth/hermes.js";
import { createSlotClient } from "./rpc/slot.js";

export interface PriceSource {
  getPrices(
    mints: string[],
  ): Promise<
    Record<
      string,
      { usdPrice: number; blockId: number; ageSlots: number } | undefined
    >
  >;
  getTokenInfo(mints: string[]): Promise<
    Record<
      string,
      | {
          symbol: string;
          name: string;
          logoURI?: string;
          launchpad?: string;
          ath?: number;
        }
      | undefined
    >
  >;
  getSolUsd(): Promise<number>;
}

export type SolUsdReading =
  | { usd: number; source: "pyth"; publishTime: number }
  | { usd: number; source: "jupiter"; ageSlots: number };

export function createPriceSource(opts: {
  fetch: typeof fetch;
  env: MarketEnv;
  cache?: TtlCache;
  clock?: Clock;
  logger?: MarketLogger;
  jupiterPlan?: JupiterPlan;
  jupiterShareBps?: number;
  maxPriceAgeSlots?: number;
}): PriceSource & { getSolUsdDetailed(): Promise<SolUsdReading> } {
  const clock = opts.clock ?? defaultClock;
  const logger = opts.logger ?? noopLogger;
  const cache = opts.cache ?? new InMemoryTtlCache(clock);
  const maxAge = opts.maxPriceAgeSlots ?? MARKET.price.maxAgeSlots;
  if (!Number.isSafeInteger(maxAge) || maxAge < 0) {
    throw new MarketError("INVALID_INPUT", {
      message: "Invalid maximum price age",
    });
  }
  const shared = { fetch: opts.fetch, env: opts.env, clock, logger, cache };
  const jupiterHttp = createHttpClient({
    fetch: opts.fetch,
    clock,
    logger,
    provider: "jupiter",
    secrets: opts.env.jupiterApiKey ? [opts.env.jupiterApiKey] : [],
    limiter: createJupiterLimiter({
      env: opts.env,
      clock,
      logger,
      plan: opts.jupiterPlan,
      shareBps: opts.jupiterShareBps,
    }),
  });
  const prices = createJupiterPriceClient({ ...shared, http: jupiterHttp });
  const tokens = createJupiterTokensClient({ ...shared, http: jupiterHttp });
  const pyth = createPythHermesClient(shared);
  const slots = createSlotClient(shared);
  let solPending: Promise<SolUsdReading> | undefined;

  const source: PriceSource = {
    async getPrices(input) {
      const mints = validateMints(input);
      if (mints.length === 0) return {};
      const [raw, slot] = await Promise.all([
        prices.getPrices(mints),
        slots.getSlot(),
      ]);
      const result: Awaited<ReturnType<PriceSource["getPrices"]>> = {};
      let dropped = 0;
      for (const mint of mints) {
        const price = raw[mint];
        if (!price || price.blockId == null) {
          result[mint] = undefined;
          dropped += 1;
          continue;
        }
        const ageSlots = Math.max(0, slot - price.blockId);
        if (ageSlots > maxAge) {
          result[mint] = undefined;
          dropped += 1;
        } else
          result[mint] = {
            usdPrice: price.usdPrice,
            blockId: price.blockId,
            ageSlots,
          };
      }
      if (dropped > 0)
        logger.debug(
          { provider: "jupiter", dropped },
          "Unavailable or stale display prices",
        );
      return result;
    },
    async getTokenInfo(input) {
      const mints = validateMints(input);
      if (mints.length === 0) return {};
      const raw = await tokens.getTokens(mints);
      const result: Awaited<ReturnType<PriceSource["getTokenInfo"]>> = {};
      for (const mint of mints) {
        const token = raw[mint];
        if (!token) {
          result[mint] = undefined;
          continue;
        }
        let logoURI: string | undefined;
        if (token.icon) {
          try {
            if (new URL(token.icon).protocol === "https:") logoURI = token.icon;
          } catch {
            /* Invalid icon URL. */
          }
        }
        result[mint] = {
          symbol: token.symbol.trim(),
          name: token.name.trim(),
          ...(logoURI ? { logoURI } : {}),
          ...(token.launchpad != null ? { launchpad: token.launchpad } : {}),
        };
      }
      return result;
    },
    async getSolUsd() {
      return (await getSolUsdDetailed()).usd;
    },
  };

  async function readSolUsd(): Promise<SolUsdReading> {
    const cached = await cache.get<SolUsdReading>("market:sol-usd");
    if (
      cached !== undefined &&
      (cached.source !== "pyth" ||
        Math.floor(clock.nowMs() / MILLISECONDS_PER_SECOND) -
          cached.publishTime <=
          STOCK.pythMaxAgeSeconds)
    )
      return cached;
    try {
      const update = await pyth.getLatest(HIT_LIST.solUsdPythFeedId);
      if (update) {
        const price = BigInt(update.price.price);
        const conf = BigInt(update.price.conf);
        const age =
          Math.floor(clock.nowMs() / MILLISECONDS_PER_SECOND) -
          update.price.publish_time;
        if (
          age <= STOCK.pythMaxAgeSeconds &&
          price > 0n &&
          conf * BigInt(BPS_DENOMINATOR) <= BigInt(STOCK.pythMaxConfBps) * price
        ) {
          const usd = Number(price) * DECIMAL_RADIX ** update.price.expo;
          if (Number.isFinite(usd) && usd > 0) {
            const reading: SolUsdReading = {
              usd,
              source: "pyth",
              publishTime: update.price.publish_time,
            };
            await cache.set(
              "market:sol-usd",
              reading,
              MARKET.solUsd.cacheTtlMs,
            );
            return reading;
          }
        }
      }
    } catch (error) {
      logger.debug(
        {
          provider: "pyth",
          code: error instanceof MarketError ? error.code : "PRICE_UNAVAILABLE",
        },
        "SOL display source unavailable",
      );
    }
    if (MARKET.solUsd.fallbackToJupiter) {
      try {
        const price = (await source.getPrices([WSOL_MINT]))[WSOL_MINT];
        if (price && price.usdPrice > 0) {
          const reading: SolUsdReading = {
            usd: price.usdPrice,
            source: "jupiter",
            ageSlots: price.ageSlots,
          };
          await cache.set("market:sol-usd", reading, MARKET.solUsd.cacheTtlMs);
          return reading;
        }
      } catch (error) {
        logger.debug(
          {
            provider: "jupiter",
            code:
              error instanceof MarketError ? error.code : "PRICE_UNAVAILABLE",
          },
          "SOL display source unavailable",
        );
      }
    }
    throw new MarketError("PRICE_UNAVAILABLE", {
      message: "SOL display price unavailable",
    });
  }

  async function getSolUsdDetailed(): Promise<SolUsdReading> {
    if (solPending) return solPending;
    solPending = readSolUsd();
    try {
      return await solPending;
    } finally {
      solPending = undefined;
    }
  }
  return { ...source, getSolUsdDetailed };
}
