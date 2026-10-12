// Explicitly fictitious MAJOR: operator opt-in, hard-pinned devnet session only.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { SystemProgram, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { setTimeout as delay } from "node:timers/promises";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "./devnet-token.mjs";
import {
  COVERAGE,
  PACK_EDITIONS,
  HIT_LIST,
  STOCK,
  devnetMajorFixtureProfile,
} from "../packages/config/dist/index.js";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  rpc,
  payer,
  pid,
  pub,
  key,
  keyRoot,
  send,
  requireBalance,
} from "./devnet-session.mjs";
assert(
  process.argv.includes("--fixture-major-approved"),
  "Requires the architect's explicit fixture-MAJOR decision",
);
const deployment = sdk.createDeploymentSelector({ devnet: pid })("devnet");
const profile = devnetMajorFixtureProfile(deployment.cluster);
const fixture = JSON.parse(
  readFileSync("reports/devnet/pump-fixtures.json", "utf8"),
)[0];
const market = key(fixture.walletPath),
  keeper = key(`${keyRoot}/keeper.json`),
  mint = pub(fixture.mint);
assert.equal(mint.toBase58(), profile.mint);
const coverage =
  (BigInt(PACK_EDITIONS[0].priceLamports) * BigInt(COVERAGE.perPackValueBps)) /
  10000n;
assert.equal(coverage, profile.coverageLamports);

const tokenProgram = sdk.EXTERNAL_IDS.token2022,
  vault = sdk.vaultAta(pid, mint, tokenProgram);
const oracle = pub(profile.solUsdPriceAccount);
let machine = await sdk.fetchMachine(pid, rpc);
assert(
  machine?.power_on_ts > 0n,
  "Complete the validated devnet launch before provisioning MAJOR coverage",
);
let index = machine.buckets.findIndex(
  (b) => b.class === 1 && b.mint.equals(mint),
);
if (index < 0) {
  await requireBalance(20_000_000);
  await send("list-fixture-major", [
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      vault,
      sdk.vaultAuthPda(pid)[0],
      mint,
      tokenProgram,
    ),
    sdk.adminListMintInstruction(pid, {
      admin: payer.publicKey,
      mint,
      tokenProgram,
      class: 1,
      cap: coverage,
      oracle: new PublicKey(Buffer.from(HIT_LIST.solUsdPythFeedId, "hex")),
    }),
  ]);
  machine = await sdk.fetchMachine(pid, rpc);
  index = machine.buckets.findIndex(
    (b) => b.class === 1 && b.mint.equals(mint),
  );
  assert(index >= 0);
}
const stockBefore = machine;
let tradeSignature;
if (machine.buckets[index].cost < coverage) {
  const amount = coverage - machine.buckets[index].cost;
  const delivered = (profile.deliveredBaseUnits * amount) / coverage;
  assert(
    delivered > 0n &&
      delivered * coverage === profile.deliveredBaseUnits * amount,
  );
  const cycle = machine.last_stock_trade_ts.toString();
  const needed = amount - machine.stock_sol;
  if (needed > 0n) {
    await requireBalance(Number(needed) + 20_000_000);
    await send(`fixture-fee-in-coverage/${cycle}`, [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: sdk.feeInPda(pid)[0],
        lamports: needed,
      }),
      sdk.collectCreatorFeesIx(deployment, { payer: payer.publicKey }),
    ]);
  }
  const source = sdk.userAta(keeper.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID),
    marketNative = sdk.userAta(market.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
  const deficit = Math.max(
    0,
    20_000_000 - (await rpc.getBalance(keeper.publicKey)),
  );
  await send(`fixture-market-setup/${cycle}`, [
    ...(deficit
      ? [
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: keeper.publicKey,
            lamports: deficit,
          }),
        ]
      : []),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      source,
      keeper.publicKey,
      NATIVE_MINT,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      marketNative,
      market.publicKey,
      NATIVE_MINT,
    ),
  ]);
  const table = (
    await rpc.getAddressLookupTable(
      pub(
        JSON.parse(readFileSync("reports/devnet/protocol-lut.json", "utf8"))
          .address,
      ),
    )
  ).value;
  assert(table);
  const args = {
    signer: keeper.publicKey,
    kind: sdk.EXEC_KIND.stockBuy,
    bucket: index,
    amount,
    mint,
    tokenProgram,
    oracles: [oracle, oracle, SystemProgram.programId, SystemProgram.programId],
  };
  // A sponsored heartbeat near its deadline can age out before simulation.
  // Wait for fresh confirmed evidence; the on-chain age limit stays unchanged.
  const waitingSince = Date.now();
  for (;;) {
    const [price, clock] = await rpc.getMultipleAccountsInfo(
      [oracle, SYSVAR_CLOCK_PUBKEY],
      "confirmed",
    );
    assert(price && clock);
    const age = Number(
      clock.data.readBigInt64LE(32) -
        price.data.readBigInt64LE(sdk.PYTH_PRICE_UPDATE_V2_PUBLISH_TIME_OFFSET),
    );
    if (age >= 0 && age <= Math.floor(STOCK.pythMaxAgeSeconds / 2)) {
      console.log(
        JSON.stringify({ oracle: oracle.toBase58(), ageSeconds: age }),
      );
      break;
    }
    assert(
      Date.now() - waitingSince < 120_000,
      "Fresh devnet Pyth update unavailable; no StockBuy sent",
    );
    await delay(5000);
  }
  tradeSignature = await send(
    `fixture-stock-buy/${cycle}`,
    [
      sdk.execBeginIx(pid, args),
      createTransferCheckedInstruction(
        source,
        NATIVE_MINT,
        marketNative,
        keeper.publicKey,
        amount,
        9,
      ),
      createTransferCheckedInstruction(
        sdk.userAta(market.publicKey, mint, tokenProgram),
        mint,
        vault,
        market.publicKey,
        delivered,
        profile.decimals,
        [],
        tokenProgram,
      ),
      sdk.execEndIx(pid, args),
    ],
    [keeper, market],
    { units: 600000, tables: [table] },
  );
}
machine = await sdk.fetchMachine(pid, rpc);
assert(machine.buckets[index].cost >= coverage);
const report = {
  fictitious: true,
  profile: profile.name,
  cluster: "devnet",
  mint: mint.toBase58(),
  oracle: oracle.toBase58(),
  bucket: index,
  cost: String(machine.buckets[index].cost),
  amount: String(machine.buckets[index].amount),
  adapter: "test transfer (master 5.1)",
  ...(tradeSignature
    ? {
        tradeSignature,
        stockBefore: String(stockBefore.stock_sol),
        stockAfter: String(machine.stock_sol),
        costBefore: String(stockBefore.buckets[index].cost),
        lastTradeBefore: String(stockBefore.last_stock_trade_ts),
        lastTradeAfter: String(machine.last_stock_trade_ts),
        stockBoughtHour: String(machine.stock_bought_hour),
        stockHourIndex: String(machine.stock_hour_index),
      }
    : {}),
};
writeFileSync(
  "reports/devnet/stock-fixture.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
