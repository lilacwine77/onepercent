import {
  CARDS_PER_PACK,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  HIT_TIERS,
} from "@onepercent/config/web";
import { FEED_BACK_RANGE } from "@onepercent/config/feed-back";
import { sol, t } from "@onepercent/copy/initial";
/**
 * Every string the home renders. COPY.md keys are used where they exist (`t`);
 * the rest is the "proposed for COPY" list of the experience report, gathered
 * here and nowhere else. Numbers come from @onepercent/config, never typed.
 */
const pct = (bps: number) =>
  `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Proposed for COPY (issue 2, home): key → text. The hero, "Got dust? Feed the
 * machine." and "How dust pays." read as the landing (onepercent.fun) does. */
export const PROPOSED = {
  "home.hero.lede":
    "Feed your dust to the machine. Rip foil packs with real Solana tokens inside.",
  "home.cta.pick": "Pick a pack →",
  "home.cta.feed": "Feed your dust",
  "home.cta.cards": "Open My cards",
  "home.soon": "The machine is warming up.",
  "home.countdown.onAir": "On air in",
  "home.countdown.feed": "Feed opens in",
  "home.film.watch": "Watch the film ↗",
  "home.film.title": "1% TV",
  "home.film.close": "Close",
  "home.film.label": "How Onepercent works, a short film",
  "home.film.captionsLabel": "English",
  "home.film.position": "Film position",
  "home.film.play": "Play",
  "home.film.pause": "Pause",
  "home.film.replay": "Replay",
  "home.film.replayLabel": "Replay the film",
  "home.film.starting": "Starting…",
  "home.film.retry": "Retry",
  "home.film.time": "{t} / {d}",
  "home.film.timeOf": "{t} of {d}",
  "home.film.soundOn": "Sound on",
  "home.film.soundOff": "Sound off",
  "home.film.mute": "Mute sound",
  "home.film.unmute": "Unmute sound",
  "home.film.cc": "CC",
  "home.film.captionsShow": "Show English captions",
  "home.film.captionsHide": "Hide English captions",
  "home.film.error": "The film couldn’t load. Use Play to try again.",
  "home.packs.title": "Pick a pack.",
  "home.packs.inside": `Every pack: ${CARDS_PER_PACK.dust} Dust Cards + ${CARDS_PER_PACK.hit} hit. Real tokens.`,
  "home.packs.rip": "Rip {edition} →",
  "home.packs.odds": "Odds and verify",
  "home.packs.jackpot": "Jackpot",
  "home.packs.onePct": "The 1%",
  "home.finish.original": "Polished silver × gold",
  "home.finish.blue_shift": "Electric blue × gold",
  "home.finish.signature": "Holographic foil × gold",
  "home.finish.after_hours": "Black anthracite × gold",
  "home.story.title": "Got dust?\nFeed the machine.",
  "home.story.body": `Each bag you feed becomes a Dust Card. When a pack pulls it, you get ${pct(PACK_SPLIT_BPS.royaltyPerDustCard)} of that pack’s price in\u00a0SOL.`,
  "home.story.cta": "How Feed works →",
  "home.story.machine":
    "The Onepercent machine, a lilac gumball machine full of gold coins and foil packs",
  "home.dust.title": "How dust pays.",
  "home.dust.lede":
    "Most dust sells for next to nothing. In the machine, it can still pay.",
  "home.dust.ticker": "$ANSEM",
  "home.dust.logo": "ANSEM logo",
  "home.dust.sells": "sells for",
  "home.dust.sold": "≈0.00027 SOL",
  "home.dust.amount": "0.2175",
  "home.dust.chain": "pump.fun ✳︎ Solana",
  "home.dust.fedBy": "Fed by you",
  "home.dust.card": "Dust Card",
  "home.dust.upTo": "up to",
  "home.dust.times": "75",
  "home.dust.when": "when a pack pulls it",
  "home.dust.range": `${sol(FEED_BACK_RANGE.min)}–${sol(FEED_BACK_RANGE.max)} SOL`,
  "home.dust.feed": "Feed",
  "home.dust.caption": `Example: an ANSEM bag that sells for about 0.00027 SOL becomes a Dust Card. When a pack pulls it, it pays ${sol(FEED_BACK_RANGE.min)} to ${sol(FEED_BACK_RANGE.max)} SOL, up to 75 times what the bag sells for.`,
  "home.dust.xray.title": "X-ray",
  "home.dust.xray.body": "See what each bag sells for.",
  "home.dust.feed.title": "Feed",
  "home.dust.feed.body": "Each bag becomes a Dust Card.",
  "home.dust.paid.title": "Get paid",
  "home.dust.paid.body": `${pct(PACK_SPLIT_BPS.royaltyPerDustCard)} of the pack that pulls it.`,
  "home.dust.back":
    "Changed your mind? Take your bag back any time before it’s pulled.",
  "home.dust.note": "Example: 0.2175 ANSEM, Jupiter quote on 10 Oct 2026.",
} as const;

type ProposedKey = keyof typeof PROPOSED;
export const copy = (key: ProposedKey, vars: Record<string, string> = {}) =>
  PROPOSED[key].replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");

/** Strings that already exist in COPY.md issue 1. */
export const existing = {
  lineIn: () => t("brand.lineIn"),
  lineGo: () => t("brand.lineGo"),
  seasonOver: () => t("errors.seasonOver"),
  trustSign: () => t("common.trustSign"),
};

export const editions = PACK_EDITIONS.map((edition) => ({
  id: edition.id,
  name: edition.name,
  /** Prices the user pays round up (M3-A7); edition prices are whole hundredths. */
  price: `${(Number(edition.priceLamports) / 1e9).toFixed(2)} SOL`,
  finish: PROPOSED[`home.finish.${edition.id}`],
}));
export const tiers = HIT_TIERS.map((tier) => ({
  id: tier.id,
  label: tier.label,
  mult: `${(tier.valueBps / 10_000).toLocaleString("en-US")}×`,
}));
