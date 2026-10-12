import { warnCause } from "@onepercent/service-kit";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded;
}

export function decodeBase58(input: string): Uint8Array {
  if (!input || input.length > 128) throw new Error("Invalid base58");
  let value = 0n;
  for (const character of input) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid base58");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value % 256n));
    value /= 256n;
  }
  for (const character of input) {
    if (character !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export function publicKeyBytes(input: unknown): Uint8Array | null {
  if (typeof input !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input))
    return null;
  try {
    const bytes = decodeBase58(input);
    return bytes.length === 32 ? bytes : null;
  } catch (error) {
    warnCause("link_address_invalid", error);
    return null;
  }
}
