import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import type { SupportedWallet } from "../../src/wallet/capabilities";
import { SubmittedBatchError } from "../../src/tx/engine/errors";
import { send } from "../../src/tx/engine/send";

const account = {
  address: "11111111111111111111111111111111",
  publicKey: new Uint8Array(32),
  chains: ["solana:devnet"],
  features: [],
} as WalletAccount;
const signature = new Uint8Array(64).fill(1);
const encode = (value: Uint8Array) => Buffer.from(value).toString("base64");
const wallet = (features: object) => ({ features }) as SupportedWallet;

describe("wallet submission boundaries", () => {
  it("preserves a successful prefix when a later prompt is rejected", async () => {
    const signAndSendTransaction = vi
      .fn()
      .mockResolvedValueOnce([{ signature }])
      .mockRejectedValueOnce({ code: 4001 });
    const fallback = vi.fn();
    const result = await send(
      wallet({ "solana:signAndSendTransaction": { signAndSendTransaction } }),
      account,
      "solana:devnet",
      [new Uint8Array([1]), new Uint8Array([2])],
      fallback,
      encode,
    ).catch((error) => error);
    expect(result).toBeInstanceOf(SubmittedBatchError);
    expect(result.signatures).toEqual([encode(signature)]);
    expect(result.uncertainIndex).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
    expect(signAndSendTransaction.mock.calls[0]![0].chain).toBe(
      "solana:devnet",
    );
  });
  it("retains uncertainty when a wallet send loses its response", async () => {
    const signAndSendTransaction = vi
      .fn()
      .mockRejectedValue(new Error("transport lost"));
    const result = await send(
      wallet({ "solana:signAndSendTransaction": { signAndSendTransaction } }),
      account,
      "solana:devnet",
      [new Uint8Array([1])],
      vi.fn(),
      encode,
    ).catch((error) => error);
    expect(result.uncertainIndex).toBe(0);
  });
  it("refuses a chain the selected account does not expose", async () => {
    const signAndSendTransaction = vi.fn();
    await expect(
      send(
        wallet({ "solana:signAndSendTransaction": { signAndSendTransaction } }),
        account,
        "solana:mainnet",
        [new Uint8Array([1])],
        vi.fn(),
        encode,
      ),
    ).rejects.toMatchObject({
      original: { copyKey: "wallet.wrongNetwork" },
      uncertainIndex: null,
    });
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("submits an unchanged signed message and refuses a signed wallet alteration", async () => {
    const signer = Keypair.generate();
    const tx = new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
    }).add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1n,
      }),
    );
    const unsigned = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const same = VersionedTransaction.deserialize(unsigned);
    same.sign([signer]);
    const altered = new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash: tx.recentBlockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 2n,
      }),
    );
    altered.sign(signer);
    const signTransaction = vi
      .fn()
      .mockResolvedValueOnce([{ signedTransaction: same.serialize() }])
      .mockResolvedValueOnce([{ signedTransaction: altered.serialize() }]);
    const fallback = vi.fn(async () => "sig");
    const signingWallet = wallet({
      "solana:signTransaction": { signTransaction },
    });
    expect(
      await send(
        signingWallet,
        account,
        "solana:devnet",
        [unsigned],
        fallback,
        encode,
      ),
    ).toEqual(["sig"]);
    await expect(
      send(
        signingWallet,
        account,
        "solana:devnet",
        [unsigned],
        fallback,
        encode,
      ),
    ).rejects.toMatchObject({ signatures: [], uncertainIndex: null });
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
