export interface RawAccount {
  address: string;
  owner: string;
  lamports: bigint;
  data: Uint8Array;
}
export interface SnapshotEvidence {
  balanceAtS: bigint | null;
  mintFirstSeenSlot?: number;
}
export type MintFailureCode =
  | "unknown_program"
  | "mint_unparseable"
  | "decimals"
  | "mint_authority"
  | "freeze_authority"
  | "token_extensions";
export type ReasonCode =
  | MintFailureCode
  | "excluded"
  | "mint_missing"
  | "not_pump_fun"
  | "snapshot_not_held"
  | "snapshot_at_feed";
