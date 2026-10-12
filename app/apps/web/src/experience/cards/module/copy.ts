/* eslint-disable */
// Synced from experience/cards-lab/src/cards/copy.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Strings of My cards. The web app passes `@onepercent/copy`'s `t` (mount option `t`) or keeps this table;
 * either way the table is the reference: the web test `cards/copy.test.ts` holds every key it shares with
 * `@onepercent/copy` to the same bytes.
 *
 * ISSUE_1: keys of COPY.md issue 1, byte for byte (typographic apostrophes, ✳ ≈ − × … →).
 * ISSUE_2: COPY.md §6, the first part of issue 2 (My cards actions, bulk bar, confirmations), byte for byte.
 * PROPOSED: keys this component needs that COPY.md does not have yet: "proposed for COPY issue 2".
 */
import type { CopyKey, Msg } from "./types";

export const ISSUE_1 = {
  "title.cards": "My cards ✳ Onepercent",
  "nav.cards": "My cards",
  "footer.cta": "Pick a pack →",
  "common.loading": "Loading…",
  "common.retry": "Try again",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.noValue": "n/a",
  "common.sol": "{sol} SOL",
  "common.solGain": "+{sol} SOL",
  "common.est": "≈{sol} SOL est.",
  "common.ifSoldNow": "≈{sol} SOL if sold now",
  "common.verify": "Verify",
  "common.trustSign": "You sign everything.",
  "common.networkError": "The machine didn’t answer. Try again.",
  "common.offline": "The machine’s data is offline. Your exits still work.",
  "common.rpcOffline":
    "The machine can’t reach Solana right now. Exits also run from the rescue page with your own RPC.",
  "common.rescueLink": "Rescue page ↗",
  "common.soundOn": "Sound on",
  "common.soundOff": "Sound off",
  "common.motionReduced": "Reduce motion",
  "common.motionFull": "Full motion",
  "count.cards.one": "1 card",
  "count.cards.other": "{n} cards",
  "count.dustCards.one": "1 Dust Card",
  "count.dustCards.other": "{n} Dust Cards",
  "count.transactions.one": "1 transaction",
  "count.transactions.other": "{n} transactions",
  "count.approvals.one": "1 approval",
  "count.approvals.other": "{n} approvals",
  "count.newTokenAccounts.one": "1 new token account",
  "count.newTokenAccounts.other": "{n} new token accounts",
  "wallet.connected": "Wallet {short}",
  "wallet.check": "Check your wallet.",
  "errors.walletNo": "Wallet said no. Nothing was sent.",
  "errors.tooLong": "Took too long. Tap again.",
  "errors.generic": "That didn’t go through. Try again.",
  "errors.simulation": "The machine would refuse this, so nothing was sent.",
  "errors.cardMoved": "That card just moved. Try again.",
  "errors.seasonOver": "Season over ✳ Redeem and take-back stay open forever",
  "errors.insufficientSol": "Not enough SOL. This needs {sol} SOL more.",
  "errors.paused": "Paused for now. Every exit still works.",
  "feed.quoting": "Getting quotes…",
  "feed.trust": "You sign everything. Take any card back until it’s pulled.",
  "feed.state.ready": "Quotes good for {s} s.",
  "feed.state.quoteExpired": "Prices moved. Tap for a fresh quote.",
  "feed.retry": "Retry",
  "feed.refresh": "Refresh quotes",
  "takeBack.title": "In the machine",
  "takeBack.empty": "None of your cards are in the machine.",
  "takeBack.row": "{ticker} ✳ {amount} tokens",
  "takeBack.refed": "Fed back from My cards",
  "takeBack.button": "Take back",
  "takeBack.buttonMany": "Take back {cards} · {transactions}, {approvals}",
  "takeBack.presign.one":
    "Take back {ticker} ✳ {amount} tokens → your wallet ✳ +{deposit} SOL deposit back",
  "takeBack.presign.other":
    "Take back {cards} → your wallet ✳ +{deposit} SOL in deposits back",
  "takeBack.ata": "{accounts} need {sol} SOL (back when you close them)",
  "takeBack.done.one": "Back in your wallet.",
  "takeBack.done.other": "{n} cards back in your wallet.",
  "takeBack.always": "Take-back never pauses and stays open after the season.",
  "vault.title": "Your vault deposits",
  "vault.held":
    "{ticker} vault ✳ {sol} SOL ✳ back when that coin’s vault is empty",
  "vault.returned": "{ticker} vault ✳ {sol} SOL ✳ returned",
} as const;

/**
 * COPY.md §6 (issue 2, first part): what My cards offers per card (at most two actions, each with one
 * clear number), the bulk bar, the confirmations (one sentence, then a small details row) and the
 * results. "Sell" is the name of the `sell_back` instruction; there is no Sell at market and no Keep.
 */
export const ISSUE_2 = {
  // §6.1 Page
  "cards.total": "≈{sol} SOL in your cards",
  "cards.ripAgain": "Rip again",
  // §6.2 Actions
  "cards.choose": "Choose an action",
  "cards.choice.sell": "Sell",
  "cards.figure.sell": "+{sol} SOL · instant",
  "cards.choice.redeem": "Redeem",
  "cards.choice.redeem.line": "Tokens to your wallet.",
  "cards.choice.feedBack": "Feed back",
  "cards.figure.feedBack": "≈{sol} SOL when it’s pulled",
  // §6.3 Sell refusals: Sell shows closed with one of these; Redeem stays
  "cards.sell.refusal.refilling": "The machine is refilling. Try again soon.",
  "cards.sell.refusal.coin": "The machine isn’t buying this coin right now.",
  "cards.sell.refusal.noPrice":
    "No price for this coin right now. Try again soon.",
  "cards.sell.refusal.closed": "Sell is closed right now.",
  "errors.sellBackFallback": "The machine can’t buy this card right now.",
  // §6.4 Bulk bar
  "cards.bulk.label": "All your cards",
  "cards.bulk.sell": "Sell all hits · +{sol} SOL",
  "cards.bulk.feedBack": "Feed back all dust · ≈{sol} SOL",
  "cards.bulk.redeem": "Redeem all",
  "cards.bulk.title.sell": "Sell all hits",
  "cards.bulk.title.feedBack": "Feed back all dust",
  "cards.bulk.partial":
    "{ok} of {t} cards can do this now; the rest stay here.",
  // §6.5 Confirmations
  "cards.lead.sell.one":
    "The machine buys it now, and +{sol} SOL lands in your wallet with the transaction.",
  "cards.lead.sell.other":
    "The machine buys these {n} cards now, and +{sol} SOL lands in your wallet with the transactions.",
  "cards.lead.redeem.one":
    "{amount} {ticker} land in your wallet with the transaction.",
  "cards.lead.redeem.other":
    "The tokens of these {n} cards land in your wallet with the transactions.",
  "cards.lead.feedBack.one":
    "It goes into the next packs, and you get ≈{sol} SOL when one pulls it.",
  "cards.lead.feedBack.other":
    "These {n} cards go into the next packs, and you get ≈{sol} SOL in all as packs pull them.",
  "cards.details.batch": "{transactions}, {approvals}",
  "cards.details.networkFee": "Network fee ≈{sol} SOL",
  "cards.details.ata.one":
    "1 new token account needs {sol} SOL (back when you close it)",
  "cards.details.ata.other":
    "{n} new token accounts need {sol} SOL (back when you close them)",
  "cards.details.deposit.one": "+{sol} SOL refundable deposit",
  "cards.details.deposit.other": "+{sol} SOL in refundable deposits",
  "cards.feedBack.confirm.title": "Feed this card back?",
  "cards.feedBack.confirm.body":
    "You’ll get ≈{sol} SOL when it’s pulled, not the ≈{value} SOL it sells for now.",
  "cards.feedBack.confirm.yes": "Feed it back",
  "cards.feedBack.confirm.titleMany": "Feed these cards back?",
  "cards.feedBack.confirm.bodyMany":
    "You’ll get ≈{sol} SOL in all when they’re pulled, not the ≈{value} SOL these {n} sell for now.",
  "cards.feedBack.confirm.yesMany": "Feed them back",
  // §6.6 Buttons and results
  "cards.button.sell": "Sell · +{sol} SOL",
  "cards.button.sellQuoting": "Sell",
  "cards.button.sellMany": "Sell {cards} · +{sol} SOL",
  "cards.button.redeem": "Redeem",
  "cards.button.redeemMany": "Redeem {cards}",
  "cards.button.feedBack": "Feed back",
  "cards.button.feedBackMany": "Feed back {cards}",
  "cards.done.sell": "Sold. +{sol} SOL.",
  "cards.done.redeem.one": "In your wallet.",
  "cards.done.redeem.other": "{n} cards in your wallet.",
  "cards.done.feedBack.one": "Back in the machine.",
  "cards.done.feedBack.other": "{n} cards back in the machine.",
} as const;

/** Proposed for COPY.md issue 2 (the rest of My cards). Same rules as issue 1 (COPY §0). */
export const PROPOSED = {
  "cards.feedBack.confirm.unavailable":
    "No executable quote is available for this selection. You can still Feed back or Redeem.",
  // Page and portfolio header
  "cards.title": "My cards",
  "cards.unvalued.one": "1 card has no value now",
  "cards.unvalued.other": "{n} cards have no value now",
  "cards.owed.label": "Owed to you",
  "cards.owed.withdraw": "Withdraw",
  "cards.close.button": "Close My cards ✳ +{sol} SOL",
  "cards.close.line":
    "My cards is empty. Close it and its deposit comes back to you.",
  // Tabs, sort, view
  "cards.tabs.label": "Filter cards",
  "cards.tab.all": "All",
  "cards.tab.hits": "Hits",
  "cards.tab.dust": "Dust",
  "cards.tab.pending": "Pending",
  "cards.sort.label": "Sort",
  "cards.sort.value": "Value",
  "cards.sort.newest": "Newest",
  "cards.sort.tier": "Tier",
  "cards.view.grid": "Grid",
  "cards.view.list": "List",
  // Card names and faces
  "cards.kind.dust": "Dust Card",
  "cards.kind.silver": "Silver Foil",
  "cards.kind.blue": "Blue Foil",
  "cards.kind.holo": "Holo Foil",
  "cards.kind.black": "Black Foil",
  "cards.kind.jackpot": "Jackpot",
  "cards.kind.one_pct": "The 1%",
  "cards.kind.spotlight": "Spotlight",
  "cards.kind.final": "Final Pull card",
  "cards.kindWithMult": "{name} {mult}",
  "cards.face.dustOrigin": "pump.fun ✳ Solana",
  "cards.face.final": "The Final Pull",
  "cards.face.mantra": "RIP. REVEAL. OWN.",
  "cards.card.aria": "{name}, {amount} {ticker}, {value}",
  "cards.card.ariaAmount": "{name}, {amount} {ticker}",
  // Card sheet
  "cards.from": "{edition} ✳ pull #{seq}",
  "cards.figure.tokens": "{amount} {ticker}",
  // Progress and results
  "cards.state.sending": "Sending… {c}/{t} confirmed",
  "cards.done.owed": "+{sol} SOL to your wallet.",
  "cards.done.close": "My cards closed. +{sol} SOL back.",
  "cards.done.refund": "Refunded. +{sol} SOL.",
  "cards.done.settle": "Settled.",
  "cards.wallet.balance": "{sol} SOL in your wallet",
  // Pending pulls
  "cards.pending.pack": "{edition} ×{n}",
  "cards.pending.pull": "pull #{seq}",
  "cards.pending.drawing": "Cranking…",
  "cards.pending.slow": "Still cranking. The draw is on-chain.",
  "cards.pending.refundable": "No draw came back. Refund the full price.",
  "cards.pending.settling": "Drawn. Settling…",
  "cards.pending.refund": "Refund · +{sol} SOL",
  "cards.pending.refundNoAmount": "Refund",
  "cards.pending.settle": "Settle",
  // Empty states
  "cards.empty.title": "No cards yet.",
  "cards.empty.hits": "No hits here yet. Silver Foil and up land in this tab.",
  "cards.empty.dust": "No Dust Cards here.",
  "cards.empty.pending": "Nothing pending. Every pull is drawn.",
  // Dock
  "cards.dock.label": "Wallet and machine",
  "cards.machine.aria": "In the machine, {n}",
} as const;

const DEFAULT: Record<string, string> = { ...ISSUE_1, ...ISSUE_2, ...PROPOSED };
export type DefaultKey =
  keyof typeof ISSUE_1 | keyof typeof ISSUE_2 | keyof typeof PROPOSED;

const warned = new Set<string>();

/** COPY §0.5–0.6: `{name}` placeholders. The module always calls plural keys by their full name (`….one` / `….other`) with `{n}`; a base key also resolves (by `vars.n`). */
export function defaultT(
  key: CopyKey,
  vars: Record<string, string> = {},
): string {
  let k = key;
  if (!(k in DEFAULT) && `${k}.one` in DEFAULT)
    k = `${k}.${vars.n === "1" ? "one" : "other"}`;
  const tpl = DEFAULT[k];
  if (tpl === undefined) {
    if (!warned.has(k)) {
      warned.add(k);
      console.warn(`[cards] missing copy key ${k}`);
    }
    return k;
  }
  return tpl.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    if (v === undefined) {
      if (!warned.has(`${k}:${name}`)) {
        warned.add(`${k}:${name}`);
        console.warn(`[cards] missing var {${name}} in ${k}`);
      }
      return m;
    }
    return v;
  });
}

export type Translate = (key: CopyKey, vars?: Record<string, string>) => string;

/** Resolves a Msg with the active `t`. */
export const msg = (t: Translate, m: Msg | null | undefined) =>
  m ? t(m.key, m.vars) : "";
