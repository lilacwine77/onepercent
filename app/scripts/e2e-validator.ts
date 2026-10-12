import {
  planStock,
  stockRequests,
  checkStockQuote,
  type StockState,
  type StockQuote,
} from "../services/worker/src/keeper/stock/planner.js";
import {
  buildRoute,
  buildStockTransaction,
} from "../services/worker/src/keeper/stock/builder.js";
import { StockChain } from "../services/worker/src/keeper/stock/chain.js";
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  ATTESTATIONS,
  STOCK,
  POST_REVEAL_BUY_DELAY,
  HIT_LIST,
  TOKEN_1PCT,
  SEASON,
  CREATOR_FEE_SPLIT_BPS,
  BPS_DENOMINATOR,
  BURN,
  JACKPOT,
  METEORA,
  SERVICES,
  KEEPER_POLICY,
  EXECUTOR_POLICY,
  WSOL_MINT,
} from "../packages/config/src/index.js";
import {
  attestationExpiry,
  advancePhaseInstruction,
  collectCreatorFeesIx,
  powerOnIx,
  feeInPda,
  fetchMachine,
  drawTier,
  liveFlags,
  composeExecTransaction,
  decodeMintLedger,
  execBeginIx,
  execEndIx,
  EXEC_KIND,
  ledgerPda,
  userAta,
  vaultAuthPda,
  binderPda,
  buildBuyPacksTransaction,
  buildRedeemTransactions,
  buildRefundTransaction,
  buildSettleTransaction,
  buildTakeBackTransactions,
  consumeRandomnessInstruction,
  configPda,
  decodeConfig,
  decodeMachine,
  encodeMachine,
  machinePda,
  encodeConfig,
  deckPda,
  decodeDeck,
  EXTERNAL_IDS,
  feedMessage,
  fetchBinder,
  fetchMintDecimals,
  fetchPayees,
  fetchPull,
  planFeedTransactions,
  pullPda,
  scopedVrfIdentity,
  serializedSize,
  splitPack,
  vaultAta,
} from "../packages/sdk/src/index.js";
import { stockBuyGuard, minOutMeteoraBuy } from "@onepercent/sdk/server";
import type {
  BuiltTransaction,
  PlannedFeedBag,
  SettleInput,
  ExecBeginInput,
} from "../packages/sdk/src/index.js";
import { runSellBack } from "./e2e-sellback.js";

import { JsonRpcClient } from "../packages/service-kit/src/rpc.js";
import { SENDER_MIN_TIP_LAMPORTS } from "../packages/service-kit/src/landing.js";
import { ExecutorSource } from "../services/worker/src/executor/source.js";
import { planExecutor } from "../services/worker/src/executor/policy.js";
import { composeExecutor } from "../services/worker/src/executor/compose.js";
import { executorP1 } from "../services/worker/src/executor/p1.js";

import { meteoraTestConfig } from "./e2e-meteora-curve.js";
import {
  meteoraLocalVenue,
  meteoraValidatorFixtures,
} from "./e2e-meteora-fixtures.js";
import { DEPLOYMENT, PROGRAM_ID } from "../packages/sdk/tests/program-id.js";
import { runMeteoraSeason, runMeteoraAfterEnd } from "./e2e-meteora-season.js";

export type ValidatorFlow =
  | "sellback"
  | "exec"
  | "feed"
  | "rip"
  | "refund"
  | "settle-closed"
  | "power-on"
  | "season"
  | "season-closed"
  | "meteora-season";
export interface FixtureWallet {
  publicKey: string;
  secretKey: number[];
}
export interface Manifest {
  programs: { address: string; file: string }[];
  accounts: { address: string; file: string }[];
  wallets: Record<"buyer" | "depositor" | "intake" | "payer", FixtureWallet>;
  buyers?: FixtureWallet[];
  deckLen?: number;
  queue: string;
  scenario: string;
  baseTime: number;
  pull?: string;
  launchMint?: string;
  seasonMint?: string;
  settlePulls?: string[];
  exec?: {
    guards?: boolean;
    mintSigner: FixtureWallet;
    signer: FixtureWallet;
    market: FixtureWallet;
    mint: string;
    tokenProgram: string;
    decimals: number;
    oracles: string[];
    marketToken: string;
    marketNative: string;
    buyAmount: string;
    buyDelta: string;
    sellAmount: string;
    sellDelta: string;
  };
  feed?: {
    mint: string;
    source: string;
    amount: string;
    decimals: number;
    tokenProgram: string;
    vaultExists: boolean;
  };
}
const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
function launch(
  command: string,
  args: string[],
  env = process.env,
  cwd = appDirectory,
): { child: ChildProcess; output: () => string; done: Promise<void> } {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (data: Buffer) => {
    output = (output + data.toString()).slice(-100_000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const done = new Promise<void>((resolveDone, reject) => {
    child.once("error", reject);
    // A fast process can exit before its stdout/stderr pipes finish draining.
    child.once("close", (code, signal) =>
      code === 0
        ? resolveDone()
        : reject(new Error(`${command} exited ${code ?? signal}\n${output}`)),
    );
  });
  // Long-lived validator failures are checked by readiness and the RPC operations.
  void done.catch(() => {});
  return { child, output: () => output, done };
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise<void>((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
  return address.port;
}
// Concurrent validators on one machine (CI runner and local agents) collide on
// gossip and dynamic ports unless each run takes its own free block.
async function freePortRange(count: number): Promise<number> {
  const bindable = (port: number) =>
    new Promise<boolean>((yes) => {
      const server = createServer();
      server.once("error", () => yes(false));
      server.listen(port, "127.0.0.1", () => server.close(() => yes(true)));
    });
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const base = 20_000 + Math.floor(Math.random() * 35_000);
    let ok = true;
    for (let port = base; port < base + count && ok; port += 1)
      ok = await bindable(port);
    if (ok) return base;
  }
  throw new Error("no free validator port range");
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((yes) => child.once("exit", () => yes())),
    delay(5000).then(() => {
      child.kill("SIGKILL");
    }),
  ]);
}
function localSigner(wallet: FixtureWallet): Keypair {
  const signer = Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey));
  assert.equal(signer.publicKey.toBase58(), wallet.publicKey);
  return signer;
}
function attest(signer: Keypair, message: Uint8Array): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(signer.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, message, key);
}
async function send(
  connection: Connection,
  tx: BuiltTransaction,
  signer: Keypair,
): Promise<string> {
  if (tx instanceof Transaction) tx.sign(signer);
  else tx.sign([signer]);
  const bytes = tx.serialize();
  assert.equal(bytes.length, serializedSize(tx));
  const signature = await connection.sendRawTransaction(bytes, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    const result = (await connection.getSignatureStatuses([signature]))
      .value[0];
    if (result?.err)
      throw new Error(
        `Local transaction failed ${signature}: ${JSON.stringify(result.err)}`,
      );
    if (
      result?.confirmationStatus === "confirmed" ||
      result?.confirmationStatus === "finalized"
    )
      return signature;
    await delay(250);
  }
  const [status, blockhash, slot] = await Promise.all([
    connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    }),
    connection.isBlockhashValid(
      tx instanceof Transaction
        ? tx.recentBlockhash!
        : tx.message.recentBlockhash,
      { commitment: "confirmed" },
    ),
    connection.getSlot("confirmed"),
  ]);
  throw new Error(
    `Local transaction confirmation timed out: ${signature}; ${JSON.stringify({ status: status.value[0], blockhashValid: blockhash.value, slot })}`,
  );
}
async function options(connection: Connection, wallet: PublicKey) {
  return {
    wallet,
    blockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
  };
}
async function deck(connection: Connection) {
  const info = await connection.getAccountInfo(
    deckPda(PROGRAM_ID)[0],
    "confirmed",
  );
  assert(info);
  return decodeDeck(info.data);
}
async function discoverBag(
  connection: Connection,
  wallet: PublicKey,
  manifest: Manifest,
): Promise<PlannedFeedBag> {
  if (manifest.feed) {
    const b = manifest.feed;
    return {
      mint: new PublicKey(b.mint),
      source: new PublicKey(b.source),
      amount: BigInt(b.amount),
      decimals: b.decimals,
      tokenProgram: new PublicKey(b.tokenProgram),
      vaultExists: b.vaultExists,
      closeSource: false,
    };
  }
  const accounts = await connection.getTokenAccountsByOwner(
    wallet,
    { programId: EXTERNAL_IDS.splToken },
    "confirmed",
  );
  const source = accounts.value.find(
    (item) => item.account.data.readBigUInt64LE(64) > 0n,
  );
  assert(source, "Fixture needs a positive depositor token account");
  const mint = new PublicKey(source.account.data.subarray(0, 32));
  const { decimals, tokenProgram } = await fetchMintDecimals(connection, mint);
  return {
    mint,
    source: source.pubkey,
    amount: source.account.data.readBigUInt64LE(64),
    decimals,
    tokenProgram,
    vaultExists:
      (await connection.getAccountInfo(
        vaultAta(PROGRAM_ID, mint, tokenProgram),
      )) !== null,
    closeSource: false,
  };
}
async function runFeed(
  connection: Connection,
  manifest: Manifest,
): Promise<void> {
  const depositor = localSigner(manifest.wallets.depositor);
  const intake = localSigner(manifest.wallets.intake);
  const bag = await discoverBag(connection, depositor.publicKey, manifest);
  const before = await deck(connection);
  const nonce = await fetchBinder(PROGRAM_ID, connection, depositor.publicKey);
  const slot = await connection.getSlot("confirmed");
  const blockTime = await connection.getBlockTime(slot);
  assert(blockTime !== null);
  const expiry = attestationExpiry(
    BigInt(blockTime),
    ATTESTATIONS.feedTtlSeconds,
  );
  const plans = await planFeedTransactions(PROGRAM_ID, {
    ...(await options(connection, depositor.publicKey)),
    bags: [bag],
    intakeSigner: intake.publicKey,
    nonceBase: nonce?.feed_nonce_base ?? 0,
    nonceBits: nonce?.feed_nonce_bits ?? 0,
    attest: ({ wallet, bags, nonce }) => ({
      expiry,
      signature: attest(
        intake,
        feedMessage({ programId: PROGRAM_ID, wallet, bags, nonce, expiry }),
      ),
    }),
  });
  assert.equal(plans.length, 1);
  await send(connection, plans[0]!.transaction, depositor);
  const after = await deck(connection);
  assert.equal(after.len, before.len + 1);
  const index = after.entries.findIndex(
    (entry) =>
      entry.depositor.equals(depositor.publicKey) &&
      entry.mint.equals(bag.mint) &&
      entry.amount === bag.amount,
  );
  assert(index >= 0);
  for (const tx of buildTakeBackTransactions(PROGRAM_ID, {
    ...(await options(connection, depositor.publicKey)),
    entries: [{ ...bag, deckIndex: index }],
  }))
    await send(connection, tx, depositor);
  assert.equal((await deck(connection)).len, before.len);
  assert.equal(
    BigInt((await connection.getTokenAccountBalance(bag.source)).value.amount),
    bag.amount,
  );
  console.log("E1 PASS: SDK Feed -> take-back; original token amount returned");
}
async function runRip(
  connection: Connection,
  manifest: Manifest,
  forcedTier?: number,
  hooks?: {
    pending(): Promise<void>;
    revealed(): Promise<void>;
    settled(): Promise<void>;
  },
): Promise<void> {
  const buyer = localSigner(manifest.wallets.buyer);
  const binderBefore = await fetchBinder(
    PROGRAM_ID,
    connection,
    buyer.publicKey,
  );
  const nonce = binderBefore?.pull_nonce ?? 0;
  const queue = new PublicKey(manifest.queue);
  const queueData = await connection.getAccountInfo(queue);
  assert(queueData);
  const requestIndex = queueData.data.readUInt32LE(0);
  const tx = buildBuyPacksTransaction(PROGRAM_ID, {
    ...(await options(connection, buyer.publicKey)),
    edition: 0,
    qty: 1,
    pullNonce: nonce,
    oracleQueue: queue,
  });
  await send(connection, tx, buyer);
  const pullAddress = pullPda(PROGRAM_ID, buyer.publicKey, nonce)[0];
  const pending = await fetchPull(PROGRAM_ID, connection, pullAddress);
  assert(pending);
  assert.equal(pending.status, 1);
  await hooks?.pending();
  const callback = consumeRandomnessInstruction(PROGRAM_ID, {
    pull: pullAddress,
    buyer: buyer.publicKey,
    seq: pending.seq,
    randomness: new Uint8Array(32),
  });
  const randomness = Buffer.alloc(32);
  if (forcedTier !== undefined) {
    const machine = await fetchMachine(PROGRAM_ID, connection);
    assert(machine);
    const blockTime = await connection.getBlockTime(await connection.getSlot());
    assert(
      blockTime !== null,
      "Validator must expose the confirmed block time",
    );
    const now = BigInt(blockTime);
    const flags = liveFlags(machine, 0, now).flags;
    let found = false;
    for (let seed = 0n; seed < 10_000_000n; seed++) {
      randomness.writeBigUInt64LE(seed);
      if (
        drawTier(randomness, pending.seq, 0, 0, flags, false).tier ===
        forcedTier
      ) {
        found = true;
        break;
      }
    }
    assert(found, "Deterministic forced special seed");
  }
  const fulfillData = Buffer.alloc(37);
  fulfillData[0] = 0xf0;
  fulfillData.writeUInt32LE(requestIndex, 1);
  randomness.copy(fulfillData, 5);
  const fulfillment = new Transaction({
    feePayer: buyer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
  }).add(
    // The mock runs within the real oracle's documented transaction CU budget.
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    new TransactionInstruction({
      programId: EXTERNAL_IDS.magicblockVrf,
      data: fulfillData,
      keys: [
        { pubkey: queue, isSigner: false, isWritable: true },
        {
          pubkey: scopedVrfIdentity(PROGRAM_ID)[0],
          isSigner: false,
          isWritable: false,
        },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
        ...callback.keys.slice(1),
      ],
    }),
  );
  await send(connection, fulfillment, buyer);
  const revealed = await fetchPull(PROGRAM_ID, connection, pullAddress);
  assert(revealed);
  assert.equal(revealed.status, 2);
  await hooks?.revealed();
  if (forcedTier !== undefined) {
    const cards = await fetchBinder(PROGRAM_ID, connection, buyer.publicKey);
    assert(
      cards?.cards.some(
        (card) =>
          card.kind === forcedTier &&
          card.mint.toBase58() === manifest.seasonMint,
      ),
    );
  }
  const record = revealed.packs[0]!;
  const addresses = [
    buyer.publicKey,
    revealed.referrer,
    ...record.royalties.map((r) => r.depositor),
  ];
  const flags = await fetchPayees(connection, addresses);
  const wallets = record.royalties.map((_, i) =>
    record.house_mask & (1 << i) ? null : flags[i + 2]!,
  ) as unknown as SettleInput["wallets"];
  await send(
    connection,
    buildSettleTransaction(PROGRAM_ID, {
      ...(await options(connection, buyer.publicKey)),
      packs: [
        {
          pull: pullAddress,
          seq: revealed.seq,
          pack: 0,
          buyer: flags[0]!,
          referrer: revealed.referrer.equals(PublicKey.default)
            ? undefined
            : flags[1],
          wallets,
        },
      ],
    }),
    buyer,
  );
  assert.equal(await fetchPull(PROGRAM_ID, connection, pullAddress), null);
  await hooks?.settled();
  const binder = await fetchBinder(PROGRAM_ID, connection, buyer.publicKey);
  assert(binder);
  assert.equal(binder.cards.length, (binderBefore?.cards.length ?? 0) + 5);
  const cards = await Promise.all(
    binder.cards.map(async (card, cardIndex) => ({
      mint: card.mint,
      amount: card.amount,
      cardIndex,
      tokenProgram: (await fetchMintDecimals(connection, card.mint))
        .tokenProgram,
    })),
  );
  for (const redeem of buildRedeemTransactions(PROGRAM_ID, {
    ...(await options(connection, buyer.publicKey)),
    cards,
  }))
    await send(connection, redeem, buyer);
  const drained = await fetchBinder(PROGRAM_ID, connection, buyer.publicKey);
  assert(drained);
  assert.equal(drained.len, 0);
  assert.equal(drained.reserved, 0);
  console.log(
    forcedTier === undefined
      ? "E2 PASS: SDK Rip OG x1 -> mock fulfil -> settle -> Redeem five cards descending"
      : `E4b PASS: forced kind ${forcedTier} -> settle -> Redeem, SDK builders`,
  );
}
async function runRefund(
  connection: Connection,
  manifest: Manifest,
): Promise<void> {
  assert(manifest.pull, "Refund fixture must export the pre-aged Pull address");
  const buyer = localSigner(manifest.wallets.buyer);
  const pull = new PublicKey(manifest.pull);
  const pending = await fetchPull(PROGRAM_ID, connection, pull);
  assert(pending);
  assert.equal(pending.status, 1);
  const buyerInfo = (await fetchPayees(connection, [buyer.publicKey]))[0]!;
  await send(
    connection,
    buildRefundTransaction(PROGRAM_ID, {
      ...(await options(connection, buyer.publicKey)),
      pull,
      seq: pending.seq,
      buyer: buyerInfo,
    }),
    buyer,
  );
  assert.equal(await fetchPull(PROGRAM_ID, connection, pull), null);
  assert.equal(
    (await fetchBinder(PROGRAM_ID, connection, buyer.publicKey))?.reserved,
    0,
  );
  console.log(
    "E3 PASS: SDK refund closes pre-aged Pending Pull and releases card capacity",
  );
}
async function runSettleClosed(
  connection: Connection,
  manifest: Manifest,
): Promise<void> {
  assert.equal(manifest.settlePulls?.length, 3);
  const buyer = localSigner(manifest.wallets.buyer);
  const pulls = manifest.settlePulls!.map((address) => new PublicKey(address));
  for (const batch of [pulls.slice(0, 1), pulls.slice(1)]) {
    const packs: SettleInput[] = [];
    const expectedCredits = new Map<string, bigint>();
    const balancesBefore = new Map<string, bigint>();
    const credit = (address: PublicKey, amount: bigint) => {
      const key = address.toBase58();
      expectedCredits.set(key, (expectedCredits.get(key) ?? 0n) + amount);
    };
    for (const address of batch) {
      const pull = await fetchPull(PROGRAM_ID, connection, address);
      assert(pull);
      assert.equal(pull.status, 2);
      const record = pull.packs[0]!;
      assert.equal(record.fresh_mask, 15);
      assert.equal(record.house_mask, 0);
      assert(!pull.referrer.equals(PublicKey.default));
      const flags = await fetchPayees(connection, [
        buyer.publicKey,
        pull.referrer,
        ...record.royalties.map((royalty) => royalty.depositor),
      ]);
      for (const royalty of record.royalties) {
        assert.equal(
          await connection.getAccountInfo(
            binderPda(PROGRAM_ID, royalty.depositor)[0],
          ),
          null,
        );
        credit(royalty.depositor, royalty.lamports + royalty.refund);
      }
      credit(pull.referrer, splitPack(pull.price).referral);
      packs.push({
        pull: address,
        seq: pull.seq,
        pack: 0,
        buyer: flags[0]!,
        referrer: flags[1],
        wallets: flags.slice(2) as unknown as SettleInput["wallets"],
      });
    }
    for (const address of expectedCredits.keys())
      balancesBefore.set(
        address,
        BigInt(
          await connection.getBalance(new PublicKey(address), "confirmed"),
        ),
      );
    const transaction = buildSettleTransaction(PROGRAM_ID, {
      ...(await options(connection, buyer.publicKey)),
      packs,
    });
    // Use the builder's actual compute-budget instructions and user fee payer.
    // A mirrored numeric assertion would miss a budget too small for these PDAs.
    await send(connection, transaction, buyer);
    for (const address of batch)
      assert.equal(await fetchPull(PROGRAM_ID, connection, address), null);
    for (const [address, amount] of expectedCredits)
      assert.equal(
        BigInt(
          await connection.getBalance(new PublicKey(address), "confirmed"),
        ),
        balancesBefore.get(address)! + amount,
      );
  }
  console.log(
    "E4 PASS: SDK Settle x1/x2 with four closed FRESH Binders per pack and a referrer; all credits paid",
  );
}

function execComputeUnits(logs: readonly string[] | null | undefined) {
  const prefix = `Program ${PROGRAM_ID.toBase58()} consumed `;
  const units = (logs ?? [])
    .filter((line) => line.startsWith(prefix))
    .map((line) => {
      const match = /^(\d+) of /u.exec(line.slice(prefix.length));
      assert(match, "Exec compute log must include consumed units");
      return Number(match[1]);
    });
  assert.equal(units.length, 2, "Exec simulation must measure begin and end");
  return { begin: units[0]!, end: units[1]! };
}

async function runExec(
  connection: Connection,
  manifest: Manifest,
): Promise<void> {
  const fixture = manifest.exec;
  assert(fixture, "Exec fixture must include the market and oracle accounts");
  const signer = localSigner(fixture.signer),
    market = localSigner(fixture.market);
  const mint = new PublicKey(fixture.mint),
    tokenProgram = new PublicKey(fixture.tokenProgram);
  const native = new PublicKey(WSOL_MINT);
  const oracles = fixture.oracles.map(
    (value) => new PublicKey(value),
  ) as unknown as ExecBeginInput["oracles"];
  const buyArgs: ExecBeginInput = {
    signer: signer.publicKey,
    kind: EXEC_KIND.stockBuy,
    bucket: 0,
    amount: BigInt(fixture.buyAmount),
    mint,
    tokenProgram,
    oracles,
  };
  const sellArgs: ExecBeginInput = {
    ...buyArgs,
    kind: EXEC_KIND.stockSell,
    amount: BigInt(fixture.sellAmount),
  };
  const buyBegin = execBeginIx(PROGRAM_ID, buyArgs),
    sellBegin = execBeginIx(PROGRAM_ID, sellArgs);
  const [createLut, lutAddress] = AddressLookupTableProgram.createLookupTable({
    authority: signer.publicKey,
    payer: signer.publicKey,
    recentSlot: await connection.getSlot("finalized"),
  });
  const addresses = [
    ...buyBegin.keys,
    ...sellBegin.keys,
    ...execEndIx(PROGRAM_ID, buyArgs).keys,
  ]
    .map((meta) => meta.pubkey)
    .filter(
      (address, index, list) =>
        list.findIndex((key) => key.equals(address)) === index &&
        !address.equals(signer.publicKey),
    );
  async function direct(instructions: TransactionInstruction[]) {
    await send(
      connection,
      new Transaction({
        feePayer: signer.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash("confirmed"))
          .blockhash,
      }).add(...instructions),
      signer,
    );
  }
  await direct([createLut]);
  for (let i = 0; i < addresses.length; i += 20)
    await direct([
      AddressLookupTableProgram.extendLookupTable({
        lookupTable: lutAddress,
        authority: signer.publicKey,
        payer: signer.publicKey,
        addresses: addresses.slice(i, i + 20),
      }),
    ]);
  await direct([
    AddressLookupTableProgram.freezeLookupTable({
      lookupTable: lutAddress,
      authority: signer.publicKey,
    }),
  ]);
  const protocolLut = (await connection.getAddressLookupTable(lutAddress))
    .value;
  assert(protocolLut && protocolLut.state.authority === undefined);
  const lutReadyStarted = Date.now();
  // Scheduler admission resolves lookup tables against the rooted bank.
  while (
    (await connection.getSlot("finalized")) <=
    protocolLut.state.lastExtendedSlot
  ) {
    assert(Date.now() - lutReadyStarted < 45_000, "Protocol LUT did not root");
    await delay(250);
  }
  function transfer(
    source: PublicKey,
    tokenMint: PublicKey,
    destination: PublicKey,
    authority: PublicKey,
    amount: bigint,
    decimals: number,
    programId: PublicKey,
  ) {
    const data = Buffer.alloc(10);
    data[0] = 12;
    data.writeBigUInt64LE(amount, 1);
    data[9] = decimals;
    return new TransactionInstruction({
      programId,
      data,
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
      ],
    });
  }
  async function snapshot() {
    const [machine, ledger, vault] = await connection.getMultipleAccountsInfo(
      [
        machinePda(PROGRAM_ID)[0],
        ledgerPda(PROGRAM_ID, mint)[0],
        vaultAta(PROGRAM_ID, mint, tokenProgram),
      ],
      "confirmed",
    );
    assert(machine && ledger && vault);
    return {
      machine: decodeMachine(machine.data),
      ledger: decodeMintLedger(ledger.data),
      vault: vault.data.readBigUInt64LE(64),
    };
  }
  const before = await snapshot();
  assert.equal(before.machine.buckets[0]!.class, 2, "Exec exercises TRENDING");
  const trade = async (args: ExecBeginInput, expectedError?: string) => {
    const sell = args.kind === EXEC_KIND.stockSell;
    if (!expectedError) {
      const last = (await snapshot()).machine.last_stock_trade_ts;
      while (true) {
        const slot = await connection.getSlot("confirmed"),
          now = await connection.getBlockTime(slot);
        if (
          now !== null &&
          BigInt(now) >= last + BigInt(STOCK.tradeMinSpacingSeconds)
        )
          break;
        await delay(500);
      }
    }
    const beforeTrade = await snapshot();
    const priorBucket = beforeTrade.machine.buckets[0]!;
    const removedBook = sell
      ? (args.amount * priorBucket.cost) / priorBucket.amount
      : 0n;
    const delivered: bigint = BigInt(
      sell ? fixture.sellDelta : fixture.buyDelta,
    );
    const source = userAta(
      signer.publicKey,
      sell ? mint : native,
      sell ? tokenProgram : EXTERNAL_IDS.splToken,
    );
    const destination = sell
      ? vaultAta(PROGRAM_ID, native, EXTERNAL_IDS.splToken)
      : vaultAta(PROGRAM_ID, mint, tokenProgram);
    const swap: TransactionInstruction[] = [
      transfer(
        source,
        sell ? mint : native,
        new PublicKey(sell ? fixture.marketToken : fixture.marketNative),
        signer.publicKey,
        args.amount,
        sell ? fixture.decimals : 9,
        sell ? tokenProgram : EXTERNAL_IDS.splToken,
      ),
      transfer(
        new PublicKey(sell ? fixture.marketNative : fixture.marketToken),
        sell ? native : mint,
        destination,
        market.publicKey,
        delivered,
        sell ? 9 : fixture.decimals,
        sell ? EXTERNAL_IDS.splToken : tokenProgram,
      ),
    ];
    const chain = new StockChain(connection, DEPLOYMENT);
    const chainSnapshot = await chain.snapshot(),
      now = chainSnapshot.now;
    const state: StockState = {
      ...chainSnapshot,
      ...(await chain.limits(chainSnapshot, now)),
      budget: { bought: 0n, sold: 0n, mints: new Map() },
      buckets: new Map([
        [
          0,
          {
            failing: sell,
            listedAt:
              chainSnapshot.machine.bucket_history[0]!.listed_ts > 0n
                ? chainSnapshot.machine.bucket_history[0]!.listed_ts
                : null,
          },
        ],
      ]),
      revealDelaySeconds: KEEPER_POLICY.revealDelaySecondsMin,
    };
    const blockhash = (await connection.getLatestBlockhash("confirmed"))
      .blockhash;
    let compose: (units: number) => {
      transaction: VersionedTransaction;
      serializedSize: number;
    };
    if (expectedError) {
      const evidence = await chain.evidence(state, {
        bucket: args.bucket,
        kind: EXEC_KIND.stockBuy,
        amount: args.amount,
        reason: "validator_prepared",
      });
      const prepared: StockQuote = {
        ...evidence,
        bucket: args.bucket,
        kind: EXEC_KIND.stockBuy,
        amount: args.amount,
        reason: "validator_prepared",
        minOut: delivered,
        outAmount: delivered,
        impactBps: 0,
      };
      assert.deepEqual(
        checkStockQuote(state, prepared, now),
        { ok: false, error: expectedError },
        `K1 must refuse the prepared amount before ${expectedError}`,
      );
      assert.deepEqual(
        planStock(state, [prepared], now),
        [],
        "K1 may propose a smaller reserve-safe buy, but cannot admit this prepared amount",
      );
      for (const candidate of stockRequests(state, now)) {
        if (candidate.kind === EXEC_KIND.stockBuy)
          assert.equal(
            stockBuyGuard(
              state.machine,
              candidate.bucket,
              candidate.amount,
              now,
            ),
            null,
            "A replacement buy must satisfy the P3 guards at its own amount",
          );
      }
      // Deliberately retain the prepared instructions despite fresh K1 refusal.
      // This probes the final on-chain guard if state changes after planning.
      compose = (units) =>
        composeExecTransaction({
          deployment: DEPLOYMENT,
          payer: signer.publicKey,
          beginIx: execBeginIx(PROGRAM_ID, args),
          endIx: execEndIx(PROGRAM_ID, args),
          swap: { setup: [], swap, cleanup: [], lookupTables: [] },
          computeBudget: [ComputeBudgetProgram.setComputeUnitLimit({ units })],
          protocolLut,
          blockhash,
        });
    } else {
      const evidence = await chain.evidence(state, {
        bucket: 0,
        kind: sell ? EXEC_KIND.stockSell : EXEC_KIND.stockBuy,
        amount: args.amount,
        reason: "validator",
      });
      const trade = planStock(
        state,
        [
          {
            ...evidence,
            kind: sell ? EXEC_KIND.stockSell : EXEC_KIND.stockBuy,
            bucket: 0,
            amount: args.amount,
            reason: "validator",
            minOut: delivered,
            outAmount: delivered,
            impactBps: 0,
          },
        ],
        now,
      )[0];
      assert(
        trade,
        `K1 planner must select a valid exec trade: ${JSON.stringify({ requests: stockRequests(state, now), check: checkStockQuote(state, { ...evidence, kind: sell ? EXEC_KIND.stockSell : EXEC_KIND.stockBuy, bucket: 0, amount: args.amount, reason: "validator", minOut: delivered, outAmount: delivered, impactBps: 0 }, now) }, (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value))}`,
      );
      const wire = (ix: TransactionInstruction) => ({
        programId: ix.programId.toBase58(),
        accounts: ix.keys.map((k) => ({ ...k, pubkey: k.pubkey.toBase58() })),
        data: ix.data.toString("base64"),
      });
      const route = await buildRoute(
        state,
        trade,
        {
          async build(input) {
            assert.equal(input.wrapAndUnwrapSol, false);
            assert.equal(input.destinationTokenAccount, destination.toBase58());
            assert.equal(input.amount, args.amount);
            return {
              inAmount: args.amount,
              outAmount: delivered,
              minOut: delivered,
              setupInstructions: [wire(swap[0]!)],
              swapInstruction: wire(swap[1]!),
              cleanupInstruction: null,
              otherInstructions: [],
              computeBudgetInstructions: [],
              lookupTables: {},
            };
          },
        },
        async () => {
          throw new Error("Unexpected stub LUT");
        },
      );
      compose = (units) =>
        buildStockTransaction({
          state,
          trade,
          route,
          now,
          blockhash,
          protocolLut,
          units,
        });
    }
    const probe = compose(1_400_000);
    probe.transaction.sign([market, signer]);
    const simulation = await connection.simulateTransaction(probe.transaction, {
      commitment: "confirmed",
      sigVerify: true,
    });
    if (expectedError) {
      assert(simulation.value.err, `Expected ${expectedError}`);
      assert(
        simulation.value.logs?.some((line) => line.includes(expectedError)),
        JSON.stringify(simulation.value),
      );
      // Submit the same prepared plan to the bank as well; a simulation alone
      // is not evidence that the execution-time guard rejected a transaction.
      const signature = await connection.sendRawTransaction(
        probe.transaction.serialize(),
        { skipPreflight: true },
      );
      const latest = await connection.getLatestBlockhash("confirmed");
      const landed = await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        "confirmed",
      );
      assert(
        landed.value.err,
        `Execution unexpectedly passed ${expectedError}`,
      );
      const receipt = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      assert(
        receipt?.meta?.logMessages?.some((line) =>
          line.includes(expectedError),
        ),
        `Missing executed ${expectedError}`,
      );
      console.log(`P3 executed refusal: ${expectedError}`);
      return;
    }
    assert.equal(
      simulation.value.err,
      null,
      `Signed exec simulation failed: ${JSON.stringify(simulation.value)}`,
    );
    assert(simulation.value.unitsConsumed);
    const measured = execComputeUnits(simulation.value.logs);
    const built = compose(
      Math.ceil(
        (simulation.value.unitsConsumed *
          (BPS_DENOMINATOR + SERVICES.landing.cuMarginBps)) /
          BPS_DENOMINATOR,
      ),
    );
    built.transaction.sign([market, signer]);
    console.log(
      `EXEC TRENDING ${sell ? "StockSell" : "StockBuy"} signed simulation: ${simulation.value.unitsConsumed} CU, begin_cu ${measured.begin}, end_cu ${measured.end}, ${built.serializedSize} bytes`,
    );
    await send(connection, built.transaction, signer);
    const after = await snapshot();
    const afterBucket = after.machine.buckets[0]!;
    const sameTrendHour =
      afterBucket.trend_hour_index === priorBucket.trend_hour_index;
    assert.equal(after.machine.exec.kind, 0);
    assert.equal(afterBucket.class, 2);
    assert.equal(
      afterBucket.trend_bought_hour,
      (sameTrendHour ? priorBucket.trend_bought_hour : 0n) +
        (sell ? 0n : args.amount),
    );
    assert.equal(
      afterBucket.trend_sold_hour,
      (sameTrendHour ? priorBucket.trend_sold_hour : 0n) + removedBook,
    );
    assert.equal(
      afterBucket.cost,
      priorBucket.cost + (sell ? -removedBook : args.amount),
    );
    assert(after.vault >= after.ledger.accounted);
    assert.equal(
      after.machine.stock_sol,
      beforeTrade.machine.stock_sol + (sell ? delivered : -args.amount),
    );
    assert.equal(
      after.ledger.accounted,
      beforeTrade.ledger.accounted + (sell ? -args.amount : delivered),
    );
    assert.equal(
      after.machine.buckets[0]!.amount,
      priorBucket.amount + (sell ? -args.amount : delivered),
    );
    if (sell) assert.equal(await connection.getAccountInfo(destination), null);
    console.log(
      `EXEC TRENDING ${sell ? "StockSell" : "StockBuy"} PASS: ${built.serializedSize} bytes, delivered ${delivered}`,
    );
  };
  if (fixture.guards) {
    async function chainNow() {
      const clock = await connection.getBlockTime(
        await connection.getSlot("confirmed"),
      );
      assert(clock !== null);
      return BigInt(clock);
    }
    async function waitUntil(deadline: bigint) {
      const started = Date.now();
      while ((await chainNow()) < deadline) {
        assert(Date.now() - started < 150_000, "Guard deadline did not arrive");
        await delay(400);
      }
    }
    // buyArgs and its account plan were prepared before the Rip and its reveal.
    await runRip(
      connection,
      { ...manifest, wallets: { ...manifest.wallets, buyer: fixture.signer } },
      undefined,
      {
        pending: () => trade(buyArgs, "StockBuyPullInFlight"),
        revealed: async () => {
          assert.equal((await snapshot()).machine.unsettled_reveals, 1n);
          await trade(buyArgs, "StockBuyPullInFlight");
          await trade(sellArgs); // Sell remains live during the reveal and notice.
        },
        settled: async () => {
          assert.equal((await snapshot()).machine.unsettled_reveals, 0n);
          await trade(buyArgs, "StockBuyRevealDelay");
        },
      },
    );
    await waitUntil(
      (await snapshot()).machine.last_reveal_ts + BigInt(POST_REVEAL_BUY_DELAY),
    );
    await trade(buyArgs, "StockBuyListingNotice");
    await waitUntil(
      (await snapshot()).machine.bucket_history[0]!.listed_ts +
        BigInt(HIT_LIST.trendingNoticeSeconds),
    );
    await trade(buyArgs, "StockBuyReserve");
    for (let i = 0; i < 4; i++) {
      if (
        stockBuyGuard(
          (await snapshot()).machine,
          0,
          buyArgs.amount,
          await chainNow(),
        ) === null
      )
        break;
      await trade(sellArgs);
    }
    const settled = (await snapshot()).machine;
    assert(settled.packs_revealed.some((count) => count > 0n));
    assert.equal(settled.pending_pulls, 0n);
    assert.equal(settled.unsettled_reveals, 0n);
    await trade(buyArgs);
    assert.equal(
      (await snapshot()).machine.buckets[0]!.cost,
      settled.buckets[0]!.cost + buyArgs.amount,
      "K1 replenishes stock after the settled reveal using P3 account evidence",
    );
    console.log(
      "K1/P3 PASS: planner and builder replenish after settled reveal; prepared buy refused for pending/reveal, delay, listing and reserve; exits and StockSell stay live",
    );
    return;
  }
  for (const args of [buyArgs, sellArgs]) await trade(args);
  console.log(
    "EXEC PASS: K1 planner and builder through P1 composeExecTransaction, frozen protocol LUT, signed transfer stub, exact vault and tracked SOL deltas, per-mint hourly counters",
  );
  await runMeteoraExec(connection, manifest);
}

/** Exercise both canonical reference accounts through the actual pinned swaps. */
async function runMeteoraExec(connection: Connection, manifest: Manifest) {
  const fixture = manifest.exec;
  assert(fixture);
  const signer = localSigner(fixture.signer);
  const source = new ExecutorSource(
    new JsonRpcClient({
      url: connection.rpcEndpoint,
      timeoutMs: 15_000,
      failureThreshold: 3,
      recoverMs: 1_000,
    }),
    DEPLOYMENT,
  );
  const market = localSigner(fixture.market);
  const mintSigner = localSigner(fixture.mintSigner);
  const mint = mintSigner.publicKey;
  const native = new PublicKey(WSOL_MINT);
  const token = EXTERNAL_IDS.splToken;
  const config = new PublicKey(DEPLOYMENT.meteora.dbcConfig);
  const dammConfig = new PublicKey(METEORA.dammV2Config);
  const venue = await meteoraLocalVenue(
    connection,
    config,
    dammConfig,
    mint,
    signer.publicKey,
    feeInPda(PROGRAM_ID)[0],
  );
  const marketVenue = await meteoraLocalVenue(
    connection,
    config,
    dammConfig,
    mint,
    market.publicKey,
    feeInPda(PROGRAM_ID)[0],
  );
  const vault = vaultAta(PROGRAM_ID, mint, token);
  const quote = userAta(signer.publicKey, native, token);
  const marketQuote = userAta(market.publicKey, native, token);
  const marketBase = userAta(market.publicKey, mint, token);
  const writable = (pubkey: PublicKey, isSigner = false) => ({
    pubkey,
    isSigner,
    isWritable: true,
  });
  const readonly = (pubkey: PublicKey) => ({
    pubkey,
    isSigner: false,
    isWritable: false,
  });
  function createAta(payer: PublicKey, owner: PublicKey, tokenMint: PublicKey) {
    return new TransactionInstruction({
      programId: EXTERNAL_IDS.associatedToken,
      data: Buffer.from([1]),
      keys: [
        writable(payer, true),
        writable(userAta(owner, tokenMint, token)),
        readonly(owner),
        readonly(tokenMint),
        readonly(SystemProgram.programId),
        readonly(token),
      ],
    });
  }
  async function direct(
    payer: Keypair,
    instructions: TransactionInstruction[],
    signers: Keypair[] = [],
  ) {
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash("confirmed"))
          .blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ...instructions,
        ],
      }).compileToV0Message(),
    );
    transaction.sign([payer, ...signers]);
    await send(connection, transaction, payer);
  }
  const configSigner = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        await readFile(
          join(
            appDirectory,
            "fixtures/meteora/keys/localnet-devnet-dbc-config-TEST-ONLY.json",
          ),
          "utf8",
        ),
      ) as number[],
    ),
  );
  assert(configSigner.publicKey.equals(config));
  await direct(
    signer,
    [venue.createConfig(meteoraTestConfig())],
    [configSigner],
  );
  await direct(
    signer,
    [
      venue.initializePool({
        name: "Onepercent executor test",
        symbol: "1PCT",
        uri: "https://example.invalid/onepercent-executor.json",
      }),
    ],
    [mintSigner],
  );
  await direct(signer, [
    createAta(signer.publicKey, vaultAuthPda(PROGRAM_ID)[0], mint),
  ]);
  async function marketBuy(amount: bigint, mode: 0 | 1) {
    await direct(market, [
      createAta(market.publicKey, market.publicKey, native),
      createAta(market.publicKey, market.publicKey, mint),
      SystemProgram.transfer({
        fromPubkey: market.publicKey,
        toPubkey: marketQuote,
        lamports: amount,
      }),
      new TransactionInstruction({
        programId: token,
        keys: [writable(marketQuote)],
        data: Buffer.from([17]),
      }),
      marketVenue.swap("dbc", marketQuote, marketBase, amount, 1n, mode),
    ]);
  }
  // Build liquidity through the real curve; the tracked reserve excludes its fees.
  await marketBuy(25_000_000_000n, 0);
  async function donateOneNativeUnit() {
    const transfer = Buffer.alloc(10);
    transfer[0] = 12;
    transfer.writeBigUInt64LE(1n, 1);
    transfer[9] = 9;
    // A separate wallet sends exactly one wrapped lamport into the public ATA.
    await direct(market, [
      createAta(market.publicKey, signer.publicKey, native),
      SystemProgram.transfer({
        fromPubkey: market.publicKey,
        toPubkey: marketQuote,
        lamports: 1n,
      }),
      new TransactionInstruction({
        programId: token,
        keys: [writable(marketQuote)],
        data: Buffer.from([17]),
      }),
      new TransactionInstruction({
        programId: token,
        data: transfer,
        keys: [
          writable(marketQuote),
          readonly(native),
          writable(quote),
          { ...readonly(market.publicKey), isSigner: true },
        ],
      }),
    ]);
    assert.equal(await source.residue(signer.publicKey), 1n);
  }
  function argsFor(
    kind: typeof EXEC_KIND.burn | typeof EXEC_KIND.jackpotBuy,
    migrated: boolean,
  ): ExecBeginInput {
    return {
      signer: signer.publicKey,
      mint,
      tokenProgram: token,
      kind,
      bucket: 255,
      amount: 50_000_000n,
      oracles: [
        venue.launchPool,
        migrated ? venue.migratedPool : SystemProgram.programId,
        migrated ? venue.migratedBaseVault : venue.baseVault,
        migrated ? venue.migratedQuoteVault : venue.quoteVault,
      ],
    };
  }
  const allInstructions = [false, true].flatMap((migrated) => {
    const args = argsFor(EXEC_KIND.burn, migrated);
    return [
      execBeginIx(PROGRAM_ID, args),
      execEndIx(PROGRAM_ID, args),
      venue.swap(
        migrated ? "damm-v2" : "dbc",
        quote,
        vault,
        args.amount,
        1n,
        0,
      ),
    ];
  });
  const addresses = [
    ...new Map(
      allInstructions
        .flatMap((ix) => [ix.programId, ...ix.keys.map((meta) => meta.pubkey)])
        .filter((address) => !address.equals(signer.publicKey))
        .map((address) => [address.toBase58(), address]),
    ).values(),
  ];
  const [createLut, lookupTable] = AddressLookupTableProgram.createLookupTable({
    authority: signer.publicKey,
    payer: signer.publicKey,
    recentSlot: await connection.getSlot("finalized"),
  });
  await direct(signer, [createLut]);
  for (let offset = 0; offset < addresses.length; offset += 20)
    await direct(signer, [
      AddressLookupTableProgram.extendLookupTable({
        lookupTable,
        authority: signer.publicKey,
        payer: signer.publicKey,
        addresses: addresses.slice(offset, offset + 20),
      }),
    ]);
  await direct(signer, [
    AddressLookupTableProgram.freezeLookupTable({
      lookupTable,
      authority: signer.publicKey,
    }),
  ]);
  const protocolLut = (await connection.getAddressLookupTable(lookupTable))
    .value;
  assert(protocolLut && protocolLut.state.authority === undefined);
  const rooting = Date.now();
  while (
    (await connection.getSlot("finalized")) <=
    protocolLut.state.lastExtendedSlot
  ) {
    assert(Date.now() - rooting < 45_000, "Meteora executor LUT did not root");
    await delay(250);
  }
  async function snapshot() {
    const [machine, ledger, account, mintAccount] =
      await connection.getMultipleAccountsInfo(
        [
          machinePda(PROGRAM_ID)[0],
          ledgerPda(PROGRAM_ID, mint)[0],
          vault,
          mint,
        ],
        "confirmed",
      );
    assert(machine && ledger && account && mintAccount);
    return {
      machine: decodeMachine(machine.data),
      ledger: decodeMintLedger(ledger.data),
      vault: account.data.readBigUInt64LE(64),
      supply: mintAccount.data.readBigUInt64LE(36),
    };
  }
  for (const migrated of [false, true]) {
    if (migrated) {
      await marketBuy(100_000_000_000n, 1);
      await direct(signer, [
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: venue.launchAuthority,
          lamports: 1_000_000_000n,
        }),
      ]);
      const migration = venue.migration();
      await direct(signer, [migration.instruction], [migration.positionMint]);
    }
    const dbc = await connection.getAccountInfo(venue.launchPool, "confirmed");
    assert(dbc);
    assert.equal(dbc.data[305], Number(migrated));
    for (const kind of [EXEC_KIND.burn, EXEC_KIND.jackpotBuy] as const) {
      const args = argsFor(kind, migrated);
      const burn = kind === EXEC_KIND.burn;
      const previous = await snapshot();
      const last = burn
        ? previous.machine.last_burn_ts
        : previous.machine.last_jackpot_buy_ts;
      const spacing = burn
        ? BURN.minSpacingSeconds
        : JACKPOT.trancheMinSpacingSeconds;
      const spacingStarted = Date.now();
      while (true) {
        const now = await connection.getBlockTime(
          await connection.getSlot("confirmed"),
        );
        if (now !== null && BigInt(now) >= last + BigInt(spacing)) break;
        assert(
          Date.now() - spacingStarted < 45_000,
          "Meteora executor spacing did not elapse",
        );
        await delay(250);
      }
      await donateOneNativeUnit();
      const evidence = await source.reference(await source.snapshot());
      const decision = planExecutor(
        burn ? "burn" : "jackpot",
        evidence.snapshot,
        evidence.reference,
        EXECUTOR_POLICY,
      );
      assert(decision.ok, decision.ok ? "" : decision.reason);
      args.amount = decision.plan.amount;
      const pool = await connection.getAccountInfo(
        migrated ? venue.migratedPool : venue.launchPool,
        "confirmed",
      );
      assert(pool);
      const sqrtOffset = migrated ? 456 : 280;
      const sqrtPrice =
        pool.data.readBigUInt64LE(sqrtOffset) |
        (pool.data.readBigUInt64LE(sqrtOffset + 8) << 64n);
      const recordedQuote = pool.data.readBigUInt64LE(migrated ? 688 : 240);
      const reserveBps = burn
        ? BURN.trancheMaxBpsOfQuoteReserves
        : JACKPOT.trancheMaxBpsOfQuoteReserves;
      assert(
        args.amount <=
          (recordedQuote * BigInt(reserveBps)) / BigInt(BPS_DENOMINATOR),
      );
      const expected = minOutMeteoraBuy({
        amount: args.amount,
        sqrtPrice,
        slipBps: burn ? BURN.minOutSlipBps : JACKPOT.minOutSlipBps,
      });
      const blockhash = (await connection.getLatestBlockhash("confirmed"))
        .blockhash;
      const compose = (units: number) => {
        const plan = composeExecutor({
          plan: decision.plan,
          p1: executorP1,
          signer: signer.publicKey,
          protocolLut,
          blockhash,
          computeUnitLimit: units,
          // Local rehearsal tip only; production remains gated on measured config.
          tipLamports: SENDER_MIN_TIP_LAMPORTS,
          swap: {
            minOut: expected.minOut,
            outAmount: expected.expected,
            setup: [],
            cleanup: [],
            lookupTables: [],
            swap: venue.swap(
              migrated ? "damm-v2" : "dbc",
              quote,
              vault,
              args.amount,
              expected.minOut,
              0,
            ),
          },
        });
        const transaction = new VersionedTransaction(
          new TransactionMessage({
            payerKey: signer.publicKey,
            recentBlockhash: blockhash,
            instructions: [
              ComputeBudgetProgram.setComputeUnitLimit({ units }),
              ...plan.instructions,
            ],
          }).compileToV0Message([...(plan.lookupTables ?? [])]),
        );
        const size = transaction.serialize().length;
        assert(size <= 1232);
        return { transaction, serializedSize: size };
      };
      const probe = compose(1_400_000);
      probe.transaction.sign([signer]);
      const simulation = await connection.simulateTransaction(
        probe.transaction,
        { commitment: "confirmed", sigVerify: true },
      );
      assert.equal(
        simulation.value.err,
        null,
        JSON.stringify(simulation.value),
      );
      assert(simulation.value.unitsConsumed);
      const measured = execComputeUnits(simulation.value.logs);
      const built = compose(
        Math.ceil(
          (simulation.value.unitsConsumed *
            (BPS_DENOMINATOR + SERVICES.landing.cuMarginBps)) /
            BPS_DENOMINATOR,
        ),
      );
      const signature = await send(connection, built.transaction, signer);
      const receipt = await source.receipt(signature, signer.publicKey);
      assert.equal(receipt.sourceResidue, 0n);
      assert.equal(await source.residue(signer.publicKey), 0n);
      const after = await snapshot();
      assert.equal(after.machine.exec.kind, 0);
      const delivered = burn
        ? after.machine.burned_total - previous.machine.burned_total
        : after.machine.jackpot_tokens - previous.machine.jackpot_tokens;
      assert(delivered >= expected.minOut);
      assert.equal(
        after.machine.burn_sol,
        previous.machine.burn_sol - (burn ? args.amount : 0n),
      );
      assert.equal(
        after.machine.jackpot_sol,
        previous.machine.jackpot_sol - (burn ? 0n : args.amount),
      );
      assert.equal(
        after.machine.jackpot_cost,
        previous.machine.jackpot_cost + (burn ? 0n : args.amount),
      );
      assert.equal(
        after.ledger.accounted,
        previous.ledger.accounted + (burn ? 0n : delivered),
      );
      assert.equal(after.vault, previous.vault + (burn ? 0n : delivered));
      assert.equal(after.supply, previous.supply - (burn ? delivered : 0n));
      console.log(
        `EXEC ${migrated ? "DAMM v2" : "DBC"} ${burn ? "Burn" : "JackpotBuy"} PASS: one-lamport wSOL donation recovered, zero execution residue, ${simulation.value.unitsConsumed} CU, begin_cu ${measured.begin}, end_cu ${measured.end}, ${built.serializedSize} bytes, reserve ${recordedQuote}, min_out ${expected.minOut}, delivered ${delivered}`,
      );
    }
  }
  console.log(
    "EXEC Meteora PASS: worker source, planner and P1 composition, real DBC buys, migration and DAMM v2 buys, exact burn/supply and Jackpot accounting",
  );
}

async function runPowerOn(
  connection: Connection,
  manifest: Manifest,
): Promise<void> {
  assert(manifest.launchMint);
  const payer = localSigner(manifest.wallets.payer);
  const mint = new PublicKey(manifest.launchMint);
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
  }).add(
    powerOnIx(DEPLOYMENT, {
      launchWallet: payer.publicKey,
      mint,
      tokenProgram: EXTERNAL_IDS.splToken,
    }),
  );
  await send(connection, tx, payer);
  const machine = await fetchMachine(PROGRAM_ID, connection);
  assert(machine);
  assert.equal(machine.phase, 2);
  assert(machine.token_mint.equals(mint));
  assert.equal(
    machine.on_air_ts - machine.power_on_ts,
    BigInt(SEASON.onAirDelaySeconds),
  );
  assert.equal(
    machine.end_ts - machine.on_air_ts,
    BigInt(SEASON.durationSeconds),
  );
  assert(
    machine.onepct.every(
      (slot) => slot.state === 0 && slot.amount === TOKEN_1PCT.onePctCardAmount,
    ),
  );
  await seedFees(
    connection,
    payer,
    STOCK.creatorFeeFloorLamports,
    "belowFloor",
  );
  await seedFees(connection, payer, 1_000_000_007n, "season");
  console.log(
    "M4 PASS: SDK Power-On on StockUp, direct FeeIn seed crosses floor, next collection uses season split",
  );
}
async function seedFees(
  connection: Connection,
  payer: Keypair,
  amount: bigint,
  regime: keyof typeof CREATOR_FEE_SPLIT_BPS,
): Promise<void> {
  const before = await fetchMachine(PROGRAM_ID, connection);
  assert(before);
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: feeInPda(PROGRAM_ID)[0],
      lamports: amount,
    }),
    collectCreatorFeesIx(DEPLOYMENT, { payer: payer.publicKey }),
  );
  await send(connection, tx, payer);
  const after = await fetchMachine(PROGRAM_ID, connection);
  assert(after);
  const team =
    (amount * BigInt(CREATOR_FEE_SPLIT_BPS[regime].team)) /
    BigInt(BPS_DENOMINATOR);
  assert.equal(after.stock_sol - before.stock_sol, amount - team);
  assert.equal(after.team_sol - before.team_sol, team);
  assert.equal(after.burn_sol, before.burn_sol);
}
async function runSeason(
  connection: Connection,
  manifest: Manifest,
): Promise<void> {
  const initial = await fetchMachine(PROGRAM_ID, connection);
  assert(initial);
  await runRip(connection, manifest, 6);
  let machine = await fetchMachine(PROGRAM_ID, connection);
  assert(machine);
  assert.equal(machine.onepct[0]!.state, 2);
  await runRip(connection, manifest, 5);
  machine = await fetchMachine(PROGRAM_ID, connection);
  assert(machine);
  assert.equal(machine.jackpot_tokens, 0n);
  assert.equal(machine.jackpot_cost, 0n);
  assert(machine.jackpot_sol >= initial.jackpot_sol);
  await seedFees(
    connection,
    localSigner(manifest.wallets.payer),
    1_000_000_007n,
    "season",
  );
}
async function runSeasonClosed(
  connection: Connection,
  manifest: Manifest,
): Promise<void> {
  const payer = localSigner(manifest.wallets.payer);
  await send(
    connection,
    new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    }).add(advancePhaseInstruction(PROGRAM_ID)),
    payer,
  );
  assert.equal((await fetchMachine(PROGRAM_ID, connection))?.phase, 4);
  await seedFees(connection, payer, 1_000_000_007n, "afterEnd");
  console.log(
    "E4b PASS: advance at season end closes buys; collected FeeIn goes entirely to team",
  );
}
export interface ValidatorOverride {
  deckLen: number;
  queueAddress: string;
  queueFile: string;
  vrfArtifact: string;
  run: (connection: Connection, manifest: Manifest) => Promise<void>;
}
export interface ValidatorLocalRun {
  /** Read existing artifacts in place; never copy a target directory. */
  artifactDirectory?: string;
  fixtureExporter?: string;
  prepare?: (manifest: Manifest, fixtureDirectory: string) => Promise<void>;
  run: (connection: Connection, manifest: Manifest) => Promise<void>;
}
export async function runValidatorFlow(
  flow: ValidatorFlow,
  real?: ValidatorOverride,
  local?: ValidatorLocalRun,
  fixtureEnv?: Record<string, string>,
): Promise<void> {
  const artifacts = resolve(
    local?.artifactDirectory ??
      process.env.ONEPERCENT_VALIDATOR_ARTIFACT_DIR ??
      resolve(appDirectory, "target/deploy"),
  );
  for (const name of real ? ["onepercent"] : ["onepercent", "mock_vrf"]) {
    const artifact = await readFile(join(artifacts, `${name}.so`));
    assert.equal(artifact.subarray(0, 6).toString("hex"), "7f454c460201");
    assert.equal(
      artifact.readUInt32LE(48),
      3,
      `${name} must be the deployable sBPFv3 artifact`,
    );
  }
  const binary = process.env.SOLANA_TEST_VALIDATOR ?? "solana-test-validator";
  const version = launch(binary, ["--version"]);
  await version.done;
  assert.match(
    version.output(),
    /\b4\.3\.0\b/,
    "M1 requires solana-test-validator 4.3.0",
  );
  const directory = await mkdtemp(join(tmpdir(), `onepercent-${flow}-`));
  let validator: ReturnType<typeof launch> | undefined;
  try {
    const fixtureDirectory = join(directory, "fixtures");
    const fixtureExporter =
      local?.fixtureExporter ?? process.env.FIXTURE_EXPORT_BINARY;
    assert(
      !local || fixtureExporter,
      "A local web run requires FIXTURE_EXPORT_BINARY; it never builds Rust implicitly",
    );
    const exporter = launch(
      fixtureExporter ?? process.execPath,
      fixtureExporter
        ? ["--nocapture"]
        : [
            "scripts/program.mjs",
            "test",
            "--test",
            "export_fixtures",
            "--",
            "--nocapture",
          ],
      {
        ...process.env,
        ...fixtureEnv,
        FIXTURE_DIR: fixtureDirectory,
        FIXTURE_FLOW: flow === "meteora-season" ? "power-on" : flow,
        FIXTURE_NOW: Math.floor(Date.now() / 1000).toString(),
        ...(real
          ? {
              FIXTURE_DECK_LEN: String(real.deckLen),
              FIXTURE_EXTRA_BUYERS: "32",
            }
          : {}),
      },
    );
    await exporter.done;
    const manifest = JSON.parse(
      await readFile(join(fixtureDirectory, "manifest.json"), "utf8"),
    ) as Manifest;
    assert.equal(
      manifest.scenario,
      flow === "meteora-season" ? "power-on" : flow,
    );
    if (flow === "exec") {
      // On-chain recent-hit accounting gives the planner an inventory target above
      // the existing TRENDING book. Only local validator fixture bytes change.
      const fixture = manifest.accounts.find(
        (item) => item.address === machinePda(PROGRAM_ID)[0].toBase58(),
      );
      assert(fixture && manifest.exec);
      const path = join(fixtureDirectory, fixture.file);
      const raw = await readFile(path, "utf8");
      const account = JSON.parse(raw) as {
        account: { data: [string, string] };
      };
      const machine = decodeMachine(
        Buffer.from(account.account.data[0], "base64"),
      );
      const target = machine.buckets[0]!.cost + BigInt(manifest.exec.buyAmount);
      const share = BigInt(STOCK.trendingShareMaxBps);
      const inventory = (target * BigInt(BPS_DENOMINATOR) + share - 1n) / share;
      const minutes = BigInt(KEEPER_POLICY.inventoryTargetMinutes);
      const hourly = (inventory * 60n + minutes - 1n) / minutes;
      await writeFile(
        path,
        raw.replace(
          JSON.stringify(account.account.data[0]),
          JSON.stringify(
            encodeMachine({
              ...machine,
              hit_out_last_hour: hourly,
              bucket_history: machine.bucket_history.map((history, index) =>
                index === 0 && !manifest.exec!.guards
                  ? {
                      ...history,
                      listed_ts:
                        BigInt(manifest.baseTime) -
                        BigInt(HIT_LIST.trendingNoticeSeconds),
                    }
                  : history,
              ),
            }).toString("base64"),
          ),
        ),
      );
    }
    const meteoraMint =
      flow === "meteora-season" ? Keypair.generate() : undefined;
    if (meteoraMint) {
      const fixture = manifest.accounts.find(
        (item) => item.address === configPda(PROGRAM_ID)[0].toBase58(),
      );
      assert(fixture);
      const path = join(fixtureDirectory, fixture.file);
      const raw = await readFile(path, "utf8");
      const account = JSON.parse(raw) as {
        account: { data: [string, string] };
      };
      const config = decodeConfig(
        Buffer.from(account.account.data[0], "base64"),
      );
      await writeFile(
        path,
        raw.replace(
          JSON.stringify(account.account.data[0]),
          JSON.stringify(
            Buffer.from(
              encodeConfig({ ...config, token_mint: meteoraMint.publicKey }),
            ).toString("base64"),
          ),
        ),
      );
      manifest.accounts = manifest.accounts.filter(
        (item) => item.address !== DEPLOYMENT.meteora.dbcConfig,
      );
    }
    if (meteoraMint || flow === "exec") {
      manifest.accounts = manifest.accounts.filter(
        (item) => item.address !== DEPLOYMENT.meteora.dbcConfig,
      );
      const meteora = await meteoraValidatorFixtures(fixtureDirectory);
      manifest.programs.push(...meteora.programs);
      for (const account of meteora.accounts) {
        manifest.accounts = manifest.accounts.filter(
          (item) => item.address !== account.address,
        );
        manifest.accounts.push(account);
      }
    }
    await local?.prepare?.(manifest, fixtureDirectory);
    const mockQueue = manifest.queue;
    if (real) {
      const configFile = manifest.accounts.find(
        (item) => item.address === configPda(PROGRAM_ID)[0].toBase58(),
      );
      assert(configFile);
      const configPath = isAbsolute(configFile.file)
        ? configFile.file
        : join(fixtureDirectory, configFile.file);
      const originalJson = await readFile(configPath, "utf8");
      const account = JSON.parse(originalJson) as {
        account: { data: [string, string] };
      };
      const config = decodeConfig(
        Buffer.from(account.account.data[0], "base64"),
      );
      config.vrf_queues[config.active_queue] = new PublicKey(real.queueAddress);
      const encoded = Buffer.from(encodeConfig(config)).toString("base64");
      // Retain the exporter's exact u64 JSON numbers (including rentEpoch).
      await writeFile(
        configPath,
        originalJson.replace(
          JSON.stringify(account.account.data[0]),
          JSON.stringify(encoded),
        ),
      );
      manifest.queue = real.queueAddress;
      assert.equal(
        manifest.deckLen,
        real.deckLen,
        "Use the latest exporter with measurement fixture support",
      );
      assert.equal(manifest.buyers?.length, 32);
    }

    assert(
      Array.isArray(manifest.programs) && manifest.programs.length > 0,
      "Use the current Rust exporter including its runtime SPL programs",
    );
    const port = await freePort();
    let faucetPort = await freePort();
    while (faucetPort === port || faucetPort === port + 1)
      faucetPort = await freePort();
    const gossipBase = await freePortRange(40);
    const programData = PublicKey.findProgramAddressSync(
      [PROGRAM_ID.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    )[0];
    const args = [
      "--reset",
      "--quiet",
      "--ledger",
      join(directory, "ledger"),
      "--bind-address",
      "127.0.0.1",
      "--rpc-port",
      String(port),
      "--faucet-port",
      String(faucetPort),
      "--gossip-port",
      String(gossipBase),
      "--dynamic-port-range",
      `${gossipBase + 1}-${gossipBase + 39}`,
      "--upgradeable-program",
      PROGRAM_ID.toBase58(),
      join(artifacts, "onepercent.so"),
      manifest.wallets.payer.publicKey,
      "--bpf-program",
      EXTERNAL_IDS.magicblockVrf.toBase58(),
      real?.vrfArtifact ?? join(artifacts, "mock_vrf.so"),
    ];
    for (const program of manifest.programs) {
      args.push(
        "--bpf-program",
        program.address,
        isAbsolute(program.file)
          ? program.file
          : join(fixtureDirectory, program.file),
      );
    }
    for (const account of manifest.accounts) {
      if (
        (real && account.address === mockQueue) ||
        account.address === PROGRAM_ID.toBase58() ||
        account.address === programData.toBase58() ||
        account.address === EXTERNAL_IDS.magicblockVrf.toBase58()
      )
        continue;
      args.push(
        "--account",
        account.address,
        isAbsolute(account.file)
          ? account.file
          : join(fixtureDirectory, account.file),
      );
    }
    if (real) args.push("--account", real.queueAddress, real.queueFile);
    validator = launch(binary, args);
    const connection = new Connection(`http://127.0.0.1:${port}`, "confirmed");
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 60_000) {
      if (validator.child.exitCode !== null)
        throw new Error(validator.output());
      try {
        await connection.getLatestBlockhash("confirmed");
        // Genesis-loaded programs become visible after their deployment slot.
        if ((await connection.getSlot("confirmed")) >= 2) {
          ready = true;
          break;
        }
        await delay(250);
      } catch {
        await delay(250);
      }
    }
    assert(ready, `Validator did not become ready\n${validator.output()}`);
    if (meteoraMint) {
      const state = await runMeteoraSeason(
        connection,
        meteoraMint,
        localSigner(manifest.wallets.payer),
        appDirectory,
      );
      // Replay the exact real venue state with an aged Machine timestamp. The
      // validator has no clock-warp RPC; this avoids changing compiled seasons.
      const snapshots = new Map<
        string,
        Awaited<ReturnType<Connection["getAccountInfo"]>>
      >();
      for (const fixture of manifest.accounts)
        snapshots.set(
          fixture.address,
          await connection.getAccountInfo(new PublicKey(fixture.address)),
        );
      for (const owner of [
        PROGRAM_ID,
        EXTERNAL_IDS.meteoraDbc,
        EXTERNAL_IDS.meteoraDammV2,
        EXTERNAL_IDS.splToken,
        EXTERNAL_IDS.token2022,
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
      ]) {
        for (const item of await connection.getProgramAccounts(owner))
          snapshots.set(item.pubkey.toBase58(), item.account);
      }
      for (const address of [
        feeInPda(PROGRAM_ID)[0],
        PublicKey.findProgramAddressSync(
          [Buffer.from("pool_authority")],
          EXTERNAL_IDS.meteoraDbc,
        )[0],
      ])
        snapshots.set(
          address.toBase58(),
          await connection.getAccountInfo(address),
        );
      const machineSnapshot = snapshots.get(
        machinePda(PROGRAM_ID)[0].toBase58(),
      );
      assert(machineSnapshot);
      const aged = decodeMachine(machineSnapshot.data);
      const onAir = BigInt(Math.floor(Date.now() / 1000) - 2);
      machineSnapshot.data = Buffer.from(
        encodeMachine({ ...aged, on_air_ts: onAir, end_ts: onAir + 1n }),
      );
      const replayArgs: string[] = [];
      for (let index = 0; index < args.length; index++) {
        if (args[index] === "--account") {
          index += 2;
          continue;
        }
        replayArgs.push(args[index]!);
      }
      for (const [address, account] of snapshots) {
        if (!account || account.executable || account.lamports === 0) continue;
        const file = join(fixtureDirectory, `${address}-replay.json`);
        await writeFile(
          file,
          JSON.stringify({
            pubkey: address,
            account: {
              ...account,
              owner: account.owner.toBase58(),
              data: [account.data.toString("base64"), "base64"],
              rentEpoch: 0,
              space: account.data.length,
            },
          }),
        );
        replayArgs.push("--account", address, file);
      }
      await stop(validator.child);
      validator = launch(binary, replayArgs);
      const replayConnection = new Connection(
        `http://127.0.0.1:${port}`,
        "confirmed",
      );
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          if ((await replayConnection.getSlot("confirmed")) >= 2) break;
        } catch {
          /* startup */
        }
        if (validator.child.exitCode !== null)
          throw new Error(validator.output());
        await delay(250);
      }
      await runMeteoraAfterEnd(replayConnection, state, appDirectory);
    } else if (real) await real.run(connection, manifest);
    else if (local) await local.run(connection, manifest);
    else
      await {
        feed: runFeed,
        rip: runRip,
        refund: runRefund,
        "settle-closed": runSettleClosed,
        sellback: (connection: Connection, manifest: Manifest) =>
          runSellBack(connection, manifest, {
            deployment: DEPLOYMENT,
            localSigner,
            attest,
            send,
            options,
          }),
        exec: runExec,
        "power-on": runPowerOn,
        season: runSeason,
        "season-closed": runSeasonClosed,
      }[flow as Exclude<ValidatorFlow, "meteora-season">](connection, manifest);
  } catch (error) {
    if (validator) {
      console.error(
        `Validator exit=${validator.child.exitCode} signal=${validator.child.signalCode}\n${validator.output()}`,
      );
      const log = await readFile(
        join(directory, "ledger/validator.log"),
        "utf8",
      ).catch(() => "Validator log unavailable");
      const logPath = join(
        tmpdir(),
        `${basename(directory)}-validator-failure.log`,
      );
      await writeFile(logPath, log);
      console.error(`Validator diagnostics saved to ${logPath}`);
    }
    throw error;
  } finally {
    if (validator) await stop(validator.child);
    await rm(directory, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const flow = process.argv[2];
  if (flow === undefined || flow === "all") {
    const results: { flow: string; code: number | null }[] = [];
    for (const selected of [
      "launch",
      "proxima",
      "feed",
      "rip",
      "refund",
      "settle-closed",
      "sellback",
      "exec",
      "power-on",
      "season",
    ]) {
      console.log(`Validator suite: ${selected}`);
      const child = spawn(
        process.execPath,
        [
          "--conditions=development",
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          selected,
        ],
        { stdio: "inherit", env: process.env },
      );
      const code = await new Promise<number | null>((resolveExit, reject) => {
        child.once("error", reject);
        child.once("exit", resolveExit);
      });
      results.push({ flow: selected, code });
    }
    console.log(JSON.stringify({ validatorSuites: results }, null, 2));
    assert(
      results.every(({ code }) => code === 0),
      "Validator suites failed",
    );
  } else if (flow === "launch" || flow === "proxima") {
    const { runMeteoraValidatorLaunch } =
      await import("../fixtures/meteora/validator-launch.js");
    await runMeteoraValidatorLaunch(flow === "proxima" ? "proxima" : "atomic");
  } else if (flow === "season") {
    await runValidatorFlow("meteora-season");
    await runValidatorFlow("season");
    await runValidatorFlow("season-closed");
  } else {
    if (
      flow !== "feed" &&
      flow !== "rip" &&
      flow !== "refund" &&
      flow !== "settle-closed" &&
      flow !== "sellback" &&
      flow !== "exec" &&
      flow !== "power-on" &&
      flow !== "season-closed" &&
      flow !== "meteora-season"
    )
      throw new Error(
        "Usage: e2e-validator.ts <launch|proxima|sellback|feed|rip|refund|settle-closed|exec|power-on|season|season-closed|meteora-season>",
      );
    await runValidatorFlow(flow);
    if (flow === "exec")
      await runValidatorFlow("exec", undefined, undefined, {
        FIXTURE_GUARDS: "1",
      });
  }
}
