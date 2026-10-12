import { z } from "zod";
import {
  BucketClass,
  Cluster,
  Hex32,
  PublicKeyString,
  PullStatus,
  Slot,
  Timestamp,
  TransactionSignature,
  U8,
  U16,
  U32,
  U64String,
  Widths,
} from "./primitives.js";

export const FeatureFlags = z.strictObject({
  XRAY: z.boolean(),
  TV_LIVE: z.boolean(),
  FEED: z.boolean(),
  PACKS: z.boolean(),
  SELL_BACK: z.boolean(),
  HOLDER_BOOST: z.boolean(),
  BOARDS: z.boolean(),
  SOUND: z.boolean(),
  BOT_ALERTS: z.boolean(),
  BLINKS_XRAY: z.boolean(),
  BLINKS_FEED: z.boolean(),
  BLINKS_RIP: z.boolean(),
  SPOTLIGHT: z.literal(false),
  KEEPER_STOCK_LIVE: z.boolean(),
  CROSSCHAIN: z.boolean(),
  CROSSCHAIN_RH_TWO_STEP: z.boolean(),
  ZK_REDEEM: z.boolean(),
});

export const HealthResponse = z.strictObject({
  ok: z.boolean(),
  version: z.string().min(1),
  commit: z.string().min(1),
});

export const ConfigResponse = z.strictObject({
  asOfSlot: Slot.nullable(),
  cluster: Cluster,
  programId: PublicKeyString,
  flags: FeatureFlags,
  paramsHash: Hex32.nullable(),
  phase: U8.nullable(),
  roles: z
    .strictObject({
      keeper: PublicKeyString,
      executor: PublicKeyString,
      intakeSigner: PublicKeyString,
      quoteSigner: PublicKeyString,
      teamWallet: PublicKeyString,
      teamWallets: z.array(PublicKeyString),
    })
    .nullable(),
  vrf: z
    .strictObject({ queues: z.array(PublicKeyString), activeIndex: U8 })
    .nullable(),
  season: z
    .strictObject({
      snapshotSlot: U64String,
      snapshotTs: Timestamp,
      stockUpTs: Timestamp,
      powerOnTs: Timestamp,
      onAirTs: Timestamp,
      endTs: Timestamp,
      finalTs: Timestamp,
    })
    .nullable(),
  paused: U8.nullable(),
});

export const VrfStatus = z.strictObject({
  queue: PublicKeyString.nullable(),
  occupancyBps: U32.nullable(),
  oldestItemAgeSeconds: Slot.nullable(),
  busy: z.boolean(),
});

export const StockBucket = z.strictObject({
  index: U8,
  mint: PublicKeyString,
  class: BucketClass,
  enabled: z.boolean(),
  amount: U64String,
  cost: U64String,
  reserved: U64String,
  free: U64String,
  cap: U64String,
});

export const MachineResponse = z.strictObject({
  asOfSlot: Slot,
  phase: U8,
  stock: z.strictObject({
    stockSol: U64String,
    book: U64String,
    target: U64String,
    belowTarget: z.boolean(),
    buckets: z.array(StockBucket),
  }),
  coverage: z.strictObject({ maxQty: z.tuple([U8, U8, U8, U8]) }),
  deck: z.strictObject({ len: U32, reservedDust: U64String, free: U32 }),
  jackpot: z.strictObject({
    tokens: U64String,
    cost: U64String,
    sol: U64String,
  }),
  onePct: z
    .array(
      z.strictObject({
        state: U8,
        amount: U64String,
        releaseTs: Timestamp.optional(),
      }),
    )
    .length(4),
  tokenMint: PublicKeyString.nullable().optional(),
  onePctLiveIndex: U8.max(3).nullable().optional(),
  burn: z
    .strictObject({
      burnSol: U64String,
      burnedTotal: U64String,
      lastBurnTs: Timestamp,
      burnPaidHour: U64String,
    })
    .optional(),
  // D18: claims and the snapshot ship in the pre-end upgrade, not at launch.
  finalPull: z.null().optional(),
  sellBack: z.strictObject({
    budget: U64String,
    paidHour: U64String,
    floor: U64String,
  }),
  pendingPulls: U64String,
  vrf: VrfStatus,
  /**
   * What one fed-back Dust Card pays when a pack pulls it (lamports), at the recent
   * edition mix (@onepercent/config feedBackEstimate), and the packs opened per
   * edition it was weighed on (PACK_EDITIONS order; all zero: the default mix).
   */
  feedBack: z.strictObject({
    estimate: U64String,
    mix: z.tuple([U32, U32, U32, U32]),
  }),
});

export const Card = z.strictObject({
  index: U16,
  mint: PublicKeyString,
  amount: U64String,
  value: U64String,
  kind: U8,
  edition: U8,
  flags: U8,
  seqLo: U32,
});

export const Binder = z.strictObject({
  owner: PublicKeyString,
  referrer: PublicKeyString,
  seasonSpend: U64String,
  solOwed: U64String,
  feedNonceBase: U32,
  sbNonce: U32,
  pullNonce: U32,
  feedNonceBits: U16,
  freshInDeck: U16,
  len: U16,
  cap: U16,
  reserved: U16,
  bump: U8,
  flags: U8,
  cards: z.array(Card),
  closable: z.boolean(),
});

export const DeckEntry = z.strictObject({
  asOfSlot: Slot,
  deckIndex: U32,
  mint: PublicKeyString,
  amount: U64String,
  fresh: z.boolean(),
  refed: z.boolean(),
  deposit: U64String,
});

export const PendingPull = z.strictObject({
  seq: U64String,
  pull: PublicKeyString,
  buyer: PublicKeyString,
  edition: U8,
  qty: U8,
  createdTs: Timestamp,
});
export const SettleablePull = z.strictObject({
  seq: U64String,
  pull: PublicKeyString,
  packs: z.array(U8),
});
export const MeResponse = z.strictObject({
  asOfSlot: Slot,
  binder: Binder.nullable(),
  deck: z.array(DeckEntry),
  pulls: z.strictObject({
    pending: z.array(PendingPull),
    settleable: z.array(SettleablePull),
  }),
  vaultDeposits: z.array(
    z.strictObject({
      mint: PublicKeyString,
      payerIsWallet: z.boolean(),
      accounted: U64String,
      vaultExists: z.boolean(),
      state: z.enum(["held", "returned"]),
    }),
  ),
  royalties: z.strictObject({
    count24h: Slot,
    lamports24h: U64String.nullable(),
    total: U64String.nullable(),
    settlementReceipts: z.strictObject({
      lamports24h: U64String,
      total: U64String,
    }),
  }),
});

export const DustPick = z.strictObject({
  deckLenBefore: U32,
  index: U32,
  movedFrom: U32,
  mint: PublicKeyString,
  amount: U64String,
  depositor: PublicKeyString,
  refund: U64String,
});
export const RevealedPack = z.strictObject({
  pack: U8,
  liveFlags: U8.optional(),
  t: U32,
  widths: Widths,
  tier: U8,
  hitBucket: U8,
  hitMint: PublicKeyString,
  hitAmount: U64String,
  hitValue: U64String,
  houseMask: U8,
  dust: z.array(DustPick).length(4),
});

const NumberCheck = z.strictObject({ computed: U32, matches: z.boolean() });
export const VerifyCheck = z.strictObject({
  ok: z.boolean(),
  complete: z.boolean(),
  callerSeed: z.strictObject({
    computed: Hex32,
    matches: z.boolean().nullable(),
  }),
  packs: z.array(
    z.strictObject({
      pack: U8,
      ok: z.boolean(),
      t: NumberCheck,
      widths: z.strictObject({ computed: Widths, matches: z.boolean() }),
      tier: NumberCheck,
      dust: z.array(
        z.strictObject({ slot: U8, computed: U32, matches: z.boolean() }),
      ),
      metadataMatches: z.boolean(),
      hitBucket: z.strictObject({ recorded: U8, verified: z.literal(false) }),
    }),
  ),
});

export const VerifyResponse = z.strictObject({
  asOfSlot: Slot,
  seq: U64String,
  pull: PublicKeyString,
  buyer: PublicKeyString,
  buyerNonce: U32,
  referrer: PublicKeyString.nullable(),
  edition: U8,
  qty: U8,
  price: U64String,
  createdTs: Timestamp,
  revealedTs: Timestamp.nullable(),
  status: PullStatus,
  settledMask: U16,
  randomness: Hex32.nullable(),
  revealedSlot: Slot.nullable(),
  revealOrder: Slot.nullable(),
  liveFlags: U8,
  holder: z.boolean(),
  openedSig: TransactionSignature,
  revealedSig: TransactionSignature.nullable(),
  packs: z.array(RevealedPack),
  check: VerifyCheck.nullable(),
});

export const SignerReadiness = z.enum([
  "ready",
  "unavailable",
  "role_mismatch",
  "role_disabled",
]);
export const StatusResponse = z.strictObject({
  asOfSlot: Slot,
  indexer: z.strictObject({ lagSlots: Slot.nullable() }),
  keeper: z.strictObject({
    leader: z.boolean(),
    lastSettleAgeSeconds: Slot.nullable(),
  }),
  signers: z.strictObject({ intake: SignerReadiness, quote: SignerReadiness }),
  vrf: VrfStatus,
});

export const ErrorResponse = z.strictObject({
  asOfSlot: Slot.nullable(),
  error: z.strictObject({ code: z.string().regex(/^[a-z][a-z0-9_]*$/) }),
});

export type ConfigResponse = z.infer<typeof ConfigResponse>;
export type HealthResponse = z.infer<typeof HealthResponse>;
export type ErrorResponse = z.infer<typeof ErrorResponse>;
export type MachineResponse = z.infer<typeof MachineResponse>;
export type MeResponse = z.infer<typeof MeResponse>;
export type VerifyResponse = z.infer<typeof VerifyResponse>;
export type StatusResponse = z.infer<typeof StatusResponse>;
export type VrfStatus = z.infer<typeof VrfStatus>;
export type FeatureFlags = z.infer<typeof FeatureFlags>;
export type DustPick = z.infer<typeof DustPick>;
export type RevealedPack = z.infer<typeof RevealedPack>;
export type VerifyCheck = z.infer<typeof VerifyCheck>;
export type Binder = z.infer<typeof Binder>;
export type Card = z.infer<typeof Card>;
export type DeckEntry = z.infer<typeof DeckEntry>;
export type PendingPull = z.infer<typeof PendingPull>;
export type SettleablePull = z.infer<typeof SettleablePull>;
export type StockBucket = z.infer<typeof StockBucket>;
export type SignerReadiness = z.infer<typeof SignerReadiness>;
