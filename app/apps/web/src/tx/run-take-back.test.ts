// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import {
  buildTakeBackTransactions,
  EXTERNAL_IDS,
  IDL,
} from "@onepercent/sdk/browser";
import { webDeployment } from "../data/deployment";
import {
  deckEntryId,
  readDeckSelection,
  type ChainDeckEntry,
} from "../data/deck";
import type { SupportedWallet } from "../wallet/capabilities";
import { prepareTakeBack, reconcileTakeBack } from "./take-back";
import { runTakeBack } from "./run-take-back";

vi.mock("./take-back", () => ({
  prepareTakeBack: vi.fn(),
  reconcileTakeBack: vi.fn(),
}));
vi.mock("../data/deck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/deck")>()),
  readDeckSelection: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function setup(repeatedFailure = false) {
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const programId = webDeployment().programId;
  const original: ChainDeckEntry = {
    depositor: owner,
    mint,
    amount: 100n,
    deposit: 0,
    flags: 1,
    _pad: new Uint8Array(3),
    deckIndex: 4,
    id: "",
  };
  original.id = deckEntryId(original, original.deckIndex);
  const moved = { ...original, deckIndex: 1, id: deckEntryId(original, 1) };
  let sends = 0;
  let hashes = 0;
  const error = {
    InstructionError: [
      2,
      { Custom: IDL.errors!.find((entry) => entry.name === "CardMoved")!.code },
    ],
  };
  const snapshot = { entries: [moved], slot: 100, lamports: 0n, header: null };
  vi.mocked(readDeckSelection).mockResolvedValue(snapshot);
  vi.mocked(reconcileTakeBack).mockResolvedValue("pending");
  vi.mocked(prepareTakeBack).mockImplementation(async (_rpc, options) => ({
    snapshot,
    missing: [],
    batches: [
      {
        transaction: buildTakeBackTransactions(programId, {
          ...options,
          entries: options.entries.map((entry) => ({
            ...entry,
            tokenProgram: EXTERNAL_IDS.splToken,
          })),
        })[0]!,
        entries: [...options.entries],
        balances: [],
        ataRentLamports: 0n,
        ataAccounts: 0,
        refundLamports: 0n,
        payeeRent: {
          address: owner,
          incomingLamports: 0n,
          debitLamports: 0n,
          balanceLamports: 0n,
          rentBytes: 0,
          minimumLamports: 0n,
          postBalanceLamports: 0n,
          shortfallLamports: 0n,
          standaloneTopUpLamports: 0n,
          ready: true,
          copyKey: null,
        },
      },
    ],
  }));
  const signAndSendTransaction = vi.fn(async () => [
    { signature: new Uint8Array(64).fill(++sends) },
  ]);
  const getTransaction = vi.fn(async () => ({
    meta: {
      err: error,
      logMessages: [
        "Program log: AnchorError. Error Code: CardMoved.",
        `Program ${programId} failed: custom program error`,
      ],
    },
  }));
  const rpc = {
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: new PublicKey(new Uint8Array(32).fill(++hashes)).toBase58(),
      lastValidBlockHeight: 100,
    })),
    getBlockHeight: vi.fn(async () => 1),
    simulateTransaction: vi.fn(async () => ({ value: { err: null } })),
    getSignatureStatuses: vi.fn(async () => ({
      value: [
        {
          confirmationStatus: "finalized",
          err: sends === 1 || repeatedFailure ? error : null,
        },
      ],
    })),
    getTransaction,
  } as unknown as Connection;
  return {
    original,
    moved,
    signAndSendTransaction,
    getTransaction,
    input: {
      rpc,
      owner,
      entries: [original],
      price: 0n,
      account: {
        address: owner.toBase58(),
        chains: ["solana:devnet"],
      } as unknown as WalletAccount,
      wallet: {
        features: {
          "solana:signAndSendTransaction": { signAndSendTransaction },
        },
      } as unknown as SupportedWallet,
      chain: "solana:devnet" as const,
      current: () => true,
      progress: vi.fn(),
    },
  };
}

describe("take-back finality retry", () => {
  it("re-reads moved indices and rebuilds once after a finalized CardMoved", async () => {
    const h = setup();
    const output = await runTakeBack(h.input);
    expect(output.result.phase).toBe("done");
    expect(output.landed).toBe(1);
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(2);
    expect(readDeckSelection).toHaveBeenCalledTimes(1);
    const builds = vi.mocked(prepareTakeBack).mock.calls;
    expect(builds.map(([, options]) => options.entries[0]!.deckIndex)).toEqual([
      4, 4, 1, 1,
    ]);
    const requests = h.signAndSendTransaction.mock.calls as unknown as Array<
      [{ transaction: Uint8Array }]
    >;
    expect(
      VersionedTransaction.deserialize(requests[0]![0].transaction).message
        .recentBlockhash,
    ).not.toBe(
      VersionedTransaction.deserialize(requests[1]![0].transaction).message
        .recentBlockhash,
    );
    expect(h.getTransaction).toHaveBeenCalledTimes(1);
  });

  it("stops after a second finalized CardMoved", async () => {
    const h = setup(true);
    const output = await runTakeBack(h.input);
    expect(output.result.phase).toBe("failed");
    expect(output.result.copyKey).toBe("errors.cardMoved");
    expect(output.landed).toBe(0);
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(2);
    expect(readDeckSelection).toHaveBeenCalledTimes(1);
    expect(output.result.unknown.size).toBe(0);
  });

  it("does not silently exceed the consented transaction count after a finalized failure", async () => {
    const h = setup();
    await expect(
      runTakeBack({ ...h.input, maxTransactions: 1 }),
    ).rejects.toThrow("errors.cardMoved");
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(1);
  });

  it("requests fresh consent before signing the rebuilt remainder beyond the original cap", async () => {
    const h = setup();
    const approveRetry = vi.fn(async () => {
      expect(h.signAndSendTransaction).toHaveBeenCalledTimes(1);
      return true;
    });
    const output = await runTakeBack({
      ...h.input,
      maxTransactions: 1,
      approveRetry,
    });
    expect(output.result.phase).toBe("done");
    expect(approveRetry).toHaveBeenCalledOnce();
    expect(approveRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        batches: [expect.objectContaining({ entries: [h.moved] })],
      }),
    );
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(2);
  });

  it("cancels the rebuild when fresh consent is declined", async () => {
    const h = setup();
    const approveRetry = vi.fn(async () => false);
    await expect(
      runTakeBack({ ...h.input, maxTransactions: 1, approveRetry }),
    ).rejects.toThrow("errors.cardMoved");
    expect(approveRetry).toHaveBeenCalledOnce();
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(1);
  });

  it("cannot use retry consent after the wallet changes", async () => {
    const h = setup();
    let current = true;
    await expect(
      runTakeBack({
        ...h.input,
        maxTransactions: 1,
        current: () => current,
        approveRetry: async () => {
          current = false;
          return true;
        },
      }),
    ).rejects.toThrow("errors.cardMoved");
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(1);
  });
});
