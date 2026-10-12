import type { PublicKey } from "@solana/web3.js";
import { CU_LIMITS, TX_LIMITS } from "@onepercent/config";
import { ComputeBudgetProgram } from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import { closeBinderIx, withdrawOwedIx } from "../ix/index.js";
import { serializedSize, transaction } from "./index.js";
import type { BuiltTransaction, TransactionOptions } from "./index.js";

/** @internal Shared composition for the four My cards builders. */
export function myCardsTransaction(
  options: TransactionOptions,
  instructions: TransactionInstruction[],
  units: number,
): BuiltTransaction {
  const budget: TransactionInstruction[] = [];
  if (options.computeBudget !== false) {
    budget.push(ComputeBudgetProgram.setComputeUnitLimit({ units }));
    if (options.priorityFeeMicroLamports !== undefined)
      budget.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: options.priorityFeeMicroLamports,
        }),
      );
  }
  const tx = transaction(options, [...budget, ...instructions]);
  if (serializedSize(tx) > TX_LIMITS.maxTxBytes)
    throw new RangeError(
      `Transaction exceeds ${TX_LIMITS.maxTxBytes}-byte budget`,
    );
  return tx;
}

/** Builds the owner-signed exit without consulting services, phase or pause state. */
export function buildCloseBinderTransaction(
  programId: PublicKey,
  options: TransactionOptions,
): BuiltTransaction {
  return myCardsTransaction(
    options,
    [closeBinderIx(programId, { owner: options.wallet })],
    CU_LIMITS.closeBinder,
  );
}

/** Builds the owner-signed exit without consulting services, phase or pause state. */
export function buildWithdrawOwedTransaction(
  programId: PublicKey,
  options: TransactionOptions,
): BuiltTransaction {
  return myCardsTransaction(
    options,
    [withdrawOwedIx(programId, { owner: options.wallet })],
    CU_LIMITS.withdrawOwed,
  );
}
