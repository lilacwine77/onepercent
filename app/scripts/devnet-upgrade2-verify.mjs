import { DEVNET_GENESIS_HASH } from "../packages/config/dist/genesis.js";
// Public, read-only RPC verification. No signer files or submission methods.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  HIT_LIST,
  KEEPER_POLICY,
  PAUSE_BITS,
  POST_REVEAL_BUY_DELAY,
  SELL_BACK,
  STOCK,
} from "../packages/config/dist/index.js";
import { createDevnetFetch } from "./devnet-fetch.mjs";
import {
  compareAccounts,
  p3Fields,
  programDataEvidence,
} from "./devnet-upgrade2-snapshot.mjs";
import { verifyImmutableMetadata } from "./devnet-metadata.mjs";

const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 1 && args[0] === "--partial"),
  "Usage: node scripts/devnet-upgrade2-verify.mjs [--partial]",
);
const partial = args[0] === "--partial";
const pid = new PublicKey("DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr");
const payer = new PublicKey("DpMXTAcBPhEpNA2joqP6eEgJkfetjzRiQyVUfQoqZG93");
const read = (name) =>
  JSON.parse(readFileSync(`reports/devnet/${name}.json`, "utf8"));
const before = read("upgrade2-before"),
  after = read("upgrade2-after");
const smoke = read("upgrade2-smoke"),
  fees = read("upgrade2-fees"),
  swap = read("upgrade2-fee-swap");
const journal = read("transactions");
const inventoryBefore = read("upgrade2-inventory");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) =>
  JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? String(item) : item),
    2,
  );
const discriminator = (name) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const rpc = new Connection("https://api.devnet.solana.com", {
  commitment: "finalized",
  disableRetryOnRateLimit: true,
  fetch: createDevnetFetch(),
});
assert.equal(await rpc.getGenesisHash(), DEVNET_GENESIS_HASH, "Devnet only");
for (const snapshot of [before, after]) {
  assert.equal(snapshot.cluster, "devnet");
  assert.equal(snapshot.program, String(pid));
}
assert.equal(smoke.cluster, "devnet");
assert.equal(fees.status, "PASS");
assert.equal(swap.status, "PASS");
let comparisonBefore = before;
if (after.reconciliation) {
  const { reconcile } = await import("./devnet-upgrade2-reconcile.mjs");
  comparisonBefore = await reconcile();
  assert.deepEqual(comparisonBefore.reconciliation, after.reconciliation);
}
const preservation = compareAccounts(comparisonBefore.accounts, after.accounts);
const originalMachine = sdk.decodeMachine(
  Buffer.from(
    before.accounts.find((row) => row.kind === "Machine").dataBase64,
    "base64",
  ),
);
const activatedMachine = sdk.decodeMachine(
  Buffer.from(
    after.accounts.find((row) => row.kind === "Machine").dataBase64,
    "base64",
  ),
);
const receipts = new Map();

async function receipt(signature) {
  assert(
    typeof signature === "string" && signature.length > 0,
    "Missing signature",
  );
  if (receipts.has(signature)) return receipts.get(signature);
  // Keep this verification below the public endpoint's per-method request rate.
  await delay(1_100);
  const value = await rpc.getTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  assert(
    value?.meta && Number.isSafeInteger(value.blockTime),
    `Finalized receipt unavailable: ${signature}`,
  );
  const message = value.transaction.message;
  const keys = message.getAccountKeys({
    accountKeysFromLookups: value.meta.loadedAddresses,
  });
  const instructions = message.compiledInstructions.map((ix) => ({
    program: String(keys.get(ix.programIdIndex)),
    data: Buffer.from(ix.data),
  }));
  const parsed = sdk.parseOnepercentLogs({
    logs: value.meta.logMessages,
    err: value.meta.err,
    programId: String(pid),
    topLevelProgramIds: instructions.map((ix) => ix.program),
  });
  assert(
    !parsed.truncated && !parsed.malformed && !parsed.unknownEvent,
    `Incomplete events: ${signature}`,
  );
  const result = { signature, value, instructions, events: parsed.events };
  receipts.set(signature, result);
  return result;
}
const oneEvent = (proof, name) => {
  const found = proof.events.filter((event) => event.name === name);
  assert.equal(found.length, 1, `Expected one ${name}: ${proof.signature}`);
  return found[0].data;
};
const success = async (signature) => {
  const proof = await receipt(signature);
  assert.equal(proof.value.meta.err, null, `Failed transaction: ${signature}`);
  return proof;
};

// Read all operation signatures recorded by the drivers, excluding saved bytes.
const reportedSignatures = new Set();
function collectSignatures(value, key = "") {
  if (typeof value === "string" && /signature$/i.test(key))
    reportedSignatures.add(value);
  else if (Array.isArray(value))
    for (const item of value)
      collectSignatures(item, /signatures$/i.test(key) ? "signature" : "");
  else if (value && typeof value === "object")
    for (const [name, item] of Object.entries(value))
      collectSignatures(item, name);
}
for (const report of [smoke, fees, swap]) collectSignatures(report);
const p3Prefix = `p3/${after.sha256}`;
const p3Labels = new Set(
  ["pause-rip", "activate-p3", "resume-rip"].map(
    (name) => `${p3Prefix}/${name}`,
  ),
);
const operationEntries = Object.entries(journal).filter(
  ([label, entry]) =>
    label.startsWith("upgrade2/") ||
    p3Labels.has(label) ||
    (label.startsWith(`upgrade/${after.sha256}/`) &&
      !label.includes("/upload/")) ||
    (label.startsWith("feed/") && entry.slot > before.slot),
);
const abandoned = [];
for (const [label, entry] of operationEntries) {
  if (!Number.isSafeInteger(entry.slot)) {
    assert(Number.isSafeInteger(entry.lastValidBlockHeight));
    const status = (
      await rpc.getSignatureStatuses([entry.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status) {
      assert.equal(
        status.confirmationStatus,
        "finalized",
        `Unresolved journal transaction: ${label}`,
      );
    } else {
      // Absence alone is insufficient: a still-valid saved transaction can land.
      const finalizedBlockHeight = await rpc.getBlockHeight("finalized");
      assert(
        finalizedBlockHeight > entry.lastValidBlockHeight,
        `Saved transaction has not expired at finalized commitment: ${label}`,
      );
      const finalizedSlot = await rpc.getSlot("finalized");
      const absent = await rpc.getSignatureStatuses([entry.signature], {
        searchTransactionHistory: true,
      });
      assert(absent.context.slot >= finalizedSlot);
      assert.equal(absent.value[0], null, `Transaction appeared: ${label}`);
      assert(
        !reportedSignatures.has(entry.signature),
        `A report claims an absent transaction: ${label}`,
      );
      abandoned.push({
        label,
        signature: entry.signature,
        lastValidBlockHeight: entry.lastValidBlockHeight,
        finalizedBlockHeight,
        finalizedSlot,
        observedSlot: absent.context.slot,
        status: "EXPIRED_WITHOUT_OBSERVED_EXECUTION",
      });
      continue;
    }
  }
  reportedSignatures.add(entry.signature);
}
const guardSignatures = new Set(
  Object.values(smoke.guards).map((entry) => entry.signature),
);
for (const signature of reportedSignatures)
  if (!guardSignatures.has(signature)) await success(signature);

const p3State = journal[p3Prefix];
assert.equal(p3State?.completed, true);
assert.equal(p3State.wasPaused, false, "This upgrade must restore open Rip");
async function migrationReceipt(label) {
  const saved = journal[label];
  assert.equal(saved?.finalized, true, `${label} was not finalized`);
  const proof = await success(saved.signature);
  assert.equal(saved.slot, proof.value.slot, `${label} slot mismatch`);
  return proof;
}
const pause = await migrationReceipt(`${p3Prefix}/pause-rip`),
  upgraded = await migrationReceipt(
    `upgrade/${after.sha256}/${before.deploymentSlot}/upgrade`,
  ),
  activated = await migrationReceipt(`${p3Prefix}/activate-p3`),
  resumed = await migrationReceipt(`${p3Prefix}/resume-rip`);
for (const [proof, paused] of [
  [pause, true],
  [resumed, false],
]) {
  assert(
    proof.instructions.some(
      (ix) =>
        ix.program === String(pid) &&
        ix.data.equals(
          Buffer.concat([
            discriminator("guardian"),
            Buffer.from([0, PAUSE_BITS.rip, Number(paused)]),
          ]),
        ),
    ),
    "Expected exact Rip pause instruction",
  );
  const event = oneEvent(proof, "ConfigChanged");
  assert.equal(event.action, 8);
  assert.equal(event.actor, String(payer));
  assert.equal(event.a, BigInt(PAUSE_BITS.rip));
  assert.equal(event.b, BigInt(Number(paused)));
}
assert(
  activated.instructions.some(
    (ix) =>
      ix.program === String(pid) &&
      ix.data.equals(discriminator("advance_phase")),
  ),
  "Initial activation must use advance_phase",
);
assert.equal(upgraded.value.slot, Number(after.deploymentSlot));
assert.equal(inventoryBefore.pullsChecked, 0);
assert(Number.isSafeInteger(inventoryBefore.slot));
assert(Number.isSafeInteger(p3State.pauseSlot));
assert(Number.isSafeInteger(p3State.activated?.slot));
assert(
  pause.value.slot <= p3State.pauseSlot &&
    p3State.pauseSlot <= inventoryBefore.slot &&
    inventoryBefore.slot < upgraded.value.slot &&
    upgraded.value.slot < activated.value.slot &&
    activated.value.slot <= p3State.activated.slot &&
    p3State.activated.slot < resumed.value.slot &&
    resumed.value.slot <= after.slot,
  "Required finalized order: pause, empty inventory, upgrade, activation, resume",
);
assert.equal(
  BigInt(p3State.activated.lastRevealTs),
  activatedMachine.last_reveal_ts,
);
const migration = {
  pause: { signature: pause.signature, slot: pause.value.slot },
  pauseObservedSlot: p3State.pauseSlot,
  inventory: inventoryBefore,
  upgrade: { signature: upgraded.signature, slot: upgraded.value.slot },
  activation: { signature: activated.signature, slot: activated.value.slot },
  activationObservedSlot: p3State.activated.slot,
  resume: { signature: resumed.signature, slot: resumed.value.slot },
};

const activationReplay = await success(smoke.activationReplay.signature);
assert(
  activationReplay.instructions.some(
    (ix) =>
      ix.program === String(pid) &&
      ix.data.equals(discriminator("advance_phase")),
  ),
  "Activation replay must invoke the permissionless advance_phase instruction",
);
assert.equal(
  String(activationReplay.value.transaction.message.staticAccountKeys[0]),
  smoke.activationReplay.signer,
);
assert.notEqual(smoke.activationReplay.signer, String(payer));
assert(
  !activationReplay.events.some(
    (event) => event.name === "KeeperHistoryStarted",
  ),
  "Idempotent replay must not restart history",
);

const guards = {};
const missingGuards = [];
for (const code of [6071, 6072, 6073, 6074]) {
  const observed = smoke.guards[code];
  const saved = journal[`upgrade2/refusal-${code}`];
  if (!observed) {
    assert(
      partial && [6071, 6072].includes(code),
      `Missing executed guard ${code}; only --partial can report this limitation`,
    );
    assert(
      !saved || abandoned.some((entry) => entry.signature === saved.signature),
      `An executed guard is missing its report: ${code}`,
    );
    missingGuards.push(code);
    guards[code] = { status: "NOT_EXECUTED", signature: null };
    continue;
  }
  assert.equal(saved?.signature, observed.signature);
  const proof = await receipt(observed.signature);
  const error = proof.value.meta.err?.InstructionError;
  assert(Array.isArray(error));
  assert.equal(error[1]?.Custom, code);
  assert.equal(error[0], saved.instructionIndex);
  const ix = proof.instructions[error[0]];
  assert.equal(ix.program, String(pid));
  assert(ix.data.subarray(0, 8).equals(discriminator("exec_begin")));
  assert.equal(ix.data[8], sdk.EXEC_KIND.stockBuy);
  assert(
    proof.value.meta.logMessages.some((line) =>
      line.includes(`Error Number: ${code}`),
    ),
  );
  guards[code] = {
    status: "PASS",
    signature: proof.signature,
    slot: proof.value.slot,
    blockTime: proof.value.blockTime,
    instructionIndex: error[0],
    bucket: ix.data[9],
    amount: ix.data.readBigUInt64LE(10),
    probeOnly: observed.probeOnly,
  };
}

const rip = await success(smoke.ripSignature),
  settle = await success(smoke.settleSignature);
const opened = oneEvent(rip, "PullOpened");
assert.equal(opened.pull, smoke.pull);
assert.equal(opened.buyer, smoke.buyer);
assert.equal(opened.qty, 1);
assert.equal(oneEvent(settle, "PackSettled").seq, opened.seq);
assert.equal(oneEvent(settle, "PullClosed").pull, smoke.pull);
let concurrentKeeper = null;
if (smoke.externalSettle || missingGuards.length > 0) {
  assert(smoke.externalSettle, "Missing evidence of the concurrent keeper");
  const activatedConfig = sdk.decodeConfig(
    Buffer.from(
      after.accounts.find((row) => row.kind === "Config").dataBase64,
      "base64",
    ),
  );
  const signer = String(settle.value.transaction.message.staticAccountKeys[0]);
  assert.equal(signer, String(activatedConfig.keeper));
  assert.equal(signer, smoke.externalSettle.signer);
  assert.equal(settle.value.slot, smoke.externalSettle.slot);
  assert.notEqual(signer, smoke.buyer);
  assert(
    !Object.values(journal).some(
      (entry) => entry.signature === smoke.settleSignature,
    ),
    "Concurrent settle must be external to the local transaction journal",
  );
  assert(
    settle.instructions.some(
      (ix) =>
        ix.program === String(pid) &&
        ix.data.subarray(0, 8).equals(discriminator("settle")),
    ),
  );
  concurrentKeeper = {
    signer,
    signature: settle.signature,
    slot: settle.value.slot,
    blockTime: settle.value.blockTime,
  };
}
let callback;
for (const candidate of await rpc.getSignaturesForAddress(
  new PublicKey(smoke.pull),
  { limit: 30 },
  "finalized",
)) {
  if (
    candidate.err ||
    [smoke.ripSignature, smoke.settleSignature].includes(candidate.signature)
  )
    continue;
  const proof = await success(candidate.signature);
  const revealed = proof.events.find(
    (event) =>
      event.name === "RevealTimestamped" && event.data.seq === opened.seq,
  );
  if (!revealed) continue;
  assert(!callback, "Multiple committed reveal timestamps for this Pull");
  assert(
    proof.value.meta.logMessages.includes(
      `Program ${sdk.EXTERNAL_IDS.magicblockVrf} invoke [1]`,
    ),
  );
  assert(proof.value.meta.logMessages.includes(`Program ${pid} invoke [2]`));
  callback = {
    signature: proof.signature,
    slot: proof.value.slot,
    blockTime: proof.value.blockTime,
    ...revealed.data,
  };
}
assert(callback, "Missing real MagicBlock VRF callback");
assert(rip.value.slot <= callback.slot && callback.slot <= settle.value.slot);
if (guards[6071].status === "PASS") {
  assert(
    rip.value.slot <= guards[6071].slot &&
      guards[6071].slot <= settle.value.slot,
  );
  assert(
    BigInt(smoke.guards[6071].before.machine.pending_pulls) > 0n ||
      BigInt(smoke.guards[6071].before.machine.unsettled_reveals) > 0n,
  );
}
const revealDeadline = callback.ts + BigInt(POST_REVEAL_BUY_DELAY);
if (guards[6072].status === "PASS") {
  assert(settle.value.slot <= guards[6072].slot);
  assert(
    BigInt(guards[6072].blockTime) >= callback.ts &&
      BigInt(guards[6072].blockTime) < revealDeadline,
    "6072 must execute within the real reveal delay",
  );
  assert.equal(BigInt(smoke.guards[6072].before.machine.unsettled_reveals), 0n);
  assert.equal(BigInt(smoke.guards[6072].before.machine.pending_pulls), 0n);
}
if (concurrentKeeper) {
  assert(
    BigInt(concurrentKeeper.blockTime) >= callback.ts &&
      BigInt(concurrentKeeper.blockTime) < revealDeadline,
    "Concurrent keeper must have settled inside the reveal-delay window",
  );
  concurrentKeeper.secondsAfterReveal =
    BigInt(concurrentKeeper.blockTime) - callback.ts;
}
const listed = oneEvent(
  await success(smoke.trending.signature),
  "BucketListed",
);
assert.equal(listed.bucket, smoke.trendingBucket);
assert.equal(listed.listed_ts, BigInt(smoke.trending.listedTs));
assert.equal(guards[6073].bucket, smoke.trendingBucket);
assert(BigInt(guards[6073].blockTime) >= listed.listed_ts);
assert(
  BigInt(guards[6073].blockTime) <
    listed.listed_ts + BigInt(HIT_LIST.trendingNoticeSeconds),
);
const lowStock = smoke.guards[6074].before.machine;
assert(
  BigInt(lowStock.stock_sol) - guards[6074].amount < SELL_BACK.solFloorLamports,
  "6074 must demonstrate the actual SOL floor",
);
const stockTrades = [];
for (const proof of receipts.values()) {
  const begun = proof.events.find((event) => event.name === "ExecBegun")?.data;
  if (
    !begun ||
    ![sdk.EXEC_KIND.stockBuy, sdk.EXEC_KIND.stockSell].includes(begun.kind)
  )
    continue;
  const ended = oneEvent(proof, "ExecEnded");
  assert.equal(ended.kind, begun.kind);
  assert.equal(ended.amount, begun.amount);
  assert(ended.delta >= ended.min_out);
  stockTrades.push({
    signature: proof.signature,
    slot: proof.value.slot,
    blockTime: proof.value.blockTime,
    ...ended,
  });
}
stockTrades.sort((left, right) => left.slot - right.slot);
let priorTradeTs = originalMachine.last_stock_trade_ts;
for (const trade of stockTrades) {
  assert(
    trade.ts >= priorTradeTs + BigInt(STOCK.tradeMinSpacingSeconds),
    "Stock spacing violated",
  );
  priorTradeTs = trade.ts;
}
const afterDelaySignature =
  smoke.transactions.afterDelay?.signature ??
  smoke.transactions["after-delay-major"]?.signature;
const afterDelay = stockTrades.find(
  (trade) => trade.signature === afterDelaySignature,
);
assert(afterDelay?.kind === sdk.EXEC_KIND.stockBuy);
assert(
  afterDelay.ts >= revealDeadline &&
    BigInt(afterDelay.blockTime) >= revealDeadline,
);
assert(
  afterDelay.ts < listed.listed_ts + BigInt(HIT_LIST.trendingNoticeSeconds),
  "MAJOR success must coexist with TRENDING notice",
);
const belowReserve = stockTrades.find(
  (trade) => trade.signature === smoke.exits.stockSellBelowReserve?.signature,
);
assert(belowReserve?.kind === sdk.EXEC_KIND.stockSell);
assert(
  BigInt(smoke.exits.stockSellBelowReserve.before.machine.stock_sol) <
    SELL_BACK.solFloorLamports,
);
const trendingNoticeDeadline =
  listed.listed_ts + BigInt(HIT_LIST.trendingNoticeSeconds);
assert(
  belowReserve.ts >= listed.listed_ts &&
    belowReserve.ts < trendingNoticeDeadline,
  "Sale below reserve must also execute during the TRENDING notice",
);
let unsettledSell = null;
if (smoke.exits.stockSellUnsettled) {
  unsettledSell = stockTrades.find(
    (trade) => trade.signature === smoke.exits.stockSellUnsettled.signature,
  );
  assert(unsettledSell?.kind === sdk.EXEC_KIND.stockSell);
  assert(
    BigInt(smoke.exits.stockSellUnsettled.before.machine.unsettled_reveals) >
      0n,
  );
  assert(
    callback.slot <= unsettledSell.slot &&
      unsettledSell.slot <= settle.value.slot,
  );
}
const unsettledSellDuringRevealDelay = Boolean(
  unsettledSell &&
  unsettledSell.ts >= callback.ts &&
  unsettledSell.ts < revealDeadline,
);

const expected = new Map(),
  redeemed = new Map();
for (const card of smoke.cards) {
  const prior = expected.get(card.mint);
  assert(!prior || prior.tokenProgram === card.tokenProgram);
  expected.set(card.mint, {
    tokenProgram: card.tokenProgram,
    amount: (prior?.amount ?? 0n) + BigInt(card.amount),
  });
}
for (const signature of smoke.redeemSignatures) {
  const proof = await success(signature);
  for (const event of proof.events.filter(
    (event) => event.name === "CardRedeemed",
  )) {
    assert.equal(event.data.owner, smoke.buyer);
    redeemed.set(
      event.data.mint,
      (redeemed.get(event.data.mint) ?? 0n) + event.data.amount,
    );
  }
}
const tokenBalances = [];
for (const [mint, wanted] of expected) {
  assert.equal(
    redeemed.get(mint),
    wanted.amount,
    "Redeem events must cover every card",
  );
  const address = sdk.userAta(
    new PublicKey(smoke.buyer),
    new PublicKey(mint),
    new PublicKey(wanted.tokenProgram),
  );
  const account = await rpc.getAccountInfo(address, "finalized");
  assert(account?.owner.equals(new PublicKey(wanted.tokenProgram)));
  assert(
    new PublicKey(account.data.subarray(0, 32)).equals(new PublicKey(mint)),
  );
  assert(
    new PublicKey(account.data.subarray(32, 64)).equals(
      new PublicKey(smoke.buyer),
    ),
  );
  const balance = account.data.readBigUInt64LE(64),
    prior = BigInt(smoke.tokenBalancesBefore[mint]);
  assert(
    balance >= prior + wanted.amount,
    "Redeemed tokens must reach the buyer",
  );
  tokenBalances.push({
    mint,
    address: String(address),
    before: prior,
    redeemed: wanted.amount,
    observed: balance,
  });
}
assert.equal(redeemed.size, expected.size);
oneEvent(await success(smoke.exits.takeBack.signature), "BagTakenBack");
const owed = await success(smoke.exits.withdrawOwed.signature);
const owedEvent = owed.events.find(
  (event) => event.name === "OwedWithdrawn",
)?.data;

const feeReceipt = await success(fees.signature);
const poolAfterSwap = sdk.decodeDbcPool(
  Buffer.from(fees.before.poolBase64, "base64"),
);
const expectedTradeFee = sdk.ceilDiv(
  BigInt(swap.quoteIn) * sdk.DBC_FEE_NUMERATOR,
  sdk.DBC_FEE_DENOMINATOR,
);
const feeParts = sdk.dbcFeeSplit(expectedTradeFee);
assert.equal(
  poolAfterSwap.protocolQuoteFee - BigInt(swap.protocolBefore),
  feeParts.protocolFee,
);
assert.equal(
  poolAfterSwap.partnerQuoteFee - BigInt(swap.partnerBefore),
  feeParts.partnerFee,
);
assert.equal(
  poolAfterSwap.quoteReserve - BigInt(swap.reserveBefore),
  BigInt(swap.quoteIn) - expectedTradeFee,
);
const claim = oneEvent(feeReceipt, "LaunchFeesClaimed"),
  collection = oneEvent(feeReceipt, "CreatorFeesCollected");
assert.equal(claim.kind, 0);
assert.equal(claim.pool, fees.pool);
assert.equal(claim.quote, BigInt(swap.partnerClaimable));
assert.equal(claim.base, 0n);
assert(claim.quote > 0n);
const unwrapped =
  BigInt(
    fees.before.feeInWsolExisted
      ? fees.before.feeInWsolLamports
      : fees.before.rentToken,
  ) + claim.quote;
assert.equal(claim.unwrapped_lamports, unwrapped);
const collected =
  BigInt(fees.before.feeInLamports) +
  unwrapped -
  BigInt(fees.before.rentSystem);
assert.equal(collection.amount, collected);
const feeMachine = sdk.decodeMachine(
  Buffer.from(fees.before.machineBase64, "base64"),
);
const regime = sdk.creatorFeeRegime(feeMachine, collection.ts),
  split = sdk.splitCreatorFees(collected, regime);
assert.equal(collection.regime, regime);
assert.equal(collection.to_stock, split.stock);
assert.equal(collection.to_team, split.team);
assert.equal(collection.to_burn, split.burn);
assert.equal(
  sdk.decodeDbcPool(
    (await rpc.getAccountInfo(new PublicKey(fees.pool), "finalized")).data,
  ).partnerQuoteFee,
  0n,
);

const final = await rpc.getMultipleAccountsInfoAndContext(
  [
    sdk.machinePda(pid)[0],
    sdk.binderPda(pid, new PublicKey(smoke.buyer))[0],
    new PublicKey(smoke.pull),
    new PublicKey(after.programData),
    payer,
    sdk.configPda(pid)[0],
  ],
  { commitment: "finalized" },
);
const [
  machineAccount,
  binderAccount,
  pullAccount,
  programData,
  payerAccount,
  configAccount,
] = final.value;
assert(
  machineAccount?.owner.equals(pid) &&
    binderAccount?.owner.equals(pid) &&
    configAccount?.owner.equals(pid) &&
    programData &&
    payerAccount,
);
assert.equal(pullAccount, null);
const machine = sdk.decodeMachine(machineAccount.data),
  binder = sdk.decodeBinder(binderAccount.data),
  config = sdk.decodeConfig(configAccount.data);
assert.equal(config.guardian_paused & PAUSE_BITS.rip, 0);
assert.equal(config.admin_paused & PAUSE_BITS.rip, 0);
const finalInventory = await rpc.getProgramAccounts(pid, {
  commitment: "finalized",
  minContextSlot: final.context.slot,
  withContext: true,
  filters: [
    {
      memcmp: {
        offset: 0,
        bytes: createHash("sha256")
          .update("account:Pull")
          .digest()
          .subarray(0, 8)
          .toString("base64"),
        encoding: "base64",
      },
    },
  ],
});
assert(finalInventory.context.slot >= final.context.slot);
assert.equal(finalInventory.value.length, 0, "Global Pull inventory not empty");
assert.equal(machine.pending_pulls, 0n);
assert.equal(machine.unsettled_reveals, 0n);
assert.equal(machine.reserved_dust, 0n);
assert.equal(machine.exec.kind, 0);
assert(machine.buckets.every((bucket) => bucket.reserved === 0n));
assert.equal(binder.cards.length, 0);
assert.equal(binder.reserved, 0);
assert.equal(machine.last_reveal_ts, callback.ts);
assert.equal(machine.last_stock_trade_ts, priorTradeTs);
assert.equal(machine.keeper_history_started_ts, 0n);
assert.equal(
  machine.bucket_history[0].listed_ts,
  originalMachine.bucket_history[0].listed_ts,
);
const raw = p3Fields(machineAccount.data);
for (const [field, value] of Object.entries(raw)) {
  if (field === "bucket_history")
    for (const row of value) {
      for (const name of ["listed_ts", "sb_inflow_hour", "sb_inflow_prev_hour"])
        assert.equal(
          String(machine.bucket_history[row.index][name]),
          row[name],
          `SDK/raw mismatch ${name}`,
        );
    }
  else
    assert.equal(
      String(machine[field]),
      value.value,
      `SDK/raw mismatch ${field}`,
    );
}
assert.equal(
  machine.bucket_history[smoke.trendingBucket].listed_ts,
  listed.listed_ts,
);
const binary = readFileSync("target/deploy/onepercent.so");
assert(
  programData.owner.equals(
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  ),
);
const deployed = programDataEvidence(programData.data, binary.length);
assert.equal(deployed.sha256, hash(binary));
assert.equal(deployed.sha256, after.sha256);
assert.equal(deployed.deploymentSlot, after.deploymentSlot);
assert.equal(deployed.authority, String(payer));
assert.equal(deployed.maxLen, after.maxLen);
const metadata = await verifyImmutableMetadata(rpc, machine.token_mint);
const feedTransactions = [...receipts.values()]
  .filter(
    (proof) =>
      proof.value.slot > Number(after.deploymentSlot) &&
      proof.events.some((event) => event.name === "BagFed"),
  )
  .map((proof) => ({
    signature: proof.signature,
    cards: proof.events.filter((event) => event.name === "BagFed").length,
  }));
assert(
  feedTransactions.length > 0,
  "A successful Feed after this upgrade is required",
);
const result = {
  status:
    missingGuards.length > 0
      ? "INCOMPLETE_CONCURRENT_KEEPER"
      : unsettledSellDuringRevealDelay
        ? "PASS"
        : "PASS_WITH_STOCKSELL_LIMITATION",
  verificationMode: partial ? "partial" : "strict",
  missingGuards,
  concurrentKeeper,
  abandoned,
  cluster: "devnet",
  observedAt: new Date().toISOString(),
  finalizedSlot: final.context.slot,
  program: String(pid),
  hashBefore: before.sha256,
  hashAfter: deployed.sha256,
  preservation,
  reconciliation: after.reconciliation ?? null,
  migration,
  activation: {
    initialTimestamp: activatedMachine.last_reveal_ts,
    replayTimestamp: smoke.activationReplay.timestamp,
    versionAfterActivation: activatedMachine.keeper_history_version,
  },
  guards,
  reveal: callback,
  revealDeadline,
  listing: listed,
  stockTrades,
  feedTransactions,
  exits: {
    takeBack: smoke.exits.takeBack.signature,
    settle: smoke.settleSignature,
    redeem: smoke.redeemSignatures,
    stockSellBelowReserve: belowReserve.signature,
    stockSellUnsettled: unsettledSell?.signature ?? null,
    stockSellConditions: {
      belowReserve: {
        signature: belowReserve.signature,
        ts: belowReserve.ts,
        stockBefore: smoke.exits.stockSellBelowReserve.before.machine.stock_sol,
        reserveFloor: SELL_BACK.solFloorLamports,
        duringTrendingNotice: true,
        trendingListedTs: listed.listed_ts,
        trendingNoticeDeadline,
      },
      unsettled: unsettledSell
        ? {
            signature: unsettledSell.signature,
            ts: unsettledSell.ts,
            unsettledRevealsBefore:
              smoke.exits.stockSellUnsettled.before.machine.unsettled_reveals,
            duringRevealDelay: unsettledSellDuringRevealDelay,
            revealTs: callback.ts,
            revealDeadline,
          }
        : null,
    },
    withdrawOwed: {
      signature: owed.signature,
      amount: owedEvent?.amount ?? 0n,
    },
  },
  tokenBalances,
  fees: {
    signature: fees.signature,
    tradeFee: expectedTradeFee,
    claim,
    collection,
  },
  metadata,
  finalMachine: {
    phase: machine.phase,
    stock: machine.stock_sol,
    pendingPulls: machine.pending_pulls,
    unsettledReveals: machine.unsettled_reveals,
    fields: raw,
  },
  finalConfig: {
    slot: final.context.slot,
    guardianPaused: config.guardian_paused,
    adminPaused: config.admin_paused,
    ripOpen: true,
  },
  finalPullInventory: {
    slot: finalInventory.context.slot,
    pullsChecked: finalInventory.value.length,
  },
  payerBalance: payerAccount.lamports,
  transactions: [...receipts.values()].map((proof) => ({
    signature: proof.signature,
    slot: proof.value.slot,
    blockTime: proof.value.blockTime,
    error: proof.value.meta.err,
    fee: proof.value.meta.fee,
  })),
  reserveWindowSeconds: KEEPER_POLICY.solReserveExtraMinutes * 60,
  limitations: [
    ...(missingGuards.length > 0
      ? [
          `Guards ${missingGuards.join(", ")} have no executed refusal proof; the concurrent keeper settled this Pull before those probes completed.`,
        ]
      : []),
    "TRENDING is an admission probe with canonical addresses; no graduated pool, quote or successful TRENDING swap is proved.",
    "MAJOR trades use the approved fictitious SOL/USD fixture and transfer adapter, not market pricing.",
    "Block timestamps are checked alongside execution events and captured Clock observations; stored snapshots are not historical RPC account proofs.",
    "Refund and Final Pull exits require other lifecycle states and are not claimed as exercised by this smoke.",
    ...(!unsettledSell
      ? [
          "StockSell during an unsettled reveal was not exercised; only the successful sale below reserve is proved.",
        ]
      : []),
    ...(unsettledSell && !unsettledSellDuringRevealDelay
      ? [
          "StockSell succeeded before settlement, but outside the 30-second reveal delay; simultaneous exemption from 6072 is not proved.",
        ]
      : []),
    ...(owedEvent
      ? []
      : ["withdraw_owed succeeded with no positive payout event."]),
  ],
};
assert.equal(
  BigInt(smoke.activationReplay.timestamp),
  activatedMachine.last_reveal_ts,
);
writeFileSync("reports/devnet/upgrade2-verified.json", `${json(result)}\n`);
console.log(
  json({
    status: result.status,
    hashBefore: result.hashBefore,
    hashAfter: result.hashAfter,
    guards: Object.keys(guards),
    missingGuards,
    abandoned: abandoned.map(({ signature }) => signature),
    payerBalance: result.payerBalance,
  }),
);
