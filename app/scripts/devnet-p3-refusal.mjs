// Deliberately execute an expected P3 refusal on devnet and retain its receipt.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { utils } from "@anchor-lang/core";
import { launchPriorityPrice } from "../packages/cli/dist/launch/landing.js";
import { rpc, pid, profile, journal, save } from "./devnet-session.mjs";

export function refusalCode(error) {
  const instruction = error?.InstructionError;
  return Array.isArray(instruction) && instruction[1]?.Custom;
}

export async function refuse(label, trade, expectedCode) {
  assert(label.startsWith("upgrade2/"));
  assert([6071, 6072, 6073, 6074].includes(expectedCode));
  const begin = createHash("sha256")
    .update("global:exec_begin")
    .digest()
    .subarray(0, 8);
  const instructionIndex =
    2 +
    trade.instructions.findIndex(
      (ix) => ix.programId.equals(pid) && ix.data.subarray(0, 8).equals(begin),
    );
  assert(instructionIndex >= 2, "Missing exec_begin");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        instructions: trade.instructions.map((ix) => ({
          program: String(ix.programId),
          data: ix.data.toString("base64"),
          keys: ix.keys.map(({ pubkey, isSigner, isWritable }) => ({
            address: String(pubkey),
            isSigner,
            isWritable,
          })),
        })),
        signers: trade.signers.map((signer) => String(signer.publicKey)),
      }),
    )
    .digest("hex");
  let entry = journal[label];
  if (!entry) {
    const written = [
      ...new Map(
        [
          trade.signers[0].publicKey,
          ...trade.instructions.flatMap((ix) =>
            ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey),
          ),
        ].map((k) => [String(k), k]),
      ).values(),
    ].sort((a, b) => String(a).localeCompare(String(b)));
    const price = launchPriorityPrice(
      await rpc.getRecentPrioritizationFees({
        lockedWritableAccounts: written,
      }),
      profile.maxComputeUnitPriceMicroLamports,
    );
    const latest = await rpc.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: trade.signers[0].publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({
            units: trade.options.units,
          }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
          ...trade.instructions,
        ],
      }).compileToV0Message(trade.options.tables),
    );
    assert(transaction.serialize().length <= 1232);
    const simulated = await rpc.simulateTransaction(transaction, {
      sigVerify: false,
      commitment: "confirmed",
    });
    assert.equal(
      refusalCode(simulated.value.err),
      expectedCode,
      "Unexpected simulation result; nothing signed",
    );
    transaction.sign(trade.signers);
    entry = journal[label] = {
      signature: utils.bytes.bs58.encode(transaction.signatures[0]),
      raw: Buffer.from(transaction.serialize()).toString("base64"),
      lastValidBlockHeight: latest.lastValidBlockHeight,
      expectedCode,
      microLamports: String(price),
      simulatedSlot: simulated.context.slot,
      fingerprint,
      instructionIndex,
    };
    save();
  }
  assert.equal(entry.expectedCode, expectedCode);
  assert.equal(entry.fingerprint, fingerprint);
  assert.equal(entry.instructionIndex, instructionIndex);
  for (let attempt = 0; attempt < 120; attempt++) {
    const status = (
      await rpc.getSignatureStatuses([entry.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (
      status &&
      ["confirmed", "finalized"].includes(status.confirmationStatus)
    ) {
      assert.equal(
        refusalCode(status.err),
        expectedCode,
        "Executed refusal differs from expected guard",
      );
      assert.equal(status.err.InstructionError[0], instructionIndex);
      Object.assign(entry, {
        slot: status.slot,
        finalized: status.confirmationStatus === "finalized",
        error: status.err,
      });
      save();
      console.log(
        JSON.stringify({
          label,
          signature: entry.signature,
          slot: status.slot,
          error: status.err,
        }),
      );
      return entry.signature;
    }
    if (!status) {
      assert(
        (await rpc.getBlockHeight("confirmed")) <= entry.lastValidBlockHeight,
        "Expired refusal: reconcile before retry",
      );
      const simulated = await rpc.simulateTransaction(
        VersionedTransaction.deserialize(Buffer.from(entry.raw, "base64")),
        { sigVerify: true, commitment: "confirmed" },
      );
      assert.equal(
        refusalCode(simulated.value.err),
        expectedCode,
        "Guard changed before broadcast; signed transaction not sent again",
      );
      assert.equal(simulated.value.err.InstructionError[0], instructionIndex);
      try {
        // Simulation has proved the requested error; a landed failure is the test.
        await rpc.sendRawTransaction(Buffer.from(entry.raw, "base64"), {
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch {
        /* Only these persisted signed bytes may be retried. */
      }
    }
    await delay(400);
  }
  throw Error(
    "Refusal confirmation pending; reconcile its persisted signature",
  );
}
