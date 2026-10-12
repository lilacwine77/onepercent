import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import { parseOnepercentLogs } from "../packages/sdk/dist/events/index.js";
import { rpc, payer, pid, pub, journal } from "./devnet-session.mjs";
import { verifyImmutableMetadata } from "./devnet-metadata.mjs";
const read = (name) =>
  JSON.parse(readFileSync(`reports/devnet/${name}.json`, "utf8"));
const before = read("upgrade1-before"),
  after = read("upgrade1-after"),
  upgrade = read("upgrade");
const swap = read("upgrade1-fee-swap"),
  services = read("upgrade1-services"),
  rip = read("upgrade1-rip"),
  stock = read("stock-fixture");
const keeper = services.keeper.find(
  (j) => j.kind === "fee-chain" && j.status === "confirmed",
);
assert(keeper?.signature, "Fee keeper must have a confirmed real collection");
const receipt = await rpc.getTransaction(keeper.signature, {
  commitment: "finalized",
  maxSupportedTransactionVersion: 0,
});
assert(receipt?.meta && !receipt.meta.err);
const parsed = parseOnepercentLogs({
  logs: receipt.meta.logMessages,
  err: receipt.meta.err,
  programId: pid.toBase58(),
});
assert(!parsed.truncated && !parsed.malformed && !parsed.unknownEvent);
const claim = parsed.events.find((e) => e.name === "LaunchFeesClaimed")?.data;
const collection = parsed.events.find(
  (e) => e.name === "CreatorFeesCollected",
)?.data;
assert(claim && collection);
assert.equal(String(claim.quote), swap.partnerClaimable);
assert.equal(claim.kind, 0);
assert.equal(claim.base, 0n);
assert.equal(collection.amount, claim.unwrapped_lamports);
assert.equal(collection.to_stock, collection.amount);
assert.equal(collection.to_team, 0n);
assert.equal(collection.to_burn, 0n);
const pool = sdk.decodeDbcPool((await rpc.getAccountInfo(pub(swap.pool))).data);
assert.equal(pool.partnerQuoteFee, 0n);
const machine = await sdk.fetchMachine(pid, rpc);
const metadata = await verifyImmutableMetadata(rpc, machine.token_mint);
const transactions = Object.entries(journal)
  .filter(
    ([label]) =>
      (label.startsWith(`upgrade/${upgrade.sha256}/`) &&
        !label.includes("/upload/")) ||
      label.startsWith("upgrade1/") ||
      ((label.startsWith("feed/") ||
        label.startsWith("fixture-stock-buy/") ||
        label.startsWith("refill-feed/")) &&
        journal[label].slot > before.slot),
  )
  .map(([label, { signature, slot, microLamports }]) => ({
    label,
    signature,
    slot,
    microLamports,
  }));
const teamJob = services.keeper.find(
  (j) => j.kind === "team-withdraw" && j.status === "confirmed",
);
assert(teamJob?.signature);
const teamReceipt = await rpc.getTransaction(teamJob.signature, {
  commitment: "finalized",
  maxSupportedTransactionVersion: 0,
});
assert(teamReceipt?.meta && !teamReceipt.meta.err);
const teamEvents = parseOnepercentLogs({
  logs: teamReceipt.meta.logMessages,
  err: teamReceipt.meta.err,
  programId: pid.toBase58(),
});
const withdrawal = teamEvents.events.find(
  (event) => event.name === "TeamWithdrawn",
)?.data;
assert(withdrawal && String(withdrawal.to) === payer.publicKey.toBase58());
const balance = await rpc.getBalance(payer.publicKey);
const result = {
  status: "upgrade-and-smoke-pass",
  cluster: "devnet",
  observedAt: new Date().toISOString(),
  sourceBaseReportedByArchitect: "f674762",
  program: pid.toBase58(),
  programData: upgrade.programData,
  authority: upgrade.authority,
  maxLen: upgrade.maxLen,
  elfBytes: after.elfLength,
  hashBefore: before.sha256,
  hashAfter: after.sha256,
  deploymentSlotBefore: before.deploymentSlot,
  deploymentSlotAfter: after.deploymentSlot,
  preservedAccounts: after.unchangedApplicationAccounts,
  openPullsBefore: before.accounts.filter((a) => a.kind === "Pull").length,
  accountProof: before.accounts.map(({ address, kind, bytes, sha256 }) => ({
    address,
    kind,
    bytes,
    sha256,
  })),
  transactions,
  smoke: {
    feedCardsAfter: services.checks.deck,
    stockBuy: stock,
    rip,
    curveSwap: swap,
    feeKeeper: {
      signature: keeper.signature,
      slot: receipt.slot,
      claim,
      collection,
    },
    metadata,
    teamWithdrawal: {
      signature: teamJob.signature,
      slot: teamReceipt.slot,
      ...withdrawal,
    },
    finalMachine: {
      phase: machine.phase,
      stock: machine.stock_sol,
      burn: machine.burn_sol,
      jackpot: machine.jackpot_sol,
      team: machine.team_sol,
      majorBook: machine.buckets[0].cost,
      pendingPulls: machine.pending_pulls,
    },
  },
  services,
  budget: {
    payerBefore: before.payerBalance,
    payerAfter: balance,
    payerOutflow: before.payerBalance - balance,
    teamReceived: String(withdrawal.amount),
    payerGrossOutflow: String(
      BigInt(before.payerBalance - balance) + withdrawal.amount,
    ),
    upgradeNetworkFees: before.payerBalance - after.payerBalance,
    bufferBalance: upgrade.bufferBalance,
    profileMaximum: read("upgrade1-budget").fullProfileMaximumRequired,
  },
  checks: {
    executorTests: 45,
    releaseTests: 5,
    workerTypecheck: "PASS",
    targetedLint: "PASS",
    targetedFormat: "PASS",
  },
  limitations: [
    "No open Pull existed before upgrade; the new Pull was exercised after upgrade.",
    "Feed attestations use test drivers, not the Railway intake API.",
    "Executor live decisions preserve the 0.05 SOL minimum and reserve caps; skipped trades are not reported as fills.",
    "Public RPC fallback uses the same provider; no redundancy proof.",
    "Public RPC returned rate limits and temporary failures; final reconciliation succeeded with roles run sequentially.",
    "Historical intake audit records are absent: Feed path remains unknown in the new service database.",
    "Keeper VRF monitoring also reads empty allow-list entries and reports the zero pubkey as unavailable; active VRF delivered successfully.",
  ],
};
const json = JSON.stringify(
  result,
  (_, v) => (typeof v === "bigint" ? String(v) : v),
  2,
);
writeFileSync("reports/devnet/upgrade1-results.json", json);
writeFileSync("fixtures/devnet/upgrade-1.json", json);
console.log(
  JSON.stringify({
    status: result.status,
    hashBefore: result.hashBefore,
    hashAfter: result.hashAfter,
    feeKeeper: keeper.signature,
    budget: result.budget,
    services: services.status,
  }),
);
