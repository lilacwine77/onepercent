/* eslint-disable */
// Synced from experience/cards-lab/src/cards/types.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Public contract of the My cards experience component (The 1% Machine).
 *
 * The shapes marked "03-M3 §6.2" mirror `experience/contracts.ts` as written in 03-M3-BRIEF.md §6.2
 * (with M4-A7: `CardRow.edition` is null for Final cards). The component never computes economics:
 * every amount arrives as lamports or as an already formatted string, and every sentence is a copy key.
 */

// ---------------------------------------------------------------------------
// 03-M3 §6.2 shapes (mirrored until experience/contracts.ts lands with wave 1)
// ---------------------------------------------------------------------------

/** A key of `@onepercent/copy` (COPY.md). Typed as string here: issue 2 keys are still proposals. */
export type CopyKey = string;

export type EditionId = "original" | "blue_shift" | "signature" | "after_hours";

/** `CARD_KINDS` (PARAMS §3.2), in on-chain order. Spotlight never exists in Season 1 (D1). */
export type CardKind =
  | "dust"
  | "silver"
  | "blue"
  | "holo"
  | "black"
  | "jackpot"
  | "one_pct"
  | "spotlight"
  | "final";

/**
 * A SOL figure for a token amount (master §7.2, COPY §0.4).
 * `now`: executable quote, "≈{x} SOL if sold now". `est`: capped estimate, lists only, "≈{x} SOL est.". `none`: "n/a".
 */
export type Value =
  | { kind: "now"; lamports: bigint }
  | { kind: "est"; lamports: bigint }
  | { kind: "none" };

/** A sentence: a copy key and its variables, already formatted by `@onepercent/copy` (COPY §0.5). */
export interface Msg {
  key: CopyKey;
  vars?: Record<string, string>;
}

export interface Coin {
  mint: string;
  ticker: string;
  name: string;
  logoUrl: string | null;
}

/** Whether an action is open now; `reason` says why not (shown under the action). */
export interface Gate {
  open: boolean;
  reason: Msg | null;
}

export interface CardRow {
  /** `seq_lo:kind:mint:amount:ordinal` (03-M3 §13.1). Stable across re-reads. */
  cardId: string;
  kind: CardKind;
  /** The pack edition; null for Final cards (M4-A7). */
  edition: EditionId | null;
  /** Pull `seq` (decimal string). Newest = highest. */
  seq: string;
  coin: Coin;
  /** Exact token amount, formatted (`amount`). */
  amountUi: string;
  /** What the machine paid for a hit (`card.value`); null for Dust Cards and specials without a cost. */
  stockedLamports: bigint | null;
  /** List value: `est` in rows, `now` once an action panel asked for executable quotes. */
  value: Value;
  /** The Sell quote (the `sell_back` payout, hits only); null when Sell does not apply. */
  sellBack: Value | null;
  /**
   * The actions My cards offers (at most two per card): hits Sell or Redeem, Dust Cards Feed back or Redeem,
   * specials Redeem. A closed gate shows its one-line reason under the action; Redeem never closes.
   */
  actions: { redeem: Gate; sellBack: Gate; feedBack: Gate };
  // ----- additions requested by this component (listed in README "Contract alignment") -----
  /** Feed back needs an explicit confirmation (value above `FEED_RULES.confirmAboveLamports`). Default: false. */
  feedBackNeedsConfirm?: boolean;
}

export interface InTheMachineEntry {
  entryId: string;
  coin: Coin;
  amountUi: string;
  depositLamports: bigint;
  refed: boolean;
}
export interface VaultDeposit {
  coin: Coin;
  lamports: bigint;
  state: "held" | "returned";
}

export type PendingState = "drawing" | "refundable" | "settling";
export interface PendingPull {
  seq: string;
  edition: EditionId;
  qty: number;
  state: PendingState;
  /** Addition: what Refund pays back ("Refund +{x} SOL"). */
  refundLamports?: bigint;
  /** Addition: chain-clock ms when the draw was requested (drives "Still cranking…"). */
  createdMs?: number;
}

/** The phases of 03-M3 §6.2 `Flow`. */
export interface Flow {
  phase:
    | "idle"
    | "planning"
    | "quoting"
    | "ready"
    | "signing"
    | "sending"
    | "done"
    | "partial"
    | "expired"
    | "rejected"
    | "failed";
  confirmed: number;
  total: number;
  approvals: number;
  message: Msg | null;
}

/** 03-M3 §6.2 `MyCardsProps`, for `fromMyCardsProps()` / `bindMyCardsProps()`. */
export interface MyCardsProps {
  hits: CardRow[];
  dust: CardRow[];
  prizes: CardRow[];
  inTheMachine: {
    entries: InTheMachineEntry[];
    vaultDeposits: VaultDeposit[];
    flow: Flow;
    onTakeBack(entryIds: string[]): void;
  };
  pending: {
    seq: string;
    edition: EditionId;
    qty: number;
    state: PendingState;
  }[];
  owedLamports: bigint;
  closeMyCards: { lamports: bigint } | null;
  preSign: Msg[];
  flow: Flow;
  onRedeem(ids: string[]): void;
  onSellBack(ids: string[]): void;
  onFeedBack(ids: string[]): void;
  onSettle(seq: string): void;
  onRefund(seq: string): void;
  onWithdrawOwed(): void;
  onCloseMyCards(): void;
  onVerify(seq: string): void;
}

// ---------------------------------------------------------------------------
// Component data
// ---------------------------------------------------------------------------

export interface CardsData {
  /** `loading` shows face-down cards; `error` shows `error` (default `common.networkError`) with Try again. */
  status: "ready" | "loading" | "error";
  error?: Msg | null;
  /** Shown above the grid: `common.offline`, `common.rpcOffline`, `errors.paused`… */
  notice?: Msg | null;
  /** The connected wallet. `lamports` drives the SOL counter that Sell back coins fly into. */
  wallet?: { address: string; lamports: bigint | null } | null;
  /** Every card in the Binder (hits, dust, prizes, Final cards), any order. */
  cards: CardRow[];
  pending: PendingPull[];
  owedLamports: bigint;
  /** "Close My cards ✳ +{x} SOL" whenever `close_binder` would succeed (03-M3 §13.2); null otherwise. */
  closeMyCards: { lamports: bigint } | null;
  inTheMachine?: {
    entries: InTheMachineEntry[];
    vaultDeposits: VaultDeposit[];
  } | null;
  /** When the values were read (ms). Shown as "as of {time}". */
  valuesAsOfMs?: number | null;
  /** Config-derived figures used in static lines (never computed here). */
  config?: {
    /**
     * What one Dust Card is expected to pay when a pack pulls it (lamports): the royalty share of the
     * expected pack price at the recent edition mix (`@onepercent/config` `feedBackEstimate`). One number.
     */
    feedBackEstimateLamports?: bigint;
    /** `PACK_SPLIT_BPS.royaltyPerDustCard` as a percent, e.g. "2%" ("2% of the pack that pulls it"). */
    royaltyPct?: string;
    /** `UI.stillCrankingAfterSeconds` × 1000 (PARAMS §18). Default 5000. */
    stillCrankingAfterMs?: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Actions, previews, states, events
// ---------------------------------------------------------------------------

/**
 * Card actions (PARAMS §3.3; `sell_back` is the Sell action) and My cards exits. Keeping is no action:
 * a card stays in My cards until the player chooses.
 */
export type CardsAction =
  | "redeem"
  | "sell_back"
  | "feed_back"
  | "withdraw_owed"
  | "close_my_cards"
  | "settle"
  | "refund"
  | "take_back";

/**
 * The pre-sign data of one action for a set of cards, supplied by the host on `preview`. The component
 * says what happens in one sentence (from `receive` or the config's estimate); `lines` are the details.
 */
export interface ActionPreview {
  /** Fresh executable quotes for Feed back confirmation. Missing quotes require the generic confirmation. */
  feedBackValues?: Record<
    string,
    {
      value: { kind: "now"; lamports: bigint } | { kind: "none" };
      needsConfirm: boolean;
    }
  >;

  /** The technical details, shown small under that sentence: transactions and approvals, network fee, deposits, new token accounts. */
  lines: Msg[];
  /** What reaches the wallet: the signed Sell quote (`now`). */
  receive?: Value | null;
  /** Quote validity, counted from when the preview is set ("Quotes good for {s} s."). */
  ttlSeconds?: number;
  /**
   * Overrides the action's gate. A refused Sell quote closes Sell with its one-line reason
   * (`cards.sell.refusal.*`); Redeem stays the action. There is no market fallback.
   */
  gate?: Gate | null;
}

/**
 * Progress of an action, set by the host from its transaction engine (03-M3 §9).
 * `done` plays the action's moment (Sell coins, Redeem stream, Feed back swirl) and removes the cards.
 */
export type ActionState = "idle" | "signing" | "sending" | "done" | "failed";
export interface ActionInfo {
  message?: Msg | null;
  progress?: { confirmed: number; total: number };
  /** Lamports that reached the wallet (Sell, owed, close, refund): the counter ticks to it. */
  receivedLamports?: bigint;
}

export type Tab = "all" | "hits" | "dust" | "pending";
export type SortKey = "value" | "newest" | "tier";
export type ViewMode = "grid" | "list";

export type SoundCue =
  | "card.lift"
  | "card.settle"
  | "coin.pop"
  | "coin.land"
  | "token.stream"
  | "slot.drop"
  | "crank.turn"
  | "select";
export interface SoundEvent {
  cue: SoundCue;
  index?: number;
}

export interface CardsEventMap {
  /** The user confirmed an action (after its pre-sign summary). `ids`: card ids, Pull seqs or machine entry ids. */
  action: (e: { action: CardsAction; ids: string[] }) => void;
  /** Pre-sign data needed for an action (choice made in the sheet, bulk sheet opened, quote expired). Answer with setPreview. */
  preview: (e: { action: CardsAction; ids: string[] }) => void;
  /** The card sheet opened (fetch `now` values: 03-M3 §13.1) or closed (`null`). */
  open: (e: { cardId: string | null }) => void;
  verify: (e: { seq: string }) => void;
  /** "Refresh quotes" or "Try again" after an error. */
  refresh: () => void;
  /** "Rip again" (the dock) or the empty state's "Pick a pack →". */
  rip: () => void;
  sound: (e: SoundEvent) => void;
}

export interface MountCardsOptions {
  /** Folder holding foil/, packs/ and pepe-white.webp (see CARDS_ASSET_FILES). Default "./assets/". */
  assetsBase?: string;
  data?: CardsData;
  /** `@onepercent/copy`'s `t`. Default: the built-in table (COPY issue 1 + proposed issue 2 keys). */
  t?: (key: CopyKey, vars?: Record<string, string>) => string;
  /** Default: `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  /** Level of the "My cards" heading (the route's h1 by default). */
  headingLevel?: 1 | 2;
  /** Host chrome covering the page (CSS px): a sticky header (top), a bottom bar (bottom). */
  insets?: { top?: number; bottom?: number };
  tab?: Tab;
  /** Default `tier`: the best pull first. */
  sort?: SortKey;
  view?: ViewMode;
  /** Particle budget per moment. Default 60 on desktop, 24 on phones (DA §8.2). */
  maxParticles?: number;
  /** Target of `common.rescueLink`, shown with the error state (exits also run from the rescue page). */
  rescueUrl?: string;
  onSound?: (e: SoundEvent) => void;
}

export interface CardsController {
  setData(data: CardsData): void;
  /** Answers a `preview` event; `null` clears it (e.g. the quote expired). */
  setPreview(
    action: CardsAction,
    ids: string[],
    preview: ActionPreview | null,
  ): void;
  setActionState(
    ids: string[],
    action: CardsAction,
    state: ActionState,
    info?: ActionInfo,
  ): void;
  open(cardId: string): void;
  close(): void;
  /**
   * Brings a card into view and lights it for a few seconds (the Rip end's "Go to My cards").
   * A card the data does not hold yet is highlighted as soon as it arrives.
   */
  highlight(cardId: string): void;
  setTab(tab: Tab): void;
  setSort(sort: SortKey): void;
  setView(view: ViewMode): void;
  setInsets(insets: { top?: number; bottom?: number }): void;
  setReducedMotion(value: boolean): void;
  /** Moves focus to the heading (route change, 03-M3 §7.1). */
  focusHeading(): void;
  on<E extends keyof CardsEventMap>(event: E, cb: CardsEventMap[E]): () => void;
  destroy(): void;
}
