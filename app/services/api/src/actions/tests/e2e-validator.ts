// Local validator tooling only: excluded from the production API build.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Hono } from "hono";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { JsonRpcClient } from "@onepercent/service-kit";
import { PACK_EDITIONS } from "@onepercent/config";
import { FeatureFlags } from "@onepercent/sdk/api";
import { EXTERNAL_IDS, fetchBinder, fetchPull, pullPda } from "@onepercent/sdk";
import { createPublicData } from "../../public/data/index.js";
import { registerActions } from "../index.js";
import { defaultDeps } from "../../link/index.js";
import { TransactionResponseSchema } from "../spec.js";

interface FixtureWallet {
  publicKey: string;
  secretKey: number[];
}
interface Manifest {
  scenario: string;
  programs: { address: string; file: string }[];
  accounts: { address: string; file: string }[];
  wallets: Record<"buyer" | "depositor" | "intake" | "payer", FixtureWallet>;
}
const appDirectory = fileURLToPath(new URL("../../../../../", import.meta.url));
// The local fixture exporter and validator use the checked-in program build.
const PROGRAM_ID = new PublicKey(
  JSON.parse(
    await readFile(
      join(appDirectory, "packages/sdk/src/idl/onepercent.json"),
      "utf8",
    ),
  ).address as string,
);
function launch(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, {
    cwd: appDirectory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (data: Buffer) => {
    output = (output + data.toString()).slice(-100_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const done = new Promise<void>((yes, no) => {
    child.once("error", no);
    child.once("exit", (code, signal) =>
      code === 0
        ? yes()
        : no(new Error(`${command} exited ${code ?? signal}\n${output}`)),
    );
  });
  void done.catch(() => {});
  return { child, done, output: () => output };
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
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((yes) => child.once("exit", () => yes())),
    delay(5_000).then(() => {
      child.kill("SIGKILL");
    }),
  ]);
}
async function confirmed(
  connection: Connection,
  signature: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 45_000) {
    const value = (await connection.getSignatureStatuses([signature])).value[0];
    if (value?.err)
      throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
    if (
      value?.confirmationStatus === "confirmed" ||
      value?.confirmationStatus === "finalized"
    )
      return;
    await delay(250);
  }
  throw new Error(`Transaction confirmation timed out: ${signature}`);
}
async function runRipChecks(
  connection: Connection,
  manifest: Manifest,
): Promise<void> {
  assert.equal(new URL(connection.rpcEndpoint).hostname, "127.0.0.1");
  const rpc = new JsonRpcClient({
    url: connection.rpcEndpoint,
    timeoutMs: 10_000,
    failureThreshold: 5,
    recoverMs: 1_000,
  });
  const flags = FeatureFlags.parse(
    Object.fromEntries(
      Object.keys(FeatureFlags.shape).map((name) => [
        name,
        ["PACKS", "BLINKS_RIP"].includes(name),
      ]),
    ),
  );
  // Only the S4 config/machine readers run; neither accesses Postgres or Redis.
  const runtime = {
    rpc,
    env: { CLUSTER: "localnet", PROGRAM_ID: PROGRAM_ID.toBase58() },
  } as Parameters<typeof createPublicData>[0]["runtime"];
  const data = createPublicData({ runtime, flags });
  const app = new Hono();
  registerActions(app, {
    ...defaultDeps({ WEB_ORIGIN: "http://127.0.0.1:3000" }),
    cluster: "localnet",
    logger: { info() {} },
    rip: {
      webOrigin: "http://127.0.0.1:3000",
      publicApiOrigin: "http://127.0.0.1:3000",
      cluster: "localnet",
      rpc,
      snapshot: async () => {
        const [config, machine, now] = await Promise.all([
          data.config(),
          data.machine(),
          rpc.chainNow(),
        ]);
        return { config, machine, nowTs: Number(now), asOfMs: Date.now() };
      },
      limiter: { consume: () => ({ ok: true }) },
      clientIp: () => "127.0.0.1",
      clock: Date.now,
    },
  });
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(manifest.wallets.buyer.secretKey),
  );
  assert.equal(buyer.publicKey.toBase58(), manifest.wallets.buyer.publicKey);
  assert.equal(
    await fetchBinder(PROGRAM_ID, connection, buyer.publicKey),
    null,
    "First Rip starts without a Binder",
  );
  const refA = new PublicKey(manifest.wallets.depositor.publicKey);
  const refB = new PublicKey(manifest.wallets.payer.publicKey);
  assert(!refA.equals(refB) && !refA.equals(buyer.publicKey));
  const records: unknown[] = [];
  try {
    for (const [qty, ref] of [
      [1, refA],
      [5, refB],
    ] as const) {
      const before = await fetchBinder(PROGRAM_ID, connection, buyer.publicKey);
      const nonce = before?.pull_nonce ?? 0;
      const response = await app.request(
        `/api/actions/rip/${PACK_EDITIONS[0].id}?n=${qty}&lf=0&ref=${ref.toBase58()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account: buyer.publicKey.toBase58(),
            type: "transaction",
          }),
        },
      );
      const body: unknown = await response.json();
      assert.equal(response.status, 200, `Rip ${qty}: ${JSON.stringify(body)}`);
      const action = TransactionResponseSchema.parse(body);
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(action.transaction, "base64"),
      );
      assert.equal(transaction.message.header.numRequiredSignatures, 1);
      assert(transaction.message.staticAccountKeys[0]?.equals(buyer.publicKey));
      assert(
        transaction.signatures.every((signature) =>
          signature.every((byte) => byte === 0),
        ),
      );
      const instructions = transaction.message.compiledInstructions;
      const purchases = instructions.filter((instruction) =>
        transaction.message.staticAccountKeys[
          instruction.programIdIndex
        ]?.equals(PROGRAM_ID),
      );
      assert.equal(purchases.length, 1);
      const purchase = purchases[0]!;
      const data = Buffer.from(purchase.data);
      assert.equal(
        data[15],
        qty === 1 ? 1 : 0,
        "Only the first Rip proposes a referrer",
      );
      if (qty === 1)
        assert(
          new PublicKey(data.subarray(16, 48)).equals(refA),
          "First Rip proposes A",
        );
      else
        assert.equal(
          data.length,
          17,
          "Second Rip encodes no referrer or holder proof",
        );
      transaction.sign([buyer]);
      const simulation = await connection.simulateTransaction(transaction, {
        commitment: "confirmed",
        sigVerify: true,
      });
      assert.equal(
        simulation.value.err,
        null,
        JSON.stringify(simulation.value),
      );
      const signature = await connection.sendRawTransaction(
        transaction.serialize(),
        { preflightCommitment: "confirmed", maxRetries: 5 },
      );
      await confirmed(connection, signature);
      const pullAddress = pullPda(PROGRAM_ID, buyer.publicKey, nonce)[0];
      const pull = await fetchPull(PROGRAM_ID, connection, pullAddress);
      assert(pull, "The confirmed Rip created a Pull");
      assert.equal(pull.qty, qty);
      assert.equal(pull.edition, PACK_EDITIONS[0].index);
      assert(pull.buyer.equals(buyer.publicKey));
      assert(pull.referrer.equals(refA));
      const binder = await fetchBinder(PROGRAM_ID, connection, buyer.publicKey);
      assert(binder);
      assert(
        binder.referrer.equals(refA),
        "A remains bound after the second Rip sends B",
      );
      records.push({
        test: "E2.01",
        edition: PACK_EDITIONS[0].code,
        qty,
        simulation: {
          err: simulation.value.err,
          unitsConsumed: simulation.value.unitsConsumed,
          logs: simulation.value.logs,
        },
        signature,
        pull: pullAddress.toBase58(),
        pullExists: true,
        referral: {
          test: "E2.03",
          supplied: ref.toBase58(),
          bound: binder.referrer.toBase58(),
        },
      });
    }
  } finally {
    buyer.secretKey.fill(0);
    for (const wallet of Object.values(manifest.wallets))
      wallet.secretKey.fill(0);
  }
  console.log(
    JSON.stringify(
      { validator: "4.3.0", cluster: "localnet", result: "PASS", records },
      null,
      2,
    ),
  );
}
export async function runBlinkValidator(): Promise<void> {
  for (const name of ["onepercent", "mock_vrf"]) {
    const artifact = await readFile(
      resolve(appDirectory, `target/deploy/${name}.so`),
    );
    assert.equal(artifact.subarray(0, 6).toString("hex"), "7f454c460201");
    assert.equal(artifact.readUInt32LE(48), 3, `${name} must be sBPFv3`);
  }
  const binary = process.env.SOLANA_TEST_VALIDATOR ?? "solana-test-validator";
  const version = launch(binary, ["--version"]);
  await version.done;
  assert.match(version.output(), /\b4\.3\.0\b/);
  const directory = await mkdtemp(join(tmpdir(), "onepercent-blinks-"));
  let validator: ReturnType<typeof launch> | undefined;
  try {
    const fixtureDirectory = join(directory, "fixtures");
    // Reuse M1's unchanged exported OnAir state and runtime-generated signers.
    const exporter = launch(
      process.env.FIXTURE_EXPORT_BINARY ?? process.execPath,
      process.env.FIXTURE_EXPORT_BINARY
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
        FIXTURE_DIR: fixtureDirectory,
        FIXTURE_FLOW: "rip",
        FIXTURE_NOW: String(Math.floor(Date.now() / 1000)),
      },
    );
    await exporter.done;
    const manifest = JSON.parse(
      await readFile(join(fixtureDirectory, "manifest.json"), "utf8"),
    ) as Manifest;
    assert.equal(manifest.scenario, "rip");
    assert(manifest.programs.length > 0);
    const port = await freePort();
    const faucetPort = await freePort();
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
      "--upgradeable-program",
      PROGRAM_ID.toBase58(),
      resolve(appDirectory, "target/deploy/onepercent.so"),
      manifest.wallets.payer.publicKey,
      "--bpf-program",
      EXTERNAL_IDS.magicblockVrf.toBase58(),
      resolve(appDirectory, "target/deploy/mock_vrf.so"),
    ];
    for (const program of manifest.programs)
      args.push(
        "--bpf-program",
        program.address,
        isAbsolute(program.file)
          ? program.file
          : join(fixtureDirectory, program.file),
      );
    for (const account of manifest.accounts)
      args.push(
        "--account",
        account.address,
        isAbsolute(account.file)
          ? account.file
          : join(fixtureDirectory, account.file),
      );
    validator = launch(binary, args);
    const connection = new Connection(`http://127.0.0.1:${port}`, "confirmed");
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 60_000) {
      if (validator.child.exitCode !== null)
        throw new Error(validator.output());
      try {
        if ((await connection.getSlot("confirmed")) >= 2) {
          ready = true;
          break;
        }
      } catch {
        /* The validator may still be binding the local RPC port. */
      }
      await delay(250);
    }
    assert(ready, `Validator did not become ready\n${validator.output()}`);
    await runRipChecks(connection, manifest);
  } finally {
    if (validator) await stop(validator.child);
    await rm(directory, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runBlinkValidator();
