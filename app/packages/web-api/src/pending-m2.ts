import { z } from "zod";
import { PublicKeyString, Timestamp, U32, U64String } from "./primitives.js";
// SWITCH to @onepercent/sdk/api. These contracts are consumed only; M2 owns the routes.
export const Phase = /* @__PURE__ */ z.enum([
  "Setup",
  "StockUp",
  "PoweredOn",
  "OnAir",
  "BuysClosed",
  "FinalPull",
  "Done",
]);
// Keep the consumed legacy contract removable when the live SDK owns decoding.
export const ConfigResponse = /* @__PURE__ */ (() =>
  z.strictObject({
    asOfSlot: U64String,
    cluster: z.enum(["mainnet", "devnet", "localnet"]),
    programId: PublicKeyString,
    flags: z.record(z.string(), z.boolean()),
    paramsHash: z.string().regex(/^[a-f0-9]{64}$/i),
    phase: Phase,
    roles: z.strictObject({
      keeper: PublicKeyString,
      executor: PublicKeyString,
      intakeSigner: PublicKeyString,
      quoteSigner: PublicKeyString,
      teamWallet: PublicKeyString,
      teamWallets: z.array(PublicKeyString),
    }),
    vrf: z.strictObject({ queues: z.array(PublicKeyString), activeIndex: U32 }),
    season: z.strictObject({
      snapshotSlot: U64String,
      snapshotTs: Timestamp,
      stockUpTs: Timestamp,
      powerOnTs: Timestamp,
      onAirTs: Timestamp,
      endTs: Timestamp,
      finalTs: Timestamp,
    }),
    paused: U32,
  }))();
export type Config = z.infer<typeof ConfigResponse>;
export const configResponseSchema = ConfigResponse;
// Exact S0 Redis envelope; S4 owns the payload fields. M3.1 never renders them.
export const StreamEvent = z.strictObject({
  event: z.enum([
    "feed",
    "takeBack",
    "pullOpened",
    "reveal",
    "settle",
    "refund",
    "sellBack",
    "stock",
    "phase",
  ]),
  id: z.string().regex(/^\d+-\d+-\d+$/),
  data: z.record(z.string(), z.json()),
});
// SSE pings have no replay cursor or business payload; S0 publishes no ping shape.
// Accept a JSON object with an optional valid timestamp, ignoring other JSON fields.
export const StreamPing = z
  .object({ ts: Timestamp.optional() })
  .catchall(z.json());
export const streamEventSchema = StreamEvent;
