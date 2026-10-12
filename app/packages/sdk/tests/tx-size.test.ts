import { PROGRAM_ID } from "./program-id.js";
import { createPrivateKey, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  AddressLookupTableAccount,
  Keypair,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { BPS_DENOMINATOR, DRAW_TAGS, TX_LIMITS } from "@onepercent/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildBuyPacksTransaction,
  buildRedeemTransactions,
  buildRefundTransaction,
  buildSettleTransaction,
  buildTakeBackTransactions,
  configPda,
  deckPda,
  EXTERNAL_IDS,
  feedMessage,
  feedTransactionInstructions,
  FEED_BYTE_BUDGET,
  machinePda,
  MEMO_PROGRAM_ID,
  planFeedTransactions,
  serializedSize,
  transaction,
  userAta,
  vaultAuthPda,
} from "../src/index.js";
import type {
  BuiltTransaction,
  PlannedFeedBag,
  SettleInput,
} from "../src/index.js";
const measured: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.SDK_TX_REPORT)
    writeFileSync(
      process.env.SDK_TX_REPORT,
      JSON.stringify(measured, null, 2) + "\n",
    );
});
const payer = Keypair.generate();
const intake = Keypair.generate();
const key = () => Keypair.generate().publicKey;
const blockhash = key().toBase58();
const base = { wallet: payer.publicKey, blockhash };
function signature(message: Uint8Array): Buffer {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(intake.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, message, privateKey);
}
function bag(vaultExists = false): PlannedFeedBag {
  const mint = key();
  return {
    mint,
    amount: 1000n,
    tokenProgram: EXTERNAL_IDS.splToken,
    source: userAta(payer.publicKey, mint, EXTERNAL_IDS.splToken),
    decimals: 6,
    vaultExists,
    closeSource: true,
  };
}
const lut = new AddressLookupTableAccount({
  key: key(),
  state: {
    deactivationSlot: (1n << 64n) - 1n,
    lastExtendedSlot: 0,
    lastExtendedSlotStartIndex: 0,
    addresses: [
      configPda(PROGRAM_ID)[0],
      machinePda(PROGRAM_ID)[0],
      deckPda(PROGRAM_ID)[0],
      vaultAuthPda(PROGRAM_ID)[0],
      SystemProgram.programId,
      SYSVAR_INSTRUCTIONS_PUBKEY,
    ],
  },
});
function actualSize(tx: BuiltTransaction): number {
  if (tx instanceof Transaction) {
    tx.sign(payer);
    return tx.serialize().length;
  }
  tx.sign([payer]);
  return tx.serialize().length;
}
function programInstructions(tx: BuiltTransaction): number {
  if (tx instanceof Transaction)
    return tx.instructions.filter((ix) => ix.programId.equals(PROGRAM_ID))
      .length;
  return tx.message.compiledInstructions.filter((ix) =>
    tx.message.staticAccountKeys[ix.programIdIndex]?.equals(PROGRAM_ID),
  ).length;
}
describe("SDK transaction byte budgets", () => {
  it("includes signature slots and prints the full Feed packing matrix", async () => {
    const table: Record<string, string | number | boolean>[] = [];
    for (const lookup of [false, true])
      for (const vaultExists of [false, true])
        for (const computeBudget of [false, true]) {
          const bags = Array.from({ length: 6 }, () => bag(vaultExists));
          let max = 0;
          for (let n = 1; n <= 6; n++) {
            const options = {
              ...base,
              lut: lookup ? lut : undefined,
              computeBudget,
              priorityFeeMicroLamports: computeBudget ? 1n : undefined,
              bags: bags.slice(0, n),
              intakeSigner: intake.publicKey,
              nonce: 0,
              attestation: {
                expiry: 2000000000n,
                signature: new Uint8Array(64),
              },
            };
            const tx = transaction(
              options,
              feedTransactionInstructions(PROGRAM_ID, options),
            );
            const size = serializedSize(tx);
            table.push({
              kind: "feed",
              format: lookup ? "v0" : "legacy",
              vaultExists,
              computeBudget,
              bags: n,
              bytes: size,
            });
            if (size <= FEED_BYTE_BUDGET) max = n;
            if (size <= TX_LIMITS.maxTxBytes) expect(actualSize(tx)).toBe(size);
          }
          expect(max).toBeGreaterThan(0);
          const plans = await planFeedTransactions(PROGRAM_ID, {
            ...base,
            lut: lookup ? lut : undefined,
            computeBudget,
            priorityFeeMicroLamports: computeBudget ? 1n : undefined,
            bags,
            intakeSigner: intake.publicKey,
            nonceBase: 20,
            nonceBits: 0b10,
            attest: ({ bags, nonce, wallet }) => {
              const expiry = 2000000000n;
              return {
                expiry,
                signature: signature(
                  feedMessage({
                    programId: PROGRAM_ID,
                    wallet,
                    bags,
                    nonce,
                    expiry,
                  }),
                ),
              };
            },
          });
          expect(
            plans.map((p) => p.bags.length).reduce((a, b) => a + b, 0),
          ).toBe(6);
          expect(new Set(plans.map((p) => p.nonce)).size).toBe(plans.length);
          expect(plans.some((p) => p.nonce === 21)).toBe(false);
          for (const p of plans) {
            expect(serializedSize(p.transaction)).toBeLessThanOrEqual(
              FEED_BYTE_BUDGET,
            );
            expect(actualSize(p.transaction)).toBe(
              serializedSize(p.transaction),
            );
            expect(programInstructions(p.transaction)).toBe(1);
          }
        }
    expect(FEED_BYTE_BUDGET).toBe(
      Math.floor(
        (TX_LIMITS.maxTxBytes * (BPS_DENOMINATOR - TX_LIMITS.byteHeadroomBps)) /
          BPS_DENOMINATOR,
      ),
    );
    measured.feed = table;
    expect(
      Math.max(
        ...table
          .filter(
            (row) =>
              row.format === "legacy" && Number(row.bytes) <= FEED_BYTE_BUDGET,
          )
          .map((row) => Number(row.bags)),
      ),
    ).toBe(TX_LIMITS.feedBagsPerTx);
    expect(
      Math.max(
        ...table
          .filter(
            (row) =>
              row.format === "v0" && Number(row.bytes) <= FEED_BYTE_BUDGET,
          )
          .map((row) => Number(row.bags)),
      ),
    ).toBe(TX_LIMITS.feedBagsPerTxWithLookupTable);
    console.table(table);
  }, 90_000);
  it("packs take-back and Redeem in descending index order, at most eight and within the wire maximum", () => {
    const entries = Array.from({ length: 19 }, (_, i) => ({
      ...bag(),
      deckIndex: i,
    }));
    const takeBack = buildTakeBackTransactions(PROGRAM_ID, {
      ...base,
      entries,
    });
    const redeems = buildRedeemTransactions(PROGRAM_ID, {
      ...base,
      cards: entries.map((e) => ({ ...e, cardIndex: e.deckIndex })),
    });
    const table = [];
    for (const [kind, transactions] of [
      ["takeBack", takeBack],
      ["redeem", redeems],
    ] as const) {
      const indexes: number[] = [];
      for (const tx of transactions) {
        expect(tx).toBeInstanceOf(Transaction);
        const raw = tx as Transaction;
        const actions = raw.instructions.filter((ix) =>
          ix.programId.equals(PROGRAM_ID),
        );
        expect(actions.length).toBeLessThanOrEqual(8);
        indexes.push(
          ...actions.map((ix) =>
            kind === "takeBack"
              ? ix.data.readUInt32LE(8)
              : ix.data.readUInt16LE(8),
          ),
        );
        expect(actualSize(tx)).toBe(serializedSize(tx));
        expect(serializedSize(tx)).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
        table.push({ kind, count: actions.length, bytes: serializedSize(tx) });
      }
      expect(indexes).toEqual(Array.from({ length: 19 }, (_, i) => 18 - i));
    }
    measured.exits = table;
    console.table(table);
  }, 30_000);
  it("lands eight same-mint Redeem instructions in one transaction and creates its ATA once", () => {
    const item = bag();
    const txs = buildRedeemTransactions(PROGRAM_ID, {
      ...base,
      cards: Array.from({ length: 8 }, (_, i) => ({ ...item, cardIndex: i })),
    });
    expect(txs.length).toBe(1);
    const tx = txs[0] as Transaction;
    expect(programInstructions(tx)).toBe(8);
    expect(
      tx.instructions.filter((ix) =>
        ix.programId.equals(EXTERNAL_IDS.associatedToken),
      ).length,
    ).toBe(1);
    measured.redeemSameMint8 = actualSize(tx);
    expect(actualSize(tx)).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
  });
  it("fits two settled packs, and BuyPacks with and without HOLD", () => {
    const buyer = { address: payer.publicKey, executable: false };
    const pull = key();
    const referrer = { address: key(), executable: false };
    const packs: SettleInput[] = Array.from({ length: 2 }, (_, pack) => ({
      pull,
      seq: 7n,
      pack,
      buyer,
      referrer,
      wallets: Array.from({ length: 4 }, () => ({
        address: key(),
        executable: false,
      })) as unknown as SettleInput["wallets"],
    }));
    const txs = [
      buildSettleTransaction(PROGRAM_ID, { ...base, packs }),
      buildRefundTransaction(PROGRAM_ID, { ...base, pull, seq: 7n, buyer }),
      ...[false, true].map((hold) =>
        buildBuyPacksTransaction(PROGRAM_ID, {
          ...base,
          edition: 0,
          qty: 10,
          pullNonce: 0,
          oracleQueue: key(),
          hold: hold
            ? {
                expiry: 2000000000n,
                signature: new Uint8Array(64),
                signer: intake.publicKey,
              }
            : undefined,
        }),
      ),
    ];
    const names = ["settle2", "refund", "buy10", "buy10Hold"];
    measured.other = txs.map((tx, i) => ({
      kind: names[i],
      bytes: serializedSize(tx),
    }));
    console.table(measured.other);
    for (const tx of txs) {
      expect(actualSize(tx)).toBe(serializedSize(tx));
      expect(serializedSize(tx)).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
    }
  });
  it("measures signed Settle shapes with full-width sequence Memos and distinct Pull payees", () => {
    const table: {
      packs: number;
      pulls: number;
      independentBuyers: boolean;
      sequenceDigits: number;
      priorityFee: boolean;
      format: string;
      memos: number;
      bytes: number;
    }[] = [];
    for (const [packCount, distinctPulls] of [
      [1, false],
      [2, false],
      [2, true],
    ] as const)
      for (const independentBuyers of [false, true])
        for (const fullWidthSequence of [false, true])
          for (const priorityFee of [false, true])
            for (const lookup of [false, true]) {
              const pull = key();
              const sharedBuyer = {
                address: independentBuyers ? key() : payer.publicKey,
                executable: false,
              };
              const sharedReferrer = { address: key(), executable: false };
              const firstSeq = fullWidthSequence ? (1n << 64n) - 3n : 7n;
              const packs: SettleInput[] = Array.from(
                { length: packCount },
                (_, index) => ({
                  pull: distinctPulls ? key() : pull,
                  seq: firstSeq + (distinctPulls ? BigInt(index) : 0n),
                  pack: distinctPulls ? 0 : index,
                  buyer:
                    distinctPulls && independentBuyers
                      ? { address: key(), executable: false }
                      : sharedBuyer,
                  referrer:
                    distinctPulls && independentBuyers
                      ? { address: key(), executable: false }
                      : sharedReferrer,
                  wallets: Array.from({ length: 4 }, () => ({
                    address: key(),
                    executable: false,
                  })) as unknown as SettleInput["wallets"],
                }),
              );
              const tx = buildSettleTransaction(PROGRAM_ID, {
                ...base,
                packs,
                lut: lookup ? lut : undefined,
                priorityFeeMicroLamports: priorityFee ? 1n : undefined,
              });
              const memos =
                tx instanceof Transaction
                  ? tx.instructions
                      .filter((ix) => ix.programId.equals(MEMO_PROGRAM_ID))
                      .map((ix) => ix.data.toString("utf8"))
                  : tx.message.compiledInstructions
                      .filter((ix) =>
                        tx.message.staticAccountKeys[ix.programIdIndex]?.equals(
                          MEMO_PROGRAM_ID,
                        ),
                      )
                      .map((ix) => Buffer.from(ix.data).toString("utf8"));
              const sequences = [...new Set(packs.map((pack) => pack.seq))];
              expect(memos).toEqual(
                sequences.map((seq) => `${DRAW_TAGS.royaltyMemoPrefix}${seq}`),
              );
              const actualBytes = actualSize(tx);
              expect(actualBytes).toBe(serializedSize(tx));
              expect(actualBytes).toBeLessThanOrEqual(TX_LIMITS.maxTxBytes);
              table.push({
                packs: packCount,
                pulls: distinctPulls ? packCount : 1,
                independentBuyers,
                sequenceDigits: firstSeq.toString().length,
                priorityFee,
                format: lookup ? "v0" : "legacy",
                memos: memos.length,
                bytes: actualBytes,
              });
            }
    expect(table).toHaveLength(48);
    measured.settle = table;
    measured.settleMaxima = table.filter(
      (row) => row.sequenceDigits === 20 && row.priorityFee,
    );
    console.table(measured.settleMaxima);
  }, 90_000);
});
