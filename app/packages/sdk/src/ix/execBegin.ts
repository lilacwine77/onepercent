import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { u8, u64 } from "../bytes.js";
import { EXEC_KIND, EXTERNAL_IDS } from "../constants.js";
import type { ExecKind } from "../constants.js";
import {
  configPda,
  machinePda,
  ledgerPda,
  vaultAta,
  vaultAuthPda,
  userAta,
} from "../pda.js";
import { readonly, writable, writableSigner } from "./m2.js";
import { instruction } from "./encoding.js";

export interface ExecBeginInput {
  signer: PublicKey;
  kind: ExecKind;
  bucket: number;
  amount: bigint;
  mint: PublicKey;
  tokenProgram: PublicKey;
  oracles: readonly [PublicKey, PublicKey, PublicKey, PublicKey];
}

export function execBeginIx(programId: PublicKey, input: ExecBeginInput) {
  u8(input.kind);
  u8(input.bucket);
  u64(input.amount);
  const isStockSell = input.kind === EXEC_KIND.stockSell;
  return instruction(
    programId,
    "exec_begin",
    { kind: input.kind, bucket: input.bucket, amount: input.amount },
    [
      writableSigner(input.signer),
      readonly(configPda(programId)[0]),
      writable(machinePda(programId)[0]),
      readonly(input.mint),
      writable(ledgerPda(programId, input.mint)[0]),
      writable(vaultAta(programId, input.mint, input.tokenProgram)),
      readonly(vaultAuthPda(programId)[0]),
      writable(
        userAta(
          input.signer,
          isStockSell ? input.mint : NATIVE_MINT,
          isStockSell ? input.tokenProgram : EXTERNAL_IDS.splToken,
        ),
      ),
      isStockSell
        ? writable(vaultAta(programId, NATIVE_MINT, EXTERNAL_IDS.splToken))
        : readonly(SystemProgram.programId),
      ...input.oracles.map(readonly),
      readonly(input.tokenProgram),
      readonly(EXTERNAL_IDS.splToken),
      readonly(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
  );
}
