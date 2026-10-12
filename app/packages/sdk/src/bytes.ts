import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha256";

/** Browser-safe byte readers also accept sliced RPC account data. */
export const bytesView = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);
export function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  if (btoa(binary) !== value) throw new RangeError("Expected canonical base64");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export const U64_MAX = (1n << 64n) - 1n;
export function integer(value: number, max: number, label = "integer"): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} outside its unsigned range`);
  }
  return value;
}
export function u8(value: number): Buffer {
  return Buffer.from([integer(value, 0xff)]);
}
export function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(integer(value, 0xffff));
  return out;
}
export function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(integer(value, 0xffffffff));
  return out;
}
export function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}
export function i64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value);
  return out;
}
export function hash(...parts: Uint8Array[]): Buffer {
  return Buffer.from(sha256(Buffer.concat(parts)));
}
export function fixedBytes(value: Uint8Array, length: number): Buffer {
  if (value.length !== length) throw new RangeError(`Expected ${length} bytes`);
  return Buffer.from(value);
}
export function discriminator(
  namespace: "account" | "global",
  name: string,
): Buffer {
  return hash(Buffer.from(`${namespace}:${name}`)).subarray(0, 8);
}
