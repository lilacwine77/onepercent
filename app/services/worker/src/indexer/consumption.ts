import { warnCause } from "@onepercent/service-kit";
import { createHash } from "node:crypto";
import { attestationBagsSchema, type JsonObject } from "@onepercent/db";
import type { IndexedEvent, IndexedTransaction, SqlExecutor } from "./store.js";
import type { FeedInstructionProof } from "./feed-proof.js";

const ED25519 = "Ed25519SigVerify111111111111111111111111111";
const FEED_DISCRIMINATOR = Buffer.from([46, 213, 237, 176, 190, 113, 182, 94]);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decodeInstructionData(encoded: string): Buffer {
  let value = 0n;
  for (const char of encoded) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new Error("invalid_instruction_base58");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value & 255n));
    value >>= 8n;
  }
  for (const char of encoded) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

export type Provenance = {
  holder: string;
  path: "self" | "hop" | "unknown";
  attestationSha256: string | null;
};
export type ProvenanceFallback = (input: {
  depositor: string;
  mint: string;
  amount: string;
  slot: bigint;
  signature: string;
}) => Promise<{ path: "self" | "hop"; via: string | null } | null>;
export type IndexerAlert = (key: string, payload: JsonObject) => Promise<void>;

// Follow the Feed's explicit att_ix. An unrelated valid Ed25519 instruction is not evidence.
export function feedMessageHash(
  transaction: IndexedTransaction,
  event: IndexedEvent,
  programId: string,
): string | null {
  try {
    const instruction = transaction.instructions[Number(event.ixIndex)];
    if (!instruction || instruction.programId !== programId) return null;
    const feed = decodeInstructionData(instruction.data);
    if (feed.length < 25 || !feed.subarray(0, 8).equals(FEED_DISCRIMINATOR))
      return null;
    const bags = feed.readUInt32LE(8);
    const attIndexOffset = 12 + bags * 8 + 8 + 4;
    if (attIndexOffset >= feed.length) return null;
    const attIndex = feed[attIndexOffset]!;
    const att = transaction.instructions[attIndex];
    if (!att || att.programId !== ED25519) return null;
    const data = decodeInstructionData(att.data);
    if (data.length < 16 || data[0] !== 1) return null;
    // M1 accepts only self-contained offsets (u16::MAX).
    if ([4, 8, 14].some((offset) => data.readUInt16LE(offset) !== 65535))
      return null;
    const signatureOffset = data.readUInt16LE(2);
    const publicKeyOffset = data.readUInt16LE(6);
    const messageOffset = data.readUInt16LE(10);
    const messageLength = data.readUInt16LE(12);
    if (
      signatureOffset + 64 > data.length ||
      publicKeyOffset + 32 > data.length ||
      messageOffset + messageLength > data.length
    )
      return null;
    return createHash("sha256")
      .update(data.subarray(messageOffset, messageOffset + messageLength))
      .digest("hex");
  } catch (error) {
    warnCause("indexer_attestation_decode_failed", error);
    return null;
  }
}

export async function resolveConsumption(
  sql: SqlExecutor,
  transaction: IndexedTransaction,
  event: IndexedEvent,
  options: {
    programId: string;
    recomputeProvenance?: ProvenanceFallback;
    proof?: FeedInstructionProof;
  },
): Promise<{ provenance: Provenance; missing: boolean }> {
  const depositor = String(event.data.depositor);
  const mint = String(event.data.mint);
  const amount = String(event.data.amount);
  const hash =
    options.proof?.attestationSha256 ??
    feedMessageHash(transaction, event, options.programId);
  if (hash) {
    const result = await sql.query(
      "SELECT wallet, bags, signer, nonce, expiry FROM attestation_log WHERE message_sha256 = $1 AND kind = 'FEED'",
      [hash],
    );
    const row = result.rows[0];
    const parsed = attestationBagsSchema.safeParse(row?.bags);
    const proof = options.proof;
    const proofMatches =
      !proof ||
      (row?.signer === proof.signer &&
        String(row?.nonce) === String(proof.nonce) &&
        new Date(String(row?.expiry)).getTime() ===
          Number(proof.expiry) * 1000 &&
        parsed.success &&
        parsed.data.length === proof.bags.length &&
        parsed.data.every(
          (bag, index) =>
            bag.mint === proof.bags[index]?.mint &&
            bag.amount === String(proof.bags[index]?.amount),
        ));
    if (row?.wallet === depositor && parsed.success && proofMatches) {
      const bag = parsed.data.find(
        (candidate) => candidate.mint === mint && candidate.amount === amount,
      );
      if (
        bag &&
        ((bag.path === "self" && bag.via === null) ||
          (bag.path === "hop" && typeof bag.via === "string"))
      ) {
        return {
          provenance: {
            holder: bag.path === "hop" ? bag.via! : depositor,
            path: bag.path,
            attestationSha256: hash,
          },
          missing: false,
        };
      }
    }
  }

  let recovered: Awaited<ReturnType<ProvenanceFallback>> = null;
  try {
    recovered =
      (await options.recomputeProvenance?.({
        depositor,
        mint,
        amount,
        slot: transaction.slot,
        signature: transaction.signature,
      })) ?? null;
  } catch (error) {
    warnCause("indexer_provenance_unavailable", error);
    // Missing S2 historical evidence leaves an explicit unknown record.
  }
  const known =
    recovered &&
    ((recovered.path === "self" && recovered.via === null) ||
      (recovered.path === "hop" && typeof recovered.via === "string"));
  return {
    provenance: {
      holder: known && recovered?.path === "hop" ? recovered.via! : depositor,
      path: known && recovered ? recovered.path : "unknown",
      attestationSha256: hash,
    },
    missing: true,
  };
}
