import { PublicKey } from "@solana/web3.js";
import { bytesFromBase64, bytesToHex, bytesView } from "../bytes.js";
import m1 from "./m1.json" with { type: "json" };
import provisional from "./m2-provisional.json" with { type: "json" };
import p3 from "./p3.json" with { type: "json" };
import m4 from "./m4.json" with { type: "json" };
import type { OnepercentEvent } from "./types.js";
import { isOnepercentEventName } from "./names.js";

/** Generated from the final M1 program IDL by scripts/copy-idl.mjs. */
export const M1_EVENT_IDL = m1;

/** M2 section 8 extensions; pending a byte-for-byte comparison with P0's IDL. */
export const M2_PROVISIONAL_EVENT_IDL = provisional;
/** M4 additions generated from the program IDL, including reserved final schemas. */
export const M4_EVENT_IDL = m4;
export const P3_EVENT_IDL = p3;

type FieldType =
  | "pubkey"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "i64"
  | "bool"
  | { array: readonly [FieldType, number] }
  | { defined: { name: string } };

interface StructDefinition {
  name: string;
  type: {
    kind: "struct";
    fields: readonly { name: string; type: FieldType }[];
  };
}

const definitions = new Map(
  [...m1.types, ...provisional.types, ...m4.types, ...p3.types].map(
    (definition) => [definition.name, definition as StructDefinition],
  ),
);
const discriminators = new Map(
  [...m1.events, ...provisional.events, ...m4.events, ...p3.events].map(
    (event) => {
      if (!isOnepercentEventName(event.name))
        throw new Error("Unknown IDL event name");
      return [
        bytesToHex(Uint8Array.from(event.discriminator)),
        event.name,
      ] as const;
    },
  ),
);

export class EventDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventDecodeError";
  }
}

class Reader {
  private offset = 8;

  constructor(private readonly bytes: Uint8Array) {}

  private take(size: number): Uint8Array {
    if (this.offset + size > this.bytes.length) {
      throw new EventDecodeError("Incomplete event payload");
    }
    const part = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return part;
  }

  struct(name: string): Record<string, unknown> {
    const definition = definitions.get(name);
    if (!definition) throw new EventDecodeError("Unknown event structure");
    return Object.fromEntries(
      definition.type.fields.map((field) => [
        field.name,
        this.value(field.type),
      ]),
    );
  }

  private value(type: FieldType): unknown {
    if (typeof type !== "string") {
      if ("defined" in type) return this.struct(type.defined.name);
      return Array.from({ length: type.array[1] }, () =>
        this.value(type.array[0]),
      );
    }
    switch (type) {
      case "pubkey":
        return new PublicKey(this.take(32)).toBase58();
      case "u8":
        return this.take(1)[0]!;
      case "u16":
        return bytesView(this.take(2)).getUint16(0, true);
      case "u32":
        return bytesView(this.take(4)).getUint32(0, true);
      case "u64":
        return bytesView(this.take(8)).getBigUint64(0, true);
      case "i64":
        return bytesView(this.take(8)).getBigInt64(0, true);
      case "bool": {
        const value = this.take(1)[0]!;
        if (value > 1) throw new EventDecodeError("Invalid event boolean");
        return value === 1;
      }
      default:
        throw new EventDecodeError("Unsupported event field type");
    }
  }

  finish(): void {
    if (this.offset !== this.bytes.length) {
      throw new EventDecodeError("Unexpected trailing event bytes");
    }
  }
}

/** Unknown discriminators return null; malformed known events throw. */
export function decodeOnepercentEvent(base64: string): OnepercentEvent | null {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  ) {
    throw new EventDecodeError("Invalid event base64");
  }
  let bytes: Uint8Array;
  try {
    bytes = bytesFromBase64(base64);
  } catch {
    throw new EventDecodeError("Invalid event payload");
  }
  if (bytes.length < 8) throw new EventDecodeError("Invalid event payload");
  const name = discriminators.get(bytesToHex(bytes.subarray(0, 8)));
  if (!name) return null;
  const reader = new Reader(bytes);
  const data = reader.struct(name);
  reader.finish();
  return { name, data } as unknown as OnepercentEvent;
}
