import { BN, BorshInstructionCoder } from "../anchor.js";
import type { Idl } from "@anchor-lang/core";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import idl from "../idl/onepercent.json" with { type: "json" };

const coder = new BorshInstructionCoder(idl as Idl);
function anchorValue(value: unknown): unknown {
  if (typeof value === "bigint") return new BN(value.toString());
  if (
    value instanceof PublicKey ||
    value instanceof Uint8Array ||
    value instanceof BN
  )
    return value;
  if (Array.isArray(value)) return value.map(anchorValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, anchorValue(child)]),
    );
  return value;
}
/** Instruction data is always encoded by the generated Anchor IDL. */
export function instruction(
  programId: PublicKey,
  name: string,
  args: object,
  keys: AccountMeta[],
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys,
    data: coder.encode(name, anchorValue(args) as object),
  });
}
