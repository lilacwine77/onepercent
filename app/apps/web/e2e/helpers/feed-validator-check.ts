import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import { TX_LIMITS } from "@onepercent/config";
import { readFeedWallet } from "../../src/data/feed.js";
import { readWalletDeck } from "../../src/data/deck.js";
import { feedDepositCost } from "../../src/data/feed-chain.js";
import {
  FeedInterrupted,
  previewFeed,
  runFeed,
} from "../../src/tx/feed/run.js";
import { runTakeBack } from "../../src/tx/run-take-back.js";
import {
  capabilities,
  type SupportedWallet,
} from "../../src/wallet/capabilities.js";
import {
  FEED_PROGRAM_ID,
  startFeedValidator,
  type FeedValidator,
} from "./feed-validator.js";

Object.assign(globalThis, {
  __WEB_DEPLOYMENT__: {
    cluster: "localnet",
    programId: FEED_PROGRAM_ID.toBase58(),
  },
});

// This supplements the Playwright gate; it does not exercise rendered controls.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  nativeFetch(
    typeof input === "string" && input.startsWith("/")
      ? new URL(input, "http://127.0.0.1:4175")
      : input,
    init,
  );

async function scenario(
  name: string,
  mode: "send" | "sign",
  bags: number,
  options: {
    split?: boolean;
    empties?: number;
    drop?: number;
    refuse?: boolean;
    hold?: boolean;
  } = {},
) {
  const signer = Keypair.generate();
  const chain = await startFeedValidator({
    wallet: signer.publicKey.toBase58(),
    bags,
    ...options,
  });
  let prompts = 0;
  let attempts = 0;
  let flow: unknown;
  const refused: string[] = [];
  const account: WalletAccount = {
    address: signer.publicKey.toBase58(),
    publicKey: signer.publicKey.toBytes(),
    chains: ["solana:devnet"],
    features:
      mode === "send"
        ? ["solana:signAndSendTransaction"]
        : ["solana:signTransaction"],
  };
  const wallet: SupportedWallet = {
    version: "1.0.0",
    name: "Validator Wallet",
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains: ["solana:devnet"],
    accounts: [account],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts: [account] }),
      },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      ...(mode === "send"
        ? {
            "solana:signAndSendTransaction": {
              version: "1.0.0" as const,
              supportedTransactionVersions: ["legacy", 0] as const,
              signAndSendTransaction: async (
                ...inputs: { transaction: Uint8Array }[]
              ) => {
                prompts++;
                const outputs = [];
                for (const input of inputs) {
                  const tx = VersionedTransaction.deserialize(
                    input.transaction,
                  );
                  if (options.hold && attempts === 0) {
                    const deadline = Date.now() + 120_000;
                    const validity =
                      await chain.connection.getLatestBlockhash("confirmed");
                    while (
                      (await chain.connection.getBlockHeight("finalized")) <=
                      validity.lastValidBlockHeight
                    ) {
                      assert(
                        Date.now() < deadline,
                        "Held blockhash did not expire",
                      );
                      await delay(500);
                    }
                  }
                  tx.sign([signer]);
                  const drop = attempts++ === options.drop;
                  if (!drop)
                    await chain.connection.sendRawTransaction(tx.serialize(), {
                      skipPreflight: false,
                    });
                  outputs.push({ signature: tx.signatures[0]! });
                }
                return outputs;
              },
            },
          }
        : {
            "solana:signTransaction": {
              version: "1.0.0" as const,
              supportedTransactionVersions: ["legacy", 0] as const,
              signTransaction: async (
                ...inputs: { transaction: Uint8Array }[]
              ) => {
                prompts++;
                return inputs.map((input) => {
                  const tx = VersionedTransaction.deserialize(
                    input.transaction,
                  );
                  tx.sign([signer]);
                  attempts++;
                  return { signedTransaction: tx.serialize() };
                });
              },
            },
          }),
    },
  };
  const input = {
    rpc: chain.connection,
    owner: chain.wallet,
    wallet,
    account,
    chain: "solana:devnet" as const,
    selection: chain.mints.map((mint) => mint.toBase58()),
    price: 0n,
    current: () => true,
    enabled: () => true,
    progress: (state: unknown) => {
      flow = state;
    },
    refused: (mint: string) => {
      refused.push(mint);
    },
  };
  try {
    if (options.refuse)
      chain.refused.set(chain.mints[0]!.toBase58(), "not_supported");
    const snapshot = await readFeedWallet(chain.connection, chain.wallet);
    const preview = await previewFeed({
      wallet: chain.wallet,
      snapshot,
      selection: input.selection,
      batchSize: capabilities(wallet, bags, TX_LIMITS.txPerSignAll).batchSize,
      price: 0n,
      blockhash: (await chain.connection.getLatestBlockhash()).blockhash,
    });
    const beforeBalance = await chain.connection.getBalance(chain.wallet);
    const closed = [
      ...chain.sources,
      ...chain.emptyAccounts,
      ...chain.splitAccounts,
    ];
    const returnedRent = (
      await chain.connection.getMultipleAccountsInfo(closed)
    ).reduce((sum, info) => sum + BigInt(info!.lamports), 0n);
    let retry = false;
    try {
      await runFeed(input);
    } catch (error) {
      if (
        (options.drop === undefined && !options.hold) ||
        !(error instanceof FeedInterrupted)
      )
        throw error;
      if (options.hold) {
        assert.equal(error.result.copyKey, "errors.tooLong");
        assert.equal(error.result.phase, "expired");
        assert.equal((await chain.deck()).len, 0);
      } else {
        assert.equal(error.result.phase, "partial");
        assert.equal((await chain.deck()).len, options.drop);
      }
      await runFeed(input);
      retry = true;
    }
    const fed = bags - (options.refuse ? 1 : 0);
    assert.equal((await chain.deck()).len, fed);
    if (!options.refuse && options.drop === undefined && !options.hold)
      assert.equal(prompts, preview.approvals);
    if (options.refuse) assert.deepEqual(refused, [chain.mints[0]!.toBase58()]);
    assert(
      chain.logs
        .flatMap((row) => row.bags)
        .every((bag) => bag.amount === chain.amount.toString()),
    );
    if (options.empties) {
      const afterBalance = await chain.connection.getBalance(chain.wallet);
      const deposit = feedDepositCost(
        snapshot.inventory.bags,
        Boolean(snapshot.core?.binder),
        snapshot.rent,
        snapshot.core?.binderLamports,
      ).total;
      assert.equal(
        BigInt(afterBalance - beforeBalance) + (await fees(chain)) + deposit,
        returnedRent,
      );
      assert(
        (await chain.connection.getMultipleAccountsInfo(closed)).every(
          (info) => info === null,
        ),
      );
    }
    const feedPrompts = prompts;
    let takenBack = 0;
    if (bags === 16) {
      chain.state.feedEnabled = false;
      chain.state.publicReads = false;
      const entries = (
        await readWalletDeck(chain.connection, chain.wallet)
      ).entries.slice(0, 3);
      const result = await runTakeBack({
        ...input,
        entries,
        progress: (state) => {
          flow = state;
        },
      });
      assert.equal(result.result.phase, "done");
      assert.equal(result.landed, 3);
      assert.equal((await chain.deck()).len, 13);
      for (const entry of entries) {
        const accounts = await chain.connection.getTokenAccountsByOwner(
          chain.wallet,
          { mint: entry.mint },
        );
        assert.equal(
          accounts.value[0]!.account.data.readBigUInt64LE(64),
          entry.amount,
        );
      }
      takenBack = 3;
    }
    console.log(
      JSON.stringify({
        scenario: name,
        result: "passed",
        mode,
        fed,
        takenBack,
        transactions: preview.transactions,
        feedPrompts,
        exitPrompts: prompts - feedPrompts,
        retry,
        artifactSha256: chain.artifactSha256,
      }),
    );
  } catch (error) {
    console.error(JSON.stringify({ scenario: name, flow }));
    throw error;
  } finally {
    await chain.close();
  }
}

async function fees(chain: FeedValidator) {
  let total = 0n;
  for (const { signature } of await chain.connection.getSignaturesForAddress(
    chain.wallet,
  )) {
    const tx = await chain.connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    assert(tx?.meta);
    total += BigInt(tx.meta.fee);
  }
  return total;
}

try {
  const selection = process.argv[2] ?? "all";
  assert(
    [
      "all",
      "remaining",
      "send",
      "sign",
      "rent",
      "refusal",
      "partial",
      "expiry",
    ].includes(selection),
    "Unknown validator scenario",
  );
  if (selection === "all" || selection === "send")
    await scenario("16 Feed, 3 take-back", "send", 16);
  if (["all", "remaining", "sign"].includes(selection))
    await scenario("16 Feed, 3 take-back", "sign", 16);
  if (["all", "remaining", "rent"].includes(selection))
    await scenario("Merge, close, Rent", "send", 1, {
      split: true,
      empties: 2,
    });
  if (["all", "remaining", "refusal"].includes(selection))
    await scenario("Per-bag refusal", "send", 2, { refuse: true });
  if (["all", "remaining", "partial"].includes(selection))
    await scenario("Partial expiry and retry", "send", 4, { drop: 2 });
  if (["all", "remaining", "expiry"].includes(selection))
    await scenario("Held approval expiry and retry", "send", 1, { hold: true });
} finally {
  globalThis.fetch = nativeFetch;
}
