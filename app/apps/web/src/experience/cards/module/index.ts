/* eslint-disable */
// Synced from experience/cards-lab/src/cards/index.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * My cards: the inventory of The 1% Machine (vanilla TS + GSAP; no wallet, RPC or SDK import, no fetch
 * besides its own assets: 03-M3 §6.1).
 *
 *   const cards = mountCards(el, { assetsBase: '/experience/cards/', data });
 *   cards.on('preview', ({ action, ids }) => cards.setPreview(action, ids, { lines, receive, ttlSeconds }));
 *   cards.on('action', ({ action, ids }) => { cards.setActionState(ids, action, 'signing'); … });
 *   cards.setActionState(ids, 'sell_back', 'done', { receivedLamports });   // plays the moment
 *   cards.setData(next);                                                  // after the Binder re-read
 *   cards.highlight(cardId);                                              // the Rip end's "Go to My cards"
 */
import "./styles/index.css";
import { CardsView } from "./view";
import type {
  CardRow,
  CardsController,
  CardsData,
  MountCardsOptions,
  MyCardsProps,
} from "./types";

export function mountCards(
  container: HTMLElement,
  opts: MountCardsOptions = {},
): CardsController {
  return new CardsView(container, opts);
}

/** `MyCardsProps` (03-M3 §6.2) → `CardsData`. Hits, dust and prizes are one list; the component files them by kind. */
export function fromMyCardsProps(
  p: MyCardsProps,
  extra: Partial<CardsData> = {},
): CardsData {
  const cards: CardRow[] = [...p.hits, ...p.dust, ...p.prizes];
  return {
    status: "ready",
    cards,
    pending: p.pending,
    owedLamports: p.owedLamports,
    closeMyCards: p.closeMyCards,
    inTheMachine: {
      entries: p.inTheMachine.entries,
      vaultDeposits: p.inTheMachine.vaultDeposits,
    },
    ...extra,
  };
}

/**
 * Wires the controller's events to `MyCardsProps` callbacks (read through `get()` so the latest props win).
 * Returns the unsubscribe function.
 */
export function bindMyCardsProps(
  c: CardsController,
  get: () => MyCardsProps,
): () => void {
  const offs = [
    c.on("action", ({ action, ids }) => {
      const p = get();
      switch (action) {
        case "redeem":
          p.onRedeem(ids);
          break;
        case "sell_back":
          p.onSellBack(ids);
          break;
        case "feed_back":
          p.onFeedBack(ids);
          break;
        case "settle":
          p.onSettle(ids[0]);
          break;
        case "refund":
          p.onRefund(ids[0]);
          break;
        case "withdraw_owed":
          p.onWithdrawOwed();
          break;
        case "close_my_cards":
          p.onCloseMyCards();
          break;
        case "take_back":
          p.inTheMachine.onTakeBack(ids);
          break;
      }
    }),
    c.on("verify", ({ seq }) => get().onVerify(seq)),
  ];
  return () => offs.forEach((f) => f());
}

export { CARDS_ASSET_FILES, EDITIONS, KINDS } from "./brand";
export {
  bulkOptions,
  choicesFor,
  defaultChoice,
  type BulkOption,
  type Choice,
} from "./actions";
export { ISSUE_1, ISSUE_2, PROPOSED, defaultT } from "./copy";
export { sol, solCost, count, short, ticker, timeUtc } from "./format";
export { setTimeScale } from "./motion";
export type * from "./types";

/** Default asset location for the web app (`apps/web/public/experience/cards/`). */
export function cardsAssets(base = "/experience/cards/") {
  return { assetsBase: base.endsWith("/") ? base : `${base}/` };
}
