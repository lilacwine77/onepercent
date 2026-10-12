import { createHash } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { VersionedTransactionResponse } from "@solana/web3.js";
import type { SignedTxRecord } from "@onepercent/service-kit";

/** Called only after TxSender has cryptographically validated the journal.
 * Bind RPC execution evidence to that exact signed message and the exec pair;
 * current LUT accounts and log completeness are not execution evidence. */
export function assertStockReceipt(
  record: SignedTxRecord,
  receipt: VersionedTransactionResponse,
  program: PublicKey,
) {
  const signed = VersionedTransaction.deserialize(
    Buffer.from(record.transactionBase64, "base64"),
  );
  if (
    receipt.meta?.err !== null ||
    receipt.transaction.signatures[0] !== record.signature ||
    !Buffer.from(receipt.transaction.message.serialize()).equals(
      Buffer.from(signed.message.serialize()),
    )
  )
    throw new Error("stock_receipt_mismatch");
  const pair = ["exec_begin", "exec_end"].map((name) =>
    createHash("sha256").update(`global:${name}`).digest().subarray(0, 8),
  );
  const instructions = signed.message.compiledInstructions;
  const positions = pair.map((disc) =>
    instructions.findIndex(
      (ix) =>
        signed.message.staticAccountKeys[ix.programIdIndex]?.equals(program) &&
        Buffer.from(ix.data).subarray(0, 8).equals(disc),
    ),
  );
  if (positions[0]! < 0 || positions[1]! <= positions[0]!)
    throw new Error("stock_receipt_program_mismatch");
}
