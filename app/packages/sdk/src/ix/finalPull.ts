import { PublicKey, SystemProgram } from "@solana/web3.js";
import { RESERVED_KEYS } from "../constants.js";
import { binderPda, machinePda } from "../pda.js";
import { instruction } from "./encoding.js";
import { readonly, writable, writableSigner } from "./m2.js";

/** Permissionless snapshot. The program checks chain time and pending Pulls. */
export function startFinalPullIx(programId: PublicKey) {
  return instruction(programId, "start_final_pull", {}, [
    writable(machinePda(programId)[0]),
  ]);
}

export interface ClaimFinalSolInput {
  owner: PublicKey;
  /** Set false for an executable payee; reserved addresses are always read-only. */
  ownerWritable?: boolean;
}

/** Permissionless payout to the Binder owner, or its owed-SOL balance. */
export function claimFinalSolIx(
  programId: PublicKey,
  input: ClaimFinalSolInput,
) {
  const ownerWritable =
    input.ownerWritable !== false && !RESERVED_KEYS.has(input.owner.toBase58());
  return instruction(programId, "claim_final_sol", {}, [
    writable(machinePda(programId)[0]),
    writable(binderPda(programId, input.owner)[0]),
    ownerWritable ? writable(input.owner) : readonly(input.owner),
  ]);
}

/** The owner signs to create Final cards; tokens stay in their existing vaults. */
export function claimFinalTokensIx(
  programId: PublicKey,
  input: { owner: PublicKey },
) {
  return instruction(programId, "claim_final_tokens", {}, [
    writableSigner(input.owner),
    writable(machinePda(programId)[0]),
    writable(binderPda(programId, input.owner)[0]),
    readonly(SystemProgram.programId),
  ]);
}
