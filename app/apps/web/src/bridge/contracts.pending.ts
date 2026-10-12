// Pending the architect's experience/contracts.ts; M3 §6.2 verbatim (with D30).
import type { CopyKey } from "@onepercent/copy";
export type EditionId = "original" | "blue_shift" | "signature" | "after_hours"; // PACK_EDITIONS[].id
export type CardKind =
  | "dust"
  | "silver"
  | "blue"
  | "holo"
  | "black"
  | "jackpot"
  | "one_pct"
  | "spotlight"
  | "final"; // CARD_KINDS
export type Value =
  | { kind: "now"; lamports: bigint } // executable quote: "≈{x} SOL if sold now"
  | { kind: "est"; lamports: bigint } // capped estimate, lists and X-ray only: "≈{x} SOL est."
  | { kind: "none" }; // shown as common.noValue
export interface Msg {
  key: CopyKey;
  vars?: Record<string, string>;
} // vars already formatted (§5.2)
export interface Coin {
  mint: string;
  ticker: string;
  name: string;
  logoUrl: string | null;
}
export interface Gate {
  open: boolean;
  reason: Msg | null;
}
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
// Wave 1
export interface HeroProps {
  phase: string;
  countdown: { label: Msg; toTs: number } | null;
  onAir: boolean;
  jackpot: { costLamports: bigint; tokens: bigint; liveEditions: EditionId[] };
  reducedMotion: boolean;
  soundOn: boolean;
  onXray(input: string): void;
  onFeedCta(): void;
  onWatchLive(): void;
}
// XrayView keeps X1's props: { result: XrayResult; onShareX(): void; onCopyLink(): void }
// Wave 2
export interface FeedRow {
  coin: Coin;
  amountUi: string;
  drawdownPct: number | null;
  value: Value; // what the bag fetches if sold now
  feed: boolean; // the Feed checkbox, on by default; off leaves the bag in the wallet (D30)
  canFeed: Gate; // closed: the one-line reason, no action
  needsConfirm: boolean;
  confirmed: boolean;
  note: Msg | null;
}
export interface FeedPanelProps {
  wallet: string;
  rentBack: { accounts: number; lamports: bigint }; // always closed in the Feed transaction
  estimateLamports: bigint; // one Dust Card when pulled: feedBackEstimate at the recent edition mix
  rows: FeedRow[];
  deposits: { totalLamports: bigint; lines: Msg[] };
  emptiedRentBackLamports: bigint;
  machineToday: Msg | null;
  plan: { bags: number; transactions: number; approvals: number } | null;
  explainer: Msg;
  trust: Msg;
  flow: Flow;
  gate: Gate;
  onToggle(mint: string, feed: boolean): void;
  onConfirmBag(mint: string): void;
  onFeed(selection: { feed: string[] }): void;
  onFeedOneFirst(): void;
  onRefreshQuotes(): void;
  onRetry(): void;
}
export interface InTheMachineProps {
  entries: {
    entryId: string;
    coin: Coin;
    amountUi: string;
    depositLamports: bigint;
    refed: boolean;
  }[];
  vaultDeposits: { coin: Coin; lamports: bigint; state: "held" | "returned" }[];
  flow: Flow;
  onTakeBack(entryIds: string[]): void;
}
// Wave 3
export interface EditionModel {
  id: EditionId;
  priceLamports: bigint;
  maxQty: number;
  maxPerRip: number;
  state:
    | "covered"
    | "refilling"
    | "hungry"
    | "busy"
    | "paused"
    | "beforeOnAir"
    | "seasonOver";
  stateLine: Msg;
  jackpot: {
    tokens: bigint;
    value: Value;
    live: boolean;
    liveFromLamports: bigint;
  };
  onePct: { live: boolean; card: number | null; of: number };
}
export interface RipPanelProps {
  editions: EditionModel[];
  selected: EditionId;
  qty: number;
  turbo: boolean;
  preSign: Msg[];
  trust: Msg;
  flow: Flow;
  refundable: { seq: string; priceLamports: bigint } | null;
  onSelectEdition(id: EditionId): void;
  onQty(n: number): void;
  onTurbo(on: boolean): void;
  onRip(a: { edition: EditionId; qty: number }): void;
  onOdds(id: EditionId): void;
  onRefund(seq: string): void;
}
export interface OddsDialogProps {
  edition: EditionId;
  rows: {
    id: string;
    ppb: number;
    live: boolean;
    oneIn: string;
    note: Msg | null;
  }[];
  figures: Msg[];
  onVerify(): void;
}
export interface CardRow {
  cardId: string;
  kind: CardKind;
  edition: EditionId;
  seq: string;
  coin: Coin;
  amountUi: string;
  stockedLamports: bigint | null;
  value: Value;
  sellBack: Value | null; // the Sell quote (hits)
  actions: { redeem: Gate; sellBack: Gate; feedBack: Gate }; // at most two per card (D30)
}
export interface MyCardsProps {
  hits: CardRow[];
  dust: CardRow[];
  prizes: CardRow[];
  inTheMachine: InTheMachineProps;
  pending: {
    seq: string;
    edition: EditionId;
    qty: number;
    state: "drawing" | "refundable" | "settling";
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
export interface TvEvent {
  id: string;
  kind: "pull" | "feed" | "burn" | "system";
  tier?: CardKind;
  edition?: EditionId;
  who: string;
  ticker?: string;
  lamports?: bigint;
  sig: string;
  ts: number;
}
export interface TvProps {
  state:
    | "idle"
    | "countdown"
    | "xray"
    | "onAir"
    | "lastCall"
    | "finalPull"
    | "sealed";
  onAir: boolean;
  countdownTo: number | null;
  events: TvEvent[];
  reducedMotion: boolean;
}
export interface VerifyProps {
  seq: string;
  checks: { id: string; ok: boolean | null; label: Msg; detail: string }[];
  packs: {
    index: number;
    t: number;
    widths: number[];
    tier: CardKind;
    dust: { index: number; deckLenBefore: number }[];
  }[];
  links: { request: string; callback: string | null; settles: string[] };
  tableHash: string;
}
