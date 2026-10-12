// Devnet P3 preparation only. The caller owns simulation, submission and journal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { SystemProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  HIT_LIST,
  STOCK,
  devnetMajorFixtureProfile,
} from "../packages/config/dist/index.js";
import * as sdk from "../packages/sdk/dist/index.js";
import { minOutMajor } from "../packages/sdk/dist/server/index.js";
import { rpc, pid, pub, key, keyRoot } from "./devnet-session.mjs";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "./devnet-token.mjs";

const profile = devnetMajorFixtureProfile("devnet");
const fixtures = JSON.parse(
  readFileSync("reports/devnet/pump-fixtures.json", "utf8"),
);
const keeper = key(`${keyRoot}/keeper.json`);
const market = key(fixtures[0].walletPath);
assert.equal(fixtures[0].mint, profile.mint);
assert.equal(market.publicKey.toBase58(), fixtures[0].wallet);
const oracle = pub(profile.solUsdPriceAccount);
let protocolTable;

async function lut() {
  if (!protocolTable) {
    const address = pub(
      JSON.parse(readFileSync("reports/devnet/protocol-lut.json", "utf8"))
        .address,
    );
    protocolTable = (
      await rpc.getAddressLookupTable(address, { commitment: "confirmed" })
    ).value;
    assert(
      protocolTable && !protocolTable.state.authority,
      "Frozen protocol LUT required",
    );
  }
  return protocolTable;
}

export async function stockState() {
  const read = await rpc.getMultipleAccountsInfoAndContext(
    [sdk.machinePda(pid)[0], SYSVAR_CLOCK_PUBKEY],
    { commitment: "confirmed" },
  );
  const [account, clock] = read.value;
  assert(account?.owner.equals(pid) && clock, "Machine and Clock required");
  return {
    machine: sdk.decodeMachine(account.data),
    now: clock.data.readBigInt64LE(32),
    slot: read.context.slot,
  };
}

export async function freshOracle() {
  const started = Date.now();
  for (;;) {
    const read = await rpc.getMultipleAccountsInfoAndContext(
      [oracle, SYSVAR_CLOCK_PUBKEY],
      { commitment: "confirmed" },
    );
    const [price, clock] = read.value;
    assert(price && clock, "Pyth and Clock required");
    const now = clock.data.readBigInt64LE(32);
    const publishTime = price.data.readBigInt64LE(
      sdk.PYTH_PRICE_UPDATE_V2_PUBLISH_TIME_OFFSET,
    );
    const ageSeconds = Number(now - publishTime);
    if (
      ageSeconds >= 0 &&
      ageSeconds <= Math.floor(STOCK.pythMaxAgeSeconds / 2)
    )
      return { now, publishTime, ageSeconds, slot: read.context.slot };
    assert(
      Date.now() - started < 120_000,
      "Fresh devnet Pyth update unavailable",
    );
    await delay(2_000);
  }
}

export async function waitSpacing() {
  const started = Date.now();
  for (;;) {
    const state = await stockState();
    if (
      state.now >=
      state.machine.last_stock_trade_ts + BigInt(STOCK.tradeMinSpacingSeconds)
    )
      return state;
    assert(
      Date.now() - started < 90_000,
      "Stock trade spacing deadline unavailable",
    );
    await delay(1_000);
  }
}

/** MAJOR amount is lamports for a buy, fixture base units for a sell. */
export async function prepareTrade(kind, amount, bucket = 0) {
  const selectedKind = typeof kind === "string" ? sdk.EXEC_KIND[kind] : kind;
  assert(
    selectedKind === sdk.EXEC_KIND.stockBuy ||
      selectedKind === sdk.EXEC_KIND.stockSell,
    "Only StockBuy and StockSell are supported",
  );
  assert(typeof amount === "bigint" && amount > 0n);
  const before = await stockState();
  const selected = before.machine.buckets[bucket];
  assert(
    selected && (selected.class === 1 || selected.class === 2),
    "Listed bucket required",
  );
  const fixture = fixtures.find(
    (entry) => entry.mint === selected.mint.toBase58(),
  );
  assert(
    fixture && fixture.wallet === market.publicKey.toBase58(),
    "Known test mint required",
  );
  const mint = selected.mint;
  const tokenProgram = sdk.EXTERNAL_IDS.token2022;
  const sell = selectedKind === sdk.EXEC_KIND.stockSell;
  const authority = sdk.vaultAuthPda(pid)[0];
  const vault = sdk.vaultAta(pid, mint, tokenProgram);
  const sourceMint = sell ? mint : NATIVE_MINT;
  const sourceProgram = sell ? tokenProgram : TOKEN_PROGRAM_ID;
  const source = sdk.userAta(keeper.publicKey, sourceMint, sourceProgram);
  const marketToken = sdk.userAta(market.publicKey, mint, tokenProgram);
  const marketNative = sdk.userAta(
    market.publicKey,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
  );
  const nativeDestination = sdk.vaultAta(pid, NATIVE_MINT, TOKEN_PROGRAM_ID);
  const setup = [
    createAssociatedTokenAccountIdempotentInstruction(
      keeper.publicKey,
      source,
      keeper.publicKey,
      sourceMint,
      sourceProgram,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      keeper.publicKey,
      sell ? nativeDestination : marketNative,
      sell ? authority : market.publicKey,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
    ),
  ];
  let oracles;
  let expected = null;
  let minOut = null;
  let guardProbeOnly = false;
  if (selected.class === 1) {
    assert.equal(
      mint.toBase58(),
      profile.mint,
      "Only the approved MAJOR fixture is supported",
    );
    assert.equal(selected.decimals, profile.decimals);
    assert(
      selected.oracle.equals(
        pub(Buffer.from(HIT_LIST.solUsdPythFeedId, "hex")),
      ),
      "The fixture MAJOR must use the approved SOL/USD feed",
    );
    oracles = [
      oracle,
      oracle,
      SystemProgram.programId,
      SystemProgram.programId,
    ];
    // Both actual on-chain Pyth readings use SOL/USD, so the price ratio is one.
    const quote = minOutMajor({
      amount,
      tokenPrice: 1n,
      tokenExponent: 0,
      solPrice: 1n,
      solExponent: 0,
      decimals: profile.decimals,
      sell,
    });
    expected = quote.expected;
    minOut = quote.minOut;
    assert(expected > 0n && minOut > 0n);
  } else {
    assert(!sell, "No fixture TRENDING execution or quote is approved");
    const pool = sdk.canonicalPool(mint);
    assert(
      selected.oracle.equals(pool),
      "TRENDING must reference its canonical PumpSwap pool",
    );
    oracles = [
      pool,
      sdk.pumpAta(pool, mint, tokenProgram),
      sdk.wsolAta(pool),
      SystemProgram.programId,
    ];
    // These coins are not graduated. This only probes a preceding admission
    // refusal; there is deliberately no synthetic pool, quote or successful buy.
    guardProbeOnly = true;
  }
  const args = {
    signer: keeper.publicKey,
    kind: selectedKind,
    bucket,
    amount,
    mint,
    tokenProgram,
    oracles,
  };
  const swap = guardProbeOnly
    ? []
    : [
        createTransferCheckedInstruction(
          source,
          sourceMint,
          sell ? marketToken : marketNative,
          keeper.publicKey,
          amount,
          sell ? profile.decimals : 9,
          [],
          sourceProgram,
        ),
        createTransferCheckedInstruction(
          sell ? marketNative : marketToken,
          sell ? NATIVE_MINT : mint,
          sell ? nativeDestination : vault,
          market.publicKey,
          expected,
          sell ? 9 : profile.decimals,
          [],
          sell ? TOKEN_PROGRAM_ID : tokenProgram,
        ),
      ];
  return {
    args,
    instructions: [
      ...setup,
      sdk.execBeginIx(pid, args),
      ...swap,
      sdk.execEndIx(pid, args),
    ],
    signers: guardProbeOnly ? [keeper] : [keeper, market],
    options: { units: 600_000, tables: [await lut()], confirmed: true },
    expected,
    minOut,
    removedBook: sell ? (amount * selected.cost) / selected.amount : 0n,
    guardProbeOnly,
    before,
  };
}

export async function prepareTrendingProbe(bucket, amount = 1_000_000n) {
  const prepared = await prepareTrade(sdk.EXEC_KIND.stockBuy, amount, bucket);
  assert(prepared.guardProbeOnly, "A TRENDING bucket is required");
  return prepared;
}
