// Journaled P3 rehearsal. Run prepare, then draw, then finish; devnet only.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  SystemProgram,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  STOCK,
  COVERAGE,
  CARDS_PER_PACK,
  SELL_BACK,
  POST_REVEAL_BUY_DELAY,
  HIT_LIST,
  devnetMajorFixtureProfile,
} from "../packages/config/dist/index.js";
import {
  rpc,
  pid,
  payer,
  pub,
  key,
  keyRoot,
  send,
  requireBalance,
  journal,
} from "./devnet-session.mjs";
import {
  prepareTrade,
  prepareTrendingProbe,
  stockState,
  freshOracle,
  waitSpacing,
} from "./devnet-p3-trade.mjs";
import { refuse } from "./devnet-p3-refusal.mjs";

const stage = process.argv[2];
assert(["prepare", "draw", "finish"].includes(stage));
const path = "reports/devnet/upgrade2-smoke.json";
const report = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { cluster: "devnet", guards: {}, exits: {}, transactions: {} };
const clean = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  );
const save = () => writeFileSync(path, JSON.stringify(report, null, 2));
const buyer = key(`${keyRoot}/test-user.json`);
const deployment = sdk.createDeploymentSelector({ devnet: pid })("devnet");
const major = devnetMajorFixtureProfile("devnet");
const table = (
  await rpc.getAddressLookupTable(
    pub(
      JSON.parse(readFileSync("reports/devnet/protocol-lut.json", "utf8"))
        .address,
    ),
  )
).value;
assert(table && !table.state.authority);
const readBinder = async () => {
  const info = await rpc.getAccountInfo(
    sdk.binderPda(pid, buyer.publicKey)[0],
    "confirmed",
  );
  return info ? sdk.decodeBinder(info.data) : null;
};
const readPull = async () => {
  const info = await rpc.getAccountInfo(pub(report.pull), "confirmed");
  return info ? sdk.decodePull(info.data) : null;
};
async function options() {
  return {
    wallet: buyer.publicKey,
    blockhash: (await rpc.getLatestBlockhash("confirmed")).blockhash,
    lut: table,
    priorityFeeMicroLamports: 0n,
  };
}
async function built(label, tx) {
  const instructions = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: [table],
  }).instructions;
  assert(
    instructions
      .slice(0, 2)
      .every((ix) => ix.programId.equals(ComputeBudgetProgram.programId)),
  );
  return send(`upgrade2/${label}`, instructions.slice(2), [buyer], {
    confirmed: true,
    units: 600000,
    tables: [table],
  });
}
async function trade(label, kind, amount) {
  if (report.transactions[label]) return report.transactions[label];
  const prepared = await prepareTrade(kind, amount);
  report.tradePlans ??= {};
  report.tradePlans[label] ??= {
    amount: String(amount),
    expected: String(prepared.expected),
    before: clean(prepared.before),
  };
  assert.equal(report.tradePlans[label].amount, String(amount));
  save();
  const signature = await send(
    `upgrade2/${label}`,
    prepared.instructions,
    prepared.signers,
    prepared.options,
  );
  report.transactions[label] = {
    signature,
    amount: String(amount),
    expected: report.tradePlans[label].expected,
    before: report.tradePlans[label].before,
    after: clean(await stockState()),
  };
  save();
  return report.transactions[label];
}
async function guard(code, prepared) {
  if (report.guards[code]) return;
  report.guardPlans ??= {};
  report.guardPlans[code] ??= clean(await stockState());
  save();
  const before = report.guardPlans[code];
  const signature = await refuse(`upgrade2/refusal-${code}`, prepared, code);
  report.guards[code] = {
    signature,
    before: clean(before),
    after: clean(await stockState()),
    probeOnly: prepared.guardProbeOnly,
  };
  save();
}
async function waitRevealDelay() {
  for (let attempt = 0; attempt < 90; attempt++) {
    const state = await stockState();
    if (
      state.now >=
      state.machine.last_reveal_ts + BigInt(POST_REVEAL_BUY_DELAY)
    )
      return;
    await delay(1000);
  }
  throw Error("Reveal delay deadline unavailable");
}

if (stage === "prepare") {
  const initial = await stockState();
  assert(
    initial.machine.last_reveal_ts > 0n &&
      initial.machine.pending_pulls === 0n &&
      initial.machine.unsettled_reveals === 0n,
  );
  if (!report.activationReplay) {
    const signature = await send(
      "upgrade2/activation-replay",
      [sdk.advancePhaseInstruction(pid)],
      [buyer],
    );
    const after = await stockState();
    assert.equal(after.machine.last_reveal_ts, initial.machine.last_reveal_ts);
    assert.equal(
      after.machine.keeper_history_version,
      initial.machine.keeper_history_version,
    );
    report.activationReplay = {
      signature,
      timestamp: String(after.machine.last_reveal_ts),
      signer: String(buyer.publicKey),
    };
    save();
  }
  if (report.trendingBucket === undefined) {
    const fixture = JSON.parse(
      readFileSync("reports/devnet/pump-fixtures.json", "utf8"),
    )[1];
    const mint = pub(fixture.mint);
    const signature = await send("upgrade2/list-trending", [
      sdk.adminListMintInstruction(pid, {
        admin: payer.publicKey,
        mint,
        tokenProgram: sdk.EXTERNAL_IDS.token2022,
        class: 2,
        cap: STOCK.trendingTrancheMaxLamports,
        oracle: sdk.canonicalPool(mint),
      }),
    ]);
    const state = await stockState();
    report.trendingBucket = state.machine.buckets.findIndex((b) =>
      b.mint.equals(mint),
    );
    assert(report.trendingBucket >= 0);
    report.trending = {
      signature,
      mint: String(mint),
      listedTs: String(
        state.machine.bucket_history[report.trendingBucket].listed_ts,
      ),
      noticeSeconds: HIT_LIST.trendingNoticeSeconds,
      graduatedPoolAvailable: false,
    };
    save();
  }
  await waitRevealDelay();
  await guard(6074, await prepareTrade("stockBuy", 50_000_000n));
  if (!report.exits.stockSellBelowReserve) {
    await waitSpacing();
    await freshOracle();
    report.exits.stockSellBelowReserve = await trade(
      "stock-sell-below-reserve",
      "stockSell",
      1000n,
    );
    save();
  }
  if (!report.exits.takeBack) {
    if (!report.takeBackPlan) {
      const deck = sdk.decodeDeck(
        (await rpc.getAccountInfo(sdk.deckPda(pid)[0], "confirmed")).data,
      );
      assert(
        deck.entries.length >= COVERAGE.dustBuffer + CARDS_PER_PACK.dust,
        "Replenish Feed before testing TakeBack",
      );
      const proof = JSON.parse(
        readFileSync("reports/devnet/feed-snapshot.json", "utf8"),
      );
      const index = deck.entries.findIndex((entry) =>
        proof.wallets.some((w) => w.address === String(entry.depositor)),
      );
      assert(index >= 0);
      const entry = deck.entries[index];
      report.takeBackPlan = {
        index,
        mint: String(entry.mint),
        amount: String(entry.amount),
        owner: String(entry.depositor),
        path: proof.wallets.find((w) => w.address === String(entry.depositor))
          .path,
      };
      save();
    }
    const plan = report.takeBackPlan;
    const wallet = key(plan.path);
    assert.equal(String(wallet.publicKey), plan.owner);
    const signature = await send(
      "upgrade2/take-back",
      [
        sdk.takeBackInstruction(pid, {
          depositor: wallet.publicKey,
          deckIndex: plan.index,
          mint: pub(plan.mint),
          amount: BigInt(plan.amount),
          tokenProgram: sdk.EXTERNAL_IDS.token2022,
        }),
      ],
      [wallet],
    );
    report.exits.takeBack = {
      signature,
      mint: plan.mint,
      amount: plan.amount,
      owner: String(wallet.publicKey),
      during: "reserve and TRENDING notice refusals",
    };
    save();
  }
  if (!report.transactions.coverage) {
    const state = await stockState();
    if (!report.coveragePlan) {
      report.coveragePlan = {
        amount: String(major.coverageLamports - state.machine.buckets[0].cost),
        before: clean(state),
        donation: String(
          major.coverageLamports -
            state.machine.buckets[0].cost +
            SELL_BACK.solFloorLamports >
            state.machine.stock_sol
            ? major.coverageLamports -
                state.machine.buckets[0].cost +
                SELL_BACK.solFloorLamports -
                state.machine.stock_sol
            : 0n,
        ),
      };
      save();
    }
    const missing = BigInt(report.coveragePlan.amount);
    assert(missing > 0n);
    const requiredStock = missing + SELL_BACK.solFloorLamports;
    const donation = BigInt(report.coveragePlan.donation);
    assert(donation >= 0n && donation <= 1_500_000_000n);
    if (!report.funding && donation > 0n) {
      await requireBalance(Number(donation) + 100_000_000);
      const signature = await send("upgrade2/stock-reserve", [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: sdk.feeInPda(pid)[0],
          lamports: donation,
        }),
        sdk.collectCreatorFeesIx(deployment, { payer: payer.publicKey }),
      ]);
      const after = await stockState();
      assert(
        after.machine.stock_sol >= requiredStock,
        "Fee split did not fund required stock; stop before buying",
      );
      report.funding = {
        signature,
        donation: String(donation),
        before: clean(state),
        after: clean(after),
      };
      save();
    }
    await waitSpacing();
    await freshOracle();
    report.transactions.coverage = await trade("coverage", "stockBuy", missing);
    assert(
      (await stockState()).machine.buckets[0].cost >= major.coverageLamports,
    );
    save();
  }
  await guard(6073, await prepareTrendingProbe(report.trendingBucket));
  report.prepared = true;
  save();
}

if (stage === "draw") {
  assert(report.prepared);
  const timingProbe = await prepareTrade("stockBuy", 1_000_000n);
  if (!report.ripSignature && journal["upgrade2/rip"]) {
    assert(report.pull && report.nonce !== undefined);
    report.ripSignature = await send("upgrade2/rip", [], [buyer], {
      confirmed: true,
    });
    save();
  }
  if (!report.ripSignature) {
    const deck = sdk.decodeDeck(
      (await rpc.getAccountInfo(sdk.deckPda(pid)[0], "confirmed")).data,
    );
    assert(
      deck.entries.length >= COVERAGE.dustBuffer + CARDS_PER_PACK.dust,
      "Refill Feed after TakeBack before Rip",
    );
    await waitSpacing();
    await freshOracle();
    const binder = await readBinder();
    assert(!binder || (binder.reserved === 0 && binder.cards.length === 0));
    const config = await sdk.fetchConfig(pid, rpc);
    report.nonce = binder?.pull_nonce ?? 0;
    report.buyer = String(buyer.publicKey);
    report.pull = String(sdk.pullPda(pid, buyer.publicKey, report.nonce)[0]);
    report.queue = String(config.vrf_queues[config.active_queue]);
    save();
    await requireBalance(120_000_000, buyer.publicKey);
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
  if (!report.settleSignature && journal["upgrade2/settle"]) {
    report.settleSignature = await send("upgrade2/settle", [], [buyer], {
      confirmed: true,
    });
    save();
  }
  if (!report.settleSignature) {
    await guard(6071, timingProbe);
    let pull;
    for (let i = 0; i < 120; i++) {
      pull = await readPull();
      assert(pull, "Pull missing before settle");
      if (pull.status === 2) break;
      await delay(1000);
    }
    assert.equal(
      pull.status,
      2,
      "VRF pending: preserve Pull and inspect timeout",
    );
    report.revealed = clean(await stockState());
    assert.equal(BigInt(report.revealed.machine.unsettled_reveals), 1n);
    save();
    const available =
      BigInt(report.revealed.machine.buckets[0].cost) -
      BigInt(report.revealed.machine.buckets[0].reserved);
    if (available >= 1_000_000n && !report.exits.stockSellUnsettled) {
      report.exits.stockSellUnsettled = await trade(
        "stock-sell-unsettled",
        "stockSell",
        1000n,
      );
      save();
    }
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
  assert.equal(await readPull(), null);
  await guard(6072, timingProbe);
  report.drawCompleted = true;
  save();
}

if (stage === "finish") {
  assert(report.settleSignature, "Settle must complete before exits");
  assert.equal(await readPull(), null);
  const binder = await readBinder();
  assert(binder && binder.reserved === 0);
  if (!report.cards) {
    const cards = [];
    for (const [cardIndex, card] of binder.cards.entries()) {
      const mintInfo = await rpc.getAccountInfo(card.mint);
      assert(mintInfo);
      cards.push({
        cardIndex,
        mint: card.mint,
        amount: card.amount,
        tokenProgram: mintInfo.owner,
      });
    }
    assert.equal(cards.length, CARDS_PER_PACK.dust + CARDS_PER_PACK.hit);
    report.cards = clean(cards);
    report.tokenBalancesBefore = {};
    for (const card of cards) {
      const info = await rpc.getAccountInfo(
        sdk.userAta(buyer.publicKey, card.mint, card.tokenProgram),
        "confirmed",
      );
      report.tokenBalancesBefore[String(card.mint)] = String(
        info?.data.readBigUInt64LE(64) ?? 0n,
      );
    }
    save();
  }
  if (!report.redeemCompleted) {
    const cards = report.cards.map((card) => ({
      ...card,
      mint: pub(card.mint),
      tokenProgram: pub(card.tokenProgram),
      amount: BigInt(card.amount),
    }));
    const transactions = sdk.buildRedeemTransactions(pid, {
      ...(await options()),
      cards,
    });
    report.redeemSignatures ??= [];
    for (const [index, tx] of transactions.entries()) {
      if (!report.redeemSignatures[index])
        report.redeemSignatures[index] = await built(`redeem/${index}`, tx);
      save();
    }
    report.redeemCompleted = true;
    save();
  }
  if (!report.exits.withdrawOwed) {
    report.exits.withdrawOwed = {
      signature: await send(
        "upgrade2/withdraw-owed",
        [sdk.withdrawOwedIx(pid, { owner: buyer.publicKey })],
        [buyer],
        { confirmed: true },
      ),
      amountBefore: String(binder.sol_owed),
      note: "Zero owed is an idempotent no-op, not a positive payout proof",
    };
    save();
  }
  await waitRevealDelay();
  await waitSpacing();
  await freshOracle();
  if (!report.transactions.afterDelay) {
    const state = await stockState();
    if (
      state.machine.buckets[0].cap - state.machine.buckets[0].cost <
      1_000_000n
    ) {
      await trade("stock-sell-make-room", "stockSell", 1000n);
      await waitSpacing();
      await freshOracle();
    }
    report.transactions.afterDelay = await trade(
      "after-delay-major",
      "stockBuy",
      1_000_000n,
    );
    save();
  }
  const after = await readBinder();
  assert(after.cards.length === 0 && after.reserved === 0);
  report.finalState = clean(await stockState());
  assert.equal(BigInt(report.finalState.machine.pending_pulls), 0n);
  assert.equal(BigInt(report.finalState.machine.unsettled_reveals), 0n);
  report.status = "awaiting-finalized-proof-and-fees";
  save();
}
console.log(
  JSON.stringify({
    stage,
    transactions: Object.keys(report.transactions),
    guards: Object.keys(report.guards),
    status: report.status,
  }),
);
