import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import assert from "node:assert/strict";
import { serveValidator } from "./server.js";
import { validatorSdkChecks } from "./checks.js";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  EXTERNAL_IDS,
  buildBuyPacksTransaction,
  buildRedeemTransactions,
  buildSettleTransaction,
  consumeRandomnessInstruction,
  deckPda,
  machinePda,
  decodeMachine,
  encodeMachine,
  decodeDeck,
  encodeDeck,
  fetchBinder,
  fetchMintDecimals,
  fetchPayees,
  fetchPull,
  pullPda,
  scopedVrfIdentity,
  vaultAta,
  type BuiltTransaction,
  type SettleInput,
} from "../../../../packages/sdk/src/index.js";
import { loadVerify } from "../../src/data/verify.js";
import { loadPullEvidence } from "../../src/data/pull.js";
import { crossCheckReveal } from "../../src/tx/watch-pull.js";
import { ripResult } from "../../src/adapters/rip-result.js";
import { identifyCards, resolveCards } from "../../src/adapters/cards.js";
import {
  JACKPOT,
  PACK_EDITIONS,
  TOKEN_1PCT,
} from "../../../../packages/config/src/index.js";
import {
  runValidatorFlow,
  type Manifest,
} from "../../../../scripts/e2e-validator.js";

/** Fresh local transactions through the Verify page's loader. Requires existing
 * artifacts, never starts a Rust build, and reads only disposable fixture signers. */
const artifacts = process.env.ONEPERCENT_VALIDATOR_ARTIFACT_DIR;
const exporter = process.env.FIXTURE_EXPORT_BINARY;
assert(
  artifacts && exporter,
  "Set ONEPERCENT_VALIDATOR_ARTIFACT_DIR and FIXTURE_EXPORT_BINARY to existing artifacts",
);
const output = resolve(
  process.env.WEB_VALIDATOR_REPORT ??
    join(tmpdir(), "onepercent-w3-validator.json"),
);
const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const provenance = {
  kind: "fresh local-validator transactions",
  programId: PROGRAM_ID.toBase58(),
  programSha256: await hash(join(artifacts, "onepercent.so")),
  mockVrfSha256: await hash(join(artifacts, "mock_vrf.so")),
  fixtureExporterSha256: await hash(exporter),
  artifactDirectory: resolve(artifacts),
  provider: "test mock VRF",
  providerProofVerified: false,
  startedAt: new Date().toISOString(),
};
const pulls: {
  address: string;
  request: string;
  callback: string;
  seq: string;
  edition: number;
  qty: number;
  signatureToRevealMs: number;
}[] = [];
const checks: string[] = [];
let transactionsSent = 0;
let manifestPath: string;
let sdkChecks: Awaited<ReturnType<typeof validatorSdkChecks>> | undefined;
async function send(
  connection: Connection,
  tx: BuiltTransaction,
  signer: Keypair,
) {
  if (tx instanceof Transaction) tx.sign(signer);
  else tx.sign([signer]);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
    skipPreflight: false,
    maxRetries: 0,
  });
  transactionsSent++;
  const end = Date.now() + 45_000;
  while (Date.now() < end) {
    const result = (await connection.getSignatureStatuses([signature]))
      .value[0];
    assert(
      !result?.err,
      `Local transaction failed: ${JSON.stringify(result?.err)}`,
    );
    if (
      result?.confirmationStatus === "confirmed" ||
      result?.confirmationStatus === "finalized"
    )
      return signature;
    await delay(100);
  }
  throw new Error(`Local confirmation timed out: ${signature}`);
}
async function options(connection: Connection, signer: Keypair) {
  return {
    wallet: signer.publicKey,
    blockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
  };
}
async function prepare(manifest: Manifest, directory: string) {
  manifestPath = join(directory, "manifest.json");
  const read = async (address: PublicKey) => {
    const item = manifest.accounts.find(
      (account) => account.address === address.toBase58(),
    );
    assert(item);
    const path = isAbsolute(item.file) ? item.file : join(directory, item.file);
    const original = await readFile(path, "utf8");
    const value = JSON.parse(original) as {
      account: { data: [string, string]; lamports: number; space: number };
    };
    return { path, original, value };
  };
  const rewrite = async (
    item: Awaited<ReturnType<typeof read>>,
    data: Buffer,
    extraLamports = 0,
  ) => {
    // Preserve the exact rentEpoch u64 from the exporter.
    let updated = item.original.replace(
      JSON.stringify(item.value.account.data[0]),
      JSON.stringify(data.toString("base64")),
    );
    if (extraLamports)
      updated = updated.replace(
        /("lamports"\s*:\s*)\d+/,
        `$1${item.value.account.lamports + extraLamports}`,
      );
    updated = updated.replace(/("space"\s*:\s*)\d+/, `$1${data.length}`);
    await writeFile(item.path, updated);
  };
  const deck = await read(deckPda(PROGRAM_ID)[0]);
  const initial = decodeDeck(Buffer.from(deck.value.account.data[0], "base64"));
  const entry = initial.entries[0];
  assert(entry);
  const deckEntries = 1000;
  const additional = deckEntries - initial.len;
  assert(additional >= 0);
  await rewrite(
    deck,
    Buffer.from(
      encodeDeck({
        ...initial,
        cap: deckEntries,
        len: deckEntries,
        total_fed: BigInt(deckEntries),
        entries: Array.from({ length: deckEntries }, () => entry),
      }),
    ),
    additional * entry.deposit,
  );
  let specialTokens = 0n;
  if (
    process.env.WEB_VALIDATOR_BROWSER === "1" ||
    process.env.WEB_VALIDATOR_SERVE === "1" ||
    process.env.WEB_VALIDATOR_SDK_CHECKS === "1"
  ) {
    const machine = await read(machinePda(PROGRAM_ID)[0]);
    const initialMachine = decodeMachine(
      Buffer.from(machine.value.account.data[0], "base64"),
    );
    const amount = TOKEN_1PCT.onePctCardAmount;
    const encoded = Buffer.from(
      encodeMachine({
        ...initialMachine,
        on_air_ts: BigInt(manifest.baseTime),
        onepct: initialMachine.onepct.map((slot) => ({
          ...slot,
          state: 0,
          amount,
        })),
        jackpot_tokens: amount,
        jackpot_cost:
          BigInt(JACKPOT.minPotPriceMultiple) * PACK_EDITIONS[3].priceLamports,
      }),
    );
    // M4.1's published Machine.token_mint offset, in the previous reserved area.
    // Reuse the local fixture mint, backed by its real vault and MintLedger.
    encoded.set(entry.mint.toBytes(), 2608);
    await rewrite(machine, encoded);
    specialTokens = amount * BigInt(TOKEN_1PCT.onePctCardCount + 1);
  }
  const extraTokens = BigInt(additional) * entry.amount + specialTokens;
  for (const [address, offset] of [
    [entry.mint, 36],
    [vaultAta(PROGRAM_ID, entry.mint, EXTERNAL_IDS.splToken), 64],
    [
      PublicKey.findProgramAddressSync(
        [Buffer.from("ledger"), entry.mint.toBuffer()],
        PROGRAM_ID,
      )[0],
      72,
    ],
  ] as const) {
    const account = await read(address);
    const data = Buffer.from(account.value.account.data[0], "base64");
    data.writeBigUInt64LE(data.readBigUInt64LE(offset) + extraTokens, offset);
    await rewrite(account, data);
  }
}
async function settle(
  connection: Connection,
  buyer: Keypair,
  address: PublicKey,
) {
  const pull = await fetchPull(PROGRAM_ID, connection, address);
  assert(pull?.status === 2);
  for (let pack = 0; pack < pull.qty; pack++) {
    const record = pull.packs[pack]!;
    const payees = await fetchPayees(connection, [
      buyer.publicKey,
      pull.referrer,
      ...record.royalties.map((row) => row.depositor),
    ]);
    await send(
      connection,
      buildSettleTransaction(PROGRAM_ID, {
        ...(await options(connection, buyer)),
        packs: [
          {
            pull: address,
            seq: pull.seq,
            pack,
            buyer: payees[0]!,
            referrer: pull.referrer.equals(PublicKey.default)
              ? undefined
              : payees[1],
            wallets: record.royalties.map((_, i) =>
              record.house_mask & (1 << i) ? null : payees[i + 2]!,
            ) as unknown as SettleInput["wallets"],
          },
        ],
      }),
      buyer,
    );
  }
  assert.equal(await fetchPull(PROGRAM_ID, connection, address), null);
}
async function browserChecks(connection: Connection, pattern: string) {
  if (process.env.WEB_VALIDATOR_BROWSER !== "1") return;
  assert(
    process.env.WEB_VALIDATOR_URL,
    "WEB_VALIDATOR_URL must point to the built web preview",
  );
  await writeFile(
    output,
    JSON.stringify({ provenance, pulls }, null, 2) + "\n",
  );
  const child = spawn(
    "pnpm",
    ["exec", "playwright", "test", "--project", "validator", "--grep", pattern],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        WEB_VALIDATOR_RPC_URL: connection.rpcEndpoint,
        WEB_VALIDATOR_REPORT: output,
        WEB_VALIDATOR_MANIFEST: manifestPath,
      },
      stdio: "inherit",
    },
  );
  await new Promise<void>((yes, no) => {
    child.once("error", no);
    child.once("exit", (code) =>
      code === 0
        ? yes()
        : no(new Error(`W3 browser verification exited ${code}`)),
    );
  });
}

async function runPullBatch(connection: Connection, manifest: Manifest) {
  await browserChecks(connection, "W3.0[12358]");
  assert(new URL(connection.rpcEndpoint).hostname === "127.0.0.1");
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(manifest.wallets.buyer.secretKey),
  );
  const queue = new PublicKey(manifest.queue);
  for (let index = 0; index < 100; index++) {
    const edition = index % 4;
    const qty = index === 0 ? 10 : 1;
    const before = await fetchBinder(PROGRAM_ID, connection, buyer.publicKey);
    const nonce = before?.pull_nonce ?? 0;
    const requestIndex = (await connection.getAccountInfo(
      queue,
      "confirmed",
    ))!.data.readUInt32LE(0);
    const start = Date.now();
    const request = await send(
      connection,
      buildBuyPacksTransaction(PROGRAM_ID, {
        ...(await options(connection, buyer)),
        edition,
        qty,
        pullNonce: nonce,
        oracleQueue: queue,
      }),
      buyer,
    );
    const address = pullPda(PROGRAM_ID, buyer.publicKey, nonce)[0];
    const pending = await fetchPull(PROGRAM_ID, connection, address);
    assert(pending?.status === 1);
    assert.equal(
      await loadPullEvidence(connection, address, pending.seq, pending),
      null,
    );
    const randomness = createHash("sha256")
      .update(`onepercent-w3:${index}`)
      .digest();
    const callbackIx = consumeRandomnessInstruction(PROGRAM_ID, {
      pull: address,
      buyer: buyer.publicKey,
      seq: pending.seq,
      randomness,
    });
    const data = Buffer.alloc(37);
    data[0] = 0xf0;
    data.writeUInt32LE(requestIndex, 1);
    randomness.copy(data, 5);
    const callback = await send(
      connection,
      new Transaction({
        feePayer: buyer.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash("confirmed"))
          .blockhash,
      }).add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
        new TransactionInstruction({
          programId: EXTERNAL_IDS.magicblockVrf,
          data,
          keys: [
            { pubkey: queue, isSigner: false, isWritable: true },
            {
              pubkey: scopedVrfIdentity(PROGRAM_ID)[0],
              isSigner: false,
              isWritable: false,
            },
            { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
            ...callbackIx.keys.slice(1),
          ],
        }),
      ),
      buyer,
    );
    const revealed = await fetchPull(PROGRAM_ID, connection, address);
    assert(revealed?.status === 2);
    const evidence = await loadPullEvidence(
      connection,
      address,
      pending.seq,
      revealed,
      PROGRAM_ID,
    );
    assert(evidence);
    const ordered = await crossCheckReveal(
      evidence,
      { buyer: buyer.publicKey.toBase58(), edition, qty },
      revealed,
      PROGRAM_ID,
    );
    assert.deepEqual(
      ordered.map((pack) => pack.pack),
      Array.from({ length: qty }, (_, pack) => pack),
    );
    for (const pack of ordered) {
      const result = ripResult(pack, { items: [] });
      assert.equal(result.dust.length, 4);
      assert.equal(result.verifyUrl, `/verify/${revealed.seq}`);
      assert.equal(result.hit.valueSolUi, null);
    }
    const verified = await loadVerify(
      connection,
      address.toBase58(),
      null,
      PROGRAM_ID,
    );
    assert(
      verified?.check?.ok && verified.check.complete,
      `Verify failed for ${revealed.seq}`,
    );
    assert.equal(verified.links.callback, callback);
    assert.equal(verified.packs.length, qty);
    const binder = await fetchBinder(PROGRAM_ID, connection, buyer.publicKey);
    assert(binder);
    assert.equal(binder.cards.length, (before?.cards.length ?? 0) + qty * 5);
    const added = binder.cards.slice(before?.cards.length ?? 0);
    assert.deepEqual(
      added.map((card) => [card.mint.toBase58(), card.amount.toString()]),
      ordered.flatMap((pack) => [
        [pack.hit_mint, pack.hit_amount.toString()],
        ...pack.dust.map((row) => [row.mint, row.amount.toString()]),
      ]),
    );
    pulls.push({
      address: address.toBase58(),
      request,
      callback,
      seq: `${revealed.seq}`,
      edition,
      qty,
      signatureToRevealMs: Date.now() - start,
    });
    if (index % 10 === 9 || index === 0) {
      const selected = resolveCards(
        binder,
        identifyCards(binder.cards).map((card) => card.cardId),
      );
      const cards = await Promise.all(
        selected.map(async (card) => ({
          ...card,
          tokenProgram: (await fetchMintDecimals(connection, card.mint))
            .tokenProgram,
        })),
      );
      for (const tx of buildRedeemTransactions(PROGRAM_ID, {
        ...(await options(connection, buyer)),
        cards,
      }))
        await send(connection, tx, buyer);
      assert.equal(
        (await fetchBinder(PROGRAM_ID, connection, buyer.publicKey))?.len,
        0,
      );
    }
    await settle(connection, buyer, address);
    if ((index + 1) % 10 === 0)
      console.log(`Fresh Verify: ${index + 1}/100 confirmed Pulls`);
  }
  await browserChecks(connection, "W3.09");
  checks.push(
    "100 fresh Pulls verified with the page data loader",
    "x10 callback order equals decoded Pull and events",
    "Pending requests produce no reveal evidence",
    "Binder additions equal confirmed dust and hit events",
    "SDK Redeem lands in descending index order",
    "SDK Settle closes each revealed Pull without a keeper",
  );
}
async function writeReport() {
  const times = pulls
    .map((pull) => pull.signatureToRevealMs)
    .sort((a, b) => a - b);
  await writeFile(
    output,
    JSON.stringify(
      {
        provenance,
        result: pulls.length === 100 ? "passed" : "in_progress",
        recordedAt: new Date().toISOString(),
        transactionsSent,
        pulls,
        checks,
        sdkChecks,
        timing: {
          context:
            "local mock provider, includes explicit fulfillment and adapter validation",
          p50Ms: times[Math.floor(times.length * 0.5)],
          p95Ms: times[Math.floor(times.length * 0.95)],
        },
        browserVerified: false,
      },
      null,
      2,
    ) + "\n",
  );
}
async function run(connection: Connection, manifest: Manifest) {
  if (process.env.WEB_VALIDATOR_SDK_CHECKS === "1") {
    sdkChecks = await validatorSdkChecks(connection, manifest);
    return;
  }
  if (process.env.WEB_VALIDATOR_SERVE === "1") {
    await writeReport();
    return serveValidator({
      rpc: connection,
      manifest,
      reportPath: output,
      run100: async () => {
        assert(pulls.length === 0, "The 100-Pull batch already ran");
        await runPullBatch(connection, manifest);
      },
      writeReport,
    });
  }
  return runPullBatch(connection, manifest);
}

try {
  await runValidatorFlow(
    process.env.WEB_VALIDATOR_BROWSER === "1" ||
      process.env.WEB_VALIDATOR_SERVE === "1" ||
      process.env.WEB_VALIDATOR_SDK_CHECKS === "1"
      ? "refund"
      : "rip",
    undefined,
    {
      artifactDirectory: artifacts,
      fixtureExporter: exporter,
      prepare,
      run,
    },
  );
  const times = pulls
    .map((pull) => pull.signatureToRevealMs)
    .sort((a, b) => a - b);
  const report = {
    provenance,
    result: "passed",
    recordedAt: new Date().toISOString(),
    transactionsSent,
    pulls,
    checks,
    sdkChecks,
    timing: {
      context:
        "local mock provider, includes explicit fulfillment and adapter validation",
      p50Ms: times[Math.floor(times.length * 0.5)],
      p95Ms: times[Math.floor(times.length * 0.95)],
    },
    browserVerified: process.env.WEB_VALIDATOR_BROWSER === "1",
    deferred: [
      "W3 browser interactions including Turbo and RipLine",
      "P2 Sell, Feed back, withdraw owed and Close on-chain validation",
      "The 1% and Jackpot injection",
      "devnet deployment and real VRF provider",
    ],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        result: report.result,
        freshPulls: sdkChecks?.injectedTiers.length ?? pulls.length,
        transactionsSent,
        report: output,
        ...report.timing,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    output,
    JSON.stringify(
      {
        provenance,
        result: "failed",
        recordedAt: new Date().toISOString(),
        transactionsSent,
        pulls,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
}
