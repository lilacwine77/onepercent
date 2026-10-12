import {
  HIT_TIERS,
  PACK_EDITIONS,
  TOKEN_1PCT,
  type PackEdition,
} from "@onepercent/config";
import { InlineKeyboard } from "grammy";
import {
  COPY,
  hitCopy,
  jackpotCopy,
  onePctCopy,
  royaltyCopy,
} from "../copy.js";
import {
  formatSol,
  formatUnits,
  sanitizeTicker,
  shortAddress,
} from "../format.js";
import { packsTarget } from "../links.js";

export type EditionId = PackEdition["id"];
export type RoyaltyEvent = { wallet: string; ticker: string; lamports: bigint };
export type HitEvent =
  | {
      tier: "holo" | "black";
      buyer: string;
      edition: EditionId;
      stockedLamports: bigint;
    }
  | { tier: "jackpot"; buyer: string; edition: EditionId; onePctAmount: bigint }
  | { tier: "onePct"; buyer: string; edition: EditionId };
export interface Notification {
  text: string;
  reply_markup?: InlineKeyboard;
}

export function royaltyTemplate(event: RoyaltyEvent): Notification {
  return {
    text: royaltyCopy(
      formatSol(event.lamports),
      sanitizeTicker(event.ticker),
      shortAddress(event.wallet),
    ),
  };
}
export function hitTemplate(event: HitEvent, webUrl: string): Notification {
  const edition = PACK_EDITIONS.find((entry) => entry.id === event.edition);
  if (!edition) throw new RangeError("Unknown edition");
  const article = /^the\s/i.test(edition.name)
    ? ""
    : /^[aeiou]/i.test(edition.name)
      ? "an"
      : "a";
  const buyer = shortAddress(event.buyer, true);
  if (event.tier === "onePct")
    return {
      text: onePctCopy(
        buyer,
        formatUnits(TOKEN_1PCT.onePctCardAmount, TOKEN_1PCT.decimals),
        article,
        edition.name,
      ),
    };
  if (event.tier === "jackpot")
    return {
      text: jackpotCopy(
        buyer,
        formatUnits(event.onePctAmount, TOKEN_1PCT.decimals),
        article,
        edition.name,
      ),
    };
  const tier = HIT_TIERS.find((entry) => entry.id === event.tier);
  if (!tier) throw new RangeError("Unknown tier");
  return {
    text: hitCopy(
      tier.label,
      formatUnits(BigInt(tier.valueBps), 4),
      buyer,
      article,
      edition.name,
      formatSol(event.stockedLamports),
    ),
    reply_markup: new InlineKeyboard().url(
      COPY.BUTTON_SAME_PACK,
      packsTarget(webUrl, edition.id),
    ),
  };
}
