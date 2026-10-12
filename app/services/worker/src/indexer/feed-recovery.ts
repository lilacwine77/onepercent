import { warnCause } from "@onepercent/service-kit";
import { decodeInstructionData, resolveConsumption } from "./consumption.js";
import {
  verifyFeedInstruction,
  type FeedInstructionProof,
  type IntakeSignerEvidence,
} from "./feed-proof.js";
import type {
  IndexedEvent,
  IndexedTransaction,
  SqlExecutor,
  StoreOptions,
} from "./store.js";

export const RECOVERED_FEED = "IndexerFeedRecovered";
const FEED = Buffer.from([46, 213, 237, 176, 190, 113, 182, 94]);
export type IntakeSignerResolver = (
  tx: IndexedTransaction,
  ixIndex: number,
) => Promise<IntakeSignerEvidence>;

/** Recovery is ordered with the original transaction, without requiring a still-live bag. */
export async function prepareFeedRecovery(
  tx: IndexedTransaction,
  options: StoreOptions,
): Promise<FeedInstructionProof[]> {
  if (tx.err !== null || !tx.truncated) return [];
  const proofs: FeedInstructionProof[] = [];
  for (const [ixIndex, ix] of tx.instructions.entries()) {
    if (ix.programId !== options.programId) continue;
    let data: Buffer;
    try {
      if (ix.data.length > 2_048) throw new Error("instruction_too_large");
      data = decodeInstructionData(ix.data);
    } catch (error) {
      warnCause("indexer_feed_recovery_incomplete", error);
      await options.alert?.("indexer_feed_recovery_incomplete", {
        signature: tx.signature,
        ixIndex,
        reason: "invalid_instruction_data",
      });
      continue;
    }
    if (!data.subarray(0, 8).equals(FEED)) continue;
    const count = data.length >= 12 ? data.readUInt32LE(8) : 0;
    const logged = tx.events.filter(
      (event) =>
        (event.name === "BagFed" || event.name === RECOVERED_FEED) &&
        event.ixIndex === BigInt(ixIndex),
    );
    if (
      count > 0 &&
      count <= 6 &&
      logged.length === count &&
      Array.from(
        { length: count },
        (_, index) =>
          data.length >= 20 + index * 8 &&
          logged.some(
            (event) =>
              event.data.depositor === ix.accounts[0] &&
              event.data.mint === ix.accounts[7 + index * 4] &&
              String(event.data.amount) ===
                String(data.readBigUInt64LE(12 + index * 8)),
          ),
      ).every(Boolean)
    )
      continue;
    const proof = verifyFeedInstruction(tx, ixIndex, {
      programId: options.programId,
    });
    if (!proof) {
      await options.alert?.("indexer_feed_recovery_incomplete", {
        signature: tx.signature,
        ixIndex,
        reason: "unreadable_feed_evidence",
      });
      continue;
    }
    proofs.push(proof);
  }
  return proofs;
}

export async function recoveredFeedEvents(
  sql: SqlExecutor,
  tx: IndexedTransaction,
  proofs: FeedInstructionProof[],
  options: StoreOptions,
): Promise<IndexedEvent[]> {
  const events: IndexedEvent[] = [];
  for (const proof of proofs) {
    for (const [index, bag] of proof.bags.entries()) {
      if (
        tx.events.some(
          (event) =>
            (event.name === "BagFed" || event.name === RECOVERED_FEED) &&
            event.ixIndex === BigInt(proof.ixIndex) &&
            event.data.depositor === proof.depositor &&
            event.data.mint === bag.mint &&
            String(event.data.amount) === String(bag.amount),
        )
      )
        continue;
      const event: IndexedEvent = {
        name: RECOVERED_FEED,
        ixIndex: BigInt(proof.ixIndex),
        // Negative ordinals are reserved for internal evidence, never real log events or SSE IDs.
        eventIndex: BigInt(index - proof.bags.length),
        data: {
          depositor: proof.depositor,
          mint: bag.mint,
          amount: String(bag.amount),
        },
      };
      const resolved = await resolveConsumption(sql, tx, event, {
        ...options,
        proof,
      });
      event.data._indexer = {
        ...resolved.provenance,
        intakeLogMissing: resolved.missing,
        evidence: proof.evidence,
        signer: proof.signer,
        nonce: proof.nonce,
        expiry: String(proof.expiry),
        attestationIxIndex: proof.attestationIxIndex,
        vault: bag.vault,
        ledger: bag.ledger,
        tokenProgram: bag.tokenProgram,
      };
      events.push(event);
    }
  }
  return events;
}
