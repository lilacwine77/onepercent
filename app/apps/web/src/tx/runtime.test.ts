// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import type { WalletSession } from "../wallet/session";
import { encodeSignature } from "../chain/encoding";
import { checkBuiltTransaction, executeTransactions } from "./runtime";

function harness() {
  const owner = Keypair.generate().publicKey;
  const hash = Keypair.generate().publicKey.toBase58();
  const signature = new Uint8Array(64).fill(3);
  const signAndSendTransaction = vi.fn(async () => [{ signature }]);
  const state = {
    wallet: {
      features: {
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy"],
          signAndSendTransaction,
        },
      },
    },
    account: {
      address: owner.toBase58(),
      publicKey: owner.toBytes(),
      chains: ["solana:devnet"],
      features: ["solana:signAndSendTransaction"],
    },
    generation: 0,
  };
  const rpc = {
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: hash,
      lastValidBlockHeight: 100,
    })),
    getBlockHeight: vi.fn(async () => 1),
    simulateTransaction: vi.fn(async () => ({ value: { err: null } })),
    getSignatureStatuses: vi.fn(async () => ({
      value: [{ confirmationStatus: "confirmed", err: null }],
    })),
  };
  const build = () =>
    new Transaction({ feePayer: owner, recentBlockhash: hash }).add(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    );
  return {
    owner,
    signature,
    state,
    rpc,
    build,
    signAndSendTransaction,
    options: {
      rpc: rpc as unknown as Connection,
      session: { snapshot: () => state } as unknown as WalletSession,
      chain: "solana:devnet" as const,
      items: [{ id: "a", phase: 0, build, landed: async () => false }],
    },
  };
}

describe("live transaction runtime", () => {
  it("refuses malformed validity heights before signing or persisting a submission", async () => {
    const h = harness();
    h.rpc.getLatestBlockhash.mockResolvedValue({
      blockhash: h.build().recentBlockhash!,
      lastValidBlockHeight: Number.NaN,
    });
    const result = await executeTransactions(h.options);
    expect(result.submitted).toBe(false);
    expect(h.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("simulates the final rebuilt message before wallet submission and confirms its signature", async () => {
    const h = harness();
    const result = await executeTransactions(h.options);
    expect(result.phase).toBe("done");
    expect(h.rpc.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(h.signAndSendTransaction).toHaveBeenCalledOnce();
    expect(result.signatures).toEqual([encodeSignature(h.signature)]);
  });
  it("does not prompt after simulation fails or wallet generation changes", async () => {
    for (const scenario of ["simulation", "switch"]) {
      const h = harness();
      h.rpc.simulateTransaction.mockImplementation(async () => {
        if (scenario === "simulation") throw new Error("Simulation failed");
        h.state.generation++;
        return { value: { err: null } };
      });
      await executeTransactions(h.options);
      expect(h.signAndSendTransaction).not.toHaveBeenCalled();
    }
  });
  it("retains submitted prefix signatures when a later wallet request rejects", async () => {
    const h = harness();
    h.signAndSendTransaction
      .mockResolvedValueOnce([{ signature: h.signature }])
      .mockRejectedValueOnce({ code: 4001 });
    const onSignature = vi.fn();
    const result = await executeTransactions({
      ...h.options,
      onSignature,
      items: [...h.options.items, { ...h.options.items[0]!, id: "b" }],
    });
    expect(result.signatures).toEqual([encodeSignature(h.signature)]);
    expect(result.landed.has("a")).toBe(true);
    expect(onSignature).toHaveBeenCalledWith(encodeSignature(h.signature));
  });
  it("refuses an unexpected program or a different fee payer", () => {
    const h = harness();
    expect(() =>
      checkBuiltTransaction(h.build(), Keypair.generate().publicKey),
    ).toThrow();
    const foreign = h.build().add(
      new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: [],
        data: Buffer.alloc(0),
      }),
    );
    expect(() => checkBuiltTransaction(foreign, h.owner)).toThrow();
  });
  it("blocks rebuilding an indeterminate send until its blockhash has expired", async () => {
    const h = harness();
    h.signAndSendTransaction.mockRejectedValueOnce(new Error("Lost response"));
    const first = await executeTransactions(h.options);
    expect(first.unknown.has("a")).toBe(true);
    await expect(executeTransactions(h.options)).rejects.toThrow(
      "errors.generic",
    );
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(1);
    h.rpc.getBlockHeight.mockResolvedValue(101);
    h.rpc.getLatestBlockhash.mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 200,
    });
    expect((await executeTransactions(h.options)).phase).toBe("done");
    expect(h.signAndSendTransaction).toHaveBeenCalledTimes(2);
  });
});

it("rejects a wallet chain different from the pinned deployment before signing", async () => {
  const input = harness();
  await expect(
    executeTransactions({ ...input.options, chain: "solana:mainnet" }),
  ).rejects.toMatchObject({ copyKey: "errors.simulation" });
  expect(input.signAndSendTransaction).not.toHaveBeenCalled();
  expect(input.rpc.getLatestBlockhash).not.toHaveBeenCalled();
});
