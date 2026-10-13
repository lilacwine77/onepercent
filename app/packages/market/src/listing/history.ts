import { z } from "zod";
import { defaultClock, type Clock } from "../clock.js";
import { MarketError, type MarketLogger } from "../errors.js";
import { createHttpClient, type HttpClient } from "../http/fetch-json.js";
import { SlidingWindowLimiter } from "../http/rate-limit.js";
import { validateMints } from "../jupiter/price.js";
import {
  CHAIN_LAYOUT,
  DECIMAL_RADIX,
  LISTING_HISTORY,
  MARKET,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_DAY,
  WSOL_MINT,
} from "../params.js";
import { pythPriceUpdateSchema } from "../pyth/hermes.js";

export interface ListingDailyCloses {
  closes: number[];
  source: string;
}
export interface ListingHistoryClient {
  getDailyCloses(
    mint: string,
    feedId: string,
    closeTimes: readonly number[],
  ): Promise<ListingDailyCloses>;
}
export interface ListingHistoryOptions {
  fetch: typeof fetch;
  clock?: Clock;
  logger?: MarketLogger;
  http?: HttpClient;
}

const benchmarksSchema = z.object({ parsed: z.array(pythPriceUpdateSchema) });
const relationshipSchema = z.object({ data: z.object({ id: z.string() }) });
const poolSchema = z.object({
  attributes: z.object({
    address: z.string(),
    reserve_in_usd: z.string().nullable(),
  }),
  relationships: z.object({
    base_token: relationshipSchema,
    quote_token: relationshipSchema,
  }),
});
const poolsSchema = z.object({ data: z.array(poolSchema) });
const ohlcvSchema = z.object({
  data: z.object({
    attributes: z.object({
      ohlcv_list: z.array(
        z.tuple([
          z.number().int().nonnegative(),
          z.number().positive(),
          z.number().positive(),
          z.number().positive(),
          z.number().positive(),
          z.number().nonnegative(),
        ]),
      ),
    }),
  }),
  meta: z.object({
    base: z.object({ address: z.string() }),
    quote: z.object({ address: z.string() }),
  }),
});
const geckoHeaders = { Accept: "application/json;version=20230203" };
const quoteMints = new Set<string>([
  WSOL_MINT,
  LISTING_HISTORY.usdcMint,
  LISTING_HISTORY.usdtMint,
]);

function unavailable(provider: string, message: string): MarketError {
  return new MarketError("PRICE_UNAVAILABLE", { provider, message });
}

/** Listing-only history. No API credentials or display prices enter this client. */
export function createListingHistoryClient(
  opts: ListingHistoryOptions,
): ListingHistoryClient {
  const clock = opts.clock ?? defaultClock;
  const benchmarks =
    opts.http ??
    createHttpClient({
      ...opts,
      provider: "pyth-benchmarks",
      limiter: new SlidingWindowLimiter(MARKET.pyth.requestsPerMinute, clock),
    });
  const gecko =
    opts.http ??
    createHttpClient({
      ...opts,
      provider: "geckoterminal",
      limiter: new SlidingWindowLimiter(
        LISTING_HISTORY.geckoRequestsPerMinute,
        clock,
      ),
    });
  let benchmarksRequiresAuth = false;

  async function pythClose(feedId: string, time: number): Promise<number> {
    const url = new URL(
      `${LISTING_HISTORY.pythBenchmarksUrl}/v1/updates/price/${time}`,
    );
    url.searchParams.append("ids[]", feedId);
    url.searchParams.set("parsed", "true");
    const response = await benchmarks.fetchJson(benchmarksSchema, {
      url: url.href,
    });
    const update = response.parsed.find(
      (entry) => entry.id.replace(/^0x/, "").toLowerCase() === feedId,
    );
    if (
      !update ||
      update.price.publish_time < time ||
      update.price.publish_time >= time + SECONDS_PER_DAY
    ) {
      throw unavailable("pyth-benchmarks", "Missing daily Pyth close");
    }
    const close =
      Number(update.price.price) * DECIMAL_RADIX ** update.price.expo;
    if (!Number.isFinite(close) || close <= 0)
      throw unavailable("pyth-benchmarks", "Invalid daily Pyth close");
    return close;
  }

  async function geckoCloses(
    mint: string,
    closeTimes: readonly number[],
  ): Promise<ListingDailyCloses> {
    let selected: z.infer<typeof poolSchema> | undefined;
    let largestReserve = 0;
    for (let page = 1; page <= LISTING_HISTORY.geckoMaxPoolPages; page += 1) {
      const url = new URL(
        `${LISTING_HISTORY.geckoTerminalUrl}/networks/solana/tokens/${mint}/pools`,
      );
      url.searchParams.set("sort", "h24_volume_usd_liquidity_desc");
      url.searchParams.set("page", String(page));
      const response = await gecko.fetchJson(poolsSchema, {
        url: url.href,
        headers: geckoHeaders,
      });
      for (const pool of response.data) {
        const base = pool.relationships.base_token.data.id;
        const quote = pool.relationships.quote_token.data.id;
        const other =
          base === `solana_${mint}`
            ? quote
            : quote === `solana_${mint}`
              ? base
              : undefined;
        if (!other?.startsWith("solana_")) continue;
        if (!quoteMints.has(other.slice("solana_".length))) continue;
        const reserve = Number(pool.attributes.reserve_in_usd);
        if (!Number.isFinite(reserve) || reserve <= largestReserve) continue;
        validateMints([pool.attributes.address]);
        selected = pool;
        largestReserve = reserve;
      }
      if (response.data.length < LISTING_HISTORY.geckoPoolsPerPage) break;
    }
    if (!selected)
      throw unavailable("geckoterminal", "No eligible SOL or USD pool");
    const poolAddress = selected.attributes.address;
    const url = new URL(
      `${LISTING_HISTORY.geckoTerminalUrl}/networks/solana/pools/${poolAddress}/ohlcv/day`,
    );
    url.searchParams.set("aggregate", "1");
    // Gecko timestamps are candle starts; the last requested close ends the day.
    url.searchParams.set("before_timestamp", String(closeTimes.at(-1)! - 1));
    url.searchParams.set("limit", String(closeTimes.length));
    url.searchParams.set("currency", "usd");
    url.searchParams.set("token", mint);
    url.searchParams.set("include_empty_intervals", "false");
    const response = await gecko.fetchJson(ohlcvSchema, {
      url: url.href,
      headers: geckoHeaders,
    });
    const pairedToken =
      selected.relationships.base_token.data.id === `solana_${mint}`
        ? selected.relationships.quote_token.data.id
        : selected.relationships.base_token.data.id;
    // Gecko reorients response metadata to the explicitly requested token.
    if (
      response.meta.base.address !== mint ||
      `solana_${response.meta.quote.address}` !== pairedToken
    ) {
      throw unavailable("geckoterminal", "OHLCV pool token mismatch");
    }
    const byClose = new Map<number, number>();
    for (const candle of response.data.attributes.ohlcv_list) {
      const closeTime = candle[0] + SECONDS_PER_DAY;
      if (byClose.has(closeTime))
        throw unavailable("geckoterminal", "Duplicate daily OHLCV candle");
      byClose.set(closeTime, candle[LISTING_HISTORY.ohlcvCloseIndex]);
    }
    const closes = closeTimes.map((time) => {
      const close = byClose.get(time);
      if (close === undefined)
        throw unavailable(
          "geckoterminal",
          "Missing completed daily OHLCV candle",
        );
      return close;
    });
    return {
      closes,
      source: `GeckoTerminal daily USD OHLCV; pool ${poolAddress}; token ${mint}; completed UTC closes ${closeTimes.join(",")}`,
    };
  }

  return {
    async getDailyCloses(mint, inputFeedId, closeTimes) {
      validateMints([mint]);
      const feedId = inputFeedId.replace(/^0x/, "").toLowerCase();
      const nowSeconds = Math.floor(clock.nowMs() / MILLISECONDS_PER_SECOND);
      if (
        feedId.length !== CHAIN_LAYOUT.publicKeyBytes * 2 ||
        !/^[\da-f]+$/.test(feedId) ||
        closeTimes.length !== MARKET.listing.sigmaWindowDays + 1 ||
        closeTimes.some(
          (time, index) =>
            !Number.isSafeInteger(time) ||
            time < SECONDS_PER_DAY ||
            time >= nowSeconds ||
            time % SECONDS_PER_DAY !== 0 ||
            (index > 0 && time !== closeTimes[index - 1]! + SECONDS_PER_DAY),
        )
      ) {
        throw new MarketError("INVALID_INPUT", {
          message:
            "Expected a Pyth feed and consecutive completed daily closes",
        });
      }
      if (!benchmarksRequiresAuth) {
        try {
          // Probe once before scheduling the remaining timestamps without a key.
          const closes = [await pythClose(feedId, closeTimes[0]!)];
          for (const time of closeTimes.slice(1)) {
            closes.push(await pythClose(feedId, time));
          }
          return {
            closes,
            source: `Pyth Benchmarks public timestamp prices; feed ${feedId}; UTC daily closes ${closeTimes.join(",")}`,
          };
        } catch (error) {
          if (error instanceof MarketError && error.code === "PROVIDER_AUTH")
            benchmarksRequiresAuth = true;
        }
      }
      return geckoCloses(mint, closeTimes);
    },
  };
}
