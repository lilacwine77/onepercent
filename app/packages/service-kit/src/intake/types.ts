/** Full, successful transaction evidence. Amounts are raw base units. */
export interface IntakeTokenBalance {
  account: string;
  accountIndex: number;
  owner: string;
  mint: string;
  amount: bigint;
}

export interface IntakeTransaction {
  signature: string;
  slot: number;
  transactionIndex: number | null;
  blockTime: number | null;
  signers: readonly string[];
  feePayer: string;
  fee: bigint;
  lamports: ReadonlyMap<string, { pre: bigint; post: bigint }>;
  preTokenBalances: readonly IntakeTokenBalance[];
  postTokenBalances: readonly IntakeTokenBalance[];
  /** Known rent and unresolved creation funding, paid by each wallet. */
  creationCosts: ReadonlyMap<
    string,
    { rent: bigint; unresolvedFunding: bigint }
  >;
}

export interface InflowEvidence {
  kind: "swap" | "transfer" | "airdrop";
  sender: string | null;
  slot: number;
  signature: string;
  date: string | null;
}

export interface WalletHistoryEvidence {
  wallet: string;
  mint: string;
  snapshotSlot: number;
  balanceAtS: bigint;
  first: InflowEvidence | null;
}

export interface ConsumptionEvidence {
  holder: string;
  mint: string;
  usedBy: string;
  date: string | null;
}

export type FeedProvenanceRefusal =
  | "zero_balance"
  | "team_wallet"
  | "live_card"
  | "snapshot_not_held"
  | "passed_on"
  | "hop_sender_ineligible"
  | "hop_used"
  | "not_bought";

export type FeedProvenance =
  | { eligible: true; path: "self" | "hop"; via: string | null; holder: string }
  | { eligible: false; reason: FeedProvenanceRefusal; date: string | null };

export class EvidenceUnavailableError extends Error {
  readonly code = "evidence_unavailable";

  constructor() {
    super("Complete intake history evidence is unavailable");
    this.name = "EvidenceUnavailableError";
  }
}
