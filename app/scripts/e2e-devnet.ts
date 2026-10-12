import { DEVNET_GENESIS_HASH } from "../packages/config/src/genesis.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZES,
  ATTESTATIONS,
  FEED_RULES,
  PUMP_LAYOUTS,
  VRF_QUEUES,
} from "../packages/config/src/index.js";
import { preparePumpFixture } from "./e2e-pump-fixture.js";
import { bondingCurvePda } from "../packages/sdk/src/pda.js";
import { utils } from "../packages/sdk/src/anchor.js";
import { EXTERNAL_IDS } from "../packages/sdk/src/constants.js";
import { PROGRAM_ID } from "../packages/sdk/tests/program-id.js";
import * as Client from "../packages/sdk/src/index.js";

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const DEVNET_GENESIS = DEVNET_GENESIS_HASH;
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const required = (name: string): string => {
  const value = process.env[name];
  assert(value, `Set ${name}; no transaction was sent`);
  return value;
};
async function keypair(path: string): Promise<Keypair> {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(path, "utf8")) as number[]),
  );
}
async function command(
  binary: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  cwd = appDirectory,
): Promise<string> {
  const child = spawn(binary, args, {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-100_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  await new Promise<void>((yes, no) => {
    child.once("error", no);
    child.once("exit", (code) =>
      code === 0
        ? yes()
        : no(
            new Error(
              `${binary} failed (${code})\n${output.replaceAll(environment.DEVNET_RPC_URL ?? "__no_rpc__", "<devnet RPC>")}`,
            ),
          ),
    );
  });
  return output;
}
function assertV3(bytes: Buffer): void {
  assert.equal(bytes.subarray(0, 6).toString("hex"), "7f454c460201");
  assert.equal(bytes.readUInt32LE(48), 3, "sBPFv3 required");
}
async function accountExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
interface RunState {
  transactions?: Record<string, string>;
  budget?: Record<string, string>;
  fundingAmount?: string;
  programId: string;
  payer: string;
  artifactHash?: string;
  fundingSignature?: string;
  deployComplete?: boolean;
  feedComplete?: boolean;
  feedAmount?: string;
}
async function send(
  connection: Connection,
  tx: Client.BuiltTransaction,
  payer: Keypair,
  additionalSigners: Keypair[] = [],
): Promise<string> {
  if (tx instanceof Transaction) tx.sign(payer, ...additionalSigners);
  else tx.sign([payer, ...additionalSigners]);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const status = (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.err)
      throw new Error(
        `Devnet test transaction failed: ${JSON.stringify(status.err)}`,
      );
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return signature;
    await delay(500);
  }
  throw new Error(
    `Uncertain devnet transaction ${signature}; inspect status before repeating this flow`,
  );
}
/** A12: same source and constants, only the disposable cluster's program ID changes. */
async function prepareIsolated(
  directory: string,
  program: Keypair,
  buildArtifact = true,
): Promise<{ artifact: string; sdk: typeof Client }> {
  const source = join(directory, "source");
  await mkdir(join(source, "programs/onepercent"), { recursive: true });
  await cp(
    join(appDirectory, "programs/onepercent/src"),
    join(source, "programs/onepercent/src"),
    { recursive: true },
  );
  for (const file of ["Cargo.toml", "Cargo.lock"])
    await cp(join(appDirectory, file), join(source, file));
  await cp(
    join(appDirectory, "programs/onepercent/Cargo.toml"),
    join(source, "programs/onepercent/Cargo.toml"),
  );
  const libPath = join(source, "programs/onepercent/src/lib.rs");
  const before = await readFile(libPath, "utf8");
  const original = `declare_id!("${PROGRAM_ID.toBase58()}")`;
  assert.equal(
    before.split(original).length,
    2,
    "Expected exactly the unchanged M0 declare_id",
  );
  await writeFile(
    libPath,
    before.replace(original, `declare_id!("${program.publicKey.toBase58()}")`),
  );
  assert.equal(
    digest(await readFile(join(source, "programs/onepercent/src/params.rs"))),
    digest(
      await readFile(join(appDirectory, "programs/onepercent/src/params.rs")),
    ),
    "Cluster copies must retain identical compiled constants",
  );
  async function sourceBytes(path: string): Promise<string[]> {
    const entries = await readdir(path, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) result.push(...(await sourceBytes(child)));
      else
        result.push(child.slice(source.length), digest(await readFile(child)));
    }
    return result;
  }
  const sourceHash = digest(
    Buffer.from((await sourceBytes(source)).join("\n")),
  );
  const hashPath = join(directory, "build-source.sha256");
  const cacheMatches =
    (await accountExists(hashPath)) &&
    (await readFile(hashPath, "utf8")) === sourceHash &&
    (await accountExists(join(directory, "artifact/onepercent.so")));
  if (buildArtifact && !cacheMatches) {
    const aliasRoot = await mkdtemp(join(tmpdir(), "onepercent-devnet-build-"));
    const alias = join(aliasRoot, "run");
    await symlink(directory, alias, "dir");
    try {
      await command(
        "cargo",
        [
          "build-sbf",
          "--manifest-path",
          join(alias, "source/programs/onepercent/Cargo.toml"),
          "--sbf-out-dir",
          join(alias, "artifact"),
          "--arch",
          "v3",
          "--",
          "--locked",
        ],
        {
          ...process.env,
          RUSTUP_TOOLCHAIN: "1.95.0",
          CARGO_TARGET_DIR: join(alias, "build-target"),
          CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
        },
        join(alias, "source"),
      );
    } finally {
      await rm(aliasRoot, { recursive: true, force: true });
    }
    await writeFile(hashPath, sourceHash);
  }
  const artifact = buildArtifact
    ? join(directory, "artifact/onepercent.so")
    : join(appDirectory, "target/deploy/onepercent.so");
  assertV3(await readFile(artifact));
  if (buildArtifact) {
    await writeFile(
      join(directory, "build-proof.json"),
      JSON.stringify(
        {
          sourceSha256: sourceHash,
          artifactSha256: digest(await readFile(artifact)),
          canonicalProgramId: PROGRAM_ID.toBase58(),
          isolatedProgramId: program.publicKey.toBase58(),
          canonicalParamsSha256: digest(
            await readFile(
              join(appDirectory, "programs/onepercent/src/params.rs"),
            ),
          ),
          isolatedParamsSha256: digest(
            await readFile(join(source, "programs/onepercent/src/params.rs")),
          ),
          sbpfFlags: 3,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await rm(join(directory, "build-target"), { recursive: true, force: true });
  }
  return { artifact, sdk: Client };
}
async function fundDisposable(
  connection: Connection,
  payer: Keypair,
  directory: string,
  state: RunState,
  save: () => Promise<void>,
): Promise<void> {
  if (state.fundingSignature) {
    const status = (
      await connection.getSignatureStatuses([state.fundingSignature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    assert(
      status &&
        !status.err &&
        (status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"),
      "Funding outcome is uncertain; reconcile the recorded signature before retrying",
    );
    return;
  }
  const amountText = required("DEVNET_FUND_LAMPORTS");
  assert(/^\d+$/.test(amountText));
  const amount = BigInt(amountText);
  assert(
    amount > 0n && amount <= 6_900_000_000n,
    "Authorized one-time funding cap is 6.9 devnet SOL",
  );
  state.fundingAmount = amount.toString();
  const source = await keypair(required("DEVNET_FUNDER_KEYPAIR"));
  const sourceBalance = BigInt(
    await connection.getBalance(source.publicKey, "confirmed"),
  );

  assert(
    !source.publicKey.equals(payer.publicKey),
    "The funding wallet must never become a test signer",
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  // This is the funding wallet's only signing site and only instruction.
  const tx = new Transaction({
    feePayer: source.publicKey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: source.publicKey,
      toPubkey: payer.publicKey,
      lamports: amount,
    }),
  );
  const fundingFee = (
    await connection.getFeeForMessage(tx.compileMessage(), "confirmed")
  ).value;
  assert(fundingFee !== null);
  assert(
    sourceBalance >= amount + BigInt(fundingFee),
    "Funding wallet lacks transfer plus network fee",
  );
  tx.sign(source);
  const raw = tx.serialize();
  await writeFile(
    join(directory, "funding-transaction.json"),
    JSON.stringify({ raw: raw.toString("base64"), lastValidBlockHeight }),
    { mode: 0o600, flag: "wx" },
  );
  // The signed transaction is persisted before the network write; a retry never creates another funding transfer.
  state.fundingSignature = utils.bytes.bs58.encode(tx.signature!);
  await save();
  await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  const confirmation = await connection.confirmTransaction(
    { signature: state.fundingSignature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  assert.equal(confirmation.value.err, null);
}
export async function runDevnetFeed(): Promise<void> {
  const endpoint =
    process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
  assert.equal(new URL(endpoint).protocol, "https:");
  const connection = new Connection(endpoint, "confirmed");
  assert.equal(
    await connection.getGenesisHash(),
    DEVNET_GENESIS,
    "Refusing non-devnet cluster",
  );
  const pump = await connection.getAccountInfo(
    EXTERNAL_IDS.pumpFun,
    "finalized",
  );
  assert(
    pump?.executable,
    "pump.fun is unavailable on devnet; use the documented validator flow with mainnet-cloned pump accounts",
  );
  const oracleQueue = await connection.getAccountInfo(
    new PublicKey(VRF_QUEUES.devnetTest),
    "finalized",
  );
  assert(
    oracleQueue?.owner.equals(EXTERNAL_IDS.magicblockVrf),
    "Configured devnet VRF queue must exist and belong to the oracle before funding or deployment",
  );
  const runId = required("DEVNET_RUN_ID");
  assert(/^[a-zA-Z0-9_-]{1,80}$/.test(runId));
  const directory = join(appDirectory, "target/devnet-m1", runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const payerPath = resolve(
    process.env.DEVNET_TEST_SIGNER_KEYPAIR ??
      join(directory, "payer-keypair.json"),
  );
  if (!(await accountExists(payerPath)))
    await writeFile(
      payerPath,
      JSON.stringify([...Keypair.generate().secretKey]),
      { mode: 0o600, flag: "wx" },
    );
  const payer = await keypair(payerPath);
  const programPath = join(directory, "program-keypair.json");
  if (!(await accountExists(programPath)))
    await writeFile(
      programPath,
      JSON.stringify([...Keypair.generate().secretKey]),
      { mode: 0o600, flag: "wx" },
    );
  const program = await keypair(programPath);
  const statePath = join(directory, "state.json");
  const state: RunState = (await accountExists(statePath))
    ? (JSON.parse(await readFile(statePath, "utf8")) as RunState)
    : {
        programId: program.publicKey.toBase58(),
        payer: payer.publicKey.toBase58(),
      };
  assert.equal(state.programId, program.publicKey.toBase58());
  assert.equal(state.payer, payer.publicKey.toBase58());
  const save = () =>
    writeFile(statePath, JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
    });
  await save();
  const fixture =
    process.env.DEVNET_CREATE_FIXTURE === "1"
      ? await preparePumpFixture(
          connection,
          directory,
          payer.publicKey,
          program.publicKey,
        )
      : undefined;
  const fixtureOnly = process.env.DEVNET_FIXTURE_ONLY === "1";
  const { artifact, sdk } = await prepareIsolated(
    directory,
    program,
    !fixtureOnly,
  );
  const artifactBytes = await readFile(artifact);
  const artifactHash = digest(artifactBytes);
  if (
    !fixtureOnly &&
    state.artifactHash &&
    state.artifactHash !== artifactHash
  ) {
    // A prepared local binary may change before the first deployment; never replace a deployed or partly uploaded binary.
    assert(
      !state.deployComplete,
      "Resume a deployed run only with the same binary",
    );
    assert.equal(
      await connection.getAccountInfo(program.publicKey, "confirmed"),
      null,
      "A changed binary requires an undeployed disposable program",
    );
    const programData = PublicKey.findProgramAddressSync(
      [program.publicKey.toBuffer()],
      loader,
    )[0];
    assert.equal(
      await connection.getAccountInfo(programData, "confirmed"),
      null,
      "Existing disposable program data must be inspected before changing the binary",
    );
    const bufferPath = join(directory, "buffer-keypair.json");
    if (await accountExists(bufferPath)) {
      const buffer = await keypair(bufferPath);
      assert.equal(
        await connection.getAccountInfo(buffer.publicKey, "confirmed"),
        null,
        "A pending deployment buffer must be inspected before changing the binary",
      );
    }
  }
  if (!fixtureOnly) state.artifactHash = artifactHash;
  const rent = async (bytes: number) =>
    BigInt(
      await connection.getMinimumBalanceForRentExemption(bytes, "confirmed"),
    );
  const deploymentRent =
    (await rent(artifactBytes.length + 45)) +
    (await rent(artifactBytes.length + 37)) +
    (await rent(36));
  const initialization =
    50_000_000n +
    (await rent(sdk.SIZES.config)) +
    (await rent(sdk.SIZES.machine)) +
    (await rent(ACCOUNT_SIZES.deckHeader)) +
    (await rent(0));
  const fixtureBudget = 50_000_000n,
    remainingFeesAndFeed = 20_000_000n,
    walletReserve = 10_000_000n;
  const totalBudget =
    deploymentRent +
    initialization +
    fixtureBudget +
    remainingFeesAndFeed +
    walletReserve;
  state.budget = Object.fromEntries(
    Object.entries({
      deploymentRent,
      initialization,
      fixtureBudget,
      remainingFeesAndFeed,
      walletReserve,
      totalBudget,
    }).map(([key, value]) => [key, value.toString()]),
  );
  assert(
    totalBudget <= 6_900_000_000n,
    "Measured deployment plus test budget exceeds authorized funding cap",
  );
  await save();
  const journalSend = async (
    stage: string,
    tx: Client.BuiltTransaction,
    signers: Keypair[] = [],
  ) => {
    const previous = state.transactions?.[stage];
    if (previous) {
      const status = (
        await connection.getSignatureStatuses([previous], {
          searchTransactionHistory: true,
        })
      ).value[0];
      assert(
        status &&
          !status.err &&
          ["confirmed", "finalized"].includes(status.confirmationStatus ?? ""),
        `Reconcile recorded ${stage} transaction before retrying`,
      );
      return previous;
    }
    assert(
      BigInt(await connection.getBalance(payer.publicKey, "confirmed")) >=
        walletReserve,
      `Insufficient disposable reserve before ${stage}`,
    );
    if (tx instanceof Transaction) tx.sign(payer, ...signers);
    else tx.sign([payer, ...signers]);
    const simulationTx =
      tx instanceof Transaction
        ? VersionedTransaction.deserialize(tx.serialize())
        : tx;
    const simulation = await connection.simulateTransaction(simulationTx, {
      sigVerify: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [payer.publicKey.toBase58()] },
    });
    assert.equal(
      simulation.value.err,
      null,
      `${stage} simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n") ?? ""}`,
    );
    const remaining = simulation.value.accounts?.[0]?.lamports;
    assert(
      remaining !== undefined && BigInt(remaining) >= walletReserve,
      `Simulation of ${stage} would consume the disposable reserve`,
    );
    await writeFile(
      join(directory, `${stage}-simulation.json`),
      JSON.stringify(
        {
          units: simulation.value.unitsConsumed,
          remainingLamports: String(remaining),
          logs: simulation.value.logs,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const signatureBytes =
      tx instanceof Transaction ? tx.signature! : tx.signatures[0]!;
    const signature = utils.bytes.bs58.encode(signatureBytes);
    await writeFile(
      join(directory, `${stage}-transaction.json`),
      JSON.stringify({
        signature,
        raw: Buffer.from(tx.serialize()).toString("base64"),
      }),
      { mode: 0o600, flag: "wx" },
    );
    state.transactions ??= {};
    state.transactions[stage] = signature;
    await save();
    return send(connection, tx, payer, signers);
  };
  const sendInstructions = async (
    stage: string,
    instructions: TransactionInstruction[],
    signers: Keypair[] = [],
  ) => {
    const blockhash = (await connection.getLatestBlockhash("confirmed"))
      .blockhash;
    return journalSend(
      stage,
      new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: blockhash,
      }).add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
        ...instructions,
      ),
      signers,
    );
  };
  if (process.env.DEVNET_EXECUTE !== "1") {
    console.log(
      JSON.stringify({
        state: "prepared",
        program: state.programId,
        artifact,
        artifactHash,
        budget: state.budget,
        payer: state.payer,
        fixtureMint: fixture?.mint.toBase58(),
        rpcHost: new URL(endpoint).hostname,
        action:
          "Review the isolated build, then set DEVNET_EXECUTE=1 to execute the authorized test",
      }),
    );
    return;
  }
  const solana = process.env.SOLANA_CLI ?? "solana";
  assert.match(await command(solana, ["--version"]), /\b4\.3\.0\b/);
  await fundDisposable(connection, payer, directory, state, save);
  if (fixture && !state.deployComplete) {
    assert(
      BigInt(await connection.getBalance(payer.publicKey, "confirmed")) >=
        deploymentRent + initialization + fixtureBudget + walletReserve,
    );
    const creator = sdk.feeInPda(program.publicKey)[0];
    if (!(await connection.getAccountInfo(creator, "confirmed")))
      await sendInstructions("s1-creator-rent", [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: creator,
          lamports: await rent(0),
        }),
      ]);
    await fixture.ensure(sendInstructions);
    if (process.env.DEVNET_FIXTURE_ONLY === "1") {
      console.log(
        JSON.stringify({
          state: "fixture-ready",
          payer: state.payer,
          mint: fixture.mint.toBase58(),
          report: fixture.reportPath,
        }),
      );
      return;
    }
  }
  assert(
    process.env.DEVNET_DEPLOY === "1",
    "Set DEVNET_DEPLOY=1 only after the program deployment decision is resolved",
  );
  if (!state.deployComplete) {
    assert(
      BigInt(await connection.getBalance(payer.publicKey, "confirmed")) >=
        deploymentRent + initialization + walletReserve,
      "Insufficient remaining deployment budget",
    );
    assert.equal(
      await connection.getAccountInfo(program.publicKey),
      null,
      "Unexpected existing disposable program; inspect it before resuming deployment",
    );
    const bufferPath = join(directory, "buffer-keypair.json");
    if (!(await accountExists(bufferPath)))
      await writeFile(
        bufferPath,
        JSON.stringify([...Keypair.generate().secretKey]),
        { mode: 0o600, flag: "wx" },
      );
    await command(
      solana,
      [
        "program",
        "deploy",
        "--buffer",
        bufferPath,
        "--url",
        endpoint,
        "--keypair",
        payerPath,
        "--fee-payer",
        payerPath,
        "--upgrade-authority",
        payerPath,
        "--program-id",
        programPath,
        "--max-len",
        String(artifactBytes.length),
        artifact,
      ],
      { ...process.env, DEVNET_RPC_URL: endpoint },
    );
    state.deployComplete = true;
    await save();
  }
  const programData = PublicKey.findProgramAddressSync(
    [program.publicKey.toBuffer()],
    loader,
  )[0];
  const deployed = await connection.getAccountInfo(programData, "confirmed");
  assert(deployed && deployed.owner.equals(loader));
  assert(
    deployed.data.subarray(45, 45 + artifactBytes.length).equals(artifactBytes),
  );
  const options = async () => ({
    wallet: payer.publicKey,
    blockhash: (await connection.getLatestBlockhash("confirmed")).blockhash,
  });
  if (!(await sdk.fetchConfig(program.publicKey, connection))) {
    const random = () => Keypair.generate().publicKey;
    const team = random();
    const setup = sdk.initializeInstruction(program.publicKey, {
      authority: payer.publicKey,
      programData,
      params: {
        admin: payer.publicKey,
        guardians: [random(), random()],
        keeper: random(),
        executor: random(),
        intake_signer: payer.publicKey,
        quote_signer: random(),
        launch_wallet: random(),
        team_wallet: team,
        team_wallets: Array.from(
          { length: 8 },
          () => PublicKey.default,
        ) as Client.InitParams["team_wallets"],
        token_mint: random(),
        vrf_queue: new PublicKey(VRF_QUEUES.devnetTest),
        rent_buffer_lamports: 50_000_000n,
      },
    });
    const block = await options();
    await journalSend(
      "initialize",
      new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: block.blockhash,
      }).add(setup),
    );
  }
  if (!(await sdk.fetchConfig(program.publicKey, connection))?.season_set) {
    const slot = await connection.getSlot("confirmed");
    const time = await connection.getBlockTime(slot);
    assert(time !== null);
    const config = sdk.adminConfigInstruction(program.publicKey, {
      admin: payer.publicKey,
      action: {
        setSeason: {
          snapshot_slot: BigInt(slot),
          snapshot_ts: BigInt(time),
          stock_up_ts: BigInt(time + 3),
        },
      },
    });
    await journalSend(
      "set-season",
      new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: (await options()).blockhash,
      }).add(config),
    );
  }
  const phaseDeadline = Date.now() + 120_000;
  let phaseAttempt = Object.keys(state.transactions ?? {}).filter((name) =>
    name.startsWith("advance-phase-"),
  ).length;
  while ((await sdk.fetchMachine(program.publicKey, connection))?.phase === 0) {
    assert(
      Date.now() < phaseDeadline,
      "StockUp transition did not complete within the bounded wait",
    );
    const config = await sdk.fetchConfig(program.publicKey, connection);
    const time = await connection.getBlockTime(
      await connection.getSlot("confirmed"),
    );
    assert(config);
    if (time === null || BigInt(time) < config.stock_up_ts) {
      await delay(1000);
      continue;
    }
    // An early successful no-op must not suppress later permissionless attempts.
    await journalSend(
      `advance-phase-${phaseAttempt++}`,
      new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: (await options()).blockhash,
      }).add(sdk.advancePhaseInstruction(program.publicKey)),
    );
  }
  if (!state.feedComplete) {
    const mint = fixture?.mint ?? new PublicKey(required("DEVNET_BAG_MINT"));
    const mintInfo = await connection.getAccountInfo(mint, "confirmed");
    assert(mintInfo && mintInfo.data.length >= 82);
    const tokenProgram = mintInfo.owner;
    assert(
      tokenProgram.equals(EXTERNAL_IDS.splToken) ||
        tokenProgram.equals(EXTERNAL_IDS.token2022),
    );
    const tokenAccounts = await connection.getTokenAccountsByOwner(
      payer.publicKey,
      { mint },
      "confirmed",
    );
    const source =
      tokenAccounts.value.find(
        (item) => item.account.data.readBigUInt64LE(64) > 0n,
      ) ??
      (state.transactions?.["feed-0"] ? tokenAccounts.value[0] : undefined);
    assert(source, "The disposable signer must hold the verified S1 bag");
    const curve = await connection.getAccountInfo(
      bondingCurvePda(mint)[0],
      "confirmed",
    );
    assert(
      curve?.owner.equals(EXTERNAL_IDS.pumpFun) &&
        curve.data.subarray(0, 8).toString("hex") ===
          PUMP_LAYOUTS.bondingCurveDiscriminatorHex,
      "S1 must provide a genuine pump.fun bag",
    );
    assert.equal(
      mintInfo.data.readUInt32LE(0),
      0,
      "Mint authority must be absent",
    );
    assert.equal(
      mintInfo.data.readUInt32LE(46),
      0,
      "Freeze authority must be absent",
    );
    const amount = state.feedAmount
      ? BigInt(state.feedAmount)
      : source.account.data.readBigUInt64LE(64);
    assert(amount > 0n);
    state.feedAmount = amount.toString();
    await save();
    const decimals = mintInfo.data[44]!;
    assert(decimals <= FEED_RULES.maxMintDecimals);
    const binder = await sdk.fetchBinder(
      program.publicKey,
      connection,
      payer.publicKey,
    );
    const slot = await connection.getSlot("confirmed");
    const time = await connection.getBlockTime(slot);
    assert(time !== null);
    const expiry = sdk.attestationExpiry(
      BigInt(time),
      ATTESTATIONS.feedTtlSeconds,
    );
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(payer.secretKey.subarray(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const bag: Client.PlannedFeedBag = {
      mint,
      source: source.pubkey,
      amount,
      decimals,
      tokenProgram,
      vaultExists:
        (await connection.getAccountInfo(
          sdk.vaultAta(program.publicKey, mint, tokenProgram),
        )) !== null,
      closeSource: false,
    };
    if (!state.transactions?.["take-back"]) {
      const plans = await sdk.planFeedTransactions(program.publicKey, {
        ...(await options()),
        bags: [bag],
        intakeSigner: payer.publicKey,
        nonceBase: binder?.feed_nonce_base ?? 0,
        nonceBits: binder?.feed_nonce_bits ?? 0,
        attest: ({ wallet, nonce, bags }) => ({
          expiry,
          signature: sign(
            null,
            sdk.feedMessage({
              programId: program.publicKey,
              wallet,
              nonce,
              bags,
              expiry,
            }),
            privateKey,
          ),
        }),
      });
      for (const [i, plan] of plans.entries())
        await journalSend(`feed-${i}`, plan.transaction);
      const data = await connection.getAccountInfo(
        sdk.deckPda(program.publicKey)[0],
      );
      assert(data);
      const entries = sdk.decodeDeck(data.data).entries;
      const index = entries.findIndex(
        (entry) =>
          entry.depositor.equals(payer.publicKey) &&
          entry.mint.equals(mint) &&
          entry.amount === amount,
      );
      assert(index >= 0);
      for (const tx of sdk.buildTakeBackTransactions(program.publicKey, {
        ...(await options()),
        entries: [{ ...bag, deckIndex: index }],
      }))
        await journalSend("take-back", tx);
    } else {
      const previous = (
        await connection.getSignatureStatuses(
          [state.transactions["take-back"]],
          { searchTransactionHistory: true },
        )
      ).value[0];
      assert(
        previous &&
          !previous.err &&
          ["confirmed", "finalized"].includes(
            previous.confirmationStatus ?? "",
          ),
        "Reconcile take-back before marking the flow complete",
      );
    }
    assert.equal(
      BigInt(
        (
          await connection.getTokenAccountBalance(
            sdk.userAta(payer.publicKey, mint, tokenProgram),
          )
        ).value.amount,
      ),
      amount,
    );
    state.feedComplete = true;
    await save();
  }
  console.log(
    JSON.stringify({
      state: "passed",
      flow: "devnet feed and take-back",
      program: state.programId,
      artifactHash,
      stateFile: statePath,
      payerBalanceLamports: String(
        await connection.getBalance(payer.publicKey, "confirmed"),
      ),
      transactions: state.transactions,
    }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assert.equal(process.argv[2], "feed", "Usage: e2e-devnet.ts feed");
  await runDevnetFeed();
}
