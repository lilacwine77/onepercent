import { PROGRAM_ID } from "../../tests/program-id.js";
import { createHash } from "node:crypto";
import { BN, BorshCoder } from "@anchor-lang/core";
import type { Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  decodeOnepercentEvent,
  EventDecodeError,
  M1_EVENT_IDL,
  M2_PROVISIONAL_EVENT_IDL,
  M4_EVENT_IDL,
  P3_EVENT_IDL,
  parseOnepercentLogs,
  ONEPERCENT_EVENT_STREAM_EVENTS,
} from "./index.js";

const EVENT_PROGRAM_ID = PROGRAM_ID.toBase58();
const idl = {
  ...M1_EVENT_IDL,
  events: [
    ...M1_EVENT_IDL.events,
    ...M2_PROVISIONAL_EVENT_IDL.events,
    ...M4_EVENT_IDL.events,
    ...P3_EVENT_IDL.events,
  ],
  types: [
    ...M1_EVENT_IDL.types,
    ...M2_PROVISIONAL_EVENT_IDL.types,
    ...M4_EVENT_IDL.types,
    ...P3_EVENT_IDL.types,
  ],
} as Idl;
const coder = new BorshCoder(idl);
type IdlType = Idl["instructions"][number]["args"][number]["type"];
const foreign = "11111111111111111111111111111111";
const compute = "ComputeBudget111111111111111111111111111111";
const knownPublicKey = new PublicKey(new Uint8Array(32).fill(19));

function encode(name: string, data: Record<string, unknown>): string {
  const definition = idl.events!.find((event) => event.name === name)!;
  return Buffer.concat([
    Buffer.from(definition.discriminator),
    coder.types.encode(name, data),
  ]).toString("base64");
}

const pong = encode("Pong", { version: 1 });
const dataLine = `Program data: ${pong}`;
const open = (id: string, depth = 1) => `Program ${id} invoke [${depth}]`;
const success = (id: string) => `Program ${id} success`;
const failure = (id: string) =>
  `Program ${id} failed: custom program error: 0x1`;
const parse = (
  logs: readonly string[] | null,
  options: { err?: unknown; topLevelProgramIds?: readonly string[] } = {},
) =>
  parseOnepercentLogs({
    logs,
    err: null,
    programId: EVENT_PROGRAM_ID,
    ...options,
  });

function sample(type: IdlType): unknown {
  if (typeof type !== "string") {
    if ("array" in type) {
      return Array.from({ length: type.array[1] as number }, () =>
        sample(type.array[0]),
      );
    }
    if ("defined" in type) return sampleStruct(type.defined.name);
    throw new Error("Unsupported fixture type");
  }
  switch (type) {
    case "pubkey":
      return knownPublicKey;
    case "u64":
      return new BN("18446744073709551615");
    case "i64":
      return new BN("-9223372036854775808");
    case "bool":
      return true;
    case "u8":
      return 255;
    case "u16":
      return 65535;
    case "u32":
      return 4294967295;
    default:
      throw new Error("Unsupported fixture scalar");
  }
}

function sampleStruct(name: string): Record<string, unknown> {
  const definition = idl.types!.find((type) => type.name === name)!;
  if (definition.type.kind !== "struct") throw new Error("Expected struct");
  return Object.fromEntries(
    definition.type.fields!.map((field) => {
      if (typeof field !== "object" || !("name" in field)) {
        throw new Error("Expected named field");
      }
      return [field.name, sample(field.type)];
    }),
  );
}

function normalize(value: unknown): unknown {
  if (value instanceof PublicKey) return value.toBase58();
  if (BN.isBN(value)) return BigInt(value.toString());
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

describe("M1, M2 and M4 event decoder", () => {
  it("initializes and decodes all event layouts without a global byte shim", async () => {
    const fixtures = idl.events!.map(({ name }) => {
      const data = sampleStruct(name);
      return {
        wire: encode(name, data),
        expected: { name, data: normalize(data) },
      };
    });
    vi.resetModules();
    let decoded: unknown[];
    vi.stubGlobal("Buffer", undefined);
    try {
      const { decodeOnepercentEvent } = await import("./decoder.js");
      decoded = fixtures.map(({ wire }) => decodeOnepercentEvent(wire));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(decoded).toEqual(fixtures.map(({ expected }) => expected));
  });

  it.each(idl.events!.map((event) => event.name))(
    "matches Anchor's independent Borsh encoding for %s",
    (name) => {
      const value = sampleStruct(name);
      expect(decodeOnepercentEvent(encode(name, value))).toEqual({
        name,
        data: normalize(value),
      });
    },
  );

  it("checks the event discriminator namespace and uniqueness", () => {
    const seen = new Set<string>();
    for (const event of idl.events!) {
      const expected = createHash("sha256")
        .update(`event:${event.name}`)
        .digest()
        .subarray(0, 8);
      expect(Buffer.from(event.discriminator)).toEqual(expected);
      seen.add(expected.toString("hex"));
    }
    expect(seen.size).toBe(idl.events!.length);
  });

  it("rejects malformed base64, truncated bodies and trailing bytes", () => {
    for (const invalid of [
      "not base64!",
      "",
      Buffer.from(pong, "base64").subarray(0, -1).toString("base64"),
      Buffer.concat([Buffer.from(pong, "base64"), Buffer.of(0)]).toString(
        "base64",
      ),
    ]) {
      expect(() => decodeOnepercentEvent(invalid)).toThrow(EventDecodeError);
    }
  });

  it("rejects noncanonical booleans and base64 trailing bits", () => {
    const closed = Buffer.from(
      encode("PullClosed", sampleStruct("PullClosed")),
      "base64",
    );
    closed[closed.length - 1] = 2;
    expect(() => decodeOnepercentEvent(closed.toString("base64"))).toThrow(
      "Invalid event boolean",
    );
    // Buffer accepts a nonzero final padding sextet; the strict decoder does not.
    expect(() => decodeOnepercentEvent("AAAAAAAAAAB=")).toThrow(
      "Invalid event payload",
    );
  });

  it("returns null for a future event discriminator", () => {
    expect(
      decodeOnepercentEvent(Buffer.alloc(8, 9).toString("base64")),
    ).toBeNull();
  });
});

describe("invocation-frame log parser", () => {
  it("indexes the final ReferralRedirected event without an unknown-event fallback", () => {
    const fields = {
      seq: new BN(7),
      pack: 0,
      referrer: knownPublicKey,
      amount: new BN(2_000_000),
    };
    const result = parse([
      open(EVENT_PROGRAM_ID),
      `Program data: ${encode("ReferralRedirected", fields)}`,
      success(EVENT_PROGRAM_ID),
    ]);
    expect(result.unknownEvent).toBe(false);
    expect(result.events).toEqual([
      {
        name: "ReferralRedirected",
        data: normalize(fields),
        ixIndex: 0,
        eventIndex: 0,
        logIndex: 1,
      },
    ]);
    expect(ONEPERCENT_EVENT_STREAM_EVENTS.ReferralRedirected).toBe("settle");
  });
  it("ignores forged data outside our innermost frame", () => {
    const result = parse([
      dataLine,
      open(foreign),
      dataLine,
      `Program log: ${open(EVENT_PROGRAM_ID, 2)}`,
      dataLine,
      open(EVENT_PROGRAM_ID, 2),
      dataLine,
      open(foreign, 3),
      dataLine,
      success(foreign),
      dataLine,
      success(EVENT_PROGRAM_ID),
      dataLine,
      success(foreign),
    ]);
    expect(result.events.map((event) => event.logIndex)).toEqual([6, 10]);
    expect(result.events.map((event) => event.eventIndex)).toEqual([0, 1]);
    expect(result.events.map((event) => event.ixIndex)).toEqual([0, 0]);
    expect(result.malformed).toBe(false);
  });

  it("maps logged roots to actual instruction indexes, including silent instructions", () => {
    const result = parse(
      [
        open(foreign),
        open(EVENT_PROGRAM_ID, 2),
        dataLine,
        success(EVENT_PROGRAM_ID),
        success(foreign),
        open(EVENT_PROGRAM_ID),
        dataLine,
        success(EVENT_PROGRAM_ID),
      ],
      { topLevelProgramIds: [compute, compute, foreign, EVENT_PROGRAM_ID] },
    );
    expect(
      result.events.map((event) => [event.ixIndex, event.eventIndex]),
    ).toEqual([
      [2, 0],
      [3, 1],
    ]);
  });

  it("drops failed transactions before decoding", () => {
    expect(
      parse([open(EVENT_PROGRAM_ID), dataLine, failure(EVENT_PROGRAM_ID)], {
        err: { InstructionError: [0, "Custom"] },
      }).events,
    ).toEqual([]);
  });

  it("discards failed CPI events, including successful descendants", () => {
    const result = parse([
      open(EVENT_PROGRAM_ID),
      dataLine,
      open(foreign, 2),
      open(EVENT_PROGRAM_ID, 3),
      dataLine,
      success(EVENT_PROGRAM_ID),
      failure(foreign),
      open(EVENT_PROGRAM_ID, 2),
      dataLine,
      failure(EVENT_PROGRAM_ID),
      dataLine,
      success(EVENT_PROGRAM_ID),
    ]);
    expect(result.events.map((event) => event.logIndex)).toEqual([1, 10]);
  });

  it("keeps only completed roots on truncation and requests reconciliation", () => {
    const result = parse([
      open(EVENT_PROGRAM_ID),
      dataLine,
      success(EVENT_PROGRAM_ID),
      open(EVENT_PROGRAM_ID),
      dataLine,
      "Log truncated",
    ]);
    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(parse(null).truncated).toBe(true);
  });

  it.each([
    [open(EVENT_PROGRAM_ID, 2), dataLine, success(EVENT_PROGRAM_ID)],
    [open(EVENT_PROGRAM_ID), dataLine, success(foreign)],
    [open(EVENT_PROGRAM_ID), dataLine],
    [success(EVENT_PROGRAM_ID)],
    [open(foreign), open(EVENT_PROGRAM_ID), dataLine],
    [
      open(EVENT_PROGRAM_ID),
      `Program ${foreign} invoke [0]`,
      dataLine,
      success(EVENT_PROGRAM_ID),
    ],
  ])("fails closed on malformed stack %j", (...logs) => {
    const result = parse(logs);
    expect(result.malformed).toBe(true);
    expect(result.events).toEqual([]);
  });

  it("rejects roots absent from the transaction message", () => {
    const result = parse(
      [open(EVENT_PROGRAM_ID), dataLine, success(EVENT_PROGRAM_ID)],
      { topLevelProgramIds: [foreign] },
    );
    expect(result.malformed).toBe(true);
    expect(result.events).toEqual([]);
  });

  it("signals unknown and invalid own events without trusting foreign data", () => {
    expect(
      parse([open(foreign), "Program data: invalid", success(foreign)])
        .unknownEvent,
    ).toBe(false);
    for (const payload of ["invalid", Buffer.alloc(8, 9).toString("base64")]) {
      const result = parse([
        open(EVENT_PROGRAM_ID),
        `Program data: ${payload}`,
        success(EVENT_PROGRAM_ID),
      ]);
      expect(result.unknownEvent).toBe(true);
      expect(result.events).toEqual([]);
    }
  });

  it("reserves unknown event ordinals across later IDL upgrades", () => {
    const result = parse([
      open(EVENT_PROGRAM_ID),
      `Program data: ${Buffer.alloc(8, 9).toString("base64")}`,
      dataLine,
      success(EVENT_PROGRAM_ID),
    ]);
    expect(result.unknownEvent).toBe(true);
    expect(result.events.map((event) => event.eventIndex)).toEqual([1]);
  });
});

it("exports one event table covering exactly the event IDLs", () => {
  expect(Object.keys(ONEPERCENT_EVENT_STREAM_EVENTS).sort()).toEqual(
    idl.events!.map((event) => event.name).sort(),
  );
});
