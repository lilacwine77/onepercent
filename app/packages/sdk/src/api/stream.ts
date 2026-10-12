import { z } from "zod";
import { Slot, StreamEventId } from "./primitives.js";
import { ProgramEventPayload } from "./event-payloads.js";
import { onepercentEventStreamName } from "../events/names.js";
import { Block0ReadyPayload } from "./block0.js";
export * from "./event-payloads.js";

export const StreamEventName = z.enum([
  "feed",
  "takeBack",
  "pullOpened",
  "reveal",
  "settle",
  "refund",
  "sellBack",
  "stock",
  "phase",
  "powerOn",
  "onePct",
  "jackpotWon",
  "jackpotBuy",
  "burn",
  "creatorFees",
  "block0",
  "ping",
]);

/** Confirmed S1 envelope; discriminated payloads let M3 safely narrow by name. */
export const StreamEvent = z
  .strictObject({
    id: StreamEventId,
    event: StreamEventName.exclude(["ping"]),
    data: z.union([ProgramEventPayload, Block0ReadyPayload]),
  })
  .refine(
    (value) =>
      onepercentEventStreamName(value.data.name, value.data) === value.event,
    "Program event and stream category disagree",
  );
export const StreamPing = z.strictObject({ asOfSlot: Slot.nullable() });
export function streamEventSlot(id: unknown): number {
  const validated = StreamEventId.parse(id);
  return Slot.parse(Number(validated.split("-")[0]));
}
/** An embedded slot cannot override the canonical order key. */
export function decodeStreamEvent(input: unknown) {
  const event = StreamEvent.parse(input);
  return {
    ...event,
    data: { ...event.data, asOfSlot: streamEventSlot(event.id) },
  };
}
export type StreamEvent = z.infer<typeof StreamEvent>;
export type StreamEventName = z.infer<typeof StreamEventName>;
export type StreamPing = z.infer<typeof StreamPing>;
export type DecodedStreamEvent = ReturnType<typeof decodeStreamEvent>;
