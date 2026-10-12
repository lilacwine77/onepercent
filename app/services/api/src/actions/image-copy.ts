// TODO(packages/copy): M5 §7.6 local keys until the Bot/Blinks copy section is issued.
import { count, t } from "@onepercent/copy";
import { CARDS_PER_PACK } from "@onepercent/config";
import { RIP_COPY } from "./rip-copy.js";

export const IMAGE_COPY = {
  asOf: (time: string) => `as of ${time}`,
  genericTitle: "Rip a pack",
  title: (name: string, price: string) => `${name} ✳ ${price} SOL`,
  upTo: (n: number) => `Rip up to ${count(n)} now`,
  contents: `${CARDS_PER_PACK.dust} Dust Cards + ${CARDS_PER_PACK.hit} hit per pack`,
  jackpot: (amount: string, value: string | null) =>
    value === null
      ? `Jackpot ${amount} $1PCT`
      : `Jackpot ${amount} $1PCT ≈${value} SOL if sold now`,
  onePct: (card: number, of: number) =>
    `The 1% card ${count(card)} of ${count(of)} live`,
  state: {
    covered: "",
    refilling: t("blink.rip.state.refilling"),
    hungry: RIP_COPY.hungry,
    busy: RIP_COPY.busy,
    paused: t("errors.paused"),
    beforeOnAir: RIP_COPY.beforeOnAir,
    seasonOver: t("errors.seasonOver"),
    off: "This Blink is off right now.",
  },
  feedTitle: (ticker: string) => `Feed ${ticker}`,
  feedDescription: (min: string, max: string) =>
    `Each bag becomes a Dust Card ✳ ${min}–${max} SOL to you when it’s pulled ✳ take it back any time before`,
  feedState: {
    open: "",
    before: t("feed.phase.beforeUndated"),
    over: t("feed.phase.over"),
    paused: t("feed.phase.paused"),
    notInSet: t("feed.refusal.not_supported"),
    off: RIP_COPY.off,
  },
} as const;
