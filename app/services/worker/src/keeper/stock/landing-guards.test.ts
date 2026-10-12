import { expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  type VersionedTransaction,
} from "@solana/web3.js";
import { TxSender } from "@onepercent/service-kit";
import type { SignedTxRecord, TxJournal, TxRpc } from "@onepercent/service-kit";
import { stockBuyGuardRefusal } from "./landing.js";

const guards = [
  [6071, "stock_buy_pull_in_flight"],
  [6072, "stock_buy_reveal_delay"],
  [6073, "stock_buy_listing_notice"],
  [6074, "stock_buy_reserve"],
] as const;

it.each(guards)(
  "classifies P3 refusal %i without relying on transport text",
  (code, reason) => {
    expect(
      stockBuyGuardRefusal({ InstructionError: [2, { Custom: code }] }),
    ).toEqual({ code, reason });
    expect(stockBuyGuardRefusal(`custom program error: ${code}`)).toBeNull();
    expect(stockBuyGuardRefusal(new Error(String(code)))).toBeNull();
  },
);

it.each([
  null,
  "BlockhashNotFound",
  { InstructionError: [2, { Custom: 6075 }] },
  { InstructionError: [2, { Custom: "6071" }] },
  { InstructionError: [-1, { Custom: 6071 }] },
  { Custom: 6071 },
])("does not classify unrelated or malformed refusal %j", (error) => {
  expect(stockBuyGuardRefusal(error)).toBeNull();
});

it.each(guards)(
  "replans proven refusal %i after finality without retrying its signed bytes",
  async (code, reason) => {
    const key = Keypair.generate();
    let signed: SignedTxRecord | null = null;
    let attempts = 0;
    let finalized = false;
    const journal: TxJournal = {
      read: async () => signed,
      write: async (_job, record) => {
        signed = record;
      },
      reserveAttempt: async () => ++attempts,
    };
    const err = { InstructionError: [2, { Custom: code }] };
    const rpc = {
      getLatestBlockhash: vi.fn(async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 100,
      })),
      getRecentPrioritizationFees: async () => [],
      simulateTransaction: async () => ({ err: null }),
      sendRawTransaction: vi.fn(async () => signed!.signature),
      getSignatureStatuses: vi.fn(async () => [
        {
          err,
          confirmationStatus: finalized
            ? ("finalized" as const)
            : ("confirmed" as const),
        },
      ]),
      getBlockHeight: async () => 99,
    } satisfies TxRpc;
    const signTransaction = vi.fn((tx: VersionedTransaction) => tx.sign([key]));
    const options = {
      rpc,
      signer: { publicKey: key.publicKey, signTransaction },
      journal,
      role: "keeper" as const,
      assertAuthorized() {},
      assertLeader() {},
      sendMaxAttempts: 2,
      backoffBaseMs: 1,
      backoffMaxMs: 1,
      cuMarginBps: 2000,
      maxComputeUnitPriceMicroLamports: 3n,
      sleep: async () => {},
    };
    const replan = vi.fn(async () => null);
    const request = {
      job: `guard-${code}`,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: key.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
      computeUnitLimit: 20000,
      isComplete: async () => false,
      rebuild: replan,
    };
    await expect(new TxSender(options).send(request)).rejects.toThrow(
      "transaction_pending",
    );
    expect(replan).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);

    // A confirmed refusal can disappear with its fork. Only finalized evidence
    // permits replacement, including when a new leader resumes this journal.
    finalized = true;
    expect(await new TxSender(options).send(request)).toMatchObject({
      status: "skipped",
    });
    expect(replan).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "failed",
        previous: expect.objectContaining({
          status: "failed",
          finalized: true,
        }),
      }),
    );
    expect(stockBuyGuardRefusal(err)).toEqual({ code, reason });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.getLatestBlockhash).toHaveBeenCalledTimes(1);
  },
);
