/** Wave 2 contract (03-M3 §6.2): Feed panel and In the machine. Codex fills these. */
import type { CopyKey } from "@onepercent/copy";
export interface Msg {
  key: CopyKey;
  vars?: Record<string, string>;
}
export type Value =
  | { kind: "now"; lamports: bigint }
  | { kind: "est"; lamports: bigint }
  | { kind: "none" };
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
export interface FeedRow {
  coin: Coin;
  amountUi: string;
  drawdownPct: number | null;
  /** What the bag fetches if sold now; the row sets it against what feeding pays. */
  value: Value;
  /** The Feed checkbox: on by default for every bag that can be fed. Off: it stays in the wallet. */
  feed: boolean;
  /** Closed for a bag that can't be fed, with its one-line reason; such a row has no action. */
  canFeed: Gate;
  needsConfirm: boolean;
  confirmed: boolean;
  note: Msg | null;
}
export interface FeedPanelProps {
  wallet: string;
  /** Empty token accounts, always closed in the Feed transaction: their rent comes back at once. */
  rentBack: { accounts: number; lamports: bigint };
  /**
   * What one Dust Card is expected to pay when it's pulled, at the recent edition
   * mix (@onepercent/config feedBackEstimate; live: /api/machine feedBack).
   */
  estimateLamports: bigint;
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
  /** Feeds the checked bags; the empty accounts close in the same transaction. */
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
