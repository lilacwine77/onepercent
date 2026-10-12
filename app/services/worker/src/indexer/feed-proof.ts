import { warnCause } from "@onepercent/service-kit";
import { createHash } from "node:crypto";
import { PROGRAM_IDS, PUMP_LAYOUTS } from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";
import {
  ledgerAddress,
  singletonAddress,
  TOKEN_PROGRAMS,
  vaultAddress,
} from "./accounts.js";
import { decodeInstructionData } from "./consumption.js";
import type { IndexedTransaction } from "./store.js";

// Structural wire constants from the read-only M1 draft, not economic defaults.
const FEED_DISCRIMINATOR = Buffer.from([46, 213, 237, 176, 190, 113, 182, 94]);
const FEED_DOMAIN = Buffer.from("1PCT-FEED-v1");
const MAX_FEED_BAGS = 6;
const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111";
const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111";

export type IntakeSignerEvidence =
  | { address: string; source: "current" }
  | {
      address: string;
      source: "historical";
      // The key immediately before this instruction, including earlier changes
      // in the same transaction. An end-of-slot Config snapshot is insufficient.
      position: { slot: bigint; txIndex: bigint; ixIndex: number };
    };
export interface FeedProofOptions {
  programId: string;
  /** Legacy injection accepted for callers; successful chain evidence never reads it. */
  intakeSigner?: IntakeSignerEvidence;
}
export interface FeedInstructionProof {
  ixIndex: number;
  attestationIxIndex: number;
  depositor: string;
  bags: {
    mint: string;
    amount: bigint;
    vault: string;
    ledger: string;
    tokenProgram: string;
  }[];
  nonce: number;
  expiry: bigint;
  attestationSha256: string;
  signer: string;
  evidence: "incomplete";
}

function bytes(encoded: string): Buffer {
  // Solana transaction instructions fit below this bound. Bound decoding work
  // before accepting arbitrary transport input as instruction data.
  if (encoded.length > 2_048) throw new Error("instruction_too_large");
  return decodeInstructionData(encoded);
}

function isFeed(
  instruction: IndexedTransaction["instructions"][number],
  programId: string,
): boolean {
  return (
    instruction.programId === programId &&
    bytes(instruction.data).subarray(0, 8).equals(FEED_DISCRIMINATOR)
  );
}

/**
 * Recover only the facts established by a successful, confirmed Feed. The
 * caller obtains the transaction from its confirmed RPC path. No account
 * balance, current Deck entry, or reconstructed economic event is used here.
 */
export function verifyFeedInstruction(
  transaction: IndexedTransaction,
  ixIndex: number,
  options: FeedProofOptions,
): FeedInstructionProof | null {
  try {
    if (
      transaction.err !== null ||
      !Number.isSafeInteger(ixIndex) ||
      ixIndex < 0
    )
      return null;
    const instruction = transaction.instructions[ixIndex];
    if (!instruction || !isFeed(instruction, options.programId)) return null;
    if (
      transaction.instructions.filter((candidate) =>
        isFeed(candidate, options.programId),
      ).length !== 1
    )
      return null;

    const data = bytes(instruction.data);
    if (data.length < 25) return null;
    const count = data.readUInt32LE(8);
    if (
      count < 1 ||
      count > MAX_FEED_BAGS ||
      data.length < 25 + count * 8 ||
      instruction.accounts.length !== 7 + count * 4
    )
      return null;
    const program = new PublicKey(options.programId);
    const depositor = new PublicKey(instruction.accounts[0]!);
    const owner = depositor.toBase58();
    const binder = PublicKey.findProgramAddressSync(
      [Buffer.from("binder"), depositor.toBuffer()],
      program,
    )[0].toBase58();
    const fixedAccounts = [
      owner,
      singletonAddress(options.programId, "config"),
      singletonAddress(options.programId, "machine"),
      singletonAddress(options.programId, "deck"),
      binder,
      INSTRUCTIONS_SYSVAR,
      PublicKey.default.toBase58(),
    ];
    if (
      fixedAccounts.some(
        (account, index) => instruction.accounts[index] !== account,
      )
    )
      return null;

    const bags: FeedInstructionProof["bags"] = [];
    const bagBytes: Buffer[] = [];
    for (let index = 0; index < count; index++) {
      const mint = new PublicKey(instruction.accounts[7 + index * 4]!);
      const mintAddress = mint.toBase58();
      const vault = instruction.accounts[8 + index * 4]!;
      const ledger = instruction.accounts[9 + index * 4]!;
      const curve = PublicKey.findProgramAddressSync(
        [Buffer.from(PUMP_LAYOUTS.bondingCurveSeed), mint.toBuffer()],
        new PublicKey(PROGRAM_IDS.pumpFun),
      )[0].toBase58();
      const amountBytes = data.subarray(12 + index * 8, 20 + index * 8);
      const amount = amountBytes.readBigUInt64LE();
      const tokenProgram = TOKEN_PROGRAMS.find(
        (candidate) =>
          vaultAddress(options.programId, mintAddress, candidate) === vault,
      );
      if (
        amount === 0n ||
        bags.some((bag) => bag.mint === mintAddress) ||
        ledger !== ledgerAddress(options.programId, mintAddress) ||
        instruction.accounts[10 + index * 4] !== curve ||
        !tokenProgram
      )
        return null;
      // Match M1's prior_transfer: a preceding TransferChecked for this exact
      // owner, mint, vault and amount. Its successful token program execution
      // establishes the source account authority and mint decimals.
      const transferred = transaction.instructions
        .slice(0, ixIndex)
        .some((candidate) => {
          if (candidate.programId !== tokenProgram) return false;
          const transfer = bytes(candidate.data);
          return (
            transfer.length === 10 &&
            transfer[0] === 12 &&
            transfer.readBigUInt64LE(1) === amount &&
            candidate.accounts[1] === mintAddress &&
            candidate.accounts[2] === vault &&
            candidate.accounts[3] === owner
          );
        });
      if (!transferred) return null;
      bags.push({ mint: mintAddress, amount, vault, ledger, tokenProgram });
      bagBytes.push(mint.toBuffer(), amountBytes);
    }

    const tailOffset = 12 + count * 8;
    const expiry = data.readBigInt64LE(tailOffset);
    const nonce = data.readUInt32LE(tailOffset + 8);
    const attestationIxIndex = data[tailOffset + 12]!;
    const attestation = transaction.instructions[attestationIxIndex];
    if (!attestation || attestation.programId !== ED25519_PROGRAM) return null;
    const attestationData = bytes(attestation.data);
    if (
      attestationData.length < 16 ||
      attestationData[0] !== 1 ||
      [4, 8, 14].some(
        (offset) => attestationData.readUInt16LE(offset) !== 65_535,
      )
    )
      return null;
    const signatureOffset = attestationData.readUInt16LE(2);
    const publicKeyOffset = attestationData.readUInt16LE(6);
    const messageOffset = attestationData.readUInt16LE(10);
    const messageLength = attestationData.readUInt16LE(12);
    // Match M1 checks/ed25519.rs exactly. The native precompile already
    // succeeded in this transaction; M1 allows later att_ix, overlapping
    // ranges and offsets in the header. Revalidating a narrower layout would
    // discard valid consumption. A current Config key cannot establish the
    // key used at this instruction after a later rotation.
    if (
      signatureOffset + 64 > attestationData.length ||
      publicKeyOffset + 32 > attestationData.length ||
      messageOffset + messageLength > attestationData.length
    )
      return null;
    const expectedMessage = Buffer.concat([
      FEED_DOMAIN,
      program.toBuffer(),
      depositor.toBuffer(),
      data.subarray(tailOffset + 8, tailOffset + 12),
      data.subarray(tailOffset, tailOffset + 8),
      Buffer.from([count]),
      createHash("sha256").update(Buffer.concat(bagBytes)).digest(),
    ]);
    const message = attestationData.subarray(
      messageOffset,
      messageOffset + messageLength,
    );
    const publicKey = attestationData.subarray(
      publicKeyOffset,
      publicKeyOffset + 32,
    );
    if (!message.equals(expectedMessage)) return null;
    return {
      ixIndex,
      attestationIxIndex,
      depositor: owner,
      bags,
      nonce,
      expiry,
      attestationSha256: createHash("sha256").update(message).digest("hex"),
      signer: new PublicKey(publicKey).toBase58(),
      evidence: "incomplete",
    };
  } catch (error) {
    warnCause("indexer_feed_proof_invalid", error);
    return null;
  }
}

export function findFeedInstructionProofs(
  transaction: IndexedTransaction,
  options: FeedProofOptions,
): FeedInstructionProof[] {
  return transaction.instructions.flatMap((_, ixIndex) => {
    const proof = verifyFeedInstruction(transaction, ixIndex, options);
    return proof ? [proof] : [];
  });
}
