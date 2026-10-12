// Create a bounded real Curve fee for the M4.2 keeper rehearsal.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SystemProgram } from "@solana/web3.js";
import { EXECUTOR_POLICY } from "../packages/config/dist/index.js";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  rpc,
  payer,
  pid,
  pub,
  send,
  requireBalance,
} from "./devnet-session.mjs";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
} from "./devnet-token.mjs";
const deployment = sdk.createDeploymentSelector({ devnet: pid })("devnet");
const run = process.argv[2] ?? "upgrade1";
assert(["upgrade1", "upgrade2"].includes(run), "Expected upgrade1 or upgrade2");
const machine = await sdk.fetchMachine(pid, rpc),
  mint = machine.token_mint;
const configKey = pub(deployment.meteora.dbcConfig),
  pool = sdk.dbcPoolPda(mint, configKey)[0];
const path = `reports/devnet/${run}-fee-swap.json`;
let report = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const save = () => writeFileSync(path, JSON.stringify(report, null, 2));
if (report?.status === "PASS") {
  const status = (
    await rpc.getSignatureStatuses([report.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  assert.equal(status?.confirmationStatus, "finalized");
  assert.equal(status?.err, null);
  console.log(JSON.stringify({ ...report, reconciled: true }));
  process.exit(0);
}
if (!report) {
  const state = sdk.decodeDbcPool((await rpc.getAccountInfo(pool)).data);
  const config = sdk.buildDbcLaunchConfig();
  config.sqrtStartPrice = state.sqrtPrice;
  config.curve = config.curve.filter((s) => s.sqrtPrice > state.sqrtPrice);
  config.migrationQuoteThreshold -= state.quoteReserve;
  const budget = EXECUTOR_POLICY.minTrancheLamports;
  let lo = 1n,
    hi = state.baseReserve;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    try {
      if (sdk.quoteDbcExactOut(config, mid).quoteIn <= budget) lo = mid;
      else hi = mid - 1n;
    } catch {
      hi = mid - 1n;
    }
  }
  const quote = sdk.quoteDbcExactOut(config, lo);
  assert(quote.quoteIn <= budget);
  report = {
    pool: pool.toBase58(),
    budget: String(budget),
    amountOut: String(lo),
    quoteIn: String(quote.quoteIn),
    partnerBefore: String(state.partnerQuoteFee),
    protocolBefore: String(state.protocolQuoteFee),
    reserveBefore: String(state.quoteReserve),
  };
  save();
}
if (!report.signature) {
  const input = BigInt(report.quoteIn);
  await requireBalance(Number(input) + 10_000_000);
  const source = sdk.userAta(
    payer.publicKey,
    NATIVE_MINT,
    sdk.EXTERNAL_IDS.splToken,
  );
  assert(
    !(await rpc.getAccountInfo(source)),
    "Do not close an existing payer wSOL account",
  );
  report.signature = await send(`${run}/fee-swap`, [
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      source,
      payer.publicKey,
      NATIVE_MINT,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      sdk.userAta(payer.publicKey, mint, sdk.EXTERNAL_IDS.splToken),
      payer.publicKey,
      mint,
    ),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: source,
      lamports: input,
    }),
    createSyncNativeInstruction(source),
    sdk.dbcSwap2Ix({
      config: configKey,
      mint,
      user: payer.publicKey,
      amountOut: BigInt(report.amountOut),
      maxQuoteIn: input,
    }),
    createCloseAccountInstruction(source, payer.publicKey, payer.publicKey),
  ]);
  save();
}
const after = sdk.decodeDbcPool((await rpc.getAccountInfo(pool)).data);
const fee = (BigInt(report.quoteIn) * 250n + 9999n) / 10000n;
assert.equal(
  after.protocolQuoteFee - BigInt(report.protocolBefore),
  (fee * 20n) / 100n,
);
assert.equal(
  after.partnerQuoteFee - BigInt(report.partnerBefore),
  fee - (fee * 20n) / 100n,
);
assert.equal(
  after.quoteReserve - BigInt(report.reserveBefore),
  BigInt(report.quoteIn) - fee,
);
report.fee = String(fee);
report.partnerClaimable = String(after.partnerQuoteFee);
report.status = "PASS";
save();
console.log(JSON.stringify(report));
