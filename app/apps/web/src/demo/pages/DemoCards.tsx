/**
 * PREVIEW builds only: My cards on the demo store. Each card offers at most two actions: hits Sell
 * (the machine buys it now) or Redeem, Dust Cards Feed back (one estimate) or Redeem, specials Redeem.
 */
import { useMemo } from "react";
import { PACK_SPLIT_BPS, SELL_BACK } from "@onepercent/config/web";
import { count, solCost } from "@onepercent/copy";
import { ExperienceSlot } from "../../bridge/ExperienceSlot";
import { preloadModule } from "../../app/lazy-module";
import {
  CardsShape,
  bulkOptions,
  loadCards,
  type ActionPreview,
  type CardRow,
  type CardsViewProps,
} from "../../experience/index";
import { motionPref, soundPref, useStore } from "../../app/prefs";
import { useFeedBackEstimate } from "../../data/feed-back";
import { navigate } from "../../routes/router";
import {
  ENTRY_DEPOSIT,
  NETWORK_FEE,
  demo,
  feedBack,
  redeem,
  sellBack,
  takeBack,
  type DemoCard,
} from "../store";
import { formatUi, sleep, useDemo, useDemoWallet } from "./shared";

const open = { open: true, reason: null };
const closed = { open: false, reason: null };
type Line = ActionPreview["lines"][number];
const m = (key: string, vars: Record<string, string> = {}): Line => ({
  key,
  vars,
});
const ticker = (symbol: string) => symbol.replace(/^\$/, "");
const SELLABLE = new Set(["silver", "blue", "holo", "black"]);
/** A demo card as My cards shows it: the gates match the actions My cards offers for its kind. */
export function cardRow(card: DemoCard): CardRow {
  const sellable = SELLABLE.has(card.kind) && card.sellBackLamports !== null;
  const dust = card.kind === "dust";
  return {
    cardId: card.cardId,
    kind: card.kind,
    edition: card.edition,
    seq: card.seq,
    coin: {
      mint: card.mint,
      ticker: ticker(card.symbol),
      name: card.name,
      logoUrl: card.logo,
    },
    amountUi: formatUi(card.amountUi),
    stockedLamports: card.stockedLamports,
    value: { kind: "est", lamports: card.valueLamports },
    sellBack: sellable
      ? { kind: "now", lamports: card.sellBackLamports! }
      : null,
    // No Feed back guard: the demo's Dust Cards are worth far less than
    // FEED_RULES.confirmAboveLamports (0.02 SOL, SPEC §2.2).
    actions: {
      redeem: open,
      sellBack: sellable ? open : closed,
      feedBack: dust ? open : closed,
    },
  };
}
/** "2 transactions, 1 approval": ≤ 8 cards a transaction; Sell, one coin a transaction (03-M3 §13.3). */
const batch = (transactions: number) =>
  m("cards.details.batch", {
    transactions: `${count(transactions)} transaction${transactions === 1 ? "" : "s"}`,
    approvals: "1 approval",
  });
const perEight = (n: number) => Math.max(1, Math.ceil(n / 8));

/** My cards' chunk, preloaded by the route (1% transition, router.ts). */
export const ready = () => preloadModule(loadCards);

export default function DemoCards() {
  const { address } = useDemoWallet();
  const state = useDemo();
  // The demo machine's estimate: the documented default edition mix (data/feed-back.ts).
  const estimate = useFeedBackEstimate();
  // "Go to My cards" on the Rip end: /cards?card=<id> lights that card.
  const highlight = new URLSearchParams(window.location.search).get("card");
  const data = useMemo<CardsViewProps["data"]>(
    () => ({
      status: "ready",
      wallet: { address: address ?? state.address, lamports: state.lamports },
      cards: state.cards.map(cardRow),
      pending: [],
      owedLamports: 0n,
      closeMyCards: null,
      inTheMachine: {
        entries: state.deck.map((entry) => ({
          entryId: entry.entryId,
          coin: {
            mint: entry.mint,
            ticker: entry.symbol,
            name: entry.name,
            logoUrl: entry.logo,
          },
          amountUi: formatUi(entry.amountUi),
          depositLamports: entry.depositLamports,
          refed: entry.refed,
        })),
        vaultDeposits: [],
      },
      valuesAsOfMs: Date.now(),
      config: {
        feedBackEstimateLamports: estimate,
        royaltyPct: `${PACK_SPLIT_BPS.royaltyPerDustCard / 100}%`,
      },
    }),
    [state, address, estimate],
  );
  const cardsOf = (ids: string[]) =>
    demo.get().cards.filter((c) => ids.includes(c.cardId));
  const props: CardsViewProps = {
    data,
    highlight,
    soundOn: useStore(soundPref),
    reducedMotion: useStore(motionPref),
    // The details row of each confirmation: transactions, fee, deposits.
    onPreview: async (action, ids): Promise<ActionPreview | null> => {
      await sleep(220);
      const cards = cardsOf(ids);
      const n = cards.length;
      const fee = (transactions: number) =>
        m("cards.details.networkFee", {
          sol: solCost(NETWORK_FEE * BigInt(transactions)),
        });
      if (action === "redeem")
        return { lines: [batch(perEight(n)), fee(perEight(n))] };
      if (action === "sell_back") {
        const pay = cards.reduce(
          (sum, c) => sum + (c.sellBackLamports ?? 0n),
          0n,
        );
        const coins = new Set(cards.map((c) => c.mint)).size;
        return {
          lines: [batch(coins), fee(coins)],
          receive: { kind: "now", lamports: pay },
          ttlSeconds: SELL_BACK.quoteTtlSeconds.major,
        };
      }
      if (action === "feed_back")
        return {
          lines: [
            batch(perEight(n)),
            fee(perEight(n)),
            m(
              n === 1
                ? "cards.details.deposit.one"
                : "cards.details.deposit.other",
              { n: count(n), sol: solCost(ENTRY_DEPOSIT * BigInt(n)) },
            ),
          ],
        };
      return null;
    },
    onAction: async (action, ids) => {
      await sleep(900);
      const cards = cardsOf(ids);
      const received =
        action === "sell_back"
          ? cards.reduce((sum, c) => sum + (c.sellBackLamports ?? 0n), 0n)
          : 0n;
      const apply: Partial<Record<string, () => unknown>> = {
        redeem: () => redeem(ids),
        sell_back: () => sellBack(ids),
        feed_back: () => feedBack(ids),
        take_back: () => takeBack(ids),
      };
      // The chain re-read lands after the action's moment, as in production.
      setTimeout(() => apply[action]?.(), 1400);
      return received ? { receivedLamports: received } : {};
    },
    onRip: () => navigate("/rip"),
    onVerify: (seq) => navigate(`/verify/${seq}`),
    onRefresh: () => undefined,
  };
  return (
    <ExperienceSlot
      component="cards"
      load={loadCards}
      props={props}
      poster={
        <CardsShape
          empty={state.cards.length === 0}
          bulk={bulkOptions(data.cards, estimate).length}
        />
      }
      placeholder={null}
    />
  );
}
