import { DEVNET_GENESIS_HASH } from "../packages/config/dist/genesis.js";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  statSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  Connection,
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { utils } from "@anchor-lang/core";
import { devnetTransportProfile } from "../packages/cli/dist/launch/devnet-transport.js";
import { launchPriorityPrice } from "../packages/cli/dist/launch/landing.js";
import { broadcastSavedTransaction } from "./devnet-broadcast.mjs";
import { createDevnetFetch } from "./devnet-fetch.mjs";

// Keep connections alive and serialize request starts to respect the public RPC.
const devnetFetch = createDevnetFetch();
export const rpc = new Connection("https://api.devnet.solana.com", {
  commitment: "finalized",
  disableRetryOnRateLimit: true,
  fetch: devnetFetch,
});
export const profile = devnetTransportProfile("devnet");
export async function assertCluster() {
  assert.equal(await rpc.getGenesisHash(), DEVNET_GENESIS_HASH);
}
await assertCluster();
export const keyRoot = `${homedir()}/.config/onepercent/devnet`;
export function key(path) {
  assert.equal(statSync(path).mode & 0o777, 0o600, "Signer must have mode 600");
  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
    );
  } catch {
    throw Error("Invalid signer file; contents withheld");
  }
}
export const payer = key(
  `${homedir()}/.config/onepercent/devnet-test-wallet.json`,
);
assert.equal(
  payer.publicKey.toBase58(),
  "DpMXTAcBPhEpNA2joqP6eEgJkfetjzRiQyVUfQoqZG93",
);
export const program = key(`${keyRoot}/program.json`);
assert.equal(
  program.publicKey.toBase58(),
  "DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr",
);
export const pid = program.publicKey;
mkdirSync("reports/devnet", { recursive: true, mode: 0o700 });
const journalPath = "reports/devnet/transactions.json";
export const journal = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath, "utf8"))
  : {};
export function save() {
  writeFileSync(`${journalPath}.new`, JSON.stringify(journal), { mode: 0o600 });
  renameSync(`${journalPath}.new`, journalPath);
}
export async function requireBalance(amount, owner = payer.publicKey) {
  const balance = await rpc.getBalance(owner);
  assert(
    balance >= amount,
    `Insufficient devnet balance: ${owner}, short ${Math.max(0, amount - balance)} lamports`,
  );
}
export async function send(
  label,
  instructions,
  signers = [payer],
  { confirmed = false, units = 1_400_000, tables = [], beforeBroadcast } = {},
) {
  let entry = journal[label];
  if (!entry) {
    const written = [
      ...new Map(
        [
          signers[0].publicKey,
          ...instructions.flatMap((ix) =>
            ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey),
          ),
        ].map((k) => [k.toBase58(), k]),
      ).values(),
    ]
      .sort((a, b) => a.toBase58().localeCompare(b.toBase58()))
      .slice(0, 128);
    const samples = await rpc.getRecentPrioritizationFees({
      lockedWritableAccounts: written,
    });
    const price = launchPriorityPrice(
      samples,
      profile.maxComputeUnitPriceMicroLamports,
    );
    const latest = await rpc.getLatestBlockhash("confirmed");
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signers[0].publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
          ...instructions,
        ],
      }).compileToV0Message(tables),
    );
    assert(tx.serialize().length <= 1232, "Transaction exceeds packet size");
    const sim = await rpc.simulateTransaction(tx, {
      sigVerify: false,
      commitment: "confirmed",
    });
    if (sim.value.err) {
      console.log(
        JSON.stringify({
          label,
          simulationError: sim.value.err,
          logs: sim.value.logs,
        }),
      );
      throw Error(`Simulation failed: ${label}`);
    }
    tx.sign(signers);
    entry = journal[label] = {
      signature: utils.bytes.bs58.encode(tx.signatures[0]),
      raw: Buffer.from(tx.serialize()).toString("base64"),
      lastValidBlockHeight: latest.lastValidBlockHeight,
      microLamports: price.toString(),
      sampledAccounts: written.map(String),
      unitsConsumed: sim.value.unitsConsumed,
    };
    save();
  }
  for (let i = 0; i < 150; i++) {
    const status = (
      await rpc.getSignatureStatuses([entry.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    assert(!status?.err, `Transaction failed: ${label}`);
    if (
      status?.confirmationStatus === "finalized" ||
      (confirmed && status?.confirmationStatus === "confirmed")
    ) {
      entry.slot = status.slot;
      entry.finalized = status.confirmationStatus === "finalized";
      save();
      if (!label.startsWith("upload/"))
        console.log(
          JSON.stringify({
            label,
            signature: entry.signature,
            slot: entry.slot,
            finalized: entry.finalized,
          }),
        );
      return entry.signature;
    }
    if (!status) {
      assert(
        (await rpc.getBlockHeight("confirmed")) <= entry.lastValidBlockHeight,
        `Uncertain expired transaction: ${label}; reconcile before retry`,
      );
      await broadcastSavedTransaction(rpc, entry, beforeBroadcast);
    }
    await delay(500);
  }
  throw Error(`Confirmation pending: ${label}`);
}
export const pub = (value) => new PublicKey(value);
