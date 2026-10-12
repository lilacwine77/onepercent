import * as namespace from "@anchor-lang/core";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Connection, VersionedTransactionResponse } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { verifyLandedLaunchEvidence } from "./evidence.js";
import type { LaunchAttempt } from "./send.js";

const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
function fixture() {
  const wallet = Keypair.generate();
  const mintSigner = Keypair.generate();
  const lookupTable = new AddressLookupTableAccount({
    key: key(7),
    state: {
      addresses: [key(8)],
      authority: undefined,
      deactivationSlot: (1n << 64n) - 1n,
      lastExtendedSlot: 90,
      lastExtendedSlotStartIndex: 0,
    },
  });
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: key(12).toBase58(),
      instructions: [
        new TransactionInstruction({
          programId: key(10),
          keys: [
            { pubkey: key(8), isWritable: false, isSigner: false },
            { pubkey: mintSigner.publicKey, isWritable: true, isSigner: true },
          ],
          data: Buffer.from([0]),
        }),
      ],
    }).compileToV0Message([lookupTable]),
  );
  tx.sign([wallet, mintSigner]);
  const transactions = [tx];
  const attempt: LaunchAttempt = {
    form: "single",
    signatures: transactions.map((tx) =>
      anchor.utils.bytes.bs58.encode(tx.signatures[0]!),
    ),
    encodedTransactions: transactions.map((tx) =>
      Buffer.from(tx.serialize()).toString("base64"),
    ),
    lastValidBlockHeight: 200,
  };
  const tableData = Buffer.alloc(88);
  tableData.writeUInt32LE(1);
  tableData.writeBigUInt64LE((1n << 64n) - 1n, 4);
  tableData.writeBigUInt64LE(90n, 12);
  key(8).toBuffer().copy(tableData, 56);
  const landed = transactions.map((tx) => ({
    slot: 100,
    transaction: {
      message: tx.message,
      signatures: tx.signatures.map((signature) =>
        anchor.utils.bytes.bs58.encode(signature),
      ),
    },
    meta: { err: null },
  })) as VersionedTransactionResponse[];
  const statuses = transactions.map(() => ({
    slot: 100,
    confirmations: null,
    err: null,
    confirmationStatus: "finalized" as const,
  }));
  const rpc = {
    getSignatureStatuses: vi.fn(async () => ({
      context: { slot: 101 },
      value: statuses,
    })),
    getTransaction: vi.fn(
      async (signature: string) =>
        landed[attempt.signatures.indexOf(signature)] ?? null,
    ),
    getAccountInfoAndContext: vi.fn(async () => ({
      context: { slot: 101 },
      value: {
        data: tableData,
        owner: AddressLookupTableProgram.programId,
        executable: false,
        lamports: 1,
        rentEpoch: 0,
      },
    })),
  };
  const verify = (
    changes: Partial<LaunchAttempt> = {},
    address = lookupTable.key,
  ) =>
    verifyLandedLaunchEvidence(
      rpc as unknown as Connection,
      { ...attempt, ...changes },
      address,
    );
  return {
    verify,
    rpc,
    attempt,
    transactions,
    landed,
    statuses,
    tableData,
    lookupTable,
  };
}

describe("landed launch provenance", () => {
  it("verifies the finalized message and the actual frozen launch LUT", async () => {
    const f = fixture();
    const result = await f.verify();
    expect(result.landedSlot).toBe(100);
    expect(result.lookupTable.key).toEqual(f.lookupTable.key);
    expect(f.rpc.getAccountInfoAndContext).toHaveBeenCalledWith(
      f.lookupTable.key,
      { commitment: "finalized", minContextSlot: 100 },
    );
  });
  it("does not use the status RPC processed context as a finalized read floor", async () => {
    const f = fixture();
    f.rpc.getSignatureStatuses.mockResolvedValueOnce({
      context: { slot: 135 },
      value: f.statuses,
    });
    expect(await f.verify()).toMatchObject({
      landedSlot: 100,
      observedSlot: 101,
    });
    expect(f.rpc.getAccountInfoAndContext).toHaveBeenCalledWith(
      f.lookupTable.key,
      { commitment: "finalized", minContextSlot: 100 },
    );
  });
  it("rejects an arbitrary supplied LUT despite valid chain state", async () => {
    const f = fixture();
    await expect(f.verify({}, key(99))).rejects.toThrow(
      "lookup_table_provenance",
    );
    expect(f.rpc.getAccountInfoAndContext).not.toHaveBeenCalled();
  });
  it("accepts only one published signature and one encoded transaction", async () => {
    const f = fixture();
    for (const changes of [
      { signatures: [] },
      { signatures: [...f.attempt.signatures, "another-signature"] },
      { encodedTransactions: [] },
      { encodedTransactions: [...f.attempt.encodedTransactions, "another-tx"] },
    ]) {
      await expect(f.verify(changes)).rejects.toThrow("signature_count");
    }
    expect(f.rpc.getSignatureStatuses).not.toHaveBeenCalled();
  });
  it("rejects an unsupported form from a malformed runtime journal", async () => {
    const f = fixture();
    await expect(
      f.verify({ form: "unsupported" as LaunchAttempt["form"] }),
    ).rejects.toThrow("launch_evidence_form");
    expect(f.rpc.getSignatureStatuses).not.toHaveBeenCalled();
  });
  it("rejects unavailable or unsuccessful finalized transactions", async () => {
    const f = fixture();
    f.rpc.getTransaction.mockResolvedValueOnce(null);
    await expect(f.verify()).rejects.toThrow("transaction_unavailable");
    f.landed[0]!.meta!.err = { InstructionError: [0, "InvalidArgument"] };
    await expect(f.verify()).rejects.toThrow("transaction_unavailable");
  });
  it("compares complete finalized message bytes with the signed journal", async () => {
    const f = fixture();
    const altered = VersionedTransaction.deserialize(
      Buffer.from(f.attempt.encodedTransactions[0]!, "base64"),
    );
    altered.message.recentBlockhash = key(50).toBase58();
    await expect(
      f.verify({
        encodedTransactions: [
          Buffer.from(altered.serialize()).toString("base64"),
        ],
      }),
    ).rejects.toThrow("message_mismatch");
  });
  it("compares every finalized signature, including additional signers", async () => {
    const f = fixture();
    expect(f.landed[0]!.transaction.signatures).toHaveLength(2);
    f.landed[0]!.transaction.signatures[1] = "unrelated-signature";
    await expect(f.verify()).rejects.toThrow("signatures_mismatch");
  });
  it("rejects extra table addresses that the landed transaction does not reference", async () => {
    const f = fixture();
    f.rpc.getAccountInfoAndContext.mockResolvedValueOnce({
      context: { slot: 101 },
      value: {
        data: Buffer.concat([f.tableData, key(99).toBuffer()]),
        owner: AddressLookupTableProgram.programId,
        executable: false,
        lamports: 1,
        rentEpoch: 0,
      },
    });
    await expect(f.verify()).rejects.toThrow(
      "unreferenced_or_duplicate_addresses",
    );
  });
  it("rejects incomplete status arrays and stale table reads", async () => {
    const f = fixture();
    f.rpc.getSignatureStatuses.mockResolvedValueOnce({
      context: { slot: 101 },
      value: [],
    });
    await expect(f.verify()).rejects.toThrow("not_finalized");
    f.rpc.getAccountInfoAndContext.mockResolvedValueOnce({
      context: { slot: 99 },
      value: {
        data: f.tableData,
        owner: AddressLookupTableProgram.programId,
        executable: false,
        lamports: 1,
        rentEpoch: 0,
      },
    });
    await expect(f.verify()).rejects.toThrow("account_invalid");
  });
  it.each(["mutable", "inactive", "not-warmed"])(
    "rejects %s tables",
    async (mode) => {
      const f = fixture();
      if (mode === "mutable") {
        f.tableData[21] = 1;
        key(25).toBuffer().copy(f.tableData, 22);
      }
      if (mode === "inactive") f.tableData.writeBigUInt64LE(99n, 4);
      if (mode === "not-warmed") f.tableData.writeBigUInt64LE(100n, 12);
      await expect(f.verify()).rejects.toThrow(
        mode === "not-warmed" ? "not_warmed_at_landing" : "not_frozen_active",
      );
    },
  );
});
