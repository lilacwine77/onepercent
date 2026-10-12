import type { Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { BN, BorshAccountsCoder, BorshInstructionCoder } from "../anchor.js";
import dbc from "./dbc.idl.json" with { type: "json" };
import damm from "./damm-v2.idl.json" with { type: "json" };
export const DBC_IDL = dbc as Idl;
export const DAMM_V2_IDL = damm as Idl;
export const DBC_ACCOUNT_CODER = new BorshAccountsCoder(DBC_IDL);
export const DAMM_V2_ACCOUNT_CODER = new BorshAccountsCoder(DAMM_V2_IDL);
export const DBC_INSTRUCTION_CODER = new BorshInstructionCoder(DBC_IDL);
export const DAMM_V2_INSTRUCTION_CODER = new BorshInstructionCoder(DAMM_V2_IDL);
export function toMeteoraWire(value: unknown): unknown {
  if (typeof value === "bigint") return new BN(value.toString());
  if (value instanceof PublicKey || BN.isBN(value)) return value;
  if (Array.isArray(value)) return value.map(toMeteoraWire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k
          .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
          .replace(/([a-z])([0-9])/g, "$1_$2")
          .replace(/_([ui])_([0-9])/g, "_$1$2"),
        toMeteoraWire(v),
      ]),
    );
  return value;
}
export function fromMeteoraWire(value: unknown): unknown {
  if (BN.isBN(value)) return BigInt(value.toString());
  if (value instanceof PublicKey) return value;
  if (Array.isArray(value)) return value.map(fromMeteoraWire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.replace(/_([a-z0-9])/g, (_m: string, c: string) => c.toUpperCase()),
        fromMeteoraWire(v),
      ]),
    );
  return value;
}
