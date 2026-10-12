import type { ClusterDeployment } from "../deployment.js";
import { EXTERNAL_IDS } from "../constants.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  dbcPoolPda,
  configPda,
  feeInPda,
  ledgerPda,
  machinePda,
  vaultAta,
  vaultAuthPda,
} from "../pda.js";
import { instruction } from "./encoding.js";
import { readonly, writable, writableSigner } from "./m2.js";

export interface PowerOnInput {
  launchWallet: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}

export function powerOnIx(deployment: ClusterDeployment, input: PowerOnInput) {
  const programId = deployment.programId;
  const dbcConfig = new PublicKey(deployment.meteora.dbcConfig);
  if (!input.tokenProgram.equals(EXTERNAL_IDS.splToken)) {
    throw new Error("The launch mint must use SPL Token");
  }
  return instruction(programId, "power_on", {}, [
    writableSigner(input.launchWallet),
    readonly(configPda(programId)[0]),
    writable(machinePda(programId)[0]),
    readonly(input.mint),
    readonly(dbcPoolPda(input.mint, dbcConfig)[0]),
    readonly(dbcConfig),
    writable(feeInPda(programId)[0]),
    writable(ledgerPda(programId, input.mint)[0]),
    readonly(vaultAta(programId, input.mint, input.tokenProgram)),
    readonly(vaultAuthPda(programId)[0]),
    readonly(input.tokenProgram),
    readonly(SystemProgram.programId),
  ]);
}
