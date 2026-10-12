import type { ClusterDeployment } from "../deployment.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { EXTERNAL_IDS } from "../constants.js";
import { feeInPda, machinePda, userAta } from "../pda.js";
import { instruction } from "./encoding.js";
import { readonly, writable, writableSigner } from "./m2.js";

export function collectCreatorFeesIx(
  deployment: ClusterDeployment,
  input: { payer: PublicKey },
) {
  const programId = deployment.programId;
  const feeIn = feeInPda(programId)[0];
  return instruction(programId, "collect_creator_fees", {}, [
    writableSigner(input.payer),
    writable(machinePda(programId)[0]),
    writable(feeIn),
    writable(userAta(feeIn, NATIVE_MINT, EXTERNAL_IDS.splToken)),
    readonly(EXTERNAL_IDS.splToken),
    readonly(SystemProgram.programId),
  ]);
}
