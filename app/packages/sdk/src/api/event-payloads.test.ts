import { describe, expect, it } from "vitest";
import {
  ProgramEventPayload,
  PROGRAM_EVENT_STREAM_NAMES,
  StreamEvent,
  StreamEventName,
  OwedWithdrawnPayload,
  BinderClosedPayload,
  PhaseAdvancedPayload,
} from "./index.js";
import { publicKey, signature, maxU64 } from "./__fixtures__/responses.js";
import { ONEPERCENT_EVENT_STREAM_EVENTS } from "../events/names.js";
import {
  M1_EVENT_IDL,
  M2_PROVISIONAL_EVENT_IDL,
  M4_EVENT_IDL,
  P3_EVENT_IDL,
} from "../events/decoder.js";
const metadata = { signature, asOfSlot: "7" };

type EventField =
  string | { array: [EventField, number] } | { defined: { name: string } };
const eventTypes = new Map(
  [
    ...M1_EVENT_IDL.types,
    ...M2_PROVISIONAL_EVENT_IDL.types,
    ...M4_EVENT_IDL.types,
    ...P3_EVENT_IDL.types,
  ].map((definition) => [definition.name, definition]),
);
function sampleField(type: EventField): unknown {
  if (typeof type !== "string") {
    if ("defined" in type) return sampleEvent(type.defined.name);
    return Array.from({ length: type.array[1] }, () =>
      sampleField(type.array[0]),
    );
  }
  switch (type) {
    case "pubkey":
      return publicKey;
    case "u64":
      return maxU64;
    case "i64":
      return "-9223372036854775808";
    case "u32":
      return 4294967295;
    case "u16":
      return 65535;
    case "u8":
      return 255;
    case "bool":
      return true;
    default:
      throw new Error(`Unsupported final event field: ${type}`);
  }
}
function sampleEvent(name: string): Record<string, unknown> {
  const definition = eventTypes.get(name);
  if (!definition) throw new Error(`Missing final event type: ${name}`);
  return Object.fromEntries(
    definition.type.fields.map(({ name, type }) => [
      name,
      sampleField(type as EventField),
    ]),
  );
}

describe("S1 public event contracts", () => {
  it.each([
    ["PoweredOn", "powerOn"],
    ["OnePctLive", "onePct"],
    ["OnePctPulled", "onePct"],
    ["JackpotWon", "jackpotWon"],
    ["CreatorFeesCollected", "creatorFees"],
  ])("routes %s to %s", (name, event) => {
    const data = { ...metadata, name, ...sampleEvent(name!) };
    expect(StreamEvent.parse({ id: "7-0-0", event, data }).event).toBe(event);
  });
  it("publishes completed executor receipts, never begins, to the special streams", () => {
    for (const [kind, event] of [
      [3, "burn"],
      [4, "jackpotBuy"],
    ] as const) {
      const data = {
        ...metadata,
        name: "ExecEnded",
        ...sampleEvent("ExecEnded"),
        kind,
      };
      expect(StreamEvent.parse({ id: "7-0-0", event, data }).event).toBe(event);
      expect(
        StreamEvent.safeParse({ id: "7-0-0", event: "stock", data }).success,
      ).toBe(false);
      const beginning = {
        ...metadata,
        name: "ExecBegun",
        ...sampleEvent("ExecBegun"),
        kind,
      };
      for (const channel of StreamEventName.options)
        expect(
          StreamEvent.safeParse({
            id: "7-0-0",
            event: channel,
            data: beginning,
          }).success,
        ).toBe(false);
    }
  });
  it("accepts a strict internal block-0 ready marker without an on-chain ABI event", () => {
    const data = { ...metadata, name: "IndexerBlock0Ready" };
    expect(
      StreamEvent.parse({ id: "7-0-0", event: "block0", data }).data,
    ).toEqual(data);
    expect(ProgramEventPayload.safeParse(data).success).toBe(false);
    expect(
      StreamEvent.safeParse({
        id: "7-0-0",
        event: "block0",
        data: { ...data, partial: true },
      }).success,
    ).toBe(false);
  });
  it.each(
    [
      ...M1_EVENT_IDL.events,
      ...M2_PROVISIONAL_EVENT_IDL.events,
      ...M4_EVENT_IDL.events,
      ...P3_EVENT_IDL.events,
    ].map(({ name }) => name),
  )("accepts exactly the published IDL fields for %s", (name) => {
    const payload = { ...metadata, name, ...sampleEvent(name) };
    expect(ProgramEventPayload.parse(payload)).toEqual(payload);
    expect(
      ProgramEventPayload.safeParse({ ...payload, unknownField: true }).success,
    ).toBe(false);
  });
  it("provides strict discriminated schemas for every actual S1 ABI event", () => {
    const names = ProgramEventPayload.options
      .map((schema) => schema.shape.name.value)
      .sort();
    expect(names).toEqual(Object.keys(PROGRAM_EVENT_STREAM_NAMES).sort());
    expect(PROGRAM_EVENT_STREAM_NAMES).toBe(ONEPERCENT_EVENT_STREAM_EVENTS);
  });
  it("publishes the final ReferralRedirected payload through the shared settle route", () => {
    const data = {
      ...metadata,
      name: "ReferralRedirected",
      seq: "7",
      pack: 0,
      referrer: publicKey,
      amount: maxU64,
    };
    expect(
      StreamEvent.parse({ id: "7-0-0", event: "settle", data }).data,
    ).toEqual(data);
    expect(ProgramEventPayload.safeParse({ ...data, amount: 1 }).success).toBe(
      false,
    );
  });
  it.each([
    { name: "CallbackSkipped", pull: publicKey, seq: "1", reason: 0 },
    { name: "CardDropped", seq: "1", pack: 0, tier: 0, value: "0" },
    {
      name: "ConfigChanged",
      action: 0,
      actor: publicKey,
      key: publicKey,
      a: "0",
      b: "0",
    },
    { name: "HitSkipped", seq: "1", pack: 0, tier: 0, value: "0" },
    { name: "Initialized", version: 1, admin: publicKey },
    { name: "Pong", version: 1 },
    { name: "TeamWithdrawn", to: publicKey, amount: "0" },
    {
      name: "VaultClosed",
      mint: publicKey,
      payer: publicKey,
      burned: "0",
      lamports: "0",
    },
    {
      name: "VaultShortfall",
      mint: publicKey,
      vault_amount: "0",
      accounted: "0",
    },
  ] as const)(
    "keeps $name typed but excludes it from public streams",
    (fields) => {
      const data = { ...metadata, ...fields };
      expect(ProgramEventPayload.parse(data)).toEqual(data);
      expect(PROGRAM_EVENT_STREAM_NAMES[fields.name]).toBeNull();
      for (const event of StreamEventName.options) {
        expect(
          StreamEvent.safeParse({ id: "7-0-0", event, data }).success,
          event,
        ).toBe(false);
      }
    },
  );
  it("exports typed exit payloads with decimal u64 amounts", () => {
    const owed = {
      ...metadata,
      name: "OwedWithdrawn",
      owner: publicKey,
      amount: maxU64,
      remaining: "0",
    };
    const closed = {
      ...metadata,
      name: "BinderClosed",
      owner: publicKey,
      lamports: maxU64,
    };
    expect(OwedWithdrawnPayload.parse(owed)).toEqual(owed);
    expect(BinderClosedPayload.parse(closed)).toEqual(closed);
    expect(
      StreamEvent.parse({ id: "7-0-0", event: "settle", data: owed }).data,
    ).toEqual(owed);
    expect(
      StreamEvent.safeParse({ id: "7-0-0", event: "phase", data: owed })
        .success,
    ).toBe(false);
    expect(OwedWithdrawnPayload.safeParse({ ...owed, amount: 1 }).success).toBe(
      false,
    );
    expect(
      OwedWithdrawnPayload.safeParse({ ...owed, _indexer: {} }).success,
    ).toBe(false);
  });
  it("enforces signed i64 timestamps and does not guess an undefined legacy payload", () => {
    const phase = {
      ...metadata,
      name: "PhaseAdvanced",
      from: 0,
      to: 1,
      ts: "-9223372036854775808",
    };
    expect(PhaseAdvancedPayload.parse(phase)).toEqual(phase);
    for (const ts of [
      "9223372036854775808",
      "-9223372036854775809",
      "invalid",
      0,
    ]) {
      expect(PhaseAdvancedPayload.safeParse({ ...phase, ts }).success).toBe(
        false,
      );
    }
    expect(
      ProgramEventPayload.safeParse({ ...metadata, name: "RoyaltyPaid" })
        .success,
    ).toBe(false);
  });
});
