// A positive Curve claim and creator-fee collection, separate from launch state.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import { parseOnepercentLogs } from "../packages/sdk/dist/events/index.js";
import {
  rpc,
  payer,
  pid,
  pub,
  profile,
  send,
  requireBalance,
} from "./devnet-session.mjs";
import { verifyImmutableMetadata } from "./devnet-metadata.mjs";
import { NATIVE_MINT } from "./devnet-token.mjs";

const path = "reports/devnet/upgrade2-fees.json";
const label = "upgrade2/claim-curve-and-collect";
const deployment = sdk.createDeploymentSelector({ devnet: pid })("devnet");
const machineAddress = sdk.machinePda(pid)[0];
const machine = await sdk.fetchMachine(pid, rpc);
const mint = machine.token_mint;
const pool = sdk.dbcPoolPda(mint, pub(deployment.meteora.dbcConfig))[0];
const feeIn = sdk.feeInPda(pid)[0];
const feeInWsol = sdk.userAta(feeIn, NATIVE_MINT, sdk.EXTERNAL_IDS.splToken);
const json = (value) =>
  JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
let report = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : undefined;
const save = () => {
  writeFileSync(`${path}.new`, `${json(report)}\n`);
  renameSync(`${path}.new`, path);
};
if (report) {
  assert.equal(report.cluster, "devnet");
  assert.equal(report.program, pid.toBase58());
  assert.equal(report.pool, pool.toBase58());
}
if (report?.status === "PASS") {
  const status = (
    await rpc.getSignatureStatuses([report.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  assert.equal(status?.confirmationStatus, "finalized");
  assert.equal(status?.err, null);
  assert.deepEqual(await verifyImmutableMetadata(rpc, mint), report.metadata);
  console.log(
    json({
      ...report,
      before: {
        ...report.before,
        machineBase64: undefined,
        poolBase64: undefined,
      },
      reconciled: true,
    }),
  );
  process.exit(0);
}

if (!report) {
  const before = await rpc.getMultipleAccountsInfoAndContext(
    [machineAddress, pool, feeIn, feeInWsol],
    { commitment: "finalized" },
  );
  const [machineAccount, poolAccount, feeAccount, wsolAccount] = before.value;
  assert(machineAccount?.owner.equals(pid));
  assert(poolAccount?.owner.equals(sdk.EXTERNAL_IDS.meteoraDbc));
  const poolState = sdk.decodeDbcPool(poolAccount.data);
  const state = sdk.decodeMachine(machineAccount.data);
  assert(
    state.phase === sdk.PHASE.poweredOn || state.phase === sdk.PHASE.onAir,
    "Fee rehearsal expects an active season",
  );
  assert(
    poolState.partnerQuoteFee > 0n,
    "Generate a positive Curve fee before this smoke",
  );
  const rentSystem = await rpc.getMinimumBalanceForRentExemption(0);
  const rentToken = await rpc.getMinimumBalanceForRentExemption(165);
  report = {
    status: "prepared",
    cluster: "devnet",
    program: pid.toBase58(),
    mint: mint.toBase58(),
    pool: pool.toBase58(),
    feeIn: feeIn.toBase58(),
    observedAt: new Date().toISOString(),
    metadata: await verifyImmutableMetadata(rpc, mint),
    before: {
      slot: before.context.slot,
      machineBase64: machineAccount.data.toString("base64"),
      machineLamports: machineAccount.lamports,
      poolBase64: poolAccount.data.toString("base64"),
      feeInLamports: feeAccount?.lamports ?? 0,
      feeInWsolLamports: wsolAccount?.lamports ?? 0,
      feeInWsolExisted: wsolAccount !== null,
      rentSystem,
      rentToken,
      partnerQuoteFee: poolState.partnerQuoteFee.toString(),
    },
  };
  save();
}

const beforeMachine = sdk.decodeMachine(
  Buffer.from(report.before.machineBase64, "base64"),
);
const beforePoolBytes = Buffer.from(report.before.poolBase64, "base64");
const beforePool = sdk.decodeDbcPool(beforePoolBytes);
const launchPool = sdk.decodeDbcLaunchPool(beforePoolBytes);
if (!report.signature) {
  const maxPriorityLamports =
    (1_400_000n * BigInt(profile.maxComputeUnitPriceMicroLamports) + 999_999n) /
    1_000_000n;
  await requireBalance(
    Number(maxPriorityLamports) + 2 * report.before.rentToken + 10_000,
  );
  report.signature = await send(
    label,
    [
      sdk.claimLaunchFeesIx(deployment, {
        kind: "curve",
        payer: payer.publicKey,
        mint,
        baseVault: launchPool.baseVault,
        quoteVault: launchPool.quoteVault,
      }),
      sdk.collectCreatorFeesIx(deployment, { payer: payer.publicKey }),
    ],
    [payer],
    {
      beforeBroadcast: async () => {
        const live = await rpc.getAccountInfo(pool, "confirmed");
        assert(
          live &&
            sdk.decodeDbcPool(live.data).partnerQuoteFee ===
              beforePool.partnerQuoteFee,
          "Curve fees changed: reconcile the saved signature before another broadcast",
        );
      },
    },
  );
  save();
}
const receipt = await rpc.getTransaction(report.signature, {
  commitment: "finalized",
  maxSupportedTransactionVersion: 0,
});
assert(receipt?.meta && !receipt.meta.err, "Finalized fee receipt is required");
const parsed = parseOnepercentLogs({
  logs: receipt.meta.logMessages,
  err: receipt.meta.err,
  programId: pid.toBase58(),
});
assert(!parsed.truncated && !parsed.malformed && !parsed.unknownEvent);
const claims = parsed.events.filter(({ name }) => name === "LaunchFeesClaimed");
const collections = parsed.events.filter(
  ({ name }) => name === "CreatorFeesCollected",
);
assert.equal(claims.length, 1);
assert.equal(collections.length, 1);
const claim = claims[0].data,
  collection = collections[0].data;
assert.equal(claim.kind, 0);
assert.equal(String(claim.pool), pool.toBase58());
assert.equal(claim.quote, beforePool.partnerQuoteFee);
assert.equal(claim.base, 0n);
const expectedUnwrapped =
  BigInt(
    report.before.feeInWsolExisted
      ? report.before.feeInWsolLamports
      : report.before.rentToken,
  ) + claim.quote;
assert.equal(claim.unwrapped_lamports, expectedUnwrapped);
const available = BigInt(report.before.feeInLamports) + expectedUnwrapped;
const expectedCollection =
  available > BigInt(report.before.rentSystem)
    ? available - BigInt(report.before.rentSystem)
    : 0n;
assert.equal(collection.amount, expectedCollection);
assert.equal(collection.from_fee_in, expectedCollection);
assert.equal(collection.from_wsol, 0n);
const regime = sdk.creatorFeeRegime(beforeMachine, collection.ts);
const split = sdk.splitCreatorFees(expectedCollection, regime);
assert.equal(collection.regime, regime);
assert.equal(collection.book, sdk.creatorFeeBook(beforeMachine));
assert.equal(collection.to_stock, split.stock);
assert.equal(collection.to_team, split.team);
assert.equal(collection.to_burn, split.burn);

const after = await rpc.getMultipleAccountsInfoAndContext(
  [machineAddress, pool, feeIn, feeInWsol],
  { commitment: "finalized", minContextSlot: receipt.slot },
);
const [afterMachineAccount, afterPoolAccount, afterFeeIn, afterWsol] =
  after.value;
assert(
  afterMachineAccount?.owner.equals(pid) &&
    afterPoolAccount?.owner.equals(sdk.EXTERNAL_IDS.meteoraDbc),
);
const afterMachine = sdk.decodeMachine(afterMachineAccount.data);
const afterPool = sdk.decodeDbcPool(afterPoolAccount.data);
assert.equal(afterPool.partnerQuoteFee, 0n);
for (const field of [
  "partnerBaseFee",
  "protocolBaseFee",
  "protocolQuoteFee",
  "baseReserve",
  "quoteReserve",
  "sqrtPrice",
])
  assert.equal(
    afterPool[field],
    beforePool[field],
    `Unexpected pool change: ${field}`,
  );
assert.equal(afterMachine.phase, beforeMachine.phase);
assert.equal(afterMachine.stock_sol - beforeMachine.stock_sol, split.stock);
assert.equal(afterMachine.team_sol - beforeMachine.team_sol, split.team);
assert.equal(afterMachine.burn_sol, beforeMachine.burn_sol);
assert.equal(afterMachine.jackpot_sol, beforeMachine.jackpot_sol);
assert.equal(afterMachine.pending_pulls, beforeMachine.pending_pulls);
assert.equal(afterMachine.unsettled_reveals, beforeMachine.unsettled_reveals);
assert.deepEqual(afterMachine.buckets, beforeMachine.buckets);
assert.equal(
  BigInt(afterMachineAccount.lamports - report.before.machineLamports),
  collection.amount,
);
assert.equal(BigInt(afterFeeIn?.lamports ?? 0), available - collection.amount);
assert.equal(afterWsol, null, "Claim must close the FeeIn wSOL ATA");
assert.deepEqual(await verifyImmutableMetadata(rpc, mint), report.metadata);
Object.assign(report, {
  status: "PASS",
  slot: receipt.slot,
  afterSlot: after.context.slot,
  claim,
  collection,
  after: {
    stock: afterMachine.stock_sol,
    team: afterMachine.team_sol,
    burn: afterMachine.burn_sol,
    jackpot: afterMachine.jackpot_sol,
    machineLamports: afterMachineAccount.lamports,
    feeInLamports: afterFeeIn?.lamports ?? 0,
    partnerQuoteFee: afterPool.partnerQuoteFee,
  },
});
save();
console.log(
  json({
    ...report,
    before: {
      ...report.before,
      machineBase64: undefined,
      poolBase64: undefined,
    },
  }),
);
