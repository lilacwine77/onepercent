export type EnginePhase =
  | "idle"
  | "building"
  | "simulating"
  | "signing"
  | "sending"
  | "done"
  | "partial"
  | "expired"
  | "rejected"
  | "failed";
export interface Progress {
  phase: EnginePhase;
  confirmed: number;
  total: number;
}
export interface Blockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}
export interface PlanItem<T> {
  id: string;
  phase: number;
  build(blockhash: Blockhash): Promise<T> | T;
  landed(): Promise<boolean>;
}
export interface PendingItem<T> {
  item: PlanItem<T>;
  validity: Blockhash;
  signature?: string;
}
export type ConfirmationResult =
  "confirmed" | "expired" | { status: "failed"; error: unknown };
export interface EnginePort<T> {
  blockhash(): Promise<Blockhash>;
  blockHeight(): Promise<number>;
  check(transaction: T): void;
  simulate(transaction: T): Promise<void>;
  send(transactions: readonly T[]): Promise<readonly string[]>;
  confirm(
    signature: string,
    validity: Blockhash,
    // Failed means a finalized error; expired means finalized expiry followed
    // by a history recheck. A still-ambiguous attempt rejects instead.
  ): Promise<ConfirmationResult>;
}
