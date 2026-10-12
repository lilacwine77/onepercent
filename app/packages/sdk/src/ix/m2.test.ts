import { PROGRAM_ID } from "../../tests/program-id.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { ATTESTATIONS, TX_LIMITS } from "@onepercent/config";
import { describe, expect, it } from "vitest";
import type { Idl } from "@anchor-lang/core";
import { BN, BorshInstructionCoder } from "../anchor.js";
import idl from "../idl/onepercent.json" with { type: "json" };
import { sellBackMessage } from "../attest.js";
import {
  BUCKET_NONE,
  EXEC_KIND,
  EXTERNAL_IDS,
  MAX_FEED_BACK_CARDS,
  MAX_SELL_BACK_CARDS,
} from "../constants.js";
import type { ExecKind } from "../constants.js";
import { decodeMachine, encodeMachine } from "../layouts.js";
import {
  binderPda,
  configPda,
  deckPda,
  ledgerPda,
  machinePda,
  userAta,
  vaultAta,
  vaultAuthPda,
} from "../pda.js";
import { execBeginIx } from "./execBegin.js";
import { execEndIx } from "./execEnd.js";
import { sellBackIx } from "./sellBack.js";
import { feedBackIx } from "./feedBack.js";
import { withdrawOwedIx } from "./withdrawOwed.js";
import { closeBinderIx } from "./closeBinder.js";

const key = (value: number) => new PublicKey(new Uint8Array(32).fill(value));
const coder = new BorshInstructionCoder(idl as Idl);
function decimalArgs(value: unknown): unknown {
  if (value instanceof BN) return value.toString(10);
  if (Array.isArray(value)) return value.map(decimalArgs);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [name, decimalArgs(child)]),
    );
  return value;
}
const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../fixtures/vectors/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
interface IxVector {
  name: string;
  args: {
    kind?: ExecKind;
    bucket?: number;
    amount?: string;
    cards?: { index: number; amount: string }[];
    quote_lamports?: string;
    expiry?: string;
    nonce?: number;
    att_ix?: number;
    card_indices?: number[];
  };
  data: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}
interface AttestVector {
  kind: string;
  programId: string;
  owner: string;
  mint: string;
  cards: { index: number; amount: string }[];
  totalAmount: string;
  quoteLamports: string;
  expiry: string;
  nonce: number;
  message: string;
  sha256: string;
}

describe("M2 interface", () => {
  const vectors = fixture<IxVector[]>("ix").filter((item) =>
    [
      "exec_begin",
      "exec_end",
      "sell_back",
      "feed_back",
      "withdraw_owed",
      "close_binder",
    ].includes(item.name),
  );
  it.each(vectors)(
    "matches the $name golden bytes and ordered account privileges",
    (vector) => {
      const args = vector.args;
      let ix: TransactionInstruction;
      switch (vector.name) {
        case "exec_begin":
          ix = execBeginIx(PROGRAM_ID, {
            signer: key(1),
            mint: key(4),
            tokenProgram: EXTERNAL_IDS.token2022,
            kind: args.kind!,
            bucket: args.bucket!,
            amount: BigInt(args.amount!),
            oracles: [key(10), key(11), key(12), key(13)],
          });
          break;
        case "exec_end":
          ix = execEndIx(PROGRAM_ID, {
            signer: key(1),
            mint: key(4),
            tokenProgram: EXTERNAL_IDS.token2022,
            kind: args.kind!,
          });
          break;
        case "sell_back":
          ix = sellBackIx(PROGRAM_ID, {
            owner: key(1),
            mint: key(5),
            tokenProgram: EXTERNAL_IDS.token2022,
            cards: args.cards!.map((card) => ({
              index: card.index,
              amount: BigInt(card.amount),
            })),
            quoteLamports: BigInt(args.quote_lamports!),
            expiry: BigInt(args.expiry!),
            nonce: args.nonce!,
            attIx: args.att_ix!,
          });
          break;
        case "feed_back":
          ix = feedBackIx(PROGRAM_ID, {
            owner: key(1),
            cardIndices: args.card_indices!,
          });
          break;
        case "withdraw_owed":
          ix = withdrawOwedIx(PROGRAM_ID, { owner: key(1) });
          break;
        default:
          ix = closeBinderIx(PROGRAM_ID, { owner: key(1) });
      }
      expect(ix.data.toString("hex")).toBe(vector.data);
      const decoded = coder.decode(ix.data);
      expect(decoded?.name).toBe(vector.name);
      expect(decimalArgs(decoded?.data)).toEqual(vector.args);
      const solDestIndex =
        vector.name === "exec_begin" ? 8 : vector.name === "exec_end" ? 7 : -1;
      if (solDestIndex >= 0)
        expect(vector.accounts[solDestIndex]!.isWritable).toBe(false);
      expect(
        ix.keys.map(({ isSigner, isWritable }) => ({ isSigner, isWritable })),
      ).toEqual(
        vector.accounts.map(({ isSigner, isWritable }, index) => ({
          isSigner,
          isWritable:
            index === solDestIndex
              ? args.kind === EXEC_KIND.stockSell
              : isWritable,
        })),
      );
    },
  );

  it.each([EXTERNAL_IDS.splToken, EXTERNAL_IDS.token2022])(
    "derives canonical exec accounts for %s and every kind",
    (tokenProgram) => {
      const signer = key(1);
      const mint = key(4);
      const oracles = [
        key(10),
        key(11),
        key(12),
        SystemProgram.programId,
      ] as const;
      for (const kind of [
        EXEC_KIND.stockBuy,
        EXEC_KIND.stockSell,
        EXEC_KIND.burn,
        EXEC_KIND.jackpotBuy,
      ]) {
        const isSell = kind === EXEC_KIND.stockSell;
        const solDest = isSell
          ? vaultAta(PROGRAM_ID, NATIVE_MINT, EXTERNAL_IDS.splToken)
          : SystemProgram.programId;
        const common = { signer, mint, tokenProgram, kind };
        const begin = execBeginIx(PROGRAM_ID, {
          ...common,
          bucket: kind >= EXEC_KIND.burn ? BUCKET_NONE : 0,
          amount: 1n,
          oracles,
        });
        const end = execEndIx(PROGRAM_ID, common);
        expect(begin.keys.map((meta) => meta.pubkey)).toEqual([
          signer,
          configPda(PROGRAM_ID)[0],
          machinePda(PROGRAM_ID)[0],
          mint,
          ledgerPda(PROGRAM_ID, mint)[0],
          vaultAta(PROGRAM_ID, mint, tokenProgram),
          vaultAuthPda(PROGRAM_ID)[0],
          userAta(
            signer,
            isSell ? mint : NATIVE_MINT,
            isSell ? tokenProgram : EXTERNAL_IDS.splToken,
          ),
          solDest,
          ...oracles,
          tokenProgram,
          EXTERNAL_IDS.splToken,
          SYSVAR_INSTRUCTIONS_PUBKEY,
        ]);
        expect(end.keys.map((meta) => meta.pubkey)).toEqual([
          signer,
          configPda(PROGRAM_ID)[0],
          machinePda(PROGRAM_ID)[0],
          mint,
          ledgerPda(PROGRAM_ID, mint)[0],
          vaultAta(PROGRAM_ID, mint, tokenProgram),
          vaultAuthPda(PROGRAM_ID)[0],
          solDest,
          tokenProgram,
          EXTERNAL_IDS.splToken,
          SystemProgram.programId,
        ]);
        for (const meta of [begin.keys[8], end.keys[7]])
          expect(meta).toEqual({
            pubkey: solDest,
            isSigner: false,
            isWritable: isSell,
          });
        for (const ix of [begin, end]) {
          const sentinels = ix.keys.filter((meta) =>
            meta.pubkey.equals(SystemProgram.programId),
          );
          expect(sentinels.length).toBeGreaterThan(0);
          expect(
            sentinels.every((meta) => !meta.isSigner && !meta.isWritable),
          ).toBe(true);
        }
      }
    },
  );

  it("keeps My cards accounts minimal and token-free", () => {
    const owner = key(1);
    const mint = key(5);
    const tokenProgram = EXTERNAL_IDS.token2022;
    expect(
      sellBackIx(PROGRAM_ID, {
        owner,
        mint,
        tokenProgram,
        cards: [{ index: 3, amount: 1000n }],
        quoteLamports: 5_000_000n,
        expiry: 1_800_000_000n,
        nonce: 0,
        attIx: 0,
      }).keys.map((meta) => meta.pubkey),
    ).toEqual([
      owner,
      configPda(PROGRAM_ID)[0],
      machinePda(PROGRAM_ID)[0],
      binderPda(PROGRAM_ID, owner)[0],
      mint,
      ledgerPda(PROGRAM_ID, mint)[0],
      vaultAta(PROGRAM_ID, mint, tokenProgram),
      SYSVAR_INSTRUCTIONS_PUBKEY,
    ]);
    expect(
      feedBackIx(PROGRAM_ID, { owner, cardIndices: [3] }).keys.map(
        (meta) => meta.pubkey,
      ),
    ).toEqual([
      owner,
      configPda(PROGRAM_ID)[0],
      machinePda(PROGRAM_ID)[0],
      deckPda(PROGRAM_ID)[0],
      binderPda(PROGRAM_ID, owner)[0],
      SystemProgram.programId,
    ]);
    for (const ix of [
      withdrawOwedIx(PROGRAM_ID, { owner }),
      closeBinderIx(PROGRAM_ID, { owner }),
    ]) {
      expect(ix.keys.map((meta) => meta.pubkey)).toEqual([
        owner,
        binderPda(PROGRAM_ID, owner)[0],
      ]);
      expect(ix.keys.every((meta) => meta.isWritable)).toBe(true);
      expect(ix.keys.map((meta) => meta.isSigner)).toEqual([true, false]);
    }
  });

  it("bounds batches and rejects unsorted or repeated indices without sorting", () => {
    for (const indices of [
      [],
      [0, 1],
      [1, 1],
      [-1],
      [65536],
      [1.5],
      Array.from({ length: 9 }, (_, i) => 9 - i),
    ]) {
      expect(() =>
        feedBackIx(PROGRAM_ID, { owner: key(1), cardIndices: indices }),
      ).toThrow(RangeError);
      expect(() =>
        sellBackIx(PROGRAM_ID, {
          owner: key(1),
          mint: key(2),
          tokenProgram: EXTERNAL_IDS.splToken,
          cards: indices.map((index) => ({ index, amount: 1n })),
          quoteLamports: 1n,
          expiry: 0n,
          nonce: 0,
          attIx: 0,
        }),
      ).toThrow(RangeError);
    }
  });

  it("keeps structural card limits equal to the configured transaction bound", () => {
    expect(MAX_SELL_BACK_CARDS).toBe(TX_LIMITS.redeemPerTx);
    expect(MAX_FEED_BACK_CARDS).toBe(TX_LIMITS.redeemPerTx);
  });

  it("rejects invalid integer widths before Anchor can encode their magnitude", () => {
    const begin = {
      signer: key(1),
      mint: key(2),
      tokenProgram: EXTERNAL_IDS.splToken,
      kind: EXEC_KIND.stockBuy,
      bucket: 0,
      amount: 1n,
      oracles: [
        key(3),
        key(4),
        SystemProgram.programId,
        SystemProgram.programId,
      ] as const,
    };
    for (const amount of [-1n, 1n << 64n])
      expect(() => execBeginIx(PROGRAM_ID, { ...begin, amount })).toThrow(
        RangeError,
      );
    for (const bucket of [-1, 256, 1.5])
      expect(() => execBeginIx(PROGRAM_ID, { ...begin, bucket })).toThrow(
        RangeError,
      );
    for (const kind of [-1, 256, 1.5]) {
      expect(() =>
        execBeginIx(PROGRAM_ID, { ...begin, kind: kind as ExecKind }),
      ).toThrow(RangeError);
      expect(() =>
        execEndIx(PROGRAM_ID, { ...begin, kind: kind as ExecKind }),
      ).toThrow(RangeError);
    }
    const sellBack = {
      owner: key(1),
      mint: key(2),
      tokenProgram: EXTERNAL_IDS.splToken,
      cards: [{ index: 0, amount: 1n }],
      quoteLamports: 1n,
      expiry: 0n,
      nonce: 0,
      attIx: 0,
    };
    for (const amount of [-1n, 1n << 64n])
      expect(() =>
        sellBackIx(PROGRAM_ID, { ...sellBack, cards: [{ index: 0, amount }] }),
      ).toThrow(RangeError);
    for (const override of [
      { quoteLamports: -1n },
      { quoteLamports: 1n << 64n },
      { expiry: 1n << 63n },
      { expiry: -(1n << 63n) - 1n },
      { nonce: -1 },
      { nonce: 0x1_0000_0000 },
      { attIx: -1 },
      { attIx: 256 },
    ])
      expect(() =>
        sellBackIx(PROGRAM_ID, { ...sellBack, ...override }),
      ).toThrow(RangeError);
  });

  it("carves only the reserved bytes while retaining all existing Machine values", () => {
    const oldBytes = encodeMachine({ next_seq: 23n, stock_sol: 456n });
    const data = Buffer.from(oldBytes);
    data.writeBigInt64LE(-1n, 2576);
    data.writeBigUInt64LE(123n, 2584);
    data.writeBigUInt64LE(456n, 2592);
    data.writeBigUInt64LE((1n << 64n) - 1n, 2600);
    data.writeBigUInt64LE(789n, 224 + 120);
    data.writeBigUInt64LE(1001n, 2496 + 72);
    data.fill(0xa5, 2608);
    const decoded = decodeMachine(data);
    expect(decoded.next_seq).toBe(23n);
    expect(decoded.stock_sol).toBe(456n);
    expect(decoded.last_stock_trade_ts).toBe(-1n);
    expect(decoded.stock_hour_index).toBe(123n);
    expect(decoded.stock_bought_hour).toBe(456n);
    expect(decoded.stock_sold_hour).toBe((1n << 64n) - 1n);
    expect(decoded.buckets[0]!.trend_sold_hour).toBe(789n);
    expect(decoded.exec.aux).toBe(1001n);
    expect(encodeMachine(decoded)).toEqual(data);
    expect(data.length).toBe(3808);
    expect(decoded._reserved0.length + decoded._reserved1.length).toBe(728);
    expect(decoded.token_mint.toBuffer()).toEqual(Buffer.alloc(32, 0xa5));
  });
});

describe("Sell back attestation ABI", () => {
  const vectors = fixture<AttestVector[]>("attest").filter(
    (item) => item.kind === "sell_back",
  );
  it.each(vectors)(
    "encodes nonce $nonce with the recorded digest $sha256",
    (vector) => {
      const message = sellBackMessage({
        programId: new PublicKey(vector.programId),
        owner: new PublicKey(vector.owner),
        mint: new PublicKey(vector.mint),
        cards: vector.cards.map((card) => ({
          index: card.index,
          amount: BigInt(card.amount),
        })),
        totalAmount: BigInt(vector.totalAmount),
        quoteLamports: BigInt(vector.quoteLamports),
        expiry: BigInt(vector.expiry),
        nonce: vector.nonce,
      });
      expect(message.toString("hex")).toBe(vector.message);
      expect(message.length).toBe(135 + 10 * vector.cards.length);
      expect(createHash("sha256").update(message).digest("hex")).toBe(
        vector.sha256,
      );
      expect(
        message.subarray(0, ATTESTATIONS.sellBackDomain.length).toString(),
      ).toBe(ATTESTATIONS.sellBackDomain);
    },
  );

  const input = {
    programId: PublicKey.default,
    owner: key(1),
    mint: key(2),
    cards: [{ index: 3, amount: 1000n }],
    totalAmount: 1000n,
    quoteLamports: 5_000_000n,
    expiry: 1_800_000_000n,
    nonce: 0,
  };
  it("matches both published M2 checks", () => {
    const one = sellBackMessage(input);
    expect(one.length).toBe(145);
    expect(createHash("sha256").update(one).digest("hex")).toBe(
      "edf53101d7a0071b005cdae28d29e6ddbe17c9e9ab59d57efa7df9455d8b501c",
    );
    const eight = sellBackMessage({
      ...input,
      cards: Array.from({ length: 8 }, (_, k) => ({
        index: 7 - k,
        amount: 1000n + BigInt(k),
      })),
      totalAmount: 8028n,
      nonce: 7,
    });
    expect(eight.length).toBe(215);
    expect(createHash("sha256").update(eight).digest("hex")).toBe(
      "53fec985a265aeaa8eeeecc3d254da20f4d224c6c9cb3d63c87c4ca439676c76",
    );
  });

  it("rejects count/order/total mismatches and every encoded integer overflow", () => {
    for (const cards of [
      [],
      [
        { index: 1, amount: 500n },
        { index: 2, amount: 500n },
      ],
      [
        { index: 1, amount: 500n },
        { index: 1, amount: 500n },
      ],
      Array.from({ length: 9 }, (_, k) => ({ index: 9 - k, amount: 1n })),
      [{ index: 65536, amount: 1000n }],
      [{ index: 3, amount: -1n }],
      [{ index: 3, amount: 1n << 64n }],
    ])
      expect(() => sellBackMessage({ ...input, cards })).toThrow(RangeError);
    for (const override of [
      { totalAmount: 1001n },
      { quoteLamports: -1n },
      { quoteLamports: 1n << 64n },
      { expiry: 1n << 63n },
      { expiry: -(1n << 63n) - 1n },
      { nonce: -1 },
      { nonce: 0x1_0000_0000 },
    ])
      expect(() => sellBackMessage({ ...input, ...override })).toThrow(
        RangeError,
      );
    const max = (1n << 64n) - 1n;
    expect(() =>
      sellBackMessage({
        ...input,
        cards: [
          { index: 1, amount: max },
          { index: 0, amount: 1n },
        ],
        totalAmount: max + 1n,
      }),
    ).toThrow(RangeError);
  });
});
