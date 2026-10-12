/**
 * PREVIEW builds only: the in-browser machine of the demo flows. One wallet at a
 * time: its bags come from its real X-ray (or the sample bags without the API);
 * balances, the Deck, My cards and past draws live here and in localStorage, so
 * the journey survives reloads and routes. Economics come from @onepercent/config
 * (prices, splits, Sell back); draws and quotes are demo values.
 */
import {
  HIT_TIERS,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  SELL_BACK,
} from "@onepercent/config/web";
import type { XrayResult } from "@onepercent/eligibility/xray-result";
import { PPB_DENOMINATOR } from "@onepercent/config";
import { LIVE_FLAGS } from "@onepercent/sdk/constants";
import { oddsRows } from "../adapters/odds";
import { cardsCount } from "../app/prefs";
import {
  DECK_DUST,
  DEMO_START_LAMPORTS,
  HIT_POOL,
  JACKPOT_POT,
  ONE_PCT,
  ONE_PCT_VALUE,
  SAMPLE_BAGS,
  SAMPLE_EMPTIES,
  logoUrl,
  type DemoBag,
  type DemoToken,
} from "./data";

export type EditionId = (typeof PACK_EDITIONS)[number]["id"];
export type Tier = "silver" | "blue" | "holo" | "black" | "jackpot" | "one_pct";
export interface DeckEntry extends DemoToken {
  entryId: string;
  amountUi: string;
  depositLamports: bigint;
  refed: boolean;
}
export interface DemoCard extends DemoToken {
  cardId: string;
  kind: "dust" | Tier;
  edition: EditionId;
  seq: string;
  amountUi: string;
  valueLamports: bigint;
  stockedLamports: bigint | null;
  sellBackLamports: bigint | null;
  fedBy?: string;
}
export interface PastPull {
  seq: string;
  edition: EditionId;
  tier: Tier;
  at: number;
  cards: { symbol: string; mint: string; kind: DemoCard["kind"] }[];
}
export interface DemoState {
  /** The wallet the demo flows run for; its bags come from its X-ray. */
  address: string;
  /** Where the bags came from: its live X-ray, the sample set, or not yet. */
  source: "xray" | "sample" | null;
  lamports: bigint;
  bags: DemoBag[];
  empties: { address: string; lamports: bigint }[];
  deck: DeckEntry[];
  cards: DemoCard[];
  history: PastPull[];
  seq: number;
  pulls: number;
  fed: number;
}
const KEY = "onepercent.demo.v2";
/** Rent the demo charges per Deck entry (refunded on take-back); invented. */
export const ENTRY_DEPOSIT = 406_400n;
export const NETWORK_FEE = 5_000n;

function fresh(address: string): DemoState {
  return {
    address,
    source: null,
    lamports: DEMO_START_LAMPORTS,
    bags: [],
    empties: [],
    deck: [],
    cards: [],
    history: [],
    seq: 48_231,
    pulls: 0,
    fed: 0,
  };
}
const reviver = (_: string, v: unknown) =>
  typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v;
const replacer = (_: string, v: unknown) =>
  typeof v === "bigint" ? `${v}n` : v;
function load(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw)
      return { ...fresh(""), ...(JSON.parse(raw, reviver) as DemoState) };
  } catch {
    /* A fresh demo. */
  }
  return fresh("");
}
let state = load();
const listeners = new Set<() => void>();
function commit(next: DemoState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state, replacer));
  } catch {
    /* In-memory only. */
  }
  cardsCount.set(state.cards.length);
  listeners.forEach((l) => l());
}
cardsCount.set(state.cards.length);

const lamportsOf = (sol: string | undefined) => {
  if (!sol) return 0n;
  const [whole = "0", fraction = ""] = sol.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
};
/** An X-ray bag as a demo bag (real mint, symbol, amount and quote). */
function fromXray(
  bag: XrayResult["bags"][number],
  worst: XrayResult["worst"],
): DemoBag | null {
  if (bag.amountUi === null) return null;
  const feedable = bag.buckets.includes("feedable");
  const kind = feedable
    ? bag.reasonCode === "snapshot_at_feed"
      ? "checkAtFeed"
      : "feedable"
    : bag.buckets.includes("not_feedable_season")
      ? "bid"
      : "notInSet";
  return {
    mint: bag.mint,
    // Tickers are shown with their own "$" (some metadata symbols carry one).
    symbol: bag.symbol.replace(/^\$+/, "") || bag.symbol,
    name: bag.name,
    logo: logoUrl(bag.mint),
    amountUi: bag.amountUi,
    decimals: bag.decimals ?? 0,
    valueLamports: lamportsOf(bag.valueSol),
    drawdownPct: worst?.mint === bag.mint ? worst.drawdownPct : null,
    kind,
    ...(bag.reasonCode && !feedable
      ? {
          // The demo has no snapshot date for the dated variant.
          reasonKey:
            bag.reasonCode === "snapshot_not_held"
              ? "xray.reason.snapshot_not_held_undated"
              : `xray.reason.${bag.reasonCode}`,
        }
      : {}),
  };
}

export const demo = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** A new wallet starts a new demo (its own bags, balance and cards). */
  use(address: string) {
    if (state.address !== address) commit(fresh(address));
  },
  /** A live X-ray of the demo wallet seeds its bags once (never over a running demo). */
  seed(result: XrayResult) {
    if (result.address !== state.address || state.source === "xray") return;
    commit({
      ...state,
      source: "xray",
      bags: result.bags
        .map((bag) => fromXray(bag, result.worst))
        .filter((bag): bag is DemoBag => bag !== null),
      empties: result.emptyAccounts.map((e) => ({
        address: e.address,
        lamports: BigInt(e.rentLamports),
      })),
    });
  },
  /** Without an X-ray (no API), the sample bags of real pump.fun coins. */
  sample() {
    if (state.source) return;
    commit({
      ...state,
      source: "sample",
      bags: SAMPLE_BAGS.map((b) => ({ ...b })),
      empties: SAMPLE_EMPTIES.map((e) => ({ ...e })),
    });
  },
  reset() {
    commit(fresh(state.address));
  },
};

const price = (edition: EditionId) =>
  PACK_EDITIONS.find((e) => e.id === edition)!.priceLamports;
const bps = (value: bigint, share: number) => (value * BigInt(share)) / 10_000n;
const pick = <T>(list: readonly T[]) =>
  list[Math.floor(Math.random() * list.length)]!;

/** Feed: bags become Dust Cards in the machine; sells and rent land in SOL. */
/** Feed: the chosen bags go into the Deck; the empty accounts close in the same transaction. */
export function feed(selection: { feed: string[] }) {
  const s = state;
  const fedBags = s.bags.filter((b) => selection.feed.includes(b.mint));
  const rent = s.empties.reduce((sum, e) => sum + e.lamports, 0n);
  const deposits = ENTRY_DEPOSIT * BigInt(fedBags.length);
  commit({
    ...s,
    lamports: s.lamports + rent - deposits - NETWORK_FEE,
    bags: s.bags.filter((b) => !selection.feed.includes(b.mint)),
    empties: [],
    deck: [
      ...s.deck,
      ...fedBags.map((b, i) => ({
        entryId: `deck:${s.fed + i + 71_400}`,
        mint: b.mint,
        symbol: b.symbol,
        name: b.name,
        logo: b.logo,
        amountUi: b.amountUi,
        depositLamports: ENTRY_DEPOSIT,
        refed: false,
      })),
    ],
    fed: s.fed + fedBags.length,
  });
  return { bags: fedBags.length, rent, deposits };
}

export function takeBack(entryIds: string[]) {
  const s = state;
  const back = s.deck.filter((e) => entryIds.includes(e.entryId));
  commit({
    ...s,
    lamports:
      s.lamports +
      back.reduce((sum, e) => sum + e.depositLamports, 0n) -
      NETWORK_FEE,
    deck: s.deck.filter((e) => !entryIds.includes(e.entryId)),
    bags: [
      ...s.bags,
      ...back.map((e) => ({
        mint: e.mint,
        symbol: e.symbol,
        name: e.name,
        logo: e.logo,
        amountUi: e.amountUi,
        decimals: 6,
        valueLamports: 0n,
        drawdownPct: null,
        kind: "feedable" as const,
      })),
    ],
  });
}

/**
 * Demo draws use the real odds: the program's segment widths for this edition
 * (adapters/odds), with Jackpot and The 1% live. Silver is the remainder.
 */
function drawTier(edition: EditionId): Tier {
  const index = PACK_EDITIONS.find((item) => item.id === edition)!.index;
  let roll = Math.random() * PPB_DENOMINATOR;
  for (const row of oddsRows(index, LIVE_FLAGS.onePct | LIVE_FLAGS.jackpot))
    if ((roll -= row.ppb) < 0) return row.id as Tier;
  return "silver";
}
const amountFor = (value: bigint, unit: bigint) =>
  (value / (unit > 0n ? unit : 1n)).toString();

export function canRip(edition: EditionId) {
  return state.lamports >= price(edition) + NETWORK_FEE;
}
/** Rip: the pack price leaves the wallet; five cards land in My cards. */
export function rip(edition: EditionId, forceTier?: Tier) {
  const s = state;
  const cost = price(edition);
  const seq = String(s.seq);
  const tier = forceTier ?? drawTier(edition);
  const multiplier = HIT_TIERS.find((t) => t.id === tier)?.valueBps;
  let hit: DemoCard;
  if (multiplier !== undefined) {
    const coin = pick(HIT_POOL);
    const value = bps(cost, multiplier);
    hit = {
      mint: coin.mint,
      symbol: coin.symbol,
      name: coin.name,
      logo: coin.logo,
      cardId: `${seq}:${tier}:${coin.mint}:${value}:0`,
      kind: tier,
      edition,
      seq,
      amountUi: amountFor(value, coin.unitLamports),
      valueLamports: value,
      stockedLamports: value,
      sellBackLamports: bps(value, SELL_BACK.payoutBps),
    };
  } else {
    const jackpot = tier === "jackpot";
    hit = {
      ...ONE_PCT,
      cardId: `${seq}:${tier}:${ONE_PCT.mint}:${tier}:0`,
      kind: tier,
      edition,
      seq,
      amountUi: jackpot ? JACKPOT_POT.amountUi : "10000000",
      valueLamports: jackpot ? JACKPOT_POT.valueLamports : ONE_PCT_VALUE,
      stockedLamports: null,
      sellBackLamports: null,
    };
  }
  const pool = [...DECK_DUST].sort(() => Math.random() - 0.5).slice(0, 4);
  const dust: DemoCard[] = pool.map((d, i) => ({
    mint: d.mint,
    symbol: d.symbol,
    name: d.name,
    logo: d.logo,
    cardId: `${seq}:dust:${d.mint}:${d.amountUi}:${i + 1}`,
    kind: "dust",
    edition,
    seq,
    amountUi: d.amountUi,
    valueLamports: d.valueLamports,
    stockedLamports: null,
    sellBackLamports: null,
    fedBy: d.fedBy,
  }));
  const cards = [...dust, hit];
  commit({
    ...s,
    lamports: s.lamports - cost - NETWORK_FEE,
    cards: [...s.cards, ...cards],
    history: [
      {
        seq,
        edition,
        tier,
        at: Date.now(),
        cards: cards.map((c) => ({
          symbol: c.symbol,
          mint: c.mint,
          kind: c.kind,
        })),
      },
      ...s.history,
    ].slice(0, 25),
    seq: s.seq + 1 + Math.floor(Math.random() * 7),
    pulls: s.pulls + 1,
  });
  return {
    seq,
    edition,
    tier,
    dust,
    hit,
    royaltyEach: bps(cost, PACK_SPLIT_BPS.royaltyPerDustCard),
  };
}

const without = (ids: string[]) =>
  state.cards.filter((c) => !ids.includes(c.cardId));
const cardsOf = (ids: string[]) =>
  state.cards.filter((c) => ids.includes(c.cardId));
export function redeem(ids: string[]) {
  const s = state;
  const moved = cardsOf(ids);
  commit({
    ...s,
    lamports: s.lamports - NETWORK_FEE,
    cards: without(ids),
    bags: [
      ...s.bags,
      ...moved.map((c) => ({
        mint: c.mint,
        symbol: c.symbol,
        name: c.name,
        logo: c.logo,
        amountUi: c.amountUi,
        decimals: 6,
        valueLamports: c.valueLamports,
        drawdownPct: null,
        kind: c.kind === "dust" ? ("feedable" as const) : ("bid" as const),
      })),
    ],
  });
}
/** Sell (the `sell_back` instruction): the machine buys the hits now, at their Sell quotes. */
export function sellBack(ids: string[]) {
  const s = state;
  const paid = cardsOf(ids).reduce(
    (sum, c) => sum + (c.sellBackLamports ?? 0n),
    0n,
  );
  commit({
    ...s,
    lamports: s.lamports + paid - NETWORK_FEE,
    cards: without(ids),
  });
  return paid;
}
export function feedBack(ids: string[]) {
  const s = state;
  const moved = cardsOf(ids);
  commit({
    ...s,
    lamports: s.lamports - ENTRY_DEPOSIT * BigInt(moved.length) - NETWORK_FEE,
    cards: without(ids),
    deck: [
      ...s.deck,
      ...moved.map((c, i) => ({
        entryId: `deck:${s.fed + i + 71_400}`,
        mint: c.mint,
        symbol: c.symbol,
        name: c.name,
        logo: c.logo,
        amountUi: c.amountUi,
        depositLamports: ENTRY_DEPOSIT,
        refed: true,
      })),
    ],
    fed: s.fed + moved.length,
  });
}
