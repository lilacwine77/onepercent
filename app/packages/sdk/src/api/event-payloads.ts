import { z } from "zod";
import {
  PublicKeyString,
  TransactionSignature,
  Slot,
  U8,
  U16,
  U32,
  U64String,
} from "./primitives.js";

// S1 and S4 share one routing table; amounts stay decimal strings.
export { ONEPERCENT_EVENT_STREAM_EVENTS as PROGRAM_EVENT_STREAM_NAMES } from "../events/names.js";

const I64String = z
  .string()
  .regex(/^-?\d{1,20}$/)
  .refine(
    (v) =>
      /^-?\d{1,20}$/.test(v) &&
      BigInt(v) >= -(1n << 63n) &&
      BigInt(v) < 1n << 63n,
  );
const metadata = {
  signature: TransactionSignature,
  asOfSlot: z.union([Slot, U64String]),
};

export const DustPickFields = z.strictObject({
  deck_len_before: U32,
  index: U32,
  moved_from: U32,
  mint: PublicKeyString,
  amount: U64String,
  depositor: PublicKeyString,
  refund: U64String,
});

export const BagFedPayload = z.strictObject({
  ...metadata,
  name: z.literal("BagFed"),
  depositor: PublicKeyString,
  mint: PublicKeyString,
  amount: U64String,
  deck_index: U32,
  deposit: U64String,
  fresh_in_deck: U16,
});

export const BagTakenBackPayload = z.strictObject({
  ...metadata,
  name: z.literal("BagTakenBack"),
  depositor: PublicKeyString,
  mint: PublicKeyString,
  amount: U64String,
  deck_index: U32,
  moved_from: U32,
  refund: U64String,
});

export const CallbackSkippedPayload = z.strictObject({
  ...metadata,
  name: z.literal("CallbackSkipped"),
  pull: PublicKeyString,
  seq: U64String,
  reason: U8,
});

export const CardDroppedPayload = z.strictObject({
  ...metadata,
  name: z.literal("CardDropped"),
  seq: U64String,
  pack: U8,
  tier: U8,
  value: U64String,
});

export const CardRedeemedPayload = z.strictObject({
  ...metadata,
  name: z.literal("CardRedeemed"),
  owner: PublicKeyString,
  mint: PublicKeyString,
  amount: U64String,
  kind: U8,
  card_index: U16,
  moved_from: U16,
  refund: U64String,
});

export const ConfigChangedPayload = z.strictObject({
  ...metadata,
  name: z.literal("ConfigChanged"),
  action: U8,
  actor: PublicKeyString,
  key: PublicKeyString,
  a: U64String,
  b: U64String,
});

export const HitSkippedPayload = z.strictObject({
  ...metadata,
  name: z.literal("HitSkipped"),
  seq: U64String,
  pack: U8,
  tier: U8,
  value: U64String,
});

export const InitializedPayload = z.strictObject({
  ...metadata,
  name: z.literal("Initialized"),
  version: U16,
  admin: PublicKeyString,
});

export const PackRevealedPayload = z.strictObject({
  ...metadata,
  name: z.literal("PackRevealed"),
  seq: U64String,
  pack: U8,
  edition: U8,
  live_flags: U8,
  holder: z.boolean(),
  t: U32,
  widths: z.array(U32).length(6),
  tier: U8,
  hit_bucket: U8,
  house_mask: U8,
  hit_mint: PublicKeyString,
  hit_amount: U64String,
  hit_value: U64String,
  dust: z.array(DustPickFields).length(4),
});

export const PackSettledPayload = z.strictObject({
  ...metadata,
  name: z.literal("PackSettled"),
  pull: PublicKeyString,
  seq: U64String,
  pack: U8,
  paid: z.array(U64String).length(4),
  redirected_mask: U8,
  referral_paid: U64String,
  referral_to_team: U64String,
});

export const PhaseAdvancedPayload = z.strictObject({
  ...metadata,
  name: z.literal("PhaseAdvanced"),
  from: U8,
  to: U8,
  ts: I64String,
});

export const PongPayload = z.strictObject({
  ...metadata,
  name: z.literal("Pong"),
  version: U16,
});

export const PullClosedPayload = z.strictObject({
  ...metadata,
  name: z.literal("PullClosed"),
  pull: PublicKeyString,
  seq: U64String,
  to: PublicKeyString,
  lamports: U64String,
  to_stock: z.boolean(),
});

export const PullOpenedPayload = z.strictObject({
  ...metadata,
  name: z.literal("PullOpened"),
  pull: PublicKeyString,
  seq: U64String,
  buyer: PublicKeyString,
  edition: U8,
  qty: U8,
  price: U64String,
  referrer: PublicKeyString,
  holder: z.boolean(),
  queue: PublicKeyString,
  created_ts: I64String,
  backing: z.array(U8).length(10),
});

export const PullRefundedPayload = z.strictObject({
  ...metadata,
  name: z.literal("PullRefunded"),
  pull: PublicKeyString,
  seq: U64String,
  buyer: PublicKeyString,
  amount: U64String,
});

export const PullRevealedPayload = z.strictObject({
  ...metadata,
  name: z.literal("PullRevealed"),
  pull: PublicKeyString,
  seq: U64String,
  buyer: PublicKeyString,
  randomness: z.array(U8).length(32),
  qty: U8,
  hit_value_total: U64String,
  to_stock: U64String,
  to_jackpot: U64String,
  to_burn: U64String,
  to_team: U64String,
  shortfall: U64String,
});

export const ReferralRedirectedPayload = z.strictObject({
  ...metadata,
  name: z.literal("ReferralRedirected"),
  seq: U64String,
  pack: U8,
  referrer: PublicKeyString,
  amount: U64String,
});

export const RoyaltyRedirectedPayload = z.strictObject({
  ...metadata,
  name: z.literal("RoyaltyRedirected"),
  seq: U64String,
  pack: U8,
  slot: U8,
  depositor: PublicKeyString,
  amount: U64String,
});

export const TeamWithdrawnPayload = z.strictObject({
  ...metadata,
  name: z.literal("TeamWithdrawn"),
  to: PublicKeyString,
  amount: U64String,
});

export const VaultClosedPayload = z.strictObject({
  ...metadata,
  name: z.literal("VaultClosed"),
  mint: PublicKeyString,
  payer: PublicKeyString,
  burned: U64String,
  lamports: U64String,
});

export const VaultShortfallPayload = z.strictObject({
  ...metadata,
  name: z.literal("VaultShortfall"),
  mint: PublicKeyString,
  vault_amount: U64String,
  accounted: U64String,
});

export const ExecBegunPayload = z.strictObject({
  ...metadata,
  name: z.literal("ExecBegun"),
  kind: U8,
  bucket: U8,
  mint: PublicKeyString,
  signer: PublicKeyString,
  amount: U64String,
  min_out: U64String,
  v0: U64String,
  book: U64String,
  expected: U64String,
  ts: I64String,
});

export const ExecEndedPayload = z.strictObject({
  ...metadata,
  name: z.literal("ExecEnded"),
  kind: U8,
  bucket: U8,
  mint: PublicKeyString,
  amount: U64String,
  min_out: U64String,
  delta: U64String,
  book: U64String,
  tracked_after: U64String,
  ts: I64String,
});

export const SoldBackPayload = z.strictObject({
  ...metadata,
  name: z.literal("SoldBack"),
  owner: PublicKeyString,
  mint: PublicKeyString,
  bucket: U8,
  n: U8,
  total_amount: U64String,
  stocked_value: U64String,
  quote_lamports: U64String,
  value: U64String,
  payout: U64String,
  to_team: U64String,
  nonce: U32,
  sb_paid_hour: U64String,
  slot_refund: U64String,
});

export const CardFedBackPayload = z.strictObject({
  ...metadata,
  name: z.literal("CardFedBack"),
  owner: PublicKeyString,
  mint: PublicKeyString,
  amount: U64String,
  kind: U8,
  card_index: U16,
  moved_from: U16,
  deck_index: U32,
  deposit: U64String,
  slot_refund: U64String,
});

export const OwedWithdrawnPayload = z.strictObject({
  ...metadata,
  name: z.literal("OwedWithdrawn"),
  owner: PublicKeyString,
  amount: U64String,
  remaining: U64String,
});

export const BinderClosedPayload = z.strictObject({
  ...metadata,
  name: z.literal("BinderClosed"),
  owner: PublicKeyString,
  lamports: U64String,
});

export const PoweredOnPayload = z.strictObject({
  ...metadata,
  name: z.literal("PoweredOn"),
  mint: PublicKeyString,
  launch_pool: PublicKeyString,
  fee_in: PublicKeyString,
  launch_wallet: PublicKeyString,
  dev_buy: U64String,
  vault_amount: U64String,
  accounted: U64String,
  fee_in_topup: U64String,
  power_on_ts: I64String,
  on_air_ts: I64String,
  end_ts: I64String,
});

export const OnePctLivePayload = z.strictObject({
  ...metadata,
  name: z.literal("OnePctLive"),
  index: U8,
  release_ts: I64String,
  ts: I64String,
});

export const OnePctPulledPayload = z.strictObject({
  ...metadata,
  name: z.literal("OnePctPulled"),
  seq: U64String,
  pack: U8,
  index: U8,
  buyer: PublicKeyString,
  amount: U64String,
  holder: z.boolean(),
});

export const JackpotWonPayload = z.strictObject({
  ...metadata,
  name: z.literal("JackpotWon"),
  seq: U64String,
  pack: U8,
  buyer: PublicKeyString,
  edition: U8,
  tokens: U64String,
  cost: U64String,
  jackpot_sol_left: U64String,
});

export const CreatorFeesCollectedPayload = z.strictObject({
  ...metadata,
  name: z.literal("CreatorFeesCollected"),
  regime: U8,
  amount: U64String,
  from_fee_in: U64String,
  from_wsol: U64String,
  to_stock: U64String,
  to_burn: U64String,
  to_team: U64String,
  book: U64String,
  target: U64String,
  ts: I64String,
});

export const FinalPullStartedPayload = z.strictObject({
  ...metadata,
  name: z.literal("FinalPullStarted"),
  final_ts: I64String,
  pool_sol: U64String,
  pool_1pct: U64String,
  jackpot_tokens: U64String,
  onepct_final_mask: U8,
  total_spend: U64String,
  bucket_pools: z.array(U64String).length(16),
});

export const FinalSolClaimedPayload = z.strictObject({
  ...metadata,
  name: z.literal("FinalSolClaimed"),
  owner: PublicKeyString,
  share: U64String,
  paid: U64String,
  to_owed: z.boolean(),
  remaining: U64String,
});

export const FinalTokensClaimedPayload = z.strictObject({
  ...metadata,
  name: z.literal("FinalTokensClaimed"),
  owner: PublicKeyString,
  onepct: U64String,
  buckets: z.array(U64String).length(16),
  cards: U8,
  slot_rent: U64String,
});

export const LaunchFeesClaimedPayload = z.strictObject({
  ...metadata,
  name: z.literal("LaunchFeesClaimed"),
  kind: U8,
  pool: PublicKeyString,
  quote: U64String,
  base: U64String,
  unwrapped_lamports: U64String,
  ts: I64String,
});

export const KeeperHistoryStartedPayload = z.strictObject({
  ...metadata,
  name: z.literal("KeeperHistoryStarted"),
  ts: I64String,
});
export const RevealTimestampedPayload = z.strictObject({
  ...metadata,
  name: z.literal("RevealTimestamped"),
  seq: U64String,
  ts: I64String,
});
export const BucketListedPayload = z.strictObject({
  ...metadata,
  name: z.literal("BucketListed"),
  bucket: U8,
  mint: PublicKeyString,
  listed_ts: I64String,
});
export const SellHistoryUpdatedPayload = z.strictObject({
  ...metadata,
  name: z.literal("SellHistoryUpdated"),
  bucket: U8,
  hour_index: U64String,
  sb_paid_hour: U64String,
  sb_paid_prev_hour: U64String,
  sb_inflow_hour: U64String,
  sb_inflow_prev_hour: U64String,
});

export const ProgramEventPayload = z.discriminatedUnion("name", [
  KeeperHistoryStartedPayload,
  RevealTimestampedPayload,
  BucketListedPayload,
  SellHistoryUpdatedPayload,
  BagFedPayload,
  BagTakenBackPayload,
  CallbackSkippedPayload,
  CardDroppedPayload,
  CardRedeemedPayload,
  ConfigChangedPayload,
  HitSkippedPayload,
  InitializedPayload,
  PackRevealedPayload,
  PackSettledPayload,
  PhaseAdvancedPayload,
  PongPayload,
  PullClosedPayload,
  PullOpenedPayload,
  PullRefundedPayload,
  PullRevealedPayload,
  ReferralRedirectedPayload,
  RoyaltyRedirectedPayload,
  TeamWithdrawnPayload,
  VaultClosedPayload,
  VaultShortfallPayload,
  ExecBegunPayload,
  ExecEndedPayload,
  SoldBackPayload,
  CardFedBackPayload,
  OwedWithdrawnPayload,
  BinderClosedPayload,
  PoweredOnPayload,
  OnePctLivePayload,
  OnePctPulledPayload,
  JackpotWonPayload,
  CreatorFeesCollectedPayload,
  FinalPullStartedPayload,
  FinalSolClaimedPayload,
  FinalTokensClaimedPayload,
  LaunchFeesClaimedPayload,
]);
export type ProgramEventPayload = z.infer<typeof ProgramEventPayload>;
