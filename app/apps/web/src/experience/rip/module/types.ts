/* eslint-disable */
// Synced from experience/lab/src/rip/types.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Public contract of the Rip experience component.
 * Codex wires real data to these types; the component never computes economics.
 */

/** The four pack editions (names from the art direction). */
export type Edition = "original" | "blue_shift" | "signature" | "after_hours";

/** Hit tiers, in ascending rarity. */
export type HitTier =
  "silver" | "blue" | "holo" | "black" | "jackpot" | "one_pct";

export interface RipInput {
  edition: Edition;
  /**
   * Optional pull id (e.g. the on-chain pull account). Seeds every particle so a
   * replay of the same pull looks identical (DA §8.5 "Replays are deterministic").
   */
  pullId?: string;
}

/** A SOL quote as given by the app: a value, or `null` while it is pending (rendered "n/a"). */
export type SolQuote = number | string | null;

/** One Dust Card: a real bag deposited by another wallet, or a House slot. */
export interface RipDustCard {
  /**
   * House slot (the Deck was empty): a display-only card with no tokens and its own visual
   * (white-Pepe coin, ticker "1%", "House card"). The other fields are ignored except `actions`.
   */
  house?: boolean;
  /** Ticker without or with the leading "$" ("PEPEKING" or "$PEPEKING"). */
  symbol: string;
  /** Token amount for display. Numbers are grouped with en-US separators; strings are shown as given. */
  amountUi: number | string;
  /** Logo URL (same-origin or CORS-enabled, ideally the 256 px proxy PNG). */
  logoUrl: string;
  /** Depositor wallet address (base58). Shown as 4+4 ("7xKp…D1d2"); `.sol` names are not used (DECISIONS D9). */
  fedBy: string;
  /** Executable quote "≈ X SOL" (can arrive later through setQuotes; `null` = pending "n/a"). Never computed here. */
  valueSolUi?: SolQuote;
  /** Actions the app offers for this card (default: none; a Dust Card simply lands in My cards). */
  actions?: CardAction[];
}

/** The hit card. */
export interface RipHitCard {
  tier: HitTier;
  symbol: string;
  amountUi: number | string;
  logoUrl: string;
  /**
   * Executable quote "≈ X SOL if sold now"; `null` = pending (shown "n/a"). Can arrive later via setQuotes.
   * Painted on the Jackpot and The 1% only: a stock hit's face shows its amount (D30).
   */
  valueSolUi: SolQuote;
  /** The Sell quote (the `sell_back` payout) for "Sell · +X SOL · instant"; `null`/absent = pending ("n/a"). */
  sellBackSolUi?: SolQuote;
  /** Sell is not available now (the quote was refused): the button shows closed with this one-line reason. */
  sellBackReason?: string | null;
  /**
   * Actions the app offers for the hit, in display order. Default: Silver–Black Foil
   * sell_back · my_cards; Jackpot and The 1% my_cards.
   */
  actions?: CardAction[];
}

export interface RipResult {
  /** Exactly four Dust Cards (extra entries are ignored, missing ones are rendered as House slots). */
  dust: RipDustCard[];
  hit: RipHitCard;
  /** Link for "Verify ↗" in the end state (DA §8.5). Without it the link emits the `verify` event. */
  verifyUrl?: string;
}

/** Quotes that arrive after setResult (any subset). Index i of `dust` is result.dust[i]. */
export interface RipQuotes {
  dust?: SolQuote[];
  hit?: { valueSolUi?: SolQuote; sellBackSolUi?: SolQuote };
}

/** Per-card action progress, set by the app (e.g. while the transaction is signed and confirmed). */
export type ActionState = "idle" | "pending" | "done" | "failed";

/**
 * Card actions offered in the end state (founder rule, after a pull): a hit is sold in one tap or found
 * in My cards; everything else waits there.
 *  - Silver / Blue / Holo / Black Foil hits: sell_back ("Sell · +X SOL · instant", the machine buys it now) · my_cards
 *  - Jackpot and The 1% ($1PCT): my_cards
 *  - Dust Cards and House slots: none (they land in My cards)
 * `my_cards` ("Go to My cards") sends the card into the My cards target; the app then opens My cards
 * with that card highlighted.
 */
export type CardAction = "sell_back" | "my_cards";

/** Named beats of the choreography, emitted as they start. */
export type RipBeat =
  | "idle"
  | "crank"
  | "dispense"
  | "fly"
  | "cranking"
  | "still-cranking"
  | "lock"
  | "tear"
  | "cards-out"
  | "fan"
  | "dust-flip"
  | "buildup"
  | "hit-flip"
  | "tier"
  | "tier-peak"
  | "takeover"
  | "exit"
  | "tap-wait"
  | "pick"
  | "action"
  | "action-done"
  | "skip"
  | "failed"
  | "end"
  | "sell-back"
  | "sell-back-done";

/** Sound cue names (DA §14). No audio ships with the component; listen and play your sprite. */
export type SoundCue =
  | "crank.turn"
  | "slot.drop"
  | "crank.loop"
  | "crank.loop.stop"
  | "lock"
  | "pack.rip"
  | "card.slide"
  | "card.flip"
  | "dust.tick"
  | "card.rise"
  | "tier.silver"
  | "tier.blue"
  | "tier.holo"
  | "tier.black"
  | "tier.jackpot"
  | "tier.onepct"
  | "coin.pop"
  | "sellback.slide"
  | "pack.burst"
  | "hit.charge"
  | "hit.burst"
  | "card.feed"
  | "card.keep"
  | "tokens.flow";

export interface SoundEvent {
  cue: SoundCue;
  /** Card index for card cues, pitch step for dust ticks (0..3), tier rank 0..5 for pack.burst / hit.*. */
  index?: number;
}

export interface MountRipOptions {
  /** Base URL of the static assets folder (pack art, studio, poster, token art). Example: "/assets/". */
  assetsBase: string;
  /** Force reduced motion. Defaults to the `prefers-reduced-motion` media query. */
  reducedMotion?: boolean;
  /**
   * URL of the machine GLB. Defaults to "./models/onepercent-machine.glb" (resolved against the page).
   * When the file is missing or invalid, a stand-in machine built from primitives is used.
   * Pass `null` to skip the lookup.
   */
  machineUrl?: string | null;
  /** Play the built-in "card slides back into the machine" animation when Sell is clicked. Default true. */
  autoSellBackAnimation?: boolean;
  /** Called for every sound cue (same as `on('sound')`). */
  onSound?: (event: SoundEvent) => void;
  /** Minimum time the "Cranking…" state is shown, in ms (DA: at least 900 ms from signing). Default 900. */
  minCrankingMs?: number;
  /**
   * Opaque backdrop drawn behind the machine: 'studio' (default, the cream-washed hero studio photo)
   * or any CSS colour. The canvas is opaque because the glass globe refracts what three.js draws.
   */
  backdrop?: "studio" | string;
  /** Initial Jackpot meter, 0..1 (see setJackpotLevel). Default 1. */
  jackpotLevel?: number;
  /**
   * 'tap' (default): the viewer turns the cards, in any order, by tapping them (the last one is
   * always the hit), with a "Reveal all" control. 'auto' turns them by itself.
   */
  revealMode?: "auto" | "tap";
  /**
   * Gacha-style rarity telegraph (default true, founder request): the light out of the pack and
   * the hit's charge take the tier's colour; rarer tiers charge longer and burst bigger.
   * false = identical anticipation for every tier (da-direction §8.5).
   */
  rarityTelegraph?: boolean;
  /**
   * Plays the Sell and Go to My cards animations as soon as the action is clicked (default true).
   * The web app passes false and calls animateAction() once the action is done.
   */
  autoActionAnimations?: boolean;
  /** Host UI the cards fly to: the "My cards" entry (Go to My cards) and the wallet. */
  targets?: { myCards?: HTMLElement | null; wallet?: HTMLElement | null };
  /** Turbo for repeat rippers: the whole choreography at ~55 % of its length. Default false. */
  turbo?: boolean;
  /** Line under the action buttons on hover / focus. Defaults are short and number-free (end-copy.ts). */
  actionHints?: Partial<Record<CardAction, string>>;
  /**
   * Upper bound of the renderer pixel ratio. Default: 3 on small canvases (phones, ≤ 600 k CSS px²),
   * 2 otherwise. Lowered automatically, in 0.25 steps, only if frames keep dropping.
   */
  maxPixelRatio?: number;
  /**
   * Screen space covered by the host UI (CSS px), e.g. a bottom dock: shots and the end layout
   * keep their content clear of it. Can be updated with setInsets().
   */
  insets?: { top?: number; bottom?: number };
  /** A short vibration (navigator.vibrate) when a Holo Foil or rarer hit turns, on devices that allow it. Default true; never under reduced motion. */
  haptics?: boolean;
  /**
   * Machine poster shown at once on first load (same framing), cross-faded to the live 3D machine
   * when it is ready. Default "<assetsBase>machine-poster.webp"; false = no poster.
   */
  poster?: string | false;
}

export interface RipEventMap {
  cardAction: (cardIndex: number, action: CardAction) => void;
  /** "Share" pressed on a big hit (Holo Foil and up). */
  share: (info: {
    cardIndex: number;
    tier: HitTier;
    result: RipResult;
  }) => void;
  /** "Try again" pressed after fail(). */
  retry: () => void;
  /** "Verify ↗" pressed and the result has no verifyUrl. */
  verify: () => void;
  /**
   * Stage mood for the host page (e.g. dim a header during Black Foil): `amount` 0..1 of `color`.
   * Emitted when a tier mood starts and ends.
   */
  mood: (info: { color: string; amount: number; durationMs: number }) => void;
  sound: (event: SoundEvent) => void;
  beat: (beat: RipBeat) => void;
}

export interface RipController {
  /**
   * Plays the whole Rip for an edition. Resolves when the end state (cards laid out with
   * actions) is reached. Rejects with an `AbortError`-named error if `reset()`/`destroy()`
   * or another `play()` interrupts it, and with a `RipFailedError`-named error after `fail()`.
   */
  play(input: RipInput): Promise<void>;
  /** Provides the drawn result. May be called before or after `play()`; the Cranking loop waits for it. */
  setResult(result: RipResult): void;
  /** Subscribes to an event. Returns an unsubscribe function. */
  on<E extends keyof RipEventMap>(event: E, cb: RipEventMap[E]): () => void;
  /**
   * Plays an action's animation and removes the card from the row: Go to My cards (into the My cards
   * target), Sell (into the slot, a SOL coin out of the tray; stock hits only).
   */
  animateAction(cardIndex: number, action: CardAction): Promise<void>;
  /** Turns every remaining face-down card (tap mode). */
  revealAll(): void;
  /** Sets the host elements the cards fly to (My cards, wallet). */
  setTargets(targets: {
    myCards?: HTMLElement | null;
    wallet?: HTMLElement | null;
  }): void;
  /** Plays the Sell animation for the hit (stock tiers only; a no-op otherwise). Use when `autoSellBackAnimation` is false. */
  animateSellBack(cardIndex: number, solUi?: number | string): Promise<void>;
  /**
   * Sets the Jackpot meter: the gold coins in the globe, 0 (empty) … 1 (full), linear in coin
   * count (10 layers of 26/16/20/13/29/31/35/33/25/28 coins; the packs in the globe settle with
   * them). Map the pot to it however the product wants (e.g. pot / display cap). Animated over
   * `animateMs` (default 700; 0 = immediate). The Jackpot reveal drains the globe by itself.
   */
  setJackpotLevel(level: number, animateMs?: number): void;
  /** Host UI covering the stage (CSS px); the framing keeps content clear of it. */
  setInsets(insets: { top?: number; bottom?: number }): void;
  /** Updates quotes after setResult (card faces repaint, "n/a" until then). */
  setQuotes(quotes: RipQuotes): void;
  /** Shows progress on one action button: pending (spinner, disabled), done (check), failed (retry). */
  setActionState(
    cardIndex: number,
    action: CardAction,
    state: ActionState,
  ): void;
  /** Skips to the end state (after the result has arrived; requested earlier, it applies as soon as it does). */
  skip(): void;
  /** Ends the current pull before its result arrives (timeout, failed transaction…). `message` is shown as given. */
  fail(message?: string): void;
  setRevealMode(mode: "auto" | "tap"): void;
  /** Call from a user gesture (e.g. the Rip button) to let the foil follow the phone's tilt (iOS asks permission). */
  enableMotion(): void;
  setTurbo(on: boolean): void;
  /** Switches reduced motion at runtime. */
  setReducedMotion(value: boolean): void;
  /** Returns to the idle machine shot. */
  reset(): void;
  destroy(): void;
}
