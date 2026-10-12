import { verifyImmutableMetadata } from "./devnet-metadata.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  rpc,
  payer,
  pid,
  key,
  keyRoot,
  send,
  requireBalance,
} from "./devnet-session.mjs";
const deployment = sdk.createDeploymentSelector({ devnet: pid })("devnet");
const mint = key(`${keyRoot}/mint.json`).publicKey;
const pool = sdk.dbcPoolPda(
  mint,
  new (await import("@solana/web3.js")).PublicKey(deployment.meteora.dbcConfig),
)[0];
if (existsSync("reports/devnet/fees.json")) {
  const prior = JSON.parse(readFileSync("reports/devnet/fees.json", "utf8"));
  assert.equal(prior.status, "PASS");
  assert.equal(prior.pool, pool.toBase58());
  const receipt = await rpc.getSignatureStatuses([prior.signature], {
    searchTransactionHistory: true,
  });
  assert.equal(receipt.value[0]?.confirmationStatus, "finalized");
  assert.equal(receipt.value[0]?.err, null);
  await verifyImmutableMetadata(rpc, mint);
  console.log(JSON.stringify({ ...prior, reconciled: true }));
  process.exit(0);
}
const account = await rpc.getAccountInfo(pool);
assert(account);
const decoded = sdk.decodeDbcLaunchPool(account.data);
const metadata = await verifyImmutableMetadata(rpc, mint);
const state = sdk.decodeDbcPool(account.data);
const check = JSON.parse(
  readFileSync("reports/devnet/launch-check.json", "utf8"),
);
const quote = check.checks.find((c) => c.id === "dbc_dev_buy_quote").value;
const tradeFee = (BigInt(quote.quoteIn) * 250n + 9999n) / 10000n;
assert.equal(state.protocolQuoteFee, (tradeFee * 20n) / 100n);
assert.equal(state.partnerQuoteFee, tradeFee - state.protocolQuoteFee);
assert.equal(state.quoteReserve, BigInt(quote.quoteIn) - tradeFee);
const before = await sdk.fetchMachine(pid, rpc);
await requireBalance(10_000_000);
const signature = await send("claim-curve-and-collect", [
  sdk.claimLaunchFeesIx(deployment, {
    kind: "curve",
    payer: payer.publicKey,
    mint,
    baseVault: decoded.baseVault,
    quoteVault: decoded.quoteVault,
  }),
  sdk.collectCreatorFeesIx(deployment, { payer: payer.publicKey }),
]);
const after = await sdk.fetchMachine(pid, rpc);
const receipt = await rpc.getTransaction(signature, {
  commitment: "finalized",
  maxSupportedTransactionVersion: 0,
});
assert(receipt && receipt.meta && !receipt.meta.err);
const events = receipt.meta.logMessages
  .filter((line) => line.startsWith("Program data: "))
  .map((line) => sdk.decodeOnepercentEvent(line.slice(14)))
  .filter(Boolean);
const event = events.find((e) => e.name === "LaunchFeesClaimed");
assert(event);
const claimed = BigInt(String(event.data.quote));
assert.equal(claimed, state.partnerQuoteFee);
assert.equal(BigInt(String(event.data.base)), 0n);
const poolAfter = sdk.decodeDbcPool((await rpc.getAccountInfo(pool)).data);
assert.equal(poolAfter.partnerQuoteFee, 0n);
const report = {
  status: "PASS",
  metadata,
  swapInput: quote.quoteIn,
  tradeFee: String(tradeFee),
  protocolFee: String(state.protocolQuoteFee),
  partnerClaimed: String(claimed),
  claimEvent: JSON.parse(
    JSON.stringify(event.data, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    ),
  ),
  signature,
  pool: pool.toBase58(),
  stockBefore: String(before.stock_sol),
  stockAfter: String(after.stock_sol),
  stockDelta: String(after.stock_sol - before.stock_sol),
  teamBefore: String(before.team_sol),
  teamAfter: String(after.team_sol),
};
writeFileSync("reports/devnet/fees.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
