import { describe, expect, it } from "vitest";
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Keypair,
  PACKET_DATA_SIZE,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { WEB } from "@onepercent/config";
import { buildTransaction, checkTransaction } from "../../src/tx/engine/build";

function transaction() {
  const payer = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey;
  const tx = buildTransaction({
    wallet: payer,
    blockhash: {
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 150,
    },
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: recipient,
        lamports: 1n,
      }),
    ],
    computeUnits: 200_000,
    recentPriorityFees: [NaN, -1, Number.MAX_SAFE_INTEGER],
  });
  const allowed = new Set([
    SystemProgram.programId.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
  ]);
  return { payer, recipient, tx, allowed };
}

describe("transaction checks before wallet prompts", () => {
  it("prepends compute budget and caps the sampled priority price", () => {
    const { tx } = transaction();
    expect(
      ComputeBudgetInstruction.decodeSetComputeUnitLimit(tx.instructions[0]!),
    ).toEqual({ units: 200_000 });
    expect(
      ComputeBudgetInstruction.decodeSetComputeUnitPrice(tx.instructions[1]!),
    ).toEqual({ microLamports: BigInt(WEB.priorityFeeCapMicroLamports) });
    expect(tx.instructions[2]!.programId.equals(SystemProgram.programId)).toBe(
      true,
    );
  });
  it("rejects an unexpected program, additional signer or different payer", () => {
    const { tx, payer, recipient, allowed } = transaction();
    expect(() =>
      checkTransaction(tx, payer, allowed, PACKET_DATA_SIZE),
    ).not.toThrow();
    expect(() =>
      checkTransaction(tx, recipient, allowed, PACKET_DATA_SIZE),
    ).toThrow("Unexpected transaction signer");
    tx.add(
      new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: [],
        data: Buffer.alloc(0),
      }),
    );
    expect(() =>
      checkTransaction(tx, payer, allowed, PACKET_DATA_SIZE),
    ).toThrow("Unexpected transaction program");
    const extra = transaction();
    extra.tx.add(
      new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [{ pubkey: recipient, isSigner: true, isWritable: true }],
        data: Buffer.alloc(0),
      }),
    );
    expect(() =>
      checkTransaction(extra.tx, extra.payer, extra.allowed, PACKET_DATA_SIZE),
    ).toThrow("Unexpected transaction signer");
  });
  it("measures serialized bytes with the signature slot and enforces the chosen bound", () => {
    const { tx, payer, allowed } = transaction();
    const bytes = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length;
    expect(() => checkTransaction(tx, payer, allowed, bytes)).not.toThrow();
    expect(() => checkTransaction(tx, payer, allowed, bytes - 1)).toThrow(
      "Transaction too large",
    );
    expect(() => checkTransaction(tx, payer, allowed, NaN)).toThrow(
      "Invalid transaction size limit",
    );
    expect(() =>
      checkTransaction(tx, payer, allowed, PACKET_DATA_SIZE + 1),
    ).toThrow("Invalid transaction size limit");
  });
  it("never accepts a large message hidden behind absent signatures", () => {
    const { tx, payer, allowed } = transaction();
    tx.add(
      new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [],
        data: Buffer.alloc(PACKET_DATA_SIZE),
      }),
    );
    expect(() =>
      checkTransaction(tx, payer, allowed, PACKET_DATA_SIZE),
    ).toThrow();
  });
});
