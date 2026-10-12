import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  rpc,
  payer,
  pid,
  pub,
  key,
  send as sessionSend,
  requireBalance,
  journal,
} from "./devnet-session.mjs";
const run = process.argv[2] ?? "initial";
assert(/^[a-z0-9-]+$/.test(run), "Invalid smoke run name");
const prefix = run === "initial" ? "" : `${run}/`;
const send = (label, ...args) => sessionSend(`${prefix}${label}`, ...args);
assert(
  existsSync("reports/devnet/stock-fixture.json"),
  "Rip requires an approved and funded devnet MAJOR fixture",
);
const walletPath = `${homedir()}/.config/solana/onepercent-devnet/rip-wallet.json`;
if (!existsSync(walletPath))
  writeFileSync(walletPath, JSON.stringify([...Keypair.generate().secretKey]), {
    mode: 0o600,
    flag: "wx",
  });
const buyer = key(walletPath);
const deficit = Math.max(
  0,
  250_000_000 - (await rpc.getBalance(buyer.publicKey)),
);
if (deficit && !journal[`${prefix}rip`]) {
  await requireBalance(deficit + 1_000_000);
  await send("fund-rip-wallet", [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: buyer.publicKey,
      lamports: deficit,
    }),
  ]);
}
const table = (
  await rpc.getAddressLookupTable(
    pub(
      JSON.parse(readFileSync("reports/devnet/protocol-lut.json", "utf8"))
        .address,
    ),
  )
).value;
assert(table);
const options = async () => ({
  wallet: buyer.publicKey,
  blockhash: (await rpc.getLatestBlockhash("confirmed")).blockhash,
  lut: table,
  priorityFeeMicroLamports: 0n,
});
async function built(label, tx, signer = buyer) {
  const instructions = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: [table],
  }).instructions;
  assert(
    instructions
      .slice(0, 2)
      .every((ix) => ix.programId.equals(ComputeBudgetProgram.programId)),
  );
  return send(label, instructions.slice(2), [signer], {
    units: 600000,
    tables: [table],
  });
}
let machine = await sdk.fetchMachine(pid, rpc);
assert(machine.power_on_ts > 0n);
const waitStarted = Date.now();
while (true) {
  const now = await rpc.getBlockTime(await rpc.getSlot("confirmed"));
  assert(now !== null);
  if (BigInt(now) >= machine.on_air_ts) break;
  assert(
    Date.now() - waitStarted < 1_000_000,
    "OnAir deadline not reached within bounded wait",
  );
  console.log(
    JSON.stringify({ waitingForOnAirSeconds: Number(machine.on_air_ts) - now }),
  );
  await delay(30000);
}
if (machine.phase !== 3)
  await send("on-air", [sdk.advancePhaseInstruction(pid)]);
const config = await sdk.fetchConfig(pid, rpc);
const reportPath = `reports/devnet/${prefix ? `${run}-` : ""}rip.json`;
let report = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : null;
if (!report) {
  const binder = await sdk.fetchBinder(pid, rpc, buyer.publicKey),
    nonce = binder?.pull_nonce ?? 0;
  report = {
    wallet: buyer.publicKey.toBase58(),
    walletPath,
    pull: sdk.pullPda(pid, buyer.publicKey, nonce)[0].toBase58(),
    nonce,
    queue: config.vrf_queues[config.active_queue].toBase58(),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
if (!report.ripSignature) {
  report.ripSignature = await built(
    "rip",
    sdk.buildBuyPacksTransaction(pid, {
      ...(await options()),
      edition: 0,
      qty: 1,
      pullNonce: report.nonce,
      oracleQueue: pub(report.queue),
    }),
  );
  save();
}
if (!report.settleSignature) {
  let pull;
  const started = Date.now();
  while (true) {
    pull = await sdk.fetchPull(pid, rpc, pub(report.pull));
    assert(pull, "Pull missing before settle");
    if (pull.status === 2) break;
    assert(
      Date.now() - started < 180000,
      "VRF still pending; inspect Pull before refund/retry",
    );
    await delay(2000);
  }
  report.revealedSeq = String(pull.seq);
  report.revealedStatus = pull.status;
  const callbacks = await rpc.getSignaturesForAddress(
    pub(report.pull),
    { limit: 10 },
    "finalized",
  );
  report.pullSignatures = callbacks
    .filter((s) => !s.err)
    .map((s) => ({ signature: s.signature, slot: s.slot }));
  save();
  const record = pull.packs[0];
  const flags = await sdk.fetchPayees(rpc, [
    buyer.publicKey,
    pull.referrer,
    ...record.royalties.map((r) => r.depositor),
  ]);
  report.settleSignature = await built(
    "settle",
    sdk.buildSettleTransaction(pid, {
      ...(await options()),
      packs: [
        {
          pull: pub(report.pull),
          seq: pull.seq,
          pack: 0,
          buyer: flags[0],
          referrer: pull.referrer.equals(SystemProgram.programId)
            ? undefined
            : flags[1],
          wallets: record.royalties.map((_, i) =>
            record.house_mask & (1 << i) ? null : flags[i + 2],
          ),
        },
      ],
    }),
  );
  save();
}
assert.equal(await sdk.fetchPull(pid, rpc, pub(report.pull)), null);
const binder = await sdk.fetchBinder(pid, rpc, buyer.publicKey);
assert(binder);
if (binder.cards.length) {
  const cards = [];
  for (const [cardIndex, card] of binder.cards.entries()) {
    const info = await rpc.getAccountInfo(card.mint);
    assert(info);
    cards.push({
      cardIndex,
      mint: card.mint,
      amount: card.amount,
      tokenProgram: info.owner,
    });
  }
  report.cards = cards.map((c) => ({
    ...c,
    mint: c.mint.toBase58(),
    amount: String(c.amount),
    tokenProgram: c.tokenProgram.toBase58(),
  }));
  save();
  if (!report.tokenBalancesBefore) {
    report.tokenBalancesBefore = {};
    for (const card of cards) {
      const address = sdk.userAta(
        buyer.publicKey,
        card.mint,
        card.tokenProgram,
      );
      const account = await rpc.getAccountInfo(address);
      report.tokenBalancesBefore[card.mint.toBase58()] = String(
        account?.data.readBigUInt64LE(64) ?? 0n,
      );
    }
    save();
  }
  const txs = sdk.buildRedeemTransactions(pid, { ...(await options()), cards });
  report.redeemSignatures = [];
  for (let i = 0; i < txs.length; i++)
    report.redeemSignatures.push(await built(`redeem/${i}`, txs[i]));
  save();
}
const after = await sdk.fetchBinder(pid, rpc, buyer.publicKey);
assert(after && after.len === 0 && after.reserved === 0);
const received = new Map();
for (const card of report.cards ?? []) {
  const entry = received.get(card.mint) ?? {
    mint: card.mint,
    tokenProgram: card.tokenProgram,
    expected: 0n,
  };
  entry.expected += BigInt(card.amount);
  received.set(card.mint, entry);
}
report.redeemedTokenBalances = [];
for (const entry of received.values()) {
  const address = sdk.userAta(
    buyer.publicKey,
    pub(entry.mint),
    pub(entry.tokenProgram),
  );
  const account = await rpc.getAccountInfo(address, "finalized");
  assert(account && account.owner.equals(pub(entry.tokenProgram)));
  assert(pub(account.data.subarray(32, 64)).equals(buyer.publicKey));
  const amount = account.data.readBigUInt64LE(64);
  assert(
    amount >=
      entry.expected + BigInt(report.tokenBalancesBefore?.[entry.mint] ?? "0"),
    "Redeemed units must reach the buyer token account",
  );
  report.redeemedTokenBalances.push({
    mint: entry.mint,
    account: address.toBase58(),
    expected: String(entry.expected),
    observed: String(amount),
    before: report.tokenBalancesBefore?.[entry.mint] ?? null,
  });
}
const callback = report.pullSignatures.find(
  (entry) => entry.signature !== report.ripSignature,
);
assert(callback, "A real VRF callback receipt is required");
const receipt = await rpc.getTransaction(callback.signature, {
  commitment: "finalized",
  maxSupportedTransactionVersion: 0,
});
assert(receipt?.meta && !receipt.meta.err);
const logs = receipt.meta.logMessages ?? [];
assert(logs.includes(`Program ${sdk.EXTERNAL_IDS.magicblockVrf} invoke [1]`));
assert(logs.includes(`Program ${pid} invoke [2]`));
assert(logs.includes("Program log: Instruction: ConsumeRandomness"));
report.callbackProof = {
  ...callback,
  instruction: "consume_randomness",
  viaMagicBlockVrf: true,
};
report.status = "PASS";
report.balance = await rpc.getBalance(buyer.publicKey);
save();
console.log(JSON.stringify(report));
