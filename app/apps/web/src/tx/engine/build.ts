import {
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  Transaction,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { WEB } from "@onepercent/config/web";
import type { Blockhash } from "./progress";
export function buildTransaction(input: {
  wallet: PublicKey;
  blockhash: Blockhash;
  instructions: readonly TransactionInstruction[];
  computeUnits: number;
  recentPriorityFees: number[];
}) {
  if (!Number.isSafeInteger(input.computeUnits) || input.computeUnits < 1)
    throw new Error("Invalid compute units");
  const fees = input.recentPriorityFees
    .filter((value) => Number.isSafeInteger(value) && value >= 0)
    .sort((a, b) => a - b);
  const price = Math.min(
    fees[Math.floor(fees.length / 2)] ?? 0,
    WEB.priorityFeeCapMicroLamports,
  );
  return new Transaction({ feePayer: input.wallet, ...input.blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: input.computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
    ...input.instructions,
  );
}
export function checkTransaction(
  transaction: Transaction,
  wallet: PublicKey,
  allowedPrograms: ReadonlySet<string>,
  maxBytes: number,
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > PACKET_DATA_SIZE
  )
    throw new Error("Invalid transaction size limit");
  const message = transaction.compileMessage();
  if (
    message.header.numRequiredSignatures !== 1 ||
    !message.accountKeys[0]?.equals(wallet)
  )
    throw new Error("Unexpected transaction signer");
  if (
    transaction.instructions.some(
      (ix) => !allowedPrograms.has(ix.programId.toBase58()),
    )
  )
    throw new Error("Unexpected transaction program");
  if (
    transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length > maxBytes
  )
    throw new Error("Transaction too large");
}
