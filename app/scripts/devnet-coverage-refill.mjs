// Devnet coverage refill for the fictitious MAJOR. Journaled; devnet only.
// Stages, in order: restore, cap, inventory, fill, grow, prove, report.
// `inventory` is followed by devnet-refill-feed.mjs and devnet-feed.mjs.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionMessage,
} from "@solana/web3.js";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  CARDS_PER_PACK,
  COVERAGE,
  PACK_EDITIONS,
  SELL_BACK,
  STOCK,
  VRF,
  POST_REVEAL_BUY_DELAY,
  devnetMajorFixtureProfile,
} from "../packages/config/dist/index.js";
import { rpc, pid, payer, pub, key, keyRoot, send } from "./devnet-session.mjs";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "./devnet-token.mjs";

const stage = process.argv[2];
const stages = ["restore", "cap", "inventory", "fill", "grow", "prove"];
assert([...stages, "status", "report"].includes(stage), "Unknown stage");
const API = "https://web-dev-744e.up.railway.app/api/machine";
const PAYER_FLOOR = 3_100_000_000n; // operator guard: keep at least 3 SOL
const CONCURRENT_ORIGINALS = 3;
const major = devnetMajorFixtureProfile("devnet");
const original = PACK_EDITIONS[0];
const need =
  (original.priceLamports * BigInt(COVERAGE.perPackValueBps)) / 10_000n;
assert.equal(need, major.coverageLamports);
assert(major.bucketCapLamports >= BigInt(CONCURRENT_ORIGINALS) * need);
// Three concurrent Originals, plus the four dust cards the proof Rip redeems.
const DECK_TARGET =
  COVERAGE.dustBuffer + CARDS_PER_PACK.dust * (CONCURRENT_ORIGINALS + 1);
const t22 = sdk.EXTERNAL_IDS.token2022;
const deployment = sdk.createDeploymentSelector({ devnet: pid })("devnet");
const fixtureDir = `${homedir()}/.config/solana/onepercent-devnet`;
const reportPath = "reports/devnet/coverage-refill.json";
const report = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : { cluster: "devnet", rounds: [], cycles: [] };
const clean = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) =>
      typeof v === "bigint"
        ? String(v)
        : v instanceof PublicKey
          ? String(v)
          : v,
    ),
  );
const save = () =>
  writeFileSync(reportPath, JSON.stringify(clean(report), null, 2), {
    mode: 0o600,
  });
const provisioning = JSON.parse(
  readFileSync("fixtures/devnet/provisioning.json", "utf8"),
);

async function api() {
  const response = await fetch(API, {
    headers: { accept: "application/json" },
  });
  assert(response.ok, `Machine API ${response.status}`);
  const body = await response.json();
  return {
    asOfSlot: body.asOfSlot,
    maxQty: body.coverage.maxQty,
    deck: body.deck,
    bucket0: body.stock.buckets[0],
    stockSol: body.stock.stockSol,
  };
}
async function chain() {
  const [machineInfo, deckInfo] = await rpc.getMultipleAccountsInfo(
    [sdk.machinePda(pid)[0], sdk.deckPda(pid)[0]],
    "confirmed",
  );
  const machine = sdk.decodeMachine(machineInfo.data);
  const deck = sdk.decodeDeck(deckInfo.data);
  return { machine, deck };
}
async function state() {
  const read = await rpc.getMultipleAccountsInfoAndContext(
    [sdk.machinePda(pid)[0], SYSVAR_CLOCK_PUBKEY],
    { commitment: "confirmed" },
  );
  return {
    machine: sdk.decodeMachine(read.value[0].data),
    now: read.value[1].data.readBigInt64LE(32),
    slot: read.context.slot,
  };
}
const tokenBalance = async (address) => {
  const info = await rpc.getAccountInfo(address, "confirmed");
  return info ? info.data.readBigUInt64LE(64) : 0n;
};
let table;
async function lut() {
  table ??= (
    await rpc.getAddressLookupTable(pub(provisioning.protocolLut.address), {
      commitment: "confirmed",
    })
  ).value;
  assert(table && !table.state.authority, "Frozen protocol LUT required");
  return table;
}
async function options(wallet) {
  return {
    wallet,
    blockhash: (await rpc.getLatestBlockhash("confirmed")).blockhash,
    lut: await lut(),
    priorityFeeMicroLamports: 0n,
  };
}
/** Resubmit an SDK-built transaction through the journaled session sender. */
async function built(label, tx, signer) {
  const instructions = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: [await lut()],
  }).instructions;
  assert(
    instructions
      .slice(0, 2)
      .every((ix) => ix.programId.equals(ComputeBudgetProgram.programId)),
  );
  const units = instructions[0].data.readUInt32LE(1);
  return send(label, instructions.slice(2), [signer], {
    confirmed: true,
    units,
    tables: [await lut()],
  });
}

if (stage === "status") {
  const { machine, deck } = await chain();
  console.log(
    JSON.stringify(
      clean({
        api: await api(),
        deck: deck.len,
        reservedDust: machine.reserved_dust,
        bucket0: machine.buckets[0],
        stockSol: machine.stock_sol,
        teamSol: machine.team_sol,
        pendingPulls: machine.pending_pulls,
        payer: await rpc.getBalance(payer.publicKey),
      }),
    ),
  );
  process.exit(0);
}

if (stage === "restore") {
  // Rebuild the ignored inputs of the existing drivers from public fixtures.
  const config = await sdk.fetchConfig(pid, rpc);
  const fixtures = provisioning.pumpFixtures.map((f) => {
    assert.equal(String(key(f.walletPath).publicKey), f.wallet);
    return f;
  });
  const wallets = Array.from({ length: 18 }, (_, i) => {
    const path = `${fixtureDir}/feed-wallet-${i}.json`;
    return { path, address: String(key(path).publicKey) };
  });
  assert.equal(wallets[0].address, fixtures[0].wallet);
  const { deck } = await chain();
  assert(
    deck.entries.every((e) =>
      wallets.some((w) => w.address === String(e.depositor)),
    ),
    "Unexpected Deck depositor; reconcile before restoring",
  );
  const files = {
    "reports/devnet/pump-fixtures.json": fixtures,
    "reports/devnet/protocol-lut.json": {
      address: provisioning.protocolLut.address,
    },
    "reports/devnet/feed-snapshot.json": {
      slot: Number(config.snapshot_slot),
      time: Number(config.snapshot_ts),
      wallets,
      mints: fixtures.map((f) => f.mint),
      heldAmountPerBag: "1000000000",
    },
  };
  for (const [path, value] of Object.entries(files))
    if (!existsSync(path))
      writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  report.apiBefore ??= await api();
  const { machine } = await chain();
  report.chainBefore ??= {
    deck: deck.len,
    bucket0: machine.buckets[0],
    stockSol: machine.stock_sol,
    payer: await rpc.getBalance(payer.publicKey),
  };
  save();
}

if (stage === "cap") {
  const { machine } = await chain();
  const bucket = machine.buckets[0];
  assert(bucket.class === 1 && String(bucket.mint) === major.mint);
  if (bucket.cap !== major.bucketCapLamports) {
    assert(major.bucketCapLamports > bucket.cap, "Raise only");
    report.cap = {
      before: bucket.cap,
      after: major.bucketCapLamports,
      signature: await send("coverage-refill/cap", [
        sdk.adminConfigInstruction(pid, {
          admin: payer.publicKey,
          action: {
            updateBucket: {
              index: 0,
              enabled: true,
              cap: major.bucketCapLamports,
            },
          },
        }),
      ]),
    };
    save();
  }
  assert.equal((await chain()).machine.buckets[0].cap, major.bucketCapLamports);
}

const fixtures = existsSync("reports/devnet/pump-fixtures.json")
  ? JSON.parse(readFileSync("reports/devnet/pump-fixtures.json", "utf8"))
  : null;
const market = fixtures ? key(fixtures[0].walletPath) : null;

if (stage === "inventory") {
  // The market wallet buys on the real pump devnet curves what the Deck refill
  // and the StockBuys need beyond its current inventory.
  const proof = JSON.parse(
    readFileSync("reports/devnet/feed-snapshot.json", "utf8"),
  );
  const { deck } = await chain();
  const global = sdk.decodeGlobal(
    (await rpc.getAccountInfo(sdk.PUMP_GLOBAL, "confirmed")).data,
  );
  const recipient = global.buybackFeeRecipients.find(
    (k) => !k.equals(PublicKey.default),
  );
  assert(recipient);
  report.inventory ??= {};
  for (const address of proof.mints) {
    const mint = pub(address);
    let wanted = 0n;
    for (const wallet of proof.wallets) {
      const owner = pub(wallet.address);
      if (owner.equals(market.publicKey)) continue;
      if (
        deck.entries.some(
          (e) => e.depositor.equals(owner) && e.mint.equals(mint),
        )
      )
        continue;
      const held = await tokenBalance(sdk.userAta(owner, mint, t22));
      if (held < BigInt(proof.heldAmountPerBag))
        wanted += BigInt(proof.heldAmountPerBag) - held;
    }
    // StockBuys deliver 1 base unit per 1000 lamports (devnet profile ratio).
    if (address === major.mint)
      wanted +=
        (major.bucketCapLamports * 2n * major.deliveredBaseUnits) /
        major.coverageLamports;
    const balance = await tokenBalance(
      sdk.userAta(market.publicKey, mint, t22),
    );
    if (report.inventory[address]?.signature || wanted <= balance) continue;
    const lot = 1_000_000_000n;
    const amount = ((wanted - balance + lot - 1n) / lot) * lot;
    const curve = sdk.decodeBondingCurve(
      (await rpc.getAccountInfo(sdk.bondingCurve(mint), "confirmed")).data,
    );
    assert(!curve.complete && curve.quoteMint.equals(PublicKey.default));
    const quote =
      (amount * curve.virtualQuoteReserves) /
        (curve.virtualTokenReserves - amount) +
      1n;
    const maxSolCost = quote * 2n + 100_000n;
    report.inventory[address] = {
      amount,
      maxSolCost,
      balanceBefore: balance,
      signature: await send(
        `coverage-refill/pump-buy/${address}`,
        [
          createAssociatedTokenAccountIdempotentInstruction(
            market.publicKey,
            sdk.userAta(market.publicKey, mint, t22),
            market.publicKey,
            mint,
            t22,
          ),
          sdk.buyV3Ix({
            mint,
            wallet: market.publicKey,
            amount,
            maxSolCost,
            buybackFeeRecipient: recipient,
          }),
        ],
        [market],
        { units: 200_000 },
      ),
    };
    report.inventory[address].balanceAfter = await tokenBalance(
      sdk.userAta(market.publicKey, mint, t22),
    );
    assert(report.inventory[address].balanceAfter >= balance + amount);
    save();
  }
}

/** Move the fixture market's wSOL proceeds back to the payer. */
async function recoverMarket(tag) {
  const source = sdk.userAta(market.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  const amount = await tokenBalance(source);
  if (amount === 0n) return null;
  const destination = sdk.userAta(
    payer.publicKey,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
  );
  const signature = await send(
    `coverage-refill/recover/${tag}`,
    [
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        destination,
        payer.publicKey,
        NATIVE_MINT,
      ),
      createTransferCheckedInstruction(
        source,
        NATIVE_MINT,
        destination,
        market.publicKey,
        amount,
        9,
      ),
      createCloseAccountInstruction(
        destination,
        payer.publicKey,
        payer.publicKey,
      ),
    ],
    [payer, market],
  );
  return { signature, amount };
}

async function waitTradeWindow() {
  const started = Date.now();
  for (;;) {
    const s = await state();
    const m = s.machine;
    if (
      m.pending_pulls === 0n &&
      m.unsettled_reveals === 0n &&
      s.now >= m.last_reveal_ts + BigInt(POST_REVEAL_BUY_DELAY) &&
      s.now >= m.last_stock_trade_ts + BigInt(STOCK.tradeMinSpacingSeconds)
    )
      return s;
    assert(Date.now() - started < 600_000, "Trade window unavailable");
    await delay(2_000);
  }
}

/** Fund stock_sol through FeeIn, then StockBuy until bucket 0 reaches `target`. */
async function ensureCost(target, tag) {
  const { prepareTrade, freshOracle } = await import("./devnet-p3-trade.mjs");
  for (let round = 0; round < 8; round++) {
    let s = await state();
    const bucket = s.machine.buckets[0];
    const goal = target < bucket.cap ? target : bucket.cap;
    if (bucket.cost >= goal) return;
    let amount = goal - bucket.cost;
    if (amount > STOCK.majorTrancheMaxLamports)
      amount = STOCK.majorTrancheMaxLamports;
    const payouts = s.machine.sb_paid_hour + s.machine.sb_paid_prev_hour;
    const reserve = SELL_BACK.solFloorLamports + payouts;
    const entry = {
      tag,
      before: { cost: bucket.cost, stockSol: s.machine.stock_sol },
    };
    // Persist the plan first: a resumed run must replay this exact donation.
    const fundLabel = `coverage-refill/fund/${tag}/${s.machine.last_stock_trade_ts}`;
    report.plans ??= {};
    let plan = report.plans[fundLabel];
    if (!plan && s.machine.stock_sol < amount + reserve) {
      const short = amount + reserve - s.machine.stock_sol;
      const book = s.machine.buckets.reduce(
        (sum, b) => sum + b.cost,
        s.machine.stock_sol,
      );
      // D27: at or above the floor the team half returns to the payer below.
      const season = book >= STOCK.creatorFeeFloorLamports;
      let donation = season ? short * 2n : short;
      const spare = BigInt(await rpc.getBalance(payer.publicKey)) - PAYER_FLOOR;
      if (donation > spare) donation = spare - (spare % 2n);
      assert(donation > 0n, "Payer floor reached; stop before funding");
      plan = report.plans[fundLabel] = clean({
        before: entry.before,
        donation,
        season,
      });
      save();
    }
    if (plan) {
      entry.before = plan.before;
      entry.fund = {
        donation: BigInt(plan.donation),
        season: plan.season,
        signature: await send(fundLabel, [
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: sdk.feeInPda(pid)[0],
            lamports: BigInt(plan.donation),
          }),
          sdk.collectCreatorFeesIx(deployment, { payer: payer.publicKey }),
          sdk.teamWithdrawInstruction(pid, payer.publicKey),
        ]),
      };
      s = await state();
      entry.fund.stockSolAfter = s.machine.stock_sol;
      if (s.machine.stock_sol < amount + reserve)
        amount = s.machine.stock_sol - reserve;
      assert(amount > 0n, "Funding left no buyable stock");
    }
    await waitTradeWindow();
    await freshOracle();
    const prepared = await prepareTrade("stockBuy", amount);
    entry.buy = {
      amount,
      delivered: prepared.expected,
      minOut: prepared.minOut,
      signature: await send(
        `coverage-refill/buy/${tag}/${prepared.before.machine.last_stock_trade_ts}`,
        prepared.instructions,
        prepared.signers,
        prepared.options,
      ),
    };
    s = await state();
    entry.after = {
      cost: s.machine.buckets[0].cost,
      stockSol: s.machine.stock_sol,
    };
    entry.recover = await recoverMarket(
      `${tag}/${s.machine.last_stock_trade_ts}`,
    );
    report.rounds.push(entry);
    save();
  }
  throw Error("Coverage target not reached within bounded rounds");
}

if (stage === "fill") await ensureCost(major.bucketCapLamports, "fill");

/** Rip `qty` Originals, wait for the real VRF callback, then settle every pack. */
async function rip(prefix, buyer, qty) {
  const config = await sdk.fetchConfig(pid, rpc);
  const binder = await sdk.fetchBinder(pid, rpc, buyer.publicKey);
  const nonce = binder?.pull_nonce ?? 0;
  const pull = sdk.pullPda(pid, buyer.publicKey, nonce)[0];
  const label = `${prefix}/${nonce}`;
  const result = { nonce, qty, pull, buyer: buyer.publicKey };
  result.rip = await built(
    `${label}/rip`,
    sdk.buildBuyPacksTransaction(pid, {
      ...(await options(buyer.publicKey)),
      edition: original.index,
      qty,
      pullNonce: nonce,
      oracleQueue: config.vrf_queues[config.active_queue],
    }),
    buyer,
  );
  const started = Date.now();
  let decoded;
  for (;;) {
    const info = await rpc.getAccountInfo(pull, "confirmed");
    decoded = info ? sdk.decodePull(info.data) : null;
    if (!decoded || decoded.status === 2) break;
    if (Date.now() - started > (VRF.timeoutSeconds + 30) * 1000) {
      result.refund = await built(
        `${label}/refund`,
        sdk.buildRefundTransaction(pid, {
          ...(await options(buyer.publicKey)),
          pull,
          seq: decoded.seq,
          buyer: (await sdk.fetchPayees(rpc, [buyer.publicKey]))[0],
        }),
        buyer,
      );
      return result;
    }
    await delay(1_000);
  }
  result.revealedAfterMs = Date.now() - started;
  if (decoded) {
    for (let pack = 0; pack < decoded.qty; pack += 2) {
      const live = await rpc.getAccountInfo(pull, "confirmed");
      if (!live) break;
      const current = sdk.decodePull(live.data);
      const packs = [];
      for (const index of [pack, pack + 1].filter((i) => i < current.qty)) {
        if (current.settled_mask & (1 << index)) continue;
        const record = current.packs[index];
        const flags = await sdk.fetchPayees(rpc, [
          buyer.publicKey,
          current.referrer,
          ...record.royalties.map((r) => r.depositor),
        ]);
        packs.push({
          pull,
          seq: current.seq,
          pack: index,
          buyer: flags[0],
          referrer: current.referrer.equals(SystemProgram.programId)
            ? undefined
            : flags[1],
          wallets: record.royalties.map((_, i) =>
            record.house_mask & (1 << i) ? null : flags[i + 2],
          ),
        });
      }
      if (packs.length)
        (result.settle ??= []).push(
          await built(
            `${label}/settle/${pack}`,
            sdk.buildSettleTransaction(pid, {
              ...(await options(buyer.publicKey)),
              packs,
            }),
            buyer,
          ),
        );
    }
  }
  for (let i = 0; i < 60 && (await rpc.getAccountInfo(pull, "confirmed")); i++)
    await delay(1_000);
  assert.equal(await rpc.getAccountInfo(pull, "confirmed"), null);
  result.pullSignatures = (
    await rpc.getSignaturesForAddress(pull, { limit: 20 }, "confirmed")
  )
    .filter((s) => !s.err)
    .map((s) => ({ signature: s.signature, slot: s.slot }));
  return result;
}

async function fundBuyer(buyer, lamports, label) {
  const balance = BigInt(await rpc.getBalance(buyer.publicKey));
  if (balance >= lamports) return null;
  const deficit = lamports - balance;
  assert(
    BigInt(await rpc.getBalance(payer.publicKey)) - deficit >= PAYER_FLOOR,
  );
  return send(label, [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: buyer.publicKey,
      lamports: deficit,
    }),
  ]);
}

if (stage === "grow") {
  // Real Rips whose cards are fed back: each pack nets one card for the Deck.
  const loop = key(`${fixtureDir}/rip-wallet.json`);
  for (let cycle = 0; cycle < 16; cycle++) {
    let binder = await sdk.fetchBinder(pid, rpc, loop.publicKey);
    while (binder?.cards.some((c) => c.kind <= 4)) {
      const indices = binder.cards
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.kind <= 4)
        .map(({ i }) => i)
        .sort((a, b) => b - a)
        .slice(0, 8);
      const [tx] = sdk.buildFeedBackTransactions(pid, {
        ...(await options(loop.publicKey)),
        cardIndices: indices,
      });
      const signature = await built(
        `coverage-refill/grow/${binder.pull_nonce}/feed-back/${binder.len}`,
        tx,
        loop,
      );
      report.cycles
        .at(-1)
        ?.feedBack?.push({ signature, cards: indices.length });
      save();
      binder = await sdk.fetchBinder(pid, rpc, loop.publicKey);
    }
    const { machine, deck } = await chain();
    if (deck.len >= DECK_TARGET) break;
    const room = Math.floor(
      (deck.len - Number(machine.reserved_dust) - COVERAGE.dustBuffer) /
        CARDS_PER_PACK.dust,
    );
    let qty = Math.min(room, DECK_TARGET - deck.len, original.maxPerRip);
    assert(qty >= 1, "Deck below one pack; refill Feed first");
    const bucket = machine.buckets[0];
    if (bucket.cost - bucket.reserved < BigInt(qty) * need) {
      await ensureCost(major.bucketCapLamports, `grow-${deck.len}`);
      const after = (await chain()).machine.buckets[0];
      qty = Math.min(qty, Number((after.cost - after.reserved) / need));
      assert(qty >= 1, "Coverage unavailable for a single pack");
    }
    await fundBuyer(
      loop,
      BigInt(qty) * original.priceLamports + 100_000_000n,
      `coverage-refill/grow/${binder?.pull_nonce ?? 0}/fund`,
    );
    const result = await rip("coverage-refill/grow", loop, qty);
    result.deckBefore = deck.len;
    result.feedBack = [];
    report.cycles.push(result);
    save();
  }
  const { deck } = await chain();
  report.deckAfterGrow = deck.len;
  save();
  assert(deck.len >= DECK_TARGET);
}

if (stage === "prove") {
  await ensureCost(major.bucketCapLamports, "prove");
  const target = await rpc.getSlot("confirmed");
  const started = Date.now();
  for (;;) {
    const seen = await api();
    if (seen.asOfSlot >= target && seen.maxQty[0] >= CONCURRENT_ORIGINALS) {
      report.apiReady ??= seen;
      break;
    }
    assert(Date.now() - started < 900_000, "Indexer did not catch up");
    await delay(10_000);
  }
  save();
  const buyer = key(`${keyRoot}/test-user.json`);
  if (!report.prove) {
    report.prove = await rip("coverage-refill/prove", buyer, 1);
    save();
  }
  const binder = await sdk.fetchBinder(pid, rpc, buyer.publicKey);
  if (binder.cards.length) {
    const cards = [];
    for (const [cardIndex, card] of binder.cards.entries()) {
      const owner = (await rpc.getAccountInfo(card.mint, "confirmed")).owner;
      cards.push({
        cardIndex,
        mint: card.mint,
        amount: card.amount,
        kind: card.kind,
        tokenProgram: owner,
      });
    }
    report.prove.cards = cards;
    report.prove.balancesBefore = {};
    for (const card of cards)
      report.prove.balancesBefore[String(card.mint)] ??= await tokenBalance(
        sdk.userAta(buyer.publicKey, card.mint, card.tokenProgram),
      );
    save();
    const txs = sdk.buildRedeemTransactions(pid, {
      ...(await options(buyer.publicKey)),
      cards,
    });
    report.prove.redeem = [];
    for (const [index, tx] of txs.entries())
      report.prove.redeem.push(
        await built(`coverage-refill/prove/redeem/${index}`, tx, buyer),
      );
    save();
  }
  const after = await sdk.fetchBinder(pid, rpc, buyer.publicKey);
  assert(after.len === 0 && after.reserved === 0);
  report.prove.balancesAfter = {};
  for (const card of report.prove.cards ?? [])
    report.prove.balancesAfter[String(card.mint)] = await tokenBalance(
      sdk.userAta(buyer.publicKey, pub(card.mint), pub(card.tokenProgram)),
    );
  report.prove.buyerBalance = await rpc.getBalance(buyer.publicKey);
  save();
}

if (stage === "report") {
  const owed = (await chain()).machine.team_sol;
  if (owed > 0n)
    report.teamWithdraw = await send(`coverage-refill/team/${owed}`, [
      sdk.teamWithdrawInstruction(pid, payer.publicKey),
    ]);
  const { machine, deck } = await chain();
  report.chainAfter = {
    deck: deck.len,
    bucket0: machine.buckets[0],
    stockSol: machine.stock_sol,
    teamSol: machine.team_sol,
    payer: await rpc.getBalance(payer.publicKey),
    loopWallet: await rpc.getBalance(
      key(`${fixtureDir}/rip-wallet.json`).publicKey,
    ),
  };
  report.apiAfter = await api();
  save();
  const { journal } = await import("./devnet-session.mjs");
  /** Label each finalized Pull transaction from its own logs and fee payer. */
  async function receipts(entries, pull) {
    const out = [];
    for (const { signature, slot } of entries ?? []) {
      const tx = await rpc.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      assert(tx?.meta && !tx.meta.err, `Missing receipt ${signature}`);
      const logs = tx.meta.logMessages ?? [];
      const kind = logs.includes("Program log: Instruction: ConsumeRandomness")
        ? "vrf-callback"
        : logs.includes("Program log: Instruction: BuyPacks")
          ? "rip"
          : logs.includes("Program log: Instruction: Settle")
            ? "settle"
            : "other";
      if (kind === "vrf-callback")
        assert(
          logs.includes(`Program ${sdk.EXTERNAL_IDS.magicblockVrf} invoke [1]`),
        );
      const keys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta.loadedAddresses,
      });
      let index = -1;
      for (let i = 0; i < keys.length; i++)
        if (String(keys.get(i)) === String(pull)) index = i;
      out.push({
        kind,
        signature,
        slot,
        feePayer: String(tx.transaction.message.staticAccountKeys[0]),
        // A settle after the Pull is closed is an idempotent no-op.
        closesPull:
          index >= 0 &&
          tx.meta.preBalances[index] > 0 &&
          tx.meta.postBalances[index] === 0,
      });
    }
    return out.sort((a, b) => a.slot - b.slot);
  }
  const sig = (label) => journal[label]?.signature;
  const cycle = async (c) => ({
    nonce: c.nonce,
    qty: c.qty,
    buyer: c.buyer,
    deckBefore: c.deckBefore,
    pull: c.pull,
    revealedAfterMs: c.revealedAfterMs,
    refund: c.refund ?? null,
    transactions: await receipts(c.pullSignatures, c.pull),
    feedBack: c.feedBack ?? [],
  });
  const publicRounds = report.rounds.map((r) => ({
    tag: r.tag,
    before: r.before,
    after: r.after,
    fund: r.fund
      ? {
          donation: r.fund.donation,
          belowFloorRegime: !r.fund.season,
          signature: r.fund.signature,
          stockSolAfter: r.fund.stockSolAfter,
        }
      : null,
    stockBuy: r.buy,
    marketProceedsReturned: r.recover,
  }));
  const fixture = {
    cluster: "devnet",
    genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    programId: String(pid),
    recordedAt: new Date().toISOString(),
    fictitious: true,
    profile: major.name,
    mint: major.mint,
    adapter: "test transfer between exec_begin and exec_end (master 5.1)",
    cap: report.cap,
    pumpCurveBuys: report.inventory,
    deckRefill: {
      restoreBags: sig("refill-feed/4"),
      feeds: Object.keys(journal)
        .filter((label) => label.startsWith("feed/"))
        .map((label) => ({ label, signature: journal[label].signature })),
      attestation:
        "driver-signed by the intake signer key for snapshot holders",
    },
    stockRounds: publicRounds,
    deckGrowth: {
      target: DECK_TARGET,
      after: report.deckAfterGrow,
      cycles: await Promise.all(report.cycles.map(cycle)),
    },
    proof: report.prove
      ? {
          ...(await cycle(report.prove)),
          cards: (report.prove.cards ?? []).map((c) => ({
            mint: c.mint,
            amount: c.amount,
            kind: c.kind,
          })),
          redeem: report.prove.redeem,
          balancesBefore: report.prove.balancesBefore,
          balancesAfter: report.prove.balancesAfter,
          buyerLamportsAfter: report.prove.buyerBalance,
        }
      : null,
    api: {
      url: API,
      before: report.apiBefore,
      ready: report.apiReady,
      after: report.apiAfter,
    },
    chain: { before: report.chainBefore, after: report.chainAfter },
    teamWithdraw: report.teamWithdraw ?? null,
  };
  const text = JSON.stringify(clean(fixture), null, 2);
  assert(!text.includes(homedir()), "Public fixture must not carry paths");
  writeFileSync("fixtures/devnet/coverage-refill.json", `${text}\n`);
}
console.log(JSON.stringify({ stage, done: true }));
