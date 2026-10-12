import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import * as anchorNamespace from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// Run with M1_APP and FIXTURE_EXPORT_BINARY pointing at read-only draft artifacts.
// All generated signers and ledger files stay in a temporary directory.
const m1 = resolve(process.env.M1_APP ?? "");
assert(process.env.M1_APP && process.env.FIXTURE_EXPORT_BINARY);
const sdk = await import(pathToFileURL(join(m1, "packages/sdk/dist/index.js")));
// The capture launches the local fixture artifact at its recorded address.
const programId = new PublicKey(sdk.IDL.address);
const anchor = anchorNamespace.default ?? anchorNamespace;
const coder = new anchor.BorshCoder(sdk.IDL);
const directory = await mkdtemp(join(tmpdir(), "onepercent-s4-capture-"));
const fixtureDirectory = join(directory, "fixtures");
const output = resolve(
  process.env.VERIFY_CAPTURE_OUTPUT ??
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures/validator-pulls.json",
    ),
);
let validator;

function start(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: directory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const collect = (data) => {
    log = (log + data.toString()).slice(-50_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const done = new Promise((yes, no) => {
    child.once("error", no);
    child.once("exit", (code) =>
      code === 0 ? yes() : no(new Error(`${command} failed: ${log}`)),
    );
  });
  void done.catch(() => {});
  return { child, done, log: () => log };
}

async function port() {
  const server = createServer();
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const result = server.address().port;
  await new Promise((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
  return result;
}

async function send(connection, transaction, signer) {
  if ("partialSign" in transaction) transaction.sign(signer);
  else transaction.sign([signer]);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    {
      preflightCommitment: "confirmed",
    },
  );
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const state = (await connection.getSignatureStatuses([signature])).value[0];
    assert(!state?.err, JSON.stringify(state?.err));
    if (
      state?.confirmationStatus === "confirmed" ||
      state?.confirmationStatus === "finalized"
    )
      return signature;
    await delay(100);
  }
  throw new Error(`Local transaction confirmation timeout: ${signature}`);
}

function jsonValue(value) {
  if (value instanceof PublicKey || value?.constructor?.name === "PublicKey")
    return value.toBase58();
  if (typeof value === "bigint" || anchor.BN.isBN(value))
    return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  return value;
}

function decodeEvents(logs) {
  const stack = [];
  const events = [];
  for (const line of logs) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(
      line,
    );
    if (invoke) {
      assert.equal(stack.length, Number(invoke[2]) - 1);
      stack.push(invoke[1]);
      continue;
    }
    const complete =
      /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/.exec(line);
    if (complete) {
      assert.equal(stack.pop(), complete[1]);
      continue;
    }
    if (
      stack.at(-1) === programId.toBase58() &&
      line.startsWith("Program data: ")
    ) {
      const event = coder.events.decode(line.slice("Program data: ".length));
      assert(event, "IDL must decode every owned event");
      events.push(jsonValue(event));
    }
  }
  assert.equal(stack.length, 0);
  return events;
}

try {
  const validatorBinary =
    process.env.SOLANA_TEST_VALIDATOR ?? "solana-test-validator";
  const version = start(validatorBinary, ["--version"]);
  await version.done;
  assert.match(version.log(), /\b4\.3\.0\b/);
  for (const name of ["onepercent", "mock_vrf"]) {
    const binary = await readFile(join(m1, "target/deploy", `${name}.so`));
    assert.equal(binary.readUInt32LE(48), 3);
  }
  const exporter = start(process.env.FIXTURE_EXPORT_BINARY, ["--nocapture"], {
    ...process.env,
    FIXTURE_DIR: fixtureDirectory,
    FIXTURE_FLOW: "rip",
    FIXTURE_NOW: String(Math.floor(Date.now() / 1000)),
  });
  await exporter.done;
  const manifest = JSON.parse(
    await readFile(join(fixtureDirectory, "manifest.json"), "utf8"),
  );
  const readAccount = async (address) => {
    const item = manifest.accounts.find(
      (account) => account.address === address.toBase58(),
    );
    assert(item);
    const path = join(fixtureDirectory, item.file);
    return { path, value: JSON.parse(await readFile(path, "utf8")) };
  };
  const rewrite = async (account, data) => {
    account.value.account.data = [data.toString("base64"), "base64"];
    account.value.account.space = data.length;
    await writeFile(account.path, JSON.stringify(account.value));
  };
  // Larger genesis test Deck, with the original Rent-derived deposit per entry.
  const deckAccount = await readAccount(sdk.deckPda(programId)[0]);
  const originalDeck = sdk.decodeDeck(
    Buffer.from(deckAccount.value.account.data[0], "base64"),
  );
  const entry = originalDeck.entries[0];
  const deckEntries = 1_000;
  const increase = deckEntries - originalDeck.len;
  deckAccount.value.account.lamports += increase * entry.deposit;
  await rewrite(
    deckAccount,
    sdk.encodeDeck({
      ...originalDeck,
      cap: deckEntries,
      len: deckEntries,
      total_fed: BigInt(deckEntries),
      entries: Array.from({ length: deckEntries }, () => entry),
    }),
  );
  const extraTokens = BigInt(increase) * entry.amount;
  for (const [address, offset] of [
    [entry.mint, 36],
    [sdk.vaultAta(programId, entry.mint, sdk.EXTERNAL_IDS.splToken), 64],
    [
      PublicKey.findProgramAddressSync(
        [Buffer.from("ledger"), entry.mint.toBuffer()],
        programId,
      )[0],
      72,
    ],
  ]) {
    const account = await readAccount(address);
    const data = Buffer.from(account.value.account.data[0], "base64");
    data.writeBigUInt64LE(data.readBigUInt64LE(offset) + extraTokens, offset);
    await rewrite(account, data);
  }

  const rpcPort = await port();
  const args = [
    "--reset",
    "--quiet",
    "--ledger",
    join(directory, "ledger"),
    "--bind-address",
    "127.0.0.1",
    "--rpc-port",
    String(rpcPort),
    "--faucet-port",
    String(await port()),
    "--upgradeable-program",
    programId.toBase58(),
    join(m1, "target/deploy/onepercent.so"),
    manifest.wallets.payer.publicKey,
    "--bpf-program",
    sdk.EXTERNAL_IDS.magicblockVrf.toBase58(),
    join(m1, "target/deploy/mock_vrf.so"),
  ];
  for (const program of manifest.programs)
    args.push(
      "--bpf-program",
      program.address,
      join(fixtureDirectory, program.file),
    );
  const programDataAddress = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0].toBase58();
  for (const account of manifest.accounts) {
    if (
      [
        programId.toBase58(),
        programDataAddress,
        sdk.EXTERNAL_IDS.magicblockVrf.toBase58(),
      ].includes(account.address)
    )
      continue;
    args.push(
      "--account",
      account.address,
      join(fixtureDirectory, account.file),
    );
  }
  validator = start(validatorBinary, args);
  const connection = new Connection(`http://127.0.0.1:${rpcPort}`, "confirmed");
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert(validator.child.exitCode === null, validator.log());
    try {
      await connection.getLatestBlockhash();
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert(ready, validator.log());
  while ((await connection.getSlot("confirmed")) < 5) await delay(250);
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(manifest.wallets.buyer.secretKey),
  );
  const queue = new PublicKey(manifest.queue);
  const pulls = [];
  for (let index = 0; index < 100; index++) {
    const nonce =
      (await sdk.fetchBinder(programId, connection, buyer.publicKey))
        ?.pull_nonce ?? 0;
    const requestIndex = (
      await connection.getAccountInfo(queue)
    ).data.readUInt32LE(0);
    const request = sdk.buildBuyPacksTransaction(programId, {
      wallet: buyer.publicKey,
      blockhash: (await connection.getLatestBlockhash()).blockhash,
      edition: index % 4,
      qty: 1,
      pullNonce: nonce,
      oracleQueue: queue,
    });
    const requestSignature = await send(connection, request, buyer);
    const address = sdk.pullPda(programId, buyer.publicKey, nonce)[0];
    const pending = await sdk.fetchPull(programId, connection, address);
    assert.equal(pending.status, 1);
    const randomness = createHash("sha256")
      .update(`onepercent-s4-validator:${index}`)
      .digest();
    const callback = sdk.consumeRandomnessInstruction(programId, {
      pull: address,
      buyer: buyer.publicKey,
      seq: pending.seq,
      randomness,
    });
    const fulfillData = Buffer.alloc(37);
    fulfillData[0] = 0xf0;
    fulfillData.writeUInt32LE(requestIndex, 1);
    randomness.copy(fulfillData, 5);
    const transaction = new Transaction({
      feePayer: buyer.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      new TransactionInstruction({
        programId: sdk.EXTERNAL_IDS.magicblockVrf,
        data: fulfillData,
        keys: [
          { pubkey: queue, isSigner: false, isWritable: true },
          {
            pubkey: sdk.scopedVrfIdentity(programId)[0],
            isSigner: false,
            isWritable: false,
          },
          { pubkey: programId, isSigner: false, isWritable: false },
          ...callback.keys.slice(1),
        ],
      }),
    );
    const callbackSignature = await send(connection, transaction, buyer);
    const revealed = await sdk.fetchPull(programId, connection, address);
    assert.equal(revealed.status, 2);
    const confirmed = await connection.getTransaction(callbackSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    assert(confirmed && !confirmed.meta.err);
    const events = decodeEvents(confirmed.meta.logMessages);
    assert(
      events.some((event) => event.name === "PackRevealed"),
      JSON.stringify({
        names: events.map((event) => event.name),
        logs: confirmed.meta.logMessages,
      }),
    );
    const opened = await connection.getTransaction(requestSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    assert(opened && !opened.meta.err);
    pulls.push({
      requestSignature,
      callbackSignature,
      pull: address.toBase58(),
      header: jsonValue(revealed),
      request: {
        slot: opened.slot,
        blockTime: opened.blockTime,
        logs: opened.meta.logMessages,
      },
      callback: {
        slot: confirmed.slot,
        blockTime: confirmed.blockTime,
        logs: confirmed.meta.logMessages,
      },
      events,
    });
    if ((index + 1) % 10 === 0)
      console.log(`Recorded ${index + 1}/100 validator Pulls`);
  }
  const hashFile = async (path) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  await writeFile(
    output,
    JSON.stringify(
      {
        provenance: {
          kind: "recorded local validator transactions, production v3 program and test mock VRF",
          validator: version.log().trim(),
          programId: programId.toBase58(),
          programSha256: await hashFile(
            join(m1, "target/deploy/onepercent.so"),
          ),
          mockVrfSha256: await hashFile(join(m1, "target/deploy/mock_vrf.so")),
          idlSha256: await hashFile(
            join(m1, "packages/sdk/src/idl/onepercent.json"),
          ),
          recordedAt: new Date().toISOString(),
          deckEntries,
          pulls: pulls.length,
          settled: false,
        },
        pulls,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Saved 100 public Pull records to ${output}`);
} catch (error) {
  if (validator) console.error(validator.log());
  throw error;
} finally {
  if (validator?.child.exitCode === null) {
    validator.child.kill("SIGTERM");
    await Promise.race([validator.done.catch(() => {}), delay(5_000)]);
    if (validator.child.exitCode === null) validator.child.kill("SIGKILL");
  }
  await rm(directory, { recursive: true, force: true });
}
