import { PublicKey } from "@solana/web3.js";
import { ONCHAIN_KEYS, PARAMS, resolveOnchainKey } from "@onepercent/config";
import { describe, expect, it } from "vitest";
import { IDL } from "../src/index.js";
import { decimalJson, vectors } from "./vectors.js";
function rustName(path: string): string {
  return path
    .replace(/\.\{edition\}/g, "")
    .replace(/\[\]/g, "")
    .replace(/Hex$/, "")
    .split(".")
    .map((part) =>
      part === part.toUpperCase()
        ? part
        : part.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase(),
    )
    .join("_");
}
function literal(value: string, type?: unknown): unknown {
  if (type === "pubkey") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Unsupported generated IDL constant literal: ${value}`);
  }
}
function normalize(value: unknown, type: string): unknown {
  if (type === "Pubkey")
    return Array.isArray(value)
      ? new PublicKey(Uint8Array.from(value as number[])).toBase58()
      : String(value);
  if (
    type.includes("u8") &&
    Array.isArray(value) &&
    typeof value[0] === "number" &&
    type.includes("&")
  )
    return Buffer.from(value as number[]).toString("utf8");
  if (Array.isArray(value)) return value.map((v) => normalize(v, type));
  if (typeof value === "number" || typeof value === "bigint")
    return value.toString();
  return value;
}
describe("on-chain parameter parity", () => {
  it("compares every ONCHAIN_KEYS entry to its generated IDL constant", () => {
    const constants = new Map(
      (IDL.constants ?? []).map((item) => [item.name, item]),
    );
    for (const entry of ONCHAIN_KEYS) {
      const name = rustName(entry.path);
      expect(constants.has(name), name).toBe(true);
      const expected = resolveOnchainKey(entry.path, PARAMS);
      const constant = constants.get(name)!;
      const value = literal(constant.value, constant.type);
      if (entry.type === "hex32") {
        expect(constant.type, entry.path).toEqual({ array: ["u8", 32] });
        expect(value, entry.path).toHaveLength(32);
      }
      // Byte-string constants are represented as JSON UTF-8 byte arrays by Anchor.
      const actual =
        typeof expected === "string" && Array.isArray(value)
          ? entry.type === "Pubkey"
            ? new PublicKey(Uint8Array.from(value)).toBase58()
            : Buffer.from(value).toString(
                entry.type === "hex32" || entry.path.endsWith("Hex")
                  ? "hex"
                  : "utf8",
              )
          : value;
      expect(normalize(actual, entry.type), entry.path).toEqual(
        normalize(expected, entry.type),
      );
    }
  });
  it("matches the Rust-exported constant snapshot", () => {
    const expected = vectors<Record<string, unknown>>("idl_constants");
    const actual = Object.fromEntries(
      (IDL.constants ?? []).map((item) => [
        item.name,
        literal(item.value, item.type),
      ]),
    );
    expect(decimalJson(actual)).toEqual(expected);
  });
});
