/** Public read-only surfaces. Every number and evidence link comes from the adapter. */
export type PublicKind = "verify" | "fairness" | "live" | "token";
export interface PublicBase {
  cluster: "mainnet" | "devnet";
  loading: boolean;
  error: boolean;
  stale: boolean;
  asOfSlot: number | null;
  trust: "sealed" | "timelocked" | null;
  onRefresh(): void;
}
export interface VerifyData {
  seq: string;
  source: "rpc" | "indexer";
  refunded: boolean;
  matches: boolean | null;
  seed: boolean | null;
  slot: number | null;
  order: number | null;
  tableHash: string;
  paramsHash: string | null;
  request: string | null;
  callback: string | null;
  settles: string[];
  packs: {
    index: number;
    kind: string | null;
    matches: boolean;
    draw: number;
    widths: readonly number[];
    bucket: number;
    dust: { slot: number; computed: number; matches: boolean }[];
  }[];
}
export interface FairnessData {
  edition: number;
  liveKnown: boolean;
  salesClosed?: boolean;
  rows: {
    id: string;
    probability: string;
    holderProbability: string | null;
    live: boolean;
    transferredToSilver: boolean;
  }[];
  tableHash: string | null;
  paramsHash: string | null;
  onEdition(edition: number): void;
}
export interface TokenData {
  mint: string | null;
  burnedTokens: bigint;
  jackpot: { tokens: bigint; costLamports: bigint; conversionLamports: bigint };
  onePct: {
    index: number;
    amount: bigint;
    state: number;
    live: boolean;
    releaseTs: bigint | null;
  }[];
}
export interface BroadcastEntry {
  id: string;
  kind: "pull" | "feed" | "system";
  tier?: string;
  who: string;
  sig: string;
  announce: boolean;
}
export interface LiveData {
  totals: null | {
    stockLamports: bigint;
    deckCards: number;
    pendingPulls: bigint;
    jackpotTokens: bigint;
  };
  window: "today" | "season";
  highlights:
    | {
        seq: string;
        tier: string;
        who: string;
        hitValueLamports: string;
        sig: string;
      }[]
    | null;
  tv: {
    enabled: boolean;
    onAir: boolean;
    state:
      | "idle"
      | "countdown"
      | "onAir"
      | "lastCall"
      | "finalPull"
      | "buysClosed"
      | "sealed"
      | null;
    countdown: string | null;
    events: BroadcastEntry[];
  };
  onWindow(window: "today" | "season"): void;
}
export type PublicViewProps = PublicBase &
  (
    | { kind: "verify"; identifier: string; data: VerifyData | null }
    | { kind: "fairness"; data: FairnessData }
    | { kind: "token"; data: TokenData | null }
    | { kind: "live"; data: LiveData }
  );
