import { PublicKey } from "@solana/web3.js";
import { defaultClock, type Clock } from "../clock.js";
import { deriveCanonicalPool } from "../chain/pump-layouts.js";
import { MarketError } from "../errors.js";
import { validateMints } from "../jupiter/price.js";
import { type JupiterSwapClient } from "../jupiter/swap.js";
import { type JupiterTokensClient } from "../jupiter/tokens.js";
import {
  BPS_DENOMINATOR,
  DECIMAL_RADIX,
  FEED_RULES,
  HIT_LIST,
  LAMPORTS_PER_SOL,
  MARKET,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_DAY,
  STOCK,
  U64_MAX,
  WSOL_MINT,
} from "../params.js";
import { type PythHermesClient, type PythPriceUpdate } from "../pyth/hermes.js";
import { capLamportsAtImpact, type Ladder } from "../value/ladder.js";
import { sigmaDailyBps } from "./sigma.js";
import { type ListingHistoryClient } from "./history.js";

export type PythReading = PythPriceUpdate["price"];
export interface ExcludedHolder {
  address: string;
  owner: string;
  amount: bigint;
  reason: string;
}
export interface BaseListingEvidence {
  mint: string;
  symbol: string | null;
  mintSafe: boolean | null;
  capLamports: bigint | null;
  excludedHolders: ExcludedHolder[] | null;
  jupiterTopHoldersPercentage: number | null;
}
export interface MajorEvidence extends BaseListingEvidence {
  pyth: PythReading | null;
  pythSource?: string;
  firstPoolCreatedAtMs: number | null;
  externalDepthUsd: number | null;
  sellRecoveryBps: bigint | null;
  dailySigmaBps: number | null;
  dailySigmaSource?: string;
}
export interface TrendingEvidence extends BaseListingEvidence {
  pumpOrigin: boolean | null;
  graduatedPool: string | null;
  canonicalPool: string | null;
  graduatedAtMs: number | null;
  realQuoteLamports: bigint | null;
  holderCount: number | null;
  top10Bps: bigint | null;
  organicScore: number | null;
  auditNotSus: boolean | null;
  curveMayhem: boolean | null;
  poolMayhem: boolean | null;
  curveSolQuote: boolean | null;
  poolSolQuote: boolean | null;
}
export interface ListingEvidenceOptions {
  tokens: JupiterTokensClient;
  pyth: Pick<PythHermesClient, "getLatest"> &
    Partial<Pick<PythHermesClient, "getHistorical">>;
  pythSource?: string;
  history?: ListingHistoryClient;
  swap: JupiterSwapClient;
  mintSafety: {
    getMintSafety(mint: string): Promise<{ safe: boolean; decimals: number }>;
  };
  exitCaps: {
    getCurve(
      mint: string,
    ): Promise<{ mayhem: boolean; quoteMint: string } | undefined>;
    getCanonicalPool(mint: string): Promise<
      | {
          address: string;
          mayhem: boolean;
          quoteMint: string;
          realQuoteLamports: bigint;
        }
      | undefined
    >;
  };
  holders: {
    getTopHolders(
      mint: string,
    ): Promise<{ top10Bps: number | bigint; excluded: ExcludedHolder[] }>;
  };
  buildLadder(mint: string, baseAmount: bigint): Promise<Ladder>;
  clock?: Clock;
}

/** Normalize Pyth exponents before the single integer division. */
export function majorSellProbeAmount(
  sol: PythReading,
  token: PythReading,
  decimals: number,
): bigint {
  const solPrice = BigInt(sol.price);
  const tokenPrice = BigInt(token.price);
  if (
    solPrice <= 0n ||
    tokenPrice <= 0n ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > FEED_RULES.maxMintDecimals ||
    !Number.isSafeInteger(sol.expo) ||
    !Number.isSafeInteger(token.expo)
  ) {
    throw new MarketError("INVALID_INPUT", {
      message: "Invalid Pyth probe inputs",
    });
  }
  let numerator = MARKET.listing.majorSellProbeLamports * solPrice;
  let denominator = tokenPrice * LAMPORTS_PER_SOL;
  const exponent = sol.expo + decimals - token.expo;
  if (!Number.isSafeInteger(exponent))
    throw new MarketError("INVALID_INPUT", {
      message: "Invalid combined Pyth exponent",
    });
  if (exponent >= 0) {
    // Decimal digit bounds detect impossible u64 amounts before constructing a large power.
    if (exponent > denominator.toString().length + U64_MAX.toString().length)
      throw new MarketError("INVALID_INPUT", {
        message: "Probe amount exceeds u64",
      });
    numerator *= BigInt(DECIMAL_RADIX) ** BigInt(exponent);
  } else {
    if (-exponent > numerator.toString().length) return 0n;
    denominator *= BigInt(DECIMAL_RADIX) ** BigInt(-exponent);
  }
  const amount = numerator / denominator;
  if (amount > U64_MAX)
    throw new MarketError("INVALID_INPUT", {
      message: "Probe amount exceeds u64",
    });
  return amount;
}

export function dailyCloseTimes(nowMs: number): number[] {
  const nowSeconds = Math.floor(nowMs / MILLISECONDS_PER_SECOND);
  let midnight = Math.floor(nowSeconds / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  if (midnight === nowSeconds) midnight -= SECONDS_PER_DAY;
  return Array.from(
    { length: MARKET.listing.sigmaWindowDays + 1 },
    (_, index) =>
      midnight - (MARKET.listing.sigmaWindowDays - index) * SECONDS_PER_DAY,
  );
}

async function nullable<T>(task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch {
    return null;
  }
}
function parsedDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eligibleProbeReading(reading: PythReading, nowMs: number): boolean {
  const price = BigInt(reading.price);
  const conf = BigInt(reading.conf);
  const age =
    Math.floor(nowMs / MILLISECONDS_PER_SECOND) - reading.publish_time;
  return (
    price > 0n &&
    conf >= 0n &&
    age <= STOCK.pythMaxAgeSeconds &&
    conf * BigInt(BPS_DENOMINATOR) <= BigInt(STOCK.pythMaxConfBps) * price
  );
}

export function createListingEvidenceGatherer(opts: ListingEvidenceOptions): {
  gatherMajorEvidence(mint: string, pythFeedId: string): Promise<MajorEvidence>;
  gatherTrendingEvidence(mint: string): Promise<TrendingEvidence>;
} {
  const clock = opts.clock ?? defaultClock;
  async function dailyCloses(mint: string, feedId: string, times: number[]) {
    if (opts.history) return opts.history.getDailyCloses(mint, feedId, times);
    const getHistorical = opts.pyth.getHistorical?.bind(opts.pyth);
    if (!getHistorical) throw new MarketError("PRICE_UNAVAILABLE");
    const historical = await Promise.all(
      times.map((time) => getHistorical(feedId, time)),
    );
    if (
      !historical.every(
        (entry, index) =>
          entry !== undefined &&
          entry.price.publish_time >= times[index]! &&
          entry.price.publish_time < times[index]! + SECONDS_PER_DAY,
      )
    )
      throw new MarketError("PRICE_UNAVAILABLE");
    return {
      closes: historical.map(
        (entry) =>
          Number(entry!.price.price) * DECIMAL_RADIX ** entry!.price.expo,
      ),
      source: "Eight daily Pyth closes; sample log-return deviation",
    };
  }
  async function cap(mint: string): Promise<bigint | null> {
    return nullable(async () => {
      const buy = await opts.swap.quoteBuy(mint, LAMPORTS_PER_SOL);
      if (buy.outAmount <= 0n) throw new MarketError("NO_ROUTE");
      const ladder = await opts.buildLadder(mint, buy.outAmount);
      return capLamportsAtImpact(ladder, HIT_LIST.capMaxPriceImpactBps) ?? null;
    });
  }
  return {
    async gatherMajorEvidence(mint, pythFeedId) {
      validateMints([mint]);
      const nowMs = clock.nowMs();
      const closeTimes = dailyCloseTimes(nowMs);
      const [safety, tokens, historical, capLamports] = await Promise.all([
        nullable(() => opts.mintSafety.getMintSafety(mint)),
        nullable(() => opts.tokens.getTokens([mint])),
        nullable(() => dailyCloses(mint, pythFeedId, closeTimes)),
        cap(mint),
      ]);
      // Public history and quote ladders may wait on provider rate limits.
      // Read both short-lived prices only when the sell probe can start.
      const [update, sol] = await Promise.all([
        nullable(() => opts.pyth.getLatest(pythFeedId)),
        nullable(() => opts.pyth.getLatest(HIT_LIST.solUsdPythFeedId)),
      ]);
      const token = tokens?.[mint];
      const sellRecoveryBps =
        update &&
        sol &&
        safety &&
        eligibleProbeReading(update.price, clock.nowMs()) &&
        eligibleProbeReading(sol.price, clock.nowMs())
          ? await nullable(async () => {
              const amount = majorSellProbeAmount(
                sol.price,
                update.price,
                safety.decimals,
              );
              const quote = await opts.swap.quote({
                inputMint: mint,
                outputMint: WSOL_MINT,
                amount,
                excludeRouters: MARKET.jupiter.listingProbeExcludeRouters,
              });
              return (
                (quote.outAmount * BigInt(BPS_DENOMINATOR)) /
                MARKET.listing.majorSellProbeLamports
              );
            })
          : null;
      let dailySigmaBps: number | null = null;
      if (historical) {
        try {
          dailySigmaBps = sigmaDailyBps(historical.closes);
        } catch {
          /* A missing or nonpositive close leaves the statistic unavailable. */
        }
      }
      return {
        mint,
        symbol: token?.symbol.trim() ?? null,
        mintSafe: safety?.safe ?? null,
        pyth: update?.price ?? null,
        pythSource: opts.pythSource,
        firstPoolCreatedAtMs: parsedDate(token?.firstPool?.createdAt),
        externalDepthUsd: token?.liquidity ?? null,
        sellRecoveryBps,
        dailySigmaBps,
        dailySigmaSource:
          historical?.source ??
          (opts.history
            ? "Public daily closes unavailable (Pyth Benchmarks, GeckoTerminal)"
            : undefined),
        capLamports,
        excludedHolders: null,
        jupiterTopHoldersPercentage: token?.audit?.topHoldersPercentage ?? null,
      };
    },
    async gatherTrendingEvidence(mint) {
      validateMints([mint]);
      const [safety, tokens, curve, pool, holders, capLamports] =
        await Promise.all([
          nullable(() => opts.mintSafety.getMintSafety(mint)),
          nullable(() => opts.tokens.getTokens([mint])),
          nullable(() => opts.exitCaps.getCurve(mint)),
          nullable(() => opts.exitCaps.getCanonicalPool(mint)),
          nullable(() => opts.holders.getTopHolders(mint)),
          cap(mint),
        ]);
      const token = tokens?.[mint];
      return {
        mint,
        symbol: token?.symbol.trim() ?? null,
        mintSafe: safety?.safe ?? null,
        pumpOrigin: curve === null ? null : curve !== undefined,
        graduatedPool: token?.graduatedPool ?? null,
        canonicalPool: deriveCanonicalPool(mint),
        graduatedAtMs: parsedDate(token?.graduatedAt),
        realQuoteLamports: pool?.realQuoteLamports ?? null,
        holderCount: token?.holderCount ?? null,
        top10Bps: holders ? BigInt(holders.top10Bps) : null,
        organicScore: token?.organicScore ?? null,
        auditNotSus: token?.audit ? token.audit.isSus === undefined : null,
        curveMayhem: curve?.mayhem ?? null,
        poolMayhem: pool?.mayhem ?? null,
        curveSolQuote: curve
          ? curve.quoteMint === PublicKey.default.toBase58()
          : null,
        poolSolQuote: pool ? pool.quoteMint === WSOL_MINT : null,
        capLamports,
        excludedHolders: holders?.excluded ?? null,
        jupiterTopHoldersPercentage: token?.audit?.topHoldersPercentage ?? null,
      };
    },
  };
}
