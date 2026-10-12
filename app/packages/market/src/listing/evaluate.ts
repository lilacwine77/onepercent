import {
  BPS_DENOMINATOR,
  HIT_LIST,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_DAY,
  STOCK,
} from "../params.js";
import {
  type BaseListingEvidence,
  type MajorEvidence,
  type TrendingEvidence,
} from "./evidence.js";
import {
  listingReportSchema,
  type ListingCriterion,
  type ListingReport,
} from "./report.js";

function criterion(
  id: string,
  observed: ListingCriterion["observed"],
  threshold: ListingCriterion["threshold"],
  source: string,
  passes: boolean,
): ListingCriterion {
  return { id, observed, threshold, source, pass: observed !== null && passes };
}
function report(
  evidence: BaseListingEvidence,
  kind: "MAJOR" | "TRENDING",
  nowMs: number,
  criteria: ListingCriterion[],
): ListingReport {
  return listingReportSchema.parse({
    version: "x2-listing-v1",
    mint: evidence.mint,
    class: kind,
    checkedAt: nowMs,
    pass: criteria.every((entry) => entry.pass),
    criteria,
    info: {
      capLamports: evidence.capLamports?.toString() ?? null,
      excludedHolders:
        evidence.excludedHolders?.map((holder) => ({
          ...holder,
          amount: holder.amount.toString(),
        })) ?? null,
      jupiterTopHoldersPercentage: evidence.jupiterTopHoldersPercentage,
    },
  });
}
function common(evidence: BaseListingEvidence): ListingCriterion[] {
  const symbol = evidence.symbol?.trim().toUpperCase() ?? null;
  return [
    criterion(
      "never_listed",
      symbol,
      [...HIT_LIST.neverListed],
      "Published hit-list exclusions",
      symbol !== null &&
        !HIT_LIST.neverListed.some((blocked) => blocked === symbol),
    ),
    criterion(
      "mint_is_safe",
      evidence.mintSafe,
      true,
      "Solana mint account",
      evidence.mintSafe === true,
    ),
  ];
}

export function evaluateMajor(
  evidence: MajorEvidence,
  nowMs: number,
): ListingReport {
  const ageSeconds = evidence.pyth
    ? Math.floor(nowMs / MILLISECONDS_PER_SECOND) - evidence.pyth.publish_time
    : null;
  const ageMs =
    evidence.firstPoolCreatedAtMs === null
      ? null
      : nowMs - evidence.firstPoolCreatedAtMs;
  const price = evidence.pyth ? BigInt(evidence.pyth.price) : null;
  const conf = evidence.pyth ? BigInt(evidence.pyth.conf) : null;
  const confidence =
    price !== null && conf !== null
      ? { price: price.toString(), conf: conf.toString() }
      : null;
  const criteria = [
    ...common(evidence),
    criterion(
      "pyth_fresh",
      ageSeconds,
      STOCK.pythMaxAgeSeconds,
      "Pyth Hermes publish_time",
      ageSeconds !== null && ageSeconds <= STOCK.pythMaxAgeSeconds,
    ),
    criterion(
      "pyth_conf",
      confidence,
      STOCK.pythMaxConfBps,
      "Pyth Hermes confidence ratio",
      price !== null &&
        conf !== null &&
        price > 0n &&
        conf >= 0n &&
        conf * BigInt(BPS_DENOMINATOR) <= price * BigInt(STOCK.pythMaxConfBps),
    ),
    criterion(
      "age_days",
      ageMs === null
        ? null
        : Math.floor(ageMs / (SECONDS_PER_DAY * MILLISECONDS_PER_SECOND)),
      HIT_LIST.majorBar.minAgeDays,
      "Jupiter Tokens v2 firstPool.createdAt",
      ageMs !== null &&
        ageMs >=
          HIT_LIST.majorBar.minAgeDays *
            SECONDS_PER_DAY *
            MILLISECONDS_PER_SECOND,
    ),
    criterion(
      "liquidity_usd",
      evidence.externalDepthUsd,
      HIT_LIST.majorBar.minLiquidityUsd,
      "[EXT] Jupiter Tokens v2 listing bar only",
      evidence.externalDepthUsd !== null &&
        evidence.externalDepthUsd >= HIT_LIST.majorBar.minLiquidityUsd,
    ),
    criterion(
      "sell150_recovery_bps",
      evidence.sellRecoveryBps?.toString() ?? null,
      HIT_LIST.majorBar.sell150SolMinRecoveryBps,
      "Jupiter Metis sell probe",
      evidence.sellRecoveryBps !== null &&
        evidence.sellRecoveryBps >=
          BigInt(HIT_LIST.majorBar.sell150SolMinRecoveryBps),
    ),
    criterion(
      "sigma_daily_bps",
      evidence.dailySigmaBps,
      HIT_LIST.majorBar.maxDailySigmaBps,
      "Eight daily Pyth closes; sample log-return deviation",
      evidence.dailySigmaBps !== null &&
        evidence.dailySigmaBps <= HIT_LIST.majorBar.maxDailySigmaBps,
    ),
  ];
  return report(evidence, "MAJOR", nowMs, criteria);
}

export function evaluateTrending(
  evidence: TrendingEvidence,
  nowMs: number,
): ListingReport {
  const ageMs =
    evidence.graduatedAtMs === null ? null : nowMs - evidence.graduatedAtMs;
  const graduation =
    evidence.graduatedPool !== null &&
    evidence.canonicalPool !== null &&
    ageMs !== null
      ? {
          actualPool: evidence.graduatedPool,
          canonicalPool: evidence.canonicalPool,
          ageDays: Math.floor(
            ageMs / (SECONDS_PER_DAY * MILLISECONDS_PER_SECOND),
          ),
        }
      : null;
  const mayhem =
    evidence.curveMayhem === null || evidence.poolMayhem === null
      ? null
      : { curve: evidence.curveMayhem, pool: evidence.poolMayhem };
  const quote =
    evidence.curveSolQuote === null || evidence.poolSolQuote === null
      ? null
      : { curve: evidence.curveSolQuote, pool: evidence.poolSolQuote };
  const base = common(evidence);
  const criteria = [
    base[0]!,
    criterion(
      "pump_origin",
      evidence.pumpOrigin,
      true,
      "Derived pump curve PDA, owner and discriminator",
      evidence.pumpOrigin === true,
    ),
    base[1]!,
    criterion(
      "graduated_canonical_days",
      graduation,
      HIT_LIST.trendingBar.minGraduatedDays,
      "Jupiter graduation and derived canonical pool",
      graduation !== null &&
        evidence.graduatedPool === evidence.canonicalPool &&
        ageMs! >=
          HIT_LIST.trendingBar.minGraduatedDays *
            SECONDS_PER_DAY *
            MILLISECONDS_PER_SECOND,
    ),
    criterion(
      "pool_real_quote_lamports",
      evidence.realQuoteLamports?.toString() ?? null,
      HIT_LIST.trendingBar.minPoolQuoteLamports.toString(),
      "Canonical pool real quote vault",
      evidence.realQuoteLamports !== null &&
        evidence.realQuoteLamports >= HIT_LIST.trendingBar.minPoolQuoteLamports,
    ),
    criterion(
      "holders",
      evidence.holderCount,
      HIT_LIST.trendingBar.minHolders,
      "Jupiter Tokens v2 holderCount",
      evidence.holderCount !== null &&
        evidence.holderCount >= HIT_LIST.trendingBar.minHolders,
    ),
    criterion(
      "top10_bps",
      evidence.top10Bps?.toString() ?? null,
      HIT_LIST.trendingBar.maxTop10Bps,
      "Solana largest eligible holder accounts",
      evidence.top10Bps !== null &&
        evidence.top10Bps <= BigInt(HIT_LIST.trendingBar.maxTop10Bps),
    ),
    criterion(
      "organic_score",
      evidence.organicScore,
      HIT_LIST.trendingBar.minOrganicScore,
      "Jupiter Tokens v2 organicScore",
      evidence.organicScore !== null &&
        evidence.organicScore >= HIT_LIST.trendingBar.minOrganicScore,
    ),
    criterion(
      "not_sus",
      evidence.auditNotSus,
      true,
      "Jupiter Tokens v2 audit.isSus absent",
      evidence.auditNotSus === true,
    ),
    criterion(
      "not_mayhem",
      mayhem,
      false,
      "Curve and canonical pool flags",
      mayhem !== null && !mayhem.curve && !mayhem.pool,
    ),
    criterion(
      "sol_quote",
      quote,
      true,
      "Curve SOL and pool wSOL quote mints",
      quote !== null && quote.curve && quote.pool,
    ),
  ];
  return report(evidence, "TRENDING", nowMs, criteria);
}
