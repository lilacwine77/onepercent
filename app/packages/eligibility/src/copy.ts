import { en, t, count, dateUtc, ticker } from "@onepercent/copy/initial";
import { PACK_EDITIONS, PACK_SPLIT_BPS } from "@onepercent/config/web";
import {
  formatPct,
  formatSolDisplay,
  lamportsToSol,
  shortAddress,
} from "./format.js";
import { BPS_DENOMINATOR, FEED_RULES, XRAY } from "./params.js";
import type { ReasonCode } from "./types.js";
import type { XrayResult } from "./xray-result.js";

// Compatibility fragments for the architect-owned X1 template. Their source is COPY.md.
const [bottom = "", domain = ""] = t("xray.card.bottom").split(" ✳ ");
export const CARD_COPY = {
  brandMark: t("brand.mark"),
  brand: t("brand.name"),
  xray: t("nav.xray"),
  worst: en["xray.worst"].split(" {ticker}")[0]!,
  ath: en["xray.worst"].split("{pct} ")[1]!,
  bottom,
  domain,
  missing: t("common.noValue"),
} as const;

export const API_MESSAGES = {
  evm_not_supported: t("xray.error.evm_not_supported"),
  invalid_address: t("xray.error.invalid_address"),
  name_not_found: t("xray.error.name_not_found"),
  name_resolution_failed: t("xray.error.name_resolution_failed"),
  not_in_fixtures: t("xray.error.not_in_fixtures"),
  wallet_too_large: t("xray.error.wallet_too_large", {
    limit: count(XRAY.maxTokenAccounts),
  }),
  scan_timeout: t("xray.error.scan_timeout"),
  upstream_failed: t("xray.error.upstream_failed"),
  prices_unavailable: t("xray.error.prices_unavailable"),
  turnstile_required: t("xray.error.turnstile_required"),
  invalid_format: t("xray.error.invalid_format"),
  invalid_response: t("xray.error.invalid_response"),
  unavailable: t("xray.error.unavailable"),
} as const;
export const API_COPY = API_MESSAGES;

export function reasonText(
  code: ReasonCode,
  snapshotDate?: Date | string | null,
): string {
  if (code === "snapshot_not_held") {
    const date = snapshotDate == null ? null : new Date(snapshotDate);
    return date == null || !Number.isFinite(date.getTime())
      ? t("xray.reason.snapshot_not_held_undated")
      : t("xray.reason.snapshot_not_held", { date: dateUtc(date) });
  }
  if (code === "decimals")
    return t("xray.reason.decimals", {
      limit: count(FEED_RULES.maxMintDecimals),
    });
  return t(`xray.reason.${code}`);
}
export function feedableLabel(): string {
  const royalties = PACK_EDITIONS.map(
    ({ priceLamports }) =>
      (priceLamports * BigInt(PACK_SPLIT_BPS.royaltyPerDustCard)) /
      BigInt(BPS_DENOMINATOR),
  );
  return t("xray.feedableLabel", {
    min: lamportsToSol(royalties[0]!),
    max: lamportsToSol(royalties[royalties.length - 1]!),
  });
}
export const cardBagCount = (bags: number): string =>
  t("xray.bags", { n: count(bags) });
export function cardBreakdown(result: XrayResult): string[] {
  const { counts, totals } = result;
  const segments: string[] = [];
  if (counts.feedable)
    segments.push(t("xray.seg.feedable", { n: count(counts.feedable) }));
  if (counts.checkAtFeed)
    segments.push(t("xray.seg.checkAtFeed", { n: count(counts.checkAtFeed) }));
  if (counts.sellable)
    segments.push(
      t("xray.seg.bid", {
        n: count(counts.sellable),
        sol: formatSolDisplay(totals.sellValueSol),
      }),
    );
  if (counts.empty)
    segments.push(
      t("xray.seg.empty", {
        n: count(counts.empty),
        sol: formatSolDisplay(totals.rentBackSol),
      }),
    );
  return segments;
}
export function xraySegments(result: XrayResult): string {
  return [
    ...(result.counts.bags
      ? [t("xray.seg.bags", { n: count(result.counts.bags) })]
      : []),
    ...cardBreakdown(result),
  ].join(" ✳ ");
}
export function xrayLine(result: XrayResult): string {
  return [
    t("xray.linePrefix", { who: shortAddress(result.address) }),
    xraySegments(result),
  ]
    .filter(Boolean)
    .join(" ✳ ");
}
export const shareIntentText = (bags: number, title: string): string =>
  t("xray.share.intent", { n: count(bags), title });
export const ogTitle = (address: string): string =>
  t("xray.og.title", { who: shortAddress(address) });
export const CARD_TITLES = {
  clean: t("xray.title.clean"),
  lastDecimal: t("xray.title.lastDecimal"),
  collector: t("xray.title.collector"),
  dust: t("xray.title.dustBunny"),
  holder: t("xray.title.bagholder"),
} as const;
export const CARD_LINES = {
  clean: t("xray.oneLiner.clean"),
  collection: t("xray.oneLiner.collected"),
  holding: t("xray.oneLiner.holding"),
  tops: t("xray.oneLiner.tops"),
  counts: (n: number, d: number, e: number) =>
    t("xray.oneLiner.counts", { n: count(n), d: count(d), e: count(e) }),
  worst: (symbol: string, drawdown: number) =>
    t("xray.oneLiner.worst", {
      ticker: ticker(symbol),
      pct: formatPct(drawdown),
    }),
  charts: t("xray.oneLiner.charts"),
  hands: t("xray.oneLiner.hands"),
} as const;
// Developer log lines are outside the public copy deck (COPY.md §0.1).
export const API_LOGS = {
  fixtures: "X-ray: fixtures mode",
  noopTurnstile: "X-ray: Turnstile noop verifier",
  skippedAccounts: "X-ray: skipped unparseable token accounts",
} as const;
export const SHARE_COPY = {
  title: (who: string) => t("xray.og.title", { who }),
  intent: shareIntentText,
  fallbackLink: t("xray.share.fallback"),
} as const;
export function cardWorst(worst: XrayResult["worst"]): string {
  return worst
    ? t("xray.worst", {
        ticker: ticker(worst.symbol),
        pct: formatPct(worst.drawdownPct),
      })
    : "";
}
export const cardOneLiner = (line: string): string => `“${line}”`;
export const CARD_CONDITIONS = [
  en["xray.condition.mint"],
  en["xray.condition.nearMint"],
  en["xray.condition.lightlyPlayed"],
  en["xray.condition.played"],
  en["xray.condition.heavilyPlayed"],
  en["xray.condition.damaged"],
] as const;
