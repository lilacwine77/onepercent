import { FEED_RULES } from "@onepercent/config";
import { WEB } from "@onepercent/config/web";
import {
  amount,
  cardTicker,
  count,
  dateUtc,
  en,
  solCost,
  timeUtc,
  type CopyKey,
} from "@onepercent/copy";
import { PHASE } from "@onepercent/sdk/browser";
import type { FeedViewProps } from "../experience/index";
import {
  feedDepositCost,
  feedIsOpen,
  freshFeedRoom,
  type ChainBag,
} from "../data/feed-chain";
import type { FeedDisplay, FeedWallet } from "../data/feed";

export type FeedMessage = NonNullable<
  FeedViewProps["panel"]["flow"]["message"]
>;
export function refusalMessage(
  reason: string,
  date: string | null = null,
): FeedMessage {
  const key =
    reason === "snapshot_not_held" && !date
      ? "feed.refusal.snapshot_not_held_undated"
      : `feed.refusal.${reason}`;
  return {
    key:
      key in en
        ? (key as CopyKey)
        : reason === "role_disabled" ||
            reason === "role_mismatch" ||
            reason === "unavailable"
          ? "feed.refusal.service_down"
          : "feed.refusal.unknown",
    vars: {
      cap: count(FEED_RULES.freshCapPerWallet),
      ...(date ? { date: dateUtc(date) } : {}),
    },
  };
}
export function feedGate(
  snapshot: FeedWallet,
  enabled: boolean,
): FeedViewProps["panel"]["gate"] {
  const core = snapshot.core;
  if (
    core &&
    (core.machine.phase >= PHASE.buysClosed ||
      (core.machine.end_ts > 0n &&
        BigInt(core.blockTime) >= core.machine.end_ts))
  )
    return { open: false, reason: { key: "feed.phase.over" } };
  if (!core || core.machine.phase === PHASE.setup)
    return {
      open: false,
      reason:
        core && core.config.stock_up_ts > 0n
          ? {
              key: "feed.phase.before",
              vars: {
                date: dateUtc(
                  Number(core.config.stock_up_ts) * WEB.millisecondsPerSecond,
                ),
                time: timeUtc(
                  Number(core.config.stock_up_ts) * WEB.millisecondsPerSecond,
                ),
              },
            }
          : { key: "feed.phase.beforeUndated" },
    };
  return enabled && feedIsOpen(core)
    ? { open: true, reason: null }
    : { open: false, reason: { key: "feed.phase.paused" } };
}
export function bagCoin(
  bag: { mint: { toBase58(): string } },
  display: FeedDisplay,
) {
  const mint = bag.mint.toBase58();
  const value = display.values.find((item) => item.mint === mint);
  const xray = display.xray?.bags.find((item) => item.mint === mint);
  return {
    mint,
    ticker: cardTicker(value?.symbol ?? xray?.symbol ?? "", mint),
    name: value?.name ?? xray?.name ?? mint,
    logoUrl: value?.logo ?? `/api/logo/${mint}`,
  };
}
export function feedRows(input: {
  snapshot: FeedWallet;
  display: FeedDisplay;
  unchecked: ReadonlySet<string>;
  confirmed: ReadonlySet<string>;
  refused: ReadonlyMap<string, FeedMessage>;
}): FeedViewProps["panel"]["rows"] {
  let room = input.snapshot.core ? freshFeedRoom(input.snapshot.core) : 0;
  return input.snapshot.inventory.bags.map((bag) => {
    const mint = bag.mint.toBase58();
    let reason = input.refused.get(mint) ?? null;
    if (!reason && !bag.feedable) {
      const key = `xray.reason.${bag.reasonCode}`;
      reason = {
        key: key in en ? (key as CopyKey) : "feed.refusal.not_supported",
        vars: { limit: count(FEED_RULES.maxMintDecimals) },
      };
    }
    // X-ray checks this wallet's snapshot only. The intake also accepts an
    // eligible sender's one-hop transfer, so it owns the final provenance check.
    const checked = !input.unchecked.has(mint);
    if (!reason && checked) {
      if (room <= 0)
        reason = {
          key: "feed.capReached",
          vars: { cap: count(FEED_RULES.freshCapPerWallet) },
        };
      else room--;
    }
    const quote = input.display.values.find(
      (item) => item.mint === mint && BigInt(item.amount) === bag.amount,
    )?.value;
    const value =
      Date.now() - input.display.quotedAt <= WEB.configRefreshMs &&
      quote?.status === "ok" &&
      quote.label === "if_sold_now"
        ? { kind: "now" as const, lamports: BigInt(quote.lamports) }
        : { kind: "none" as const };
    return {
      coin: bagCoin(bag, input.display),
      amountUi: bag.decimals === null ? "" : amount(bag.amount, bag.decimals),
      drawdownPct: null,
      value,
      feed: checked && !reason,
      canFeed: { open: reason === null, reason },
      needsConfirm:
        value.kind === "now" &&
        value.lamports > FEED_RULES.confirmAboveLamports,
      confirmed: input.confirmed.has(mint),
      note: reason ? null : { key: "feed.row.checkAtFeed" as const },
    };
  });
}
export function depositLines(
  snapshot: FeedWallet,
  selected: readonly ChainBag[],
) {
  const costs = feedDepositCost(
    selected,
    Boolean(snapshot.core?.binder),
    snapshot.rent,
    snapshot.core?.binderLamports,
  );
  const lines: FeedMessage[] = [];
  if (selected.length)
    lines.push({
      key:
        selected.length === 1
          ? "feed.deposits.entry.one"
          : "feed.deposits.entry.other",
      vars: {
        n: count(selected.length),
        each: solCost(snapshot.rent.deckEntry),
      },
    });
  // Per coin keeps differing SPL/Token-2022 deposits exact.
  for (const bag of selected) {
    const coin = feedDepositCost([bag], true, snapshot.rent);
    if (coin.vaults + coin.ledgers > 0n)
      lines.push({
        key: "feed.deposits.newCoin.one",
        vars: { sol: solCost(coin.vaults + coin.ledgers) },
      });
  }
  if (costs.binder)
    lines.push({
      key: "feed.deposits.myCards",
      vars: { sol: solCost(costs.binder) },
    });
  return { totalLamports: costs.total, lines };
}
