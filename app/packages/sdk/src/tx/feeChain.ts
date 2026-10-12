import type { ClusterDeployment } from "../deployment.js";
import {
  ComputeBudgetProgram,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type PublicKey,
} from "@solana/web3.js";
import { TX_LIMITS } from "@onepercent/config";
import {
  claimLaunchFeesIx,
  type ClaimLaunchFeesInput,
} from "../ix/claimLaunchFees.js";
import { collectCreatorFeesIx } from "../ix/collectCreatorFees.js";
import { advancePhaseInstruction } from "../ix/index.js";
import { feeInPda } from "../pda.js";
import { serializedSize } from "./index.js";

export interface FeeChainInput {
  deployment: ClusterDeployment;
  claim: ClaimLaunchFeesInput;
  /** Present only when the live DBC flag says partner surplus has not been withdrawn. */
  surplus?: Extract<ClaimLaunchFeesInput, { kind: "curve" | "surplus" }>;
  feeInLamports: bigint;
  feeInRentMinimum: bigint;
  withAdvancePhase?: boolean;
}
export function feeChainInstructions(input: FeeChainInput) {
  if (
    input.claim.kind === "surplus" ||
    (input.surplus &&
      (input.claim.kind !== "pool" ||
        input.surplus.kind !== "surplus" ||
        !input.surplus.payer.equals(input.claim.payer) ||
        !input.surplus.mint.equals(input.claim.mint)))
  )
    throw new Error("fee_chain_invalid_order");
  if (input.feeInLamports < 0n || input.feeInRentMinimum < 0n)
    throw new Error("fee_chain_invalid_rent");
  const shortfall =
    input.feeInRentMinimum > input.feeInLamports
      ? input.feeInRentMinimum - input.feeInLamports
      : 0n;
  return [
    ...(shortfall > 0n
      ? [
          SystemProgram.transfer({
            fromPubkey: input.claim.payer,
            toPubkey: feeInPda(input.deployment.programId)[0],
            lamports: shortfall,
          }),
        ]
      : []),
    claimLaunchFeesIx(input.deployment, input.claim),
    ...(input.surplus
      ? [claimLaunchFeesIx(input.deployment, input.surplus)]
      : []),
    collectCreatorFeesIx(input.deployment, { payer: input.claim.payer }),
    ...(input.withAdvancePhase
      ? [advancePhaseInstruction(input.deployment.programId)]
      : []),
  ];
}
export function buildFeeChainTransaction(
  input: FeeChainInput & {
    payer: PublicKey;
    blockhash: string;
    computeUnitLimit: number;
    priorityFeeMicroLamports: bigint;
    lookupTables?: readonly AddressLookupTableAccount[];
  },
) {
  if (!input.payer.equals(input.claim.payer))
    throw new Error("fee_chain_payer_mismatch");
  for (const table of input.lookupTables ?? [])
    if (table.state.authority || !table.isActive())
      throw new Error("fee_chain_lookup_table_not_frozen");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: input.payer,
      recentBlockhash: input.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: input.computeUnitLimit,
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: input.priorityFeeMicroLamports,
        }),
        ...feeChainInstructions(input),
      ],
    }).compileToV0Message([...(input.lookupTables ?? [])]),
  );
  if (serializedSize(tx) > TX_LIMITS.maxTxBytes)
    throw new Error("fee_chain_transaction_too_large");
  return tx;
}
