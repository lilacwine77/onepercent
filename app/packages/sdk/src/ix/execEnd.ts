import { PublicKey, SystemProgram } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { u8 } from "../bytes.js";
import { EXEC_KIND, EXTERNAL_IDS } from "../constants.js";
import type { ExecKind } from "../constants.js";
import {
  configPda,
  machinePda,
  ledgerPda,
  vaultAta,
  vaultAuthPda,
} from "../pda.js";
import { readonly, writable, writableSigner } from "./m2.js";
import { instruction } from "./encoding.js";

export interface ExecEndInput {
  signer: PublicKey;
  kind: ExecKind;
  mint: PublicKey;
  tokenProgram: PublicKey;
}

export function execEndIx(programId: PublicKey, input: ExecEndInput) {
  u8(input.kind);
  return instruction(programId, "exec_end", { kind: input.kind }, [
    writableSigner(input.signer),
    readonly(configPda(programId)[0]),
    writable(machinePda(programId)[0]),
    writable(input.mint),
    writable(ledgerPda(programId, input.mint)[0]),
    writable(vaultAta(programId, input.mint, input.tokenProgram)),
    readonly(vaultAuthPda(programId)[0]),
    input.kind === EXEC_KIND.stockSell
      ? writable(vaultAta(programId, NATIVE_MINT, EXTERNAL_IDS.splToken))
      : readonly(SystemProgram.programId),
    readonly(input.tokenProgram),
    readonly(EXTERNAL_IDS.splToken),
    readonly(SystemProgram.programId),
  ]);
}
