/* eslint-disable */
// Synced from experience/lab/src/rip/end.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * The end state's actions (founder rule, after a pull): a stock hit is sold to the machine in one tap
 * ("Sell · +X SOL · instant") or found in My cards ("Go to My cards", which opens it with the card
 * highlighted); the Jackpot and The 1% wait in My cards; Dust Cards and House slots have no action.
 * "Rip again", in the host's dock, stays the strongest call to action.
 */
import type { CardAction, HitTier } from "./types";

/** The default actions of an end-state card (the app may pass its own `actions`). */
export function endActions(
  card: { hit: true; tier: HitTier } | { hit: false },
): CardAction[] {
  if (!card.hit) return [];
  return card.tier === "jackpot" || card.tier === "one_pct"
    ? ["my_cards"]
    : ["sell_back", "my_cards"];
}

/**
 * Their strings (COPY.md §6.7, issue 2's first part), byte for byte; the web test
 * `experience/cards/cards.test.ts` holds every key to `@onepercent/copy`.
 */
export const END_COPY = {
  "cards.choice.sell": "Sell",
  "cards.figure.sell": "+{sol} SOL · instant",
  "cards.done.sell": "Sold. +{sol} SOL.",
  "rip.end.myCards": "Go to My cards",
  "rip.end.dust": "Dust Cards land in My cards.",
  "rip.end.sold": "Sold.",
  "rip.end.soldChip": "Sold · +{sol} SOL",
} as const;

export type EndCopyKey = keyof typeof END_COPY;

/** `{name}` placeholders, as `@onepercent/copy` fills them. */
export function endCopy(
  key: EndCopyKey,
  vars: Record<string, string> = {},
): string {
  return END_COPY[key].replace(
    /\{(\w+)\}/g,
    (m, name: string) => vars[name] ?? m,
  );
}
