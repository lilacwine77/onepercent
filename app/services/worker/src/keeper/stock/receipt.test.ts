import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { VersionedTransactionResponse } from "@solana/web3.js";
import type { SignedTxRecord } from "@onepercent/service-kit";
import { execBeginIx, execEndIx } from "@onepercent/sdk";
import { expect, it } from "vitest";
import { assertStockReceipt } from "./receipt.js";
import { fixture } from "./testing.js";

it.each([
  "truncated",
  "missing",
  "signature",
  "message",
  "program",
  "failed",
  "reversed",
])(
  "binds a %s receipt to the signed message and expected program independently of logs",
  (mode) => {
    const f = fixture(),
      signer = Keypair.generate();
    const instructions = [
      execBeginIx(f.state.deployment.programId, f.args),
      execEndIx(f.state.deployment.programId, f.args),
    ];
    if (mode === "reversed") instructions.reverse();
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions,
      }).compileToV0Message(),
    );
    tx.sign([signer]);
    // TxSender validates signatures before this helper; test message binding here.
    const signature = "validated-signature";
    const record: SignedTxRecord = {
      fingerprint: "a".repeat(64),
      signature,
      transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
      lastValidBlockHeight: 100,
      status: "signed",
    };
    const message = VersionedTransaction.deserialize(tx.serialize()).message;
    if (mode === "message")
      message.recentBlockhash = signer.publicKey.toBase58();
    const receipt = {
      transaction: {
        message,
        signatures: [mode === "signature" ? "other-signature" : signature],
      },
      meta: {
        err:
          mode === "failed"
            ? { InstructionError: [0, "InvalidArgument"] }
            : null,
        logMessages: mode === "missing" ? null : ["Log truncated"],
      },
    } as unknown as VersionedTransactionResponse;
    const check = () =>
      assertStockReceipt(
        record,
        receipt,
        mode === "program" ? PublicKey.default : f.state.deployment.programId,
      );
    if (mode === "truncated" || mode === "missing") expect(check).not.toThrow();
    else expect(check).toThrow(/stock_receipt_/);
  },
);
