import { PublicKey } from "@solana/web3.js";
import { binderPda } from "../pda.js";
import { writable, writableSigner } from "./m2.js";
import { instruction } from "./encoding.js";

export function withdrawOwedIx(
  programId: PublicKey,
  input: { owner: PublicKey },
) {
  return instruction(programId, "withdraw_owed", {}, [
    writableSigner(input.owner),
    writable(binderPda(programId, input.owner)[0]),
  ]);
}
