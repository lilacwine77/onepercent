import { AnchorProvider, Program } from "./anchor.js";
import type { Idl, Wallet } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "./idl/onepercent.json" with { type: "json" };
import type { Onepercent } from "./idl/onepercent.js";

export type { Onepercent } from "./idl/onepercent.js";
export const IDL: Idl = idl as Idl;

export type TransactionSigner = Pick<
  Wallet,
  "publicKey" | "signTransaction" | "signAllTransactions"
>;

/** Send the M0 instruction using the caller's signer. */
export async function ping(
  programId: PublicKey,
  connectionOrRpc: Connection | string,
  signer: TransactionSigner,
): Promise<string> {
  const connection =
    typeof connectionOrRpc === "string"
      ? new Connection(connectionOrRpc, "confirmed")
      : connectionOrRpc;
  const provider = new AnchorProvider(connection, signer, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program<Onepercent>(
    { ...IDL, address: programId.toBase58() } as unknown as Onepercent,
    provider,
  );

  return program.methods.ping().accounts({ signer: signer.publicKey }).rpc();
}

export * from "./events/index.js";
export { bytesView, bytesToHex, bytesEqual, bytesFromBase64 } from "./bytes.js";
export * from "./constants.js";
export * from "./pda.js";
export * from "./layouts.js";
export * from "./math/index.js";
export * from "./attest.js";
export * from "./ix/index.js";
export * from "./tx/index.js";
export * from "./fetch.js";
export * from "./errors.js";
export { buildMergeTransactions } from "./tx/merge.js";
export type { MergeMint, MergeSource } from "./tx/merge.js";

export type { MergeTransactionOptions } from "./tx/merge.js";

export * from "./pump/index.js";
export * from "./tx/launch.js";
export * from "./tx/proxima.js";
export * from "./rescue/compose.js";

export * from "./math/sellback.js";
export * from "./tx/sellback.js";
export * from "./tx/feedback.js";
export {
  buildCloseBinderTransaction,
  buildWithdrawOwedTransaction,
} from "./tx/binder.js";
export * from "./tx/exec.js";

export * from "./meteora/index.js";
export * from "./meteora/launch.js";

export { createDeploymentSelector } from "./deployment.js";
export type { ClusterDeployment } from "./deployment.js";
export * from "./meteora/fees.js";
export * from "./tx/feeChain.js";
