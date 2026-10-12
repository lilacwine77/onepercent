import { createPrivateKey, sign } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  Keypair,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";

export async function installWallet(
  page: Page,
  options: {
    signer?: Keypair;
    rpc?: Connection;
    sendTransaction?: (transaction: Uint8Array) => Promise<void>;
    signAndSend?: boolean;
  } = {},
) {
  if (options.rpc) {
    const endpoint = new URL(options.rpc.rpcEndpoint);
    if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1")
      throw new Error(
        "The validator wallet only sends to disposable localhost RPC",
      );
  }
  if (options.rpc && options.sendTransaction)
    throw new Error("Select one validator transaction transport");
  const signer = options.signer ?? Keypair.generate();
  const other = Keypair.generate();
  const signers = new Map(
    [signer, other].map((item) => [item.publicKey.toBase58(), item]),
  );
  function selectSigner(address: string) {
    const selected = signers.get(address);
    if (!selected) throw new Error("Unknown fixture account");
    return selected;
  }
  await page.exposeFunction(
    "onepercentTestSign",
    (bytes: number[], address: string) => {
      const transaction = VersionedTransaction.deserialize(
        Uint8Array.from(bytes),
      );
      transaction.sign([selectSigner(address)]);
      return Array.from(transaction.serialize());
    },
  );
  await page.exposeFunction(
    "onepercentTestSend",
    async (bytes: number[], address: string) => {
      const selected = selectSigner(address);
      const transaction = VersionedTransaction.deserialize(
        Uint8Array.from(bytes),
      );
      transaction.sign([selected]);
      await options.sendTransaction?.(transaction.serialize());
      const index = transaction.message.staticAccountKeys.findIndex((key) =>
        key.equals(selected.publicKey),
      );
      if (options.rpc)
        await options.rpc.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        });
      return Array.from(transaction.signatures[index]!);
    },
  );
  await page.exposeFunction(
    "onepercentTestMessage",
    (bytes: number[], address: string) => {
      const selected = selectSigner(address);
      // Ed25519 PKCS#8 wraps the runtime-generated seed; it never crosses into the page.
      const privateKey = createPrivateKey({
        key: Buffer.concat([
          Buffer.from("302e020100300506032b657004220420", "hex"),
          Buffer.from(selected.secretKey.subarray(0, 32)),
        ]),
        format: "der",
        type: "pkcs8",
      });
      return Array.from(sign(null, Uint8Array.from(bytes), privateKey));
    },
  );
  await page.addInitScript(
    ({ address, publicKey, secondAddress, secondKey, signAndSend }) => {
      const listeners = new Set<
        (event: { accounts: readonly unknown[] }) => void
      >();
      const held = new Set<() => void>();
      const account = (address: string, key: number[]) => ({
        address,
        publicKey: Uint8Array.from(key),
        chains: ["solana:devnet"],
        features: [
          "solana:signTransaction",
          ...(signAndSend ? ["solana:signAndSendTransaction"] : []),
          "solana:signMessage",
        ],
      });
      type Account = ReturnType<typeof account>;
      type TransactionInput = {
        transaction: Uint8Array;
        account: Account;
        chain?: string;
      };
      type MessageInput = { message: Uint8Array; account: Account };
      let accounts: Account[] = [];
      const stats = {
        prompts: 0,
        silent: 0,
        signatures: 0,
        behavior: "approve",
        drop: -1,
        sendAttempts: 0,
        // Default keeps the existing send-per-transaction / sign-in-one-batch behavior.
        promptMode: "default" as "default" | "batch" | "perTransaction",
      };
      const bridge = window as unknown as {
        onepercentTestSend(bytes: number[], address: string): Promise<number[]>;
        onepercentTestSign(bytes: number[], address: string): Promise<number[]>;
        onepercentTestMessage(
          bytes: number[],
          address: string,
        ): Promise<number[]>;
      };
      function assertAccount(input: { account: Account; chain?: string }) {
        const connected = accounts.find(
          (item) => item.address === input.account?.address,
        );
        if (
          !connected ||
          !(input.account.publicKey instanceof Uint8Array) ||
          input.account.publicKey.length !== connected.publicKey.length ||
          !input.account.publicKey.every(
            (byte, index) => byte === connected.publicKey[index],
          ) ||
          !input.account.chains.includes("solana:devnet")
        )
          throw new Error("Fixture account is not connected");
        if (input.chain && input.chain !== "solana:devnet")
          throw new Error("Unsupported fixture chain");
      }
      async function approve(input: { account: Account; chain?: string }) {
        if (stats.behavior === "reject")
          throw Object.assign(new Error("User rejected"), { code: 4001 });
        if (stats.behavior === "hold")
          await new Promise<void>((resolve) => held.add(resolve));
        assertAccount(input);
      }
      async function runInputs<
        T extends { account: Account; chain?: string },
        R,
      >(
        inputs: readonly T[],
        defaultPerTransaction: boolean,
        execute: (input: T) => Promise<R>,
      ): Promise<R[]> {
        inputs.forEach(assertAccount);
        if (!inputs.length) return [];
        const perTransaction =
          stats.promptMode === "perTransaction" ||
          (stats.promptMode === "default" && defaultPerTransaction);
        if (!perTransaction) stats.prompts++;
        const outputs: R[] = [];
        for (const input of inputs) {
          assertAccount(input);
          if (perTransaction) stats.prompts++;
          await approve(input);
          const output = await execute(input);
          stats.signatures++;
          outputs.push(output);
        }
        return outputs;
      }
      const wallet = {
        version: "1.0.0",
        name: "Fixture Wallet",
        icon: "data:image/svg+xml;base64,PHN2Zy8+",
        chains: ["solana:devnet"],
        get accounts() {
          return accounts;
        },
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async ({ silent = false } = {}) => {
              if (silent) stats.silent++;
              else stats.prompts++;
              accounts = [account(address, publicKey)];
              return { accounts };
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (
              _: string,
              listener: (event: { accounts: readonly unknown[] }) => void,
            ) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              accounts = [];
              listeners.forEach((listener) => listener({ accounts }));
            },
          },
          "solana:signAndSendTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signAndSendTransaction: (...inputs: TransactionInput[]) =>
              runInputs(inputs, true, async (input) => {
                const index = stats.sendAttempts++;
                if (index === stats.drop)
                  throw new Error("Dropped transaction");
                return {
                  signature: Uint8Array.from(
                    await bridge.onepercentTestSend(
                      Array.from(input.transaction),
                      input.account.address,
                    ),
                  ),
                };
              }),
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: (...inputs: TransactionInput[]) =>
              runInputs(inputs, false, async (input) => ({
                signedTransaction: Uint8Array.from(
                  await bridge.onepercentTestSign(
                    Array.from(input.transaction),
                    input.account.address,
                  ),
                ),
              })),
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: (...inputs: MessageInput[]) =>
              runInputs(inputs, false, async (input) => ({
                signedMessage: Uint8Array.from(input.message),
                signature: Uint8Array.from(
                  await bridge.onepercentTestMessage(
                    Array.from(input.message),
                    input.account.address,
                  ),
                ),
              })),
          },
        },
      };
      if (!signAndSend)
        delete (wallet.features as Record<string, unknown>)[
          "solana:signAndSendTransaction"
        ];
      Object.assign(window, {
        fixtureWallet: {
          stats,
          switch() {
            accounts = [account(secondAddress, secondKey)];
            listeners.forEach((listener) => listener({ accounts }));
          },
          release() {
            stats.behavior = "approve";
            held.forEach((resume) => resume());
            held.clear();
          },
        },
      });
      const register = (api: { register(wallet: unknown): void }) =>
        api.register(wallet);
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: register,
        }),
      );
      window.addEventListener("wallet-standard:app-ready", (event) =>
        register((event as CustomEvent).detail),
      );
    },
    {
      address: signer.publicKey.toBase58(),
      publicKey: Array.from(signer.publicKey.toBytes()),
      secondAddress: other.publicKey.toBase58(),
      secondKey: Array.from(other.publicKey.toBytes()),
      signAndSend: options.signAndSend !== false,
    },
  );
  return {
    address: signer.publicKey.toBase58(),
    other: other.publicKey.toBase58(),
  };
}
