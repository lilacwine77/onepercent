// Retain the CLI's validated string inputs and canonical intent verification.
// SDK governance builders now accept runtime programId and PublicKey-based InitParams.
import { isDeepStrictEqual } from "node:util";
import { OpsError } from "./input.js";
import * as namespace from "@anchor-lang/core";
import type { Idl } from "@anchor-lang/core";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import idl from "./m1-governance-idl.json" with { type: "json" };
import type { GuardianAction, InitInput } from "./input.js";

const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
const coder = new anchor.BorshInstructionCoder(idl as Idl);
const ro = (pubkey: PublicKey): AccountMeta => ({
  pubkey,
  isSigner: false,
  isWritable: false,
});
const rw = (pubkey: PublicKey): AccountMeta => ({
  ...ro(pubkey),
  isWritable: true,
});
const signer = (pubkey: PublicKey, writable = false): AccountMeta => ({
  ...ro(pubkey),
  isSigner: true,
  isWritable: writable,
});
export const pda = (seed: string, programId: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], programId)[0];
export const UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const programDataPda = (programId: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    UPGRADEABLE_LOADER,
  )[0];

function anchorValue(value: unknown): unknown {
  if (typeof value === "bigint") return new anchor.BN(value.toString());
  if (value instanceof PublicKey) return value;
  if (Array.isArray(value)) return value.map(anchorValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, anchorValue(child)]),
    );
  return value;
}

export function encodeDraftInstruction(name: string, args: object): Buffer {
  return coder.encode(name, anchorValue(args) as object);
}
export function initializeInstruction(input: {
  programId: PublicKey;
  authority: PublicKey;
  programData: PublicKey;
  params: InitInput;
}): TransactionInstruction {
  const params = Object.fromEntries(
    Object.entries(input.params).map(([key, value]) => [
      key,
      typeof value === "string"
        ? new PublicKey(value)
        : Array.isArray(value)
          ? value.map((v) => new PublicKey(v))
          : value,
    ]),
  );
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      signer(input.authority, true),
      ro(input.programId),
      ro(input.programData),
      rw(pda("config", input.programId)),
      rw(pda("machine", input.programId)),
      rw(pda("deck", input.programId)),
      rw(pda("fee_in", input.programId)),
      ro(new PublicKey(input.params.vrf_queue)),
      ro(SystemProgram.programId),
    ],
    data: encodeDraftInstruction("initialize", { params }),
  });
}
export type AdminAction =
  | { setRole: { role: number; key: PublicKey } }
  | {
      setSeason: {
        snapshot_slot: bigint;
        snapshot_ts: bigint;
        stock_up_ts: bigint;
      };
    };
function actionInstruction(
  name: "admin_config" | "guardian",
  programId: PublicKey,
  authority: PublicKey,
  action: object,
) {
  const converted = Object.fromEntries(
    Object.entries(action).map(([name, value]) => [
      name[0]!.toUpperCase() + name.slice(1),
      value,
    ]),
  );
  return new TransactionInstruction({
    programId,
    keys: [
      signer(authority),
      rw(pda("config", programId)),
      rw(pda("machine", programId)),
    ],
    data: encodeDraftInstruction(name, { action: converted }),
  });
}
export const adminConfigInstruction = (input: {
  programId: PublicKey;
  admin: PublicKey;
  action: AdminAction;
}) =>
  actionInstruction("admin_config", input.programId, input.admin, input.action);
export const guardianInstruction = (input: {
  programId: PublicKey;
  signer: PublicKey;
  action: GuardianAction;
}) =>
  actionInstruction("guardian", input.programId, input.signer, input.action);

/** Decode the constructed bytes with the same coder used to encode them. */
export function decodeDraftInstruction(instruction: TransactionInstruction) {
  let decoded: ReturnType<typeof coder.decode>;
  try {
    decoded = coder.decode(instruction.data);
  } catch {
    throw new OpsError("instruction_decode_failed");
  }
  if (!decoded) throw new OpsError("instruction_decode_failed");
  const definition = idl.instructions.find((row) => row.name === decoded.name);
  if (!definition || definition.accounts.length !== instruction.keys.length)
    throw new OpsError("instruction_accounts_mismatch");
  // Reject trailing bytes and noncanonical encodings, including unknown variants.
  if (!coder.encode(decoded.name, decoded.data).equals(instruction.data))
    throw new OpsError("instruction_encoding_mismatch");
  const args = normalizedArgs(decoded.data) as Record<string, unknown>;
  const variant = args.action as Record<string, unknown> | undefined;
  const variantName = variant ? Object.keys(variant)[0]! : null;
  const action = variantName
    ? variantName[0]!.toLowerCase() + variantName.slice(1)
    : null;
  return {
    instruction: decoded.name,
    action,
    args: variantName ? variant![variantName] : (args.params ?? args),
    accountNames: definition.accounts.map((account) => account.name),
  };
}

export function normalizedArgs(value: unknown): unknown {
  if (typeof value === "bigint" || anchor.BN.isBN(value))
    return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(normalizedArgs);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizedArgs(child)]),
    );
  return value;
}

export function verifyDraftInstruction(
  instruction: TransactionInstruction,
  expected: { instruction: string; action: string | null; args: unknown },
) {
  const decoded = decodeDraftInstruction(instruction);
  if (
    decoded.instruction !== expected.instruction ||
    decoded.action !== expected.action ||
    !isDeepStrictEqual(decoded.args, normalizedArgs(expected.args))
  )
    throw new OpsError("instruction_intent_mismatch");
  return decoded;
}
