import { createPublicKey, verify } from "node:crypto";
import type { Page } from "@playwright/test";
import type { WalletAccount } from "@wallet-standard/base";
import type { SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { installWallet } from "../../e2e/mock-wallet/index";
import type { SupportedWallet } from "../../src/wallet/capabilities";

type RegisteredWallet = SupportedWallet & {
  features: SolanaSignMessageFeature;
};
type Surface = EventTarget & {
  fixtureWallet: {
    stats: {
      prompts: number;
      silent: number;
      signatures: number;
      behavior: string;
      drop: number;
      sendAttempts: number;
      promptMode: "default" | "batch" | "perTransaction";
    };
    switch(): void;
    release(): void;
  };
};
async function fixture() {
  const surface = new EventTarget() as Surface;
  vi.stubGlobal("window", surface);
  let registered: RegisteredWallet | undefined;
  surface.addEventListener("wallet-standard:register-wallet", (event) => {
    (event as CustomEvent).detail({
      register: (wallet: RegisteredWallet) => {
        registered = wallet;
      },
    });
  });
  const page = {
    exposeFunction: async (
      name: string,
      callback: (...args: unknown[]) => unknown,
    ) => {
      Object.assign(surface, { [name]: callback });
    },
    addInitScript: async (callback: (arg: unknown) => void, arg: unknown) => {
      callback(arg);
    },
  } as unknown as Page;
  const addresses = await installWallet(page);
  if (!registered) throw new Error("Wallet did not register");
  const wallet = registered;
  await wallet.features["standard:connect"].connect({ silent: true });
  return { wallet, control: surface.fixtureWallet, addresses };
}
const publicKey = (account: WalletAccount) =>
  createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(account.publicKey),
    ]),
    format: "der",
    type: "spki",
  });
function transaction(account: WalletAccount) {
  const payer = new PublicKey(account.publicKey);
  return new Transaction({
    feePayer: payer,
    recentBlockhash: "11111111111111111111111111111111",
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: SystemProgram.programId,
      lamports: 1n,
    }),
  );
}

describe("registered fixture wallet signing", () => {
  it("implements its announced message feature with valid Ed25519 signatures for the current account", async () => {
    const { wallet, control, addresses } = await fixture();
    const message = new TextEncoder().encode("Fixture message");
    const first = wallet.accounts[0]!;
    const [output] = await wallet.features["solana:signMessage"].signMessage({
      account: first,
      message,
    });
    expect(first.address).toBe(addresses.address);
    expect(output!.signedMessage).toEqual(message);
    expect(verify(null, message, publicKey(first), output!.signature)).toBe(
      true,
    );
    control.switch();
    const second = wallet.accounts[0]!;
    const [switched] = await wallet.features["solana:signMessage"].signMessage({
      account: second,
      message,
    });
    expect(second.address).toBe(addresses.other);
    expect(verify(null, message, publicKey(second), switched!.signature)).toBe(
      true,
    );
    expect(verify(null, message, publicKey(first), switched!.signature)).toBe(
      false,
    );
  });
  it("selects the switched account for transaction and send signatures", async () => {
    const { wallet, control } = await fixture();
    control.switch();
    const account = wallet.accounts[0]!;
    const tx = transaction(account);
    const bytes = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const [signed] = await wallet.features[
      "solana:signTransaction"
    ]!.signTransaction({ account, transaction: bytes, chain: "solana:devnet" });
    const decoded = VersionedTransaction.deserialize(signed!.signedTransaction);
    expect(
      verify(
        null,
        decoded.message.serialize(),
        publicKey(account),
        decoded.signatures[0]!,
      ),
    ).toBe(true);
    const [sent] = await wallet.features[
      "solana:signAndSendTransaction"
    ]!.signAndSendTransaction({
      account,
      transaction: bytes,
      chain: "solana:devnet",
    });
    expect(
      verify(null, tx.serializeMessage(), publicKey(account), sent!.signature),
    ).toBe(true);
  });
  it("rejects a disconnected or altered account before recording a prompt", async () => {
    const { wallet, control } = await fixture();
    const previous = wallet.accounts[0]!;
    control.switch();
    const current = wallet.accounts[0]!;
    const message = new Uint8Array([1]);
    await expect(
      wallet.features["solana:signMessage"].signMessage({
        account: previous,
        message,
      }),
    ).rejects.toThrow("not connected");
    await expect(
      wallet.features["solana:signMessage"].signMessage({
        account: { ...current, publicKey: previous.publicKey },
        message,
      }),
    ).rejects.toThrow("not connected");
    expect(control.stats.prompts).toBe(0);
    expect(control.stats.signatures).toBe(0);
  });
  it("counts actual attempted prompts in both modes and stops on a rejection", async () => {
    const { wallet, control } = await fixture();
    const input = {
      account: wallet.accounts[0]!,
      message: new Uint8Array([1]),
    };
    control.stats.promptMode = "perTransaction";
    await wallet.features["solana:signMessage"].signMessage(input, input);
    expect(control.stats.prompts).toBe(2);
    control.stats.promptMode = "batch";
    await wallet.features["solana:signMessage"].signMessage(input, input);
    expect(control.stats.prompts).toBe(3);
    expect(control.stats.signatures).toBe(4);
    control.stats.promptMode = "perTransaction";
    control.stats.behavior = "reject";
    await expect(
      wallet.features["solana:signMessage"].signMessage(input, input),
    ).rejects.toMatchObject({ code: 4001 });
    expect(control.stats.prompts).toBe(4);
    expect(control.stats.signatures).toBe(4);
  });
  it("drops the configured send index across separate calls, preserving earlier counters", async () => {
    const { wallet, control } = await fixture();
    const account = wallet.accounts[0]!;
    const input = {
      account,
      chain: "solana:devnet" as const,
      transaction: transaction(account).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    };
    control.stats.drop = 1;
    await wallet.features[
      "solana:signAndSendTransaction"
    ]!.signAndSendTransaction(input);
    await expect(
      wallet.features["solana:signAndSendTransaction"]!.signAndSendTransaction(
        input,
      ),
    ).rejects.toThrow("Dropped transaction");
    expect(control.stats.sendAttempts).toBe(2);
    expect(control.stats.signatures).toBe(1);
    expect(control.stats.prompts).toBe(2);
  });
  it("rechecks the connected account when a held approval is released", async () => {
    const { wallet, control } = await fixture();
    control.stats.behavior = "hold";
    const pending = wallet.features["solana:signMessage"].signMessage({
      account: wallet.accounts[0]!,
      message: new Uint8Array([1]),
    });
    control.switch();
    control.release();
    await expect(pending).rejects.toThrow("not connected");
    expect(control.stats.signatures).toBe(0);
  });
});
