import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  binderHeaderLayout,
  decodeBinder,
  cardLayout,
  configLayout,
  machineLayout,
  sellBackMessage,
} from "@onepercent/sdk";
import { M2_PROVISIONAL_EVENT_IDL } from "@onepercent/sdk/events";
import { SellBackQuoteResponse } from "@onepercent/sdk/api";
import { identifyCards, type Binder } from "../adapters/cards";
import { createCardActions } from "./card-actions";
import type { WalletSession } from "../wallet/session";

const mocks = vi.hoisted(() => ({
  binder: vi.fn(),
  account: vi.fn(),
  machine: vi.fn(),
  api: vi.fn(),
  execute: vi.fn(),
  prepareSettles: vi.fn(),
  runSettles: vi.fn(),
}));
vi.mock("../data/chain", () => ({
  readBinder: mocks.binder,
  readBinderAccount: mocks.account,
  readMachine: mocks.machine,
}));
vi.mock("../data/api", () => ({ api: mocks.api }));
vi.mock("./runtime", () => ({ executeTransactions: mocks.execute }));
vi.mock("./settle", () => ({
  prepareSettles: mocks.prepareSettles,
  runSettles: mocks.runSettles,
}));
vi.mock("@onepercent/sdk/rescue", async (original) => ({
  ...(await original<typeof import("@onepercent/sdk/rescue")>()),
  readMints: async (_rpc: unknown, mints: PublicKey[]) =>
    mints.map((address) => ({
      address,
      tokenProgram: TOKEN_PROGRAM_ID,
      decimals: 6,
    })),
}));

const owner = new PublicKey(new Uint8Array(32).fill(1));
const signer = new PublicKey(new Uint8Array(32).fill(2));
const mints = [3, 4, 5].map((n) => new PublicKey(new Uint8Array(32).fill(n)));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("My cards controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareSettles.mockResolvedValue({ groups: [], feeLamports: 0n });
    mocks.runSettles.mockResolvedValue(undefined);
  });
  it("preserves approved mint groups through swap-remove and quotes each execution with its new nonce", async () => {
    const cards = Array.from({ length: 32 }, (_, seq_lo) => {
      const bytes = binderHeaderLayout.encode();
      cardLayout.write(bytes, 0, {
        mint: mints[seq_lo % mints.length]!,
        amount: 1n,
        value: 50_000_000n,
        kind: 1,
        seq_lo,
      });
      return cardLayout.read(bytes, 0);
    });
    let binder: Binder = {
      ...decodeBinder(binderHeaderLayout.encode({ owner })),
      cards,
      len: cards.length,
    };
    const config = configLayout.decode(
      configLayout.encode({ quote_signer: signer }),
    );
    const machine = machineLayout.decode(
      machineLayout.encode({ phase: 3, end_ts: 1_000n }),
    );
    mocks.binder.mockImplementation(async () => binder);
    mocks.account.mockImplementation(async () => ({
      binder,
      lamports: 1_000_000n,
      dataLength: 100,
    }));
    mocks.machine.mockResolvedValue({ config, machine, nowTs: 100n });
    const quoted: { seqs: number[]; nonce: number }[] = [];
    let latestIndices: number[] = [];
    mocks.api.mockImplementation(async (_route, _schema, init) => {
      const { cardIndices } = JSON.parse(init.body) as {
        cardIndices: number[];
      };
      latestIndices = cardIndices;
      const selected = cardIndices.map((index) => ({
        index,
        ...binder.cards[index]!,
      }));
      const quoteLamports = selected.reduce(
        (sum, card) => sum + card.value,
        0n,
      );
      const totalAmount = selected.reduce((sum, card) => sum + card.amount, 0n);
      const expiry = 150n;
      const message = sellBackMessage({
        programId: PROGRAM_ID,
        owner,
        mint: selected[0]!.mint,
        cards: selected,
        totalAmount,
        quoteLamports,
        expiry,
        nonce: binder.sb_nonce,
      });
      quoted.push({
        seqs: selected.map((card) => card.seq_lo).sort((a, b) => a - b),
        nonce: binder.sb_nonce,
      });
      return SellBackQuoteResponse.parse({
        ok: true,
        asOfSlot: 1,
        quote: {
          owner: owner.toBase58(),
          mint: selected[0]!.mint.toBase58(),
          cards: selected.map(({ index, amount }) => ({
            index,
            amount: `${amount}`,
          })),
          totalAmount: `${totalAmount}`,
          quoteLamports: `${quoteLamports}`,
          stockedValueLamports: `${quoteLamports}`,
          valueLamports: `${quoteLamports}`,
          payoutLamports: `${(quoteLamports * 8_700n) / 10_000n}`,
          expiry: Number(expiry),
          nonce: binder.sb_nonce,
          bucketClass: "MAJOR",
          message: b64(message),
          signature: b64(new Uint8Array(64).fill(1)),
          signer: signer.toBase58(),
          router: "fixture",
          requestId: "fixture",
        },
      });
    });
    mocks.execute.mockImplementation(async ({ items }) => {
      for (const item of items) {
        await item.build({ blockhash: PublicKey.default.toBase58() });
        const remaining = [...binder.cards];
        for (const index of latestIndices) {
          const last = remaining.pop()!;
          if (index < remaining.length) remaining[index] = last;
        }
        binder = {
          ...binder,
          cards: remaining,
          len: remaining.length,
          sb_nonce: binder.sb_nonce + 1,
        };
      }
      return { phase: "done" };
    });
    const rpc = {
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
      }),
      getFeeForMessage: async () => ({ value: 5_000 }),
    } as unknown as Connection;
    const session = {
      snapshot: () => ({
        generation: 1,
        wallet: {},
        account: { address: owner.toBase58() },
      }),
    } as unknown as WalletSession;
    const actions = createCardActions({
      rpc,
      session,
      chain: "solana:devnet",
      flags: () => ({ sell: true, feed: true }),
    });
    const ids = identifyCards(binder.cards).map((card) => card.cardId);
    const preview = await actions.preview("sell_back", ids);
    expect(preview?.gate).toBeUndefined();
    const approved = [...quoted];
    expect(approved).toHaveLength(6);
    expect(approved.every((q) => q.nonce === 0)).toBe(true);
    await expect(actions.execute("sell_back", ids)).resolves.toEqual({
      receivedLamports: 1_392_000_000n,
    });
    const executed = quoted.slice(approved.length);
    expect(executed.map((q) => q.seqs)).toEqual(approved.map((q) => q.seqs));
    expect(executed.map((q) => q.nonce)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(binder.cards).toHaveLength(0);
    await expect(actions.execute("sell_back", ids)).rejects.toEqual({
      message: { key: "errors.cardMoved", vars: undefined },
    });
  });
  it("rejects an already expired Sell approval before any optional settlement signature", async () => {
    const bytes = Buffer.alloc(cardLayout.size);
    cardLayout.write(bytes, 0, {
      mint: mints[0]!,
      amount: 1n,
      value: 50_000_000n,
      kind: 1,
      seq_lo: 1,
    });
    const card = cardLayout.read(bytes, 0);
    const binder = {
      ...decodeBinder(binderHeaderLayout.encode({ owner })),
      cards: [card],
      len: 1,
    };
    const config = configLayout.decode(
      configLayout.encode({ quote_signer: signer }),
    );
    const machine = machineLayout.decode(
      machineLayout.encode({ phase: 3, end_ts: 1000n }),
    );
    let nowTs = 100n;
    mocks.binder.mockResolvedValue(binder);
    mocks.account.mockResolvedValue({
      binder,
      lamports: 1_000_000n,
      dataLength: 100,
    });
    mocks.machine.mockImplementation(async () => ({ config, machine, nowTs }));
    const expiry = 150n;
    const selected = [{ index: 0, ...card }];
    mocks.api.mockResolvedValue(
      SellBackQuoteResponse.parse({
        ok: true,
        asOfSlot: 1,
        quote: {
          owner: owner.toBase58(),
          mint: mints[0]!.toBase58(),
          cards: [{ index: 0, amount: "1" }],
          totalAmount: "1",
          quoteLamports: "50000000",
          stockedValueLamports: "50000000",
          valueLamports: "50000000",
          payoutLamports: "43500000",
          expiry: Number(expiry),
          nonce: 0,
          bucketClass: "MAJOR",
          message: b64(
            sellBackMessage({
              programId: PROGRAM_ID,
              owner,
              mint: mints[0]!,
              cards: selected,
              totalAmount: 1n,
              quoteLamports: 50_000_000n,
              expiry,
              nonce: 0,
            }),
          ),
          signature: b64(new Uint8Array(64).fill(1)),
          signer: signer.toBase58(),
          router: "fixture",
          requestId: "fixture",
        },
      }),
    );
    mocks.prepareSettles.mockResolvedValue({
      groups: [{ pull: mints[1]!.toBase58(), seq: 2n, indices: [0] }],
      feeLamports: 5000n,
    });
    const rpc = {
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
      }),
      getFeeForMessage: async () => ({ value: 5000 }),
    } as unknown as Connection;
    const session = {
      snapshot: () => ({
        generation: 1,
        wallet: {},
        account: { address: owner.toBase58() },
      }),
    } as unknown as WalletSession;
    const actions = createCardActions({
      rpc,
      session,
      chain: "solana:devnet",
      flags: () => ({ sell: true, feed: true }),
    });
    const ids = identifyCards(binder.cards).map((item) => item.cardId);
    expect((await actions.preview("sell_back", ids))?.gate).toBeUndefined();
    nowTs = expiry + 1n;
    await expect(actions.execute("sell_back", ids)).rejects.toMatchObject({
      message: { key: "feed.state.quoteExpired" },
    });
    expect(mocks.runSettles).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["valid", "missing", "truncated", "malformed"])(
    "uses only confirmed withdrawal receipts despite concurrent owed credits (receipt=%s)",
    async (receiptState) => {
      let binder = {
        ...decodeBinder(binderHeaderLayout.encode({ owner, sol_owed: 100n })),
        cards: [],
      };
      mocks.binder.mockImplementation(async () => binder);
      mocks.account.mockImplementation(async () => ({
        binder,
        lamports: 1_000_000n,
        dataLength: 100,
      }));
      const event = (who: PublicKey, amount: bigint) => {
        const definition = M2_PROVISIONAL_EVENT_IDL.events.find(
          (entry) => entry.name === "OwedWithdrawn",
        )!;
        const data = Buffer.alloc(48);
        who.toBuffer().copy(data);
        data.writeBigUInt64LE(amount, 32);
        data.writeBigUInt64LE(0n, 40);
        return `Program data: ${Buffer.concat([Buffer.from(definition.discriminator), data]).toString("base64")}`;
      };
      const foreign = PublicKey.default.toBase58();
      const getTransaction = vi.fn(async () =>
        receiptState !== "missing"
          ? {
              meta: {
                err: null,
                logMessages: [
                  `Program ${foreign} invoke [1]`,
                  event(owner, 777n),
                  `Program ${foreign} success`,
                  `Program ${PROGRAM_ID} invoke [1]`,
                  event(mints[0]!, 888n),
                  event(owner, 40n),
                  `Program ${PROGRAM_ID} success`,
                  ...(receiptState === "truncated" ? ["Log truncated"] : []),
                  ...(receiptState === "malformed"
                    ? [`Program ${PROGRAM_ID} success`]
                    : []),
                ],
              },
            }
          : null,
      );
      const rpc = {
        getLatestBlockhash: async () => ({
          blockhash: PublicKey.default.toBase58(),
        }),
        getFeeForMessage: async () => ({ value: 5000 }),
        getMinimumBalanceForRentExemption: async () => 1000,
        getTransaction,
      } as unknown as Connection;
      const session = {
        snapshot: () => ({
          generation: 1,
          wallet: {},
          account: { address: owner.toBase58() },
        }),
      } as unknown as WalletSession;
      mocks.execute.mockImplementation(async ({ items }) => {
        await items[0].build({ blockhash: PublicKey.default.toBase58() });
        // A new royalty exceeds the withdrawal, so a before/after delta would be negative.
        binder = { ...binder, sol_owed: 200n };
        return { phase: "done", signatures: ["confirmed-withdrawal"] };
      });
      const actions = createCardActions({
        rpc,
        session,
        chain: "solana:devnet",
        flags: () => ({ sell: false, feed: false }),
      });
      expect((await actions.preview("withdraw_owed", []))?.receive).toEqual({
        kind: "now",
        lamports: 100n,
      });
      await expect(actions.execute("withdraw_owed", [])).resolves.toEqual(
        receiptState === "valid" ? { receivedLamports: 40n } : {},
      );
      expect(getTransaction).toHaveBeenCalledWith("confirmed-withdrawal", {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    },
  );
});
