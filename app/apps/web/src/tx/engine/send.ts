import {
  SIGNATURE_LENGTH_IN_BYTES,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import type { SupportedWallet } from "../../wallet/capabilities";
import { EngineError, SubmittedBatchError, errorCopy } from "./errors";

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
// The fallback /api/send lands in M3.2. Its submission port is injected here.
export async function send(
  wallet: SupportedWallet,
  account: WalletAccount,
  chain: "solana:devnet" | "solana:mainnet",
  transactions: readonly Uint8Array[],
  fallback: (bytes: Uint8Array) => Promise<string>,
  encodeSignature: (bytes: Uint8Array) => string,
) {
  if (!account.chains.includes(chain))
    throw new SubmittedBatchError(
      new EngineError("wallet.wrongNetwork"),
      [],
      null,
    );
  const signatures: string[] = [];
  const direct = wallet.features["solana:signAndSendTransaction"];
  if (direct) {
    for (const [index, transaction] of transactions.entries()) {
      try {
        const outputs = await direct.signAndSendTransaction({
          transaction,
          account,
          chain,
          options: { preflightCommitment: "confirmed" },
        });
        const output = outputs[0];
        if (
          outputs.length !== 1 ||
          !output ||
          output.signature.length !== SIGNATURE_LENGTH_IN_BYTES ||
          !output.signature.some((byte) => byte !== 0)
        )
          throw new EngineError("errors.generic");
        signatures.push(encodeSignature(output.signature));
      } catch (error) {
        throw new SubmittedBatchError(
          error,
          signatures,
          errorCopy(error) === "errors.walletNo" ? null : index,
        );
      }
    }
    return signatures;
  }
  const signing = wallet.features["solana:signTransaction"];
  if (!signing)
    throw new SubmittedBatchError(
      new EngineError("wallet.unsupported"),
      [],
      null,
    );
  let signed: readonly { signedTransaction: Uint8Array }[];
  try {
    signed = await signing.signTransaction(
      ...transactions.map((transaction) => ({ transaction, account, chain })),
    );
    if (signed.length !== transactions.length)
      throw new EngineError("errors.generic");
    for (const [index, output] of signed.entries()) {
      const expected = VersionedTransaction.deserialize(transactions[index]!);
      const actual = VersionedTransaction.deserialize(output.signedTransaction);
      if (
        !sameBytes(expected.message.serialize(), actual.message.serialize()) ||
        actual.signatures.some(
          (signature) =>
            signature.length !== SIGNATURE_LENGTH_IN_BYTES ||
            !signature.some((byte) => byte !== 0),
        )
      )
        throw new EngineError("errors.generic");
    }
  } catch (error) {
    throw new SubmittedBatchError(error, [], null);
  }
  for (const [index, output] of signed.entries()) {
    try {
      const signature = await fallback(output.signedTransaction);
      if (!signature) throw new EngineError("errors.generic");
      signatures.push(signature);
    } catch (error) {
      throw new SubmittedBatchError(error, signatures, index);
    }
  }
  return signatures;
}
