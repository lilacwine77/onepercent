import type { RawAccount, SnapshotEvidence } from "@onepercent/eligibility";

export interface ChainSource {
  getTokenAccounts(owner: string, signal?: AbortSignal): Promise<RawAccount[]>;
  getAccounts(
    addresses: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, RawAccount | null>>;
  getAccountsPartial?(
    addresses: string[],
    signal?: AbortSignal,
  ): Promise<{
    accounts: Map<string, RawAccount | null>;
    failed: string[];
  }>;
  getMetadata(
    owner: string,
    signal?: AbortSignal,
  ): Promise<Map<string, { symbol?: string; name?: string; image?: string }>>;
  getSlot(signal?: AbortSignal): Promise<number>;
  getBlockTime(slot: number, signal?: AbortSignal): Promise<number | null>;
  getSnapshotEvidence(
    owner: string,
    mints: string[],
    slotS: number,
    signal?: AbortSignal,
  ): Promise<Map<string, SnapshotEvidence>>;
}

export interface PriceSource {
  getPrices(
    mints: string[],
    signal?: AbortSignal,
  ): Promise<
    Record<
      string,
      { usdPrice: number; blockId: number; ageSlots: number } | undefined
    >
  >;
  getTokenInfo(
    mints: string[],
    signal?: AbortSignal,
  ): Promise<
    Record<
      string,
      | {
          symbol: string;
          name: string;
          logoURI?: string;
          launchpad?: string;
          ath?: number;
        }
      | undefined
    >
  >;
  getSolUsd(signal?: AbortSignal): Promise<number>;
}

export interface NameResolver {
  resolve(name: string): Promise<string | null>;
}

// X2 owns reserve evidence and fee policy; use its public contract without mirroring it.
export type { ExitCap } from "@onepercent/market";
export type ExitCapSource = Pick<
  import("@onepercent/market").ExitCapClient,
  "getExitCap"
> &
  Partial<Pick<import("@onepercent/market").ExitCapClient, "getSellValues">>;
