import { createDeploymentSelector } from "../src/deployment.js";
import { PROGRAM_ID } from "./program-id.js";
import { createPrivateKey, sign, verify } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Ed25519Program,
  Keypair,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionMessage,
} from "@solana/web3.js";
import { CU_LIMITS, TX_LIMITS } from "@onepercent/config";
import { BorshInstructionCoder } from "../src/anchor.js";
import type { Idl } from "@anchor-lang/core";
import idl from "../src/idl/onepercent.json" with { type: "json" };
import { sellBackMessage } from "../src/attest.js";
import { programError } from "../src/errors.js";
import { EXTERNAL_IDS, MAX_FEED_BACK_CARDS } from "../src/constants.js";
import {
  binderPda,
  configPda,
  deckPda,
  ledgerPda,
  machinePda,
  vaultAta,
} from "../src/pda.js";
import {
  buildCloseBinderTransaction,
  buildWithdrawOwedTransaction,
} from "../src/tx/binder.js";
import { buildFeedBackTransactions } from "../src/tx/feedback.js";
import { buildSellBackTransaction } from "../src/tx/sellback.js";
import { serializedSize } from "../src/tx/index.js";
import type { BuiltTransaction } from "../src/tx/index.js";

const payer = Keypair.generate();
const quoteSigner = Keypair.generate();
const mint = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();
const base = { wallet: payer.publicKey, blockhash };
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(quoteSigner.secretKey.subarray(0, 32)),
  ]),
  format: "der",
  type: "pkcs8",
});
const coder = new BorshInstructionCoder(idl as Idl);
const lut = new AddressLookupTableAccount({
  key: Keypair.generate().publicKey,
  state: {
    deactivationSlot: (1n << 64n) - 1n,
    lastExtendedSlot: 0,
    lastExtendedSlotStartIndex: 0,
    addresses: [
      configPda(PROGRAM_ID)[0],
      machinePda(PROGRAM_ID)[0],
      deckPda(PROGRAM_ID)[0],
      binderPda(PROGRAM_ID, payer.publicKey)[0],
      mint,
      ledgerPda(PROGRAM_ID, mint)[0],
      vaultAta(PROGRAM_ID, mint, EXTERNAL_IDS.splToken),
      SystemProgram.programId,
      SYSVAR_INSTRUCTIONS_PUBKEY,
    ],
  },
});
const measured: Record<string, number>[] = [];
afterAll(() => {
  if (process.env.M2_TX_REPORT)
    writeFileSync(
      process.env.M2_TX_REPORT,
      JSON.stringify(measured, null, 2) + "\n",
    );
});
function instructions(tx: BuiltTransaction) {
  return tx instanceof Transaction
    ? tx.instructions
    : TransactionMessage.decompile(tx.message, {
        addressLookupTableAccounts: [lut],
      }).instructions;
}
function actualSize(tx: BuiltTransaction): number {
  if (tx instanceof Transaction) tx.sign(payer);
  else tx.sign([payer]);
  const size = tx.serialize().length;
  expect(size).toBe(serializedSize(tx));
  expect(size).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
  return size;
}
function sellOptions(count: number) {
  const cards = Array.from({ length: count }, (_, index) => ({
    index: count - index - 1,
    amount: BigInt(1000 + index),
  }));
  const quote = {
    ...base,
    mint,
    tokenProgram: EXTERNAL_IDS.splToken,
    cards,
    quoteLamports: 50_000_000n,
    expiry: 1_800_000_000n,
    nonce: 7,
    quoteSigner: quoteSigner.publicKey,
  };
  const message = sellBackMessage({
    programId: PROGRAM_ID,
    ...quote,
    owner: payer.publicKey,
    totalAmount: cards.reduce((sum, card) => sum + card.amount, 0n),
  });
  return { ...quote, signature: sign(null, message, privateKey) };
}

describe("My cards transactions", () => {
  it("binds all four builders and the signed quote to the selected cluster", () => {
    const select = createDeploymentSelector({
      localnet: PROGRAM_ID,
      devnet: Keypair.generate().publicKey,
    });
    for (const cluster of ["localnet", "devnet"]) {
      const programId = select(cluster).programId;
      const quote = sellOptions(1);
      const message = sellBackMessage({
        ...quote,
        programId,
        owner: payer.publicKey,
        totalAmount: 1000n,
      });
      const txs = [
        buildSellBackTransaction(programId, {
          ...quote,
          signature: sign(null, message, privateKey),
        }),
        ...buildFeedBackTransactions(programId, { ...base, cardIndices: [0] }),
        buildWithdrawOwedTransaction(programId, base),
        buildCloseBinderTransaction(programId, base),
      ];
      for (const tx of txs) {
        const ix = instructions(tx).at(-1)!;
        expect(ix.programId.equals(programId)).toBe(true);
        expect(
          ix.keys.some((key) =>
            key.pubkey.equals(binderPda(programId, payer.publicKey)[0]),
          ),
        ).toBe(true);
      }
      const attestation = instructions(txs[0]!).find((ix) =>
        ix.programId.equals(Ed25519Program.programId),
      )!;
      expect(
        attestation.data.subarray(attestation.data.readUInt16LE(10)),
      ).toEqual(message);
    }
  });

  it("maps either exit's rent refusal to the existing payee copy", () => {
    for (const instruction of ["close_binder", "withdraw_owed"])
      expect(programError({ name: "PayeeBelowRent" }, { instruction })).toEqual(
        {
          name: "PayeeBelowRent",
          copyKey: "payeeBelowRent",
        },
      );
  });
  it("preserves a signed quote with exact Ed25519 index for every budget form", () => {
    for (const computeBudget of [false, true])
      for (const priorityFeeMicroLamports of [undefined, 1n])
        for (const lookup of [undefined, lut])
          for (const count of [1, 8]) {
            const options = {
              ...sellOptions(count),
              computeBudget,
              priorityFeeMicroLamports,
              lut: lookup,
            };
            const tx = buildSellBackTransaction(PROGRAM_ID, options);
            const ixs = instructions(tx);
            const attIx = ixs.findIndex((ix) =>
              ix.programId.equals(Ed25519Program.programId),
            );
            const sb = ixs.at(-1)!;
            const decoded = coder.decode(sb.data)!;
            expect(decoded.name).toBe("sell_back");
            expect((decoded.data as { att_ix: number }).att_ix).toBe(attIx);
            expect(
              ixs.filter((ix) => ix.programId.equals(PROGRAM_ID)),
            ).toHaveLength(1);
            const data = ixs[attIx]!.data;
            const signatureOffset = data.readUInt16LE(2);
            const messageOffset = data.readUInt16LE(10);
            const messageLength = data.readUInt16LE(12);
            const signedMessage = data.subarray(
              messageOffset,
              messageOffset + messageLength,
            );
            expect(
              verify(
                null,
                signedMessage,
                privateKey,
                data.subarray(signatureOffset, signatureOffset + 64),
              ),
            ).toBe(true);
            expect(signedMessage).toEqual(
              sellBackMessage({
                programId: PROGRAM_ID,
                ...options,
                owner: payer.publicKey,
                totalAmount: options.cards.reduce(
                  (sum, card) => sum + card.amount,
                  0n,
                ),
              }),
            );
            if (computeBudget) {
              expect(
                ixs[0]!.programId.equals(ComputeBudgetProgram.programId),
              ).toBe(true);
              expect(ixs[0]!.data.readUInt32LE(1)).toBe(
                count === 1 ? CU_LIMITS.sellBack.x1 : CU_LIMITS.sellBack.x8,
              );
            } else expect(attIx).toBe(0);
            measured.push({
              kind: 0,
              cards: count,
              v0: Number(Boolean(lookup)),
              budget: Number(computeBudget),
              priority: Number(priorityFeeMicroLamports !== undefined),
              bytes: actualSize(tx),
            });
          }
  });

  it("never changes signed order or splits a Sell back quote", () => {
    const options = sellOptions(8);
    options.cards.reverse();
    expect(() => buildSellBackTransaction(PROGRAM_ID, options)).toThrow(
      "descending",
    );
    expect(() =>
      buildSellBackTransaction(
        PROGRAM_ID,
        sellOptions(1 + TX_LIMITS.redeemPerTx),
      ),
    ).toThrow();
  });

  it("sorts Feed back indices globally and chunks at eight without mutating input", () => {
    expect(MAX_FEED_BACK_CARDS).toBe(8);
    expect(MAX_FEED_BACK_CARDS).toBe(TX_LIMITS.redeemPerTx);
    const indices = Array.from({ length: 19 }, (_, i) => i);
    for (const lookup of [undefined, lut]) {
      const txs = buildFeedBackTransactions(PROGRAM_ID, {
        ...base,
        cardIndices: indices,
        lut: lookup,
        priorityFeeMicroLamports: 1n,
      });
      expect(txs).toHaveLength(3);
      const batches = txs.map((tx) => {
        actualSize(tx);
        const ixs = instructions(tx);
        expect(
          ixs.filter((ix) => ix.programId.equals(PROGRAM_ID)),
        ).toHaveLength(1);
        const decoded = coder.decode(ixs.at(-1)!.data)!;
        expect(decoded.name).toBe("feed_back");
        return (decoded.data as { card_indices: number[] }).card_indices;
      });
      expect(batches.map((batch) => batch.length)).toEqual([8, 8, 3]);
      expect(batches.flat()).toEqual([...indices].reverse());
    }
    expect(indices).toEqual(Array.from({ length: 19 }, (_, i) => i));
    expect(
      buildFeedBackTransactions(PROGRAM_ID, { ...base, cardIndices: [] }),
    ).toEqual([]);
    for (const cardIndices of [[1, 1], [-1], [65536], [1.1]])
      expect(() =>
        buildFeedBackTransactions(PROGRAM_ID, { ...base, cardIndices }),
      ).toThrow();
  });

  it("measures Feed back and composes both exits with only owner and Binder", () => {
    for (const lookup of [undefined, lut])
      for (const count of [1, 8]) {
        const [tx] = buildFeedBackTransactions(PROGRAM_ID, {
          ...base,
          lut: lookup,
          priorityFeeMicroLamports: 1n,
          cardIndices: Array.from({ length: count }, (_, i) => i),
        });
        measured.push({
          kind: 1,
          cards: count,
          v0: Number(Boolean(lookup)),
          budget: 1,
          priority: 1,
          bytes: actualSize(tx!),
        });
      }
    for (const [name, build, units] of [
      ["close_binder", buildCloseBinderTransaction, CU_LIMITS.closeBinder],
      ["withdraw_owed", buildWithdrawOwedTransaction, CU_LIMITS.withdrawOwed],
    ] as const)
      for (const lookup of [undefined, lut]) {
        const tx = build(PROGRAM_ID, {
          ...base,
          lut: lookup,
          priorityFeeMicroLamports: 1n,
        });
        const ixs = instructions(tx);
        const exit = ixs.at(-1)!;
        expect(coder.decode(exit.data)!.name).toBe(name);
        expect(ixs[0]!.data.readUInt32LE(1)).toBe(units);
        expect(exit.keys).toEqual([
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          {
            pubkey: binderPda(PROGRAM_ID, payer.publicKey)[0],
            isSigner: false,
            isWritable: true,
          },
        ]);
        measured.push({
          kind: name === "close_binder" ? 2 : 3,
          v0: Number(Boolean(lookup)),
          budget: 1,
          priority: 1,
          bytes: actualSize(tx),
        });
      }
  });
});
