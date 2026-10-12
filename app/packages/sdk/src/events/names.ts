import type { OnepercentEventName } from "./types.js";

/** Shared S1/S4 routing. Administrative and diagnostic events have no public action. */
export const ONEPERCENT_EVENT_STREAM_EVENTS = {
  KeeperHistoryStarted: null,
  RevealTimestamped: null,
  BucketListed: null,
  SellHistoryUpdated: null,
  BagFed: "feed",
  BagTakenBack: "takeBack",
  CallbackSkipped: null,
  CardDropped: null,
  CardRedeemed: "settle",
  ConfigChanged: null,
  HitSkipped: null,
  Initialized: null,
  PackRevealed: "reveal",
  PackSettled: "settle",
  PhaseAdvanced: "phase",
  Pong: null,
  PullClosed: "settle",
  PullOpened: "pullOpened",
  PullRefunded: "refund",
  PullRevealed: "reveal",
  ReferralRedirected: "settle",
  RoyaltyRedirected: "settle",
  TeamWithdrawn: null,
  VaultClosed: null,
  VaultShortfall: null,
  ExecBegun: "stock",
  ExecEnded: "stock",
  SoldBack: "sellBack",
  CardFedBack: "feed",
  OwedWithdrawn: "settle",
  BinderClosed: "settle",
  PoweredOn: "powerOn",
  OnePctLive: "onePct",
  OnePctPulled: "onePct",
  JackpotWon: "jackpotWon",
  CreatorFeesCollected: "creatorFees",
  FinalPullStarted: null,
  FinalSolClaimed: null,
  FinalTokensClaimed: null,
  LaunchFeesClaimed: null,
} as const satisfies Record<OnepercentEventName, string | null>;

/** Executed special buys have their own category; a begin is not a completed trade. */
export function onepercentEventStreamName(
  name: string,
  data: Record<string, unknown>,
) {
  if (name === "IndexerBlock0Ready") return "block0";
  if (name === "ExecBegun" && (data.kind === 3 || data.kind === 4)) return null;
  if (name === "ExecEnded" && data.kind === 3) return "burn";
  if (name === "ExecEnded" && data.kind === 4) return "jackpotBuy";
  return isOnepercentEventName(name)
    ? ONEPERCENT_EVENT_STREAM_EVENTS[name]
    : null;
}

export function isOnepercentEventName(
  name: string,
): name is OnepercentEventName {
  return Object.hasOwn(ONEPERCENT_EVENT_STREAM_EVENTS, name);
}
