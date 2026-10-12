import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "@onepercent/config";
import type { IntakeParams } from "../internal/params.js";
import type { IntakeServiceOptions, FeedLogRow } from "./service.js";
import type { FeedState } from "./chain.js";

// Synthetic tests only. Values copied from M1's read-only config draft and
// PARAMS §26.1. These are never supplied by the production runtime factory.
export const testParams: IntakeParams = {
  ATTESTATIONS: { feedDomain: "1PCT-FEED-v1", feedTtlSeconds: 120 },
  FEED_RULES: { freshCapPerWallet: 25 },
  TX_LIMITS: { feedBagsPerTxWithLookupTable: 2, txPerSignAll: 8 },
  INTAKE: { rateLimitPerMinutePerWallet: 30, rateLimitPerMinutePerIp: 60 },
  SERVICES: {
    indexer: { maxLagSecondsForIntake: 30 },
    signers: { evidenceCacheSeconds: 86_400 },
  },
};
export const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
export const wallet = key(1).toBase58();
export const mint = key(2).toBase58();
export const ipHash = "a".repeat(64);
export const now = 1_800_000_000;
export function intakeFixture() {
  const rows: FeedLogRow[] = [];
  const signed: Uint8Array[] = [];
  const state: FeedState = {
    slot: 100,
    snapshotSlot: 50,
    snapshotDate: new Date((now - 1000) * 1000).toISOString(),
    tokenMint: key(3).toBase58(),
    teamWallets: [],
    feedOpen: true,
    base: 4,
    bits: 2,
    freshInDeck: 0,
  };
  const options: IntakeServiceOptions = {
    programId: key(4),
    params: testParams,
    signer: {
      publicKey: key(5),
      signMessage: (message) => {
        signed.push(message);
        return Buffer.alloc(64, 1);
      },
    },
    guard: { assertAuthorized: () => undefined },
    blockTimeNow: async () => now,
    readState: async () => state,
    readBag: async (_wallet, mint, minContextSlot) => ({
      ok: true,
      slot: minContextSlot,
      bag: {
        mint,
        amount: 1000n,
        decimals: 6,
        tokenProgram: PROGRAM_IDS.splToken,
        source: key(6).toBase58(),
        mergeFrom: [],
      },
    }),
    history: async (wallet, mint, snapshotSlot) => ({
      wallet,
      mint,
      snapshotSlot,
      balanceAtS: 1000n,
      first: {
        kind: "swap",
        sender: null,
        slot: 40,
        signature: "fixture",
        date: new Date((now - 2000) * 1000).toISOString(),
      },
    }),
    live: async () => ({ consumption: [], liveCard: null }),
    indexerTime: async () => now,
    appendLogs: async (next) => {
      rows.push(...next);
    },
  };
  return {
    options,
    state,
    rows,
    signed,
    request: { wallet, chunks: [[{ mint }]] },
  };
}
