/* eslint-disable */
// Synced from experience/cards-lab/src/cards/actions.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * What My cards offers, per card and for every card at once (founder rule: at most two actions per
 * card, each with one clear number):
 *  - hits (Silver Foil to Black Foil): Sell (the `sell_back` quote, paid at once) or Redeem;
 *  - Dust Cards: Feed back (one estimate, paid when a pack pulls it) or Redeem;
 *  - specials (Jackpot, The 1%, Final, Spotlight): Redeem.
 * Keeping is no action: a card stays in My cards until the player chooses.
 */
import { SELL_BACK_KINDS } from "./brand";
import type { CardKind, CardRow, Gate } from "./types";

export type Choice = "sell_back" | "feed_back" | "redeem";

/** The actions of a card, in display order (the first one leads). */
export function choicesFor(kind: CardKind): Choice[] {
  if (SELL_BACK_KINDS.includes(kind)) return ["sell_back", "redeem"];
  if (kind === "dust") return ["feed_back", "redeem"];
  return ["redeem"];
}

export function gateFor(card: CardRow, choice: Choice): Gate {
  return choice === "sell_back"
    ? card.actions.sellBack
    : choice === "feed_back"
      ? card.actions.feedBack
      : card.actions.redeem;
}

/** The pre-selected action: the card's first open one (Sell for a hit, Feed back for a Dust Card), else Redeem. */
export function defaultChoice(card: CardRow): Choice {
  return choicesFor(card.kind).find((c) => gateFor(card, c).open) ?? "redeem";
}

export interface BulkOption {
  action: Choice;
  /** The cards it acts on now (their gate is open). */
  ids: string[];
  /** The cards of its kind (hits, Dust Cards, every card): more than `ids.length` when some are closed. */
  of: number;
  /** "+X SOL" (the Sell quotes) or "≈Y SOL" (the Feed back estimate × the cards); null for Redeem. */
  lamports: bigint | null;
}

/**
 * The bulk bar: "Sell all hits · +X SOL", "Feed back all dust · ≈Y SOL", "Redeem all", in this order and
 * only those that apply. Sell covers the hits with an open gate; its action preview quotes the whole batch.
 * Feed back covers the Dust Cards
 * with an open gate, at `estimate` each.
 */
export function bulkOptions(
  cards: CardRow[],
  estimate: bigint | null,
): BulkOption[] {
  const out: BulkOption[] = [];
  const hits = cards.filter((c) => SELL_BACK_KINDS.includes(c.kind));
  const sell = hits.filter((c) => c.actions.sellBack.open);
  if (sell.length) {
    const lamports = sell.every((c) => c.sellBack && c.sellBack.kind !== "none")
      ? sell.reduce(
          (sum, c) =>
            sum +
            (c.sellBack && c.sellBack.kind !== "none"
              ? c.sellBack.lamports
              : 0n),
          0n,
        )
      : null;
    out.push({
      action: "sell_back",
      ids: sell.map((c) => c.cardId),
      of: hits.length,
      lamports,
    });
  }
  const dust = cards.filter((c) => c.kind === "dust");
  const feed = dust.filter((c) => c.actions.feedBack.open);
  if (feed.length && estimate !== null) {
    out.push({
      action: "feed_back",
      ids: feed.map((c) => c.cardId),
      of: dust.length,
      lamports: estimate * BigInt(feed.length),
    });
  }
  const redeem = cards.filter((c) => c.actions.redeem.open);
  if (redeem.length)
    out.push({
      action: "redeem",
      ids: redeem.map((c) => c.cardId),
      of: cards.length,
      lamports: null,
    });
  return out;
}
