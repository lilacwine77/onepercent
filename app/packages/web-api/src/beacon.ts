import { z } from "zod";
import { CardKind, EditionId } from "./primitives.js";
export const RouteName = z.enum([
  "home",
  "xray",
  "feed",
  "rip",
  "cards",
  "verify",
  "fairness",
  "live",
  "token",
  "docs",
  "link",
  "notFound",
]);
export const CountBucket = z.enum(["1", "2-5", "6-10", "11+"]);
const status = z.enum(["done", "partial", "expired", "rejected", "failed"]);
const action = z.enum(["redeem", "sell_back", "sellMarket", "feed", "keep"]);
export const BeaconEvent = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("page_view"), route: RouteName }),
  z.strictObject({ event: z.literal("xray_submit"), cached: z.boolean() }),
  z.strictObject({
    event: z.literal("xray_share"),
    channel: z.enum(["x", "copy"]),
  }),
  z.strictObject({
    event: z.literal("wallet_connect"),
    wallet: z.enum(["phantom", "solflare", "backpack", "other"]),
    mobile: z.boolean(),
    inApp: z.boolean(),
  }),
  z.strictObject({
    event: z.literal("feed_plan"),
    bags: CountBucket,
    txs: CountBucket,
    approvals: CountBucket,
  }),
  z.strictObject({ event: z.literal("feed_result"), status }),
  z.strictObject({ event: z.literal("take_back_result"), status }),
  z.strictObject({
    event: z.literal("rip_start"),
    edition: EditionId,
    qty: CountBucket,
  }),
  z.strictObject({
    event: z.literal("rip_result"),
    status,
    edition: EditionId,
  }),
  z.strictObject({ event: z.literal("card_action"), action, kind: CardKind }),
  z.strictObject({
    event: z.literal("tx_error"),
    flow: z.enum([
      "feed",
      "takeBack",
      "rip",
      "redeem",
      "sellBack",
      "sellMarket",
      "settle",
      "refund",
      "close",
      "withdraw",
    ]),
    code: z.enum([
      "rejected",
      "expired",
      "simulation",
      "insufficientSol",
      "cardMoved",
      "paused",
      "network",
      "unknown",
    ]),
  }),
  z.strictObject({
    event: z.literal("experience_error"),
    component: z.enum([
      "hero",
      "xray",
      "feed",
      "inTheMachine",
      "rip",
      "cards",
      "tv",
      "verify",
      "live",
      "token",
      "unknown",
    ]),
  }),
]);
export type Beacon = z.infer<typeof BeaconEvent>;
