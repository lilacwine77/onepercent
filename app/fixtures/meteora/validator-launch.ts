import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { TOKEN_1PCT } from "../../packages/config/src/index.js";
import { DEPLOYMENT, PROGRAM_ID } from "../../packages/sdk/tests/program-id.js";
import { executeLaunch } from "../../packages/cli/src/launch/runtime.js";
import type { LaunchInput } from "../../packages/cli/src/launch/input.js";
import type { LaunchPolicy } from "../../packages/cli/src/launch/landing.js";
import { freeGossipPort } from "../../scripts/validator-ports.js";
import {
  launchAddresses,
  launchInstructionGroups,
} from "../../packages/sdk/src/tx/launch.js";
import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  decodeDbcPool,
  decodeDbcConfig,
  decodeDammV2Pool,
  decodeDammV2Position,
  dbcPartialFillIx,
  migrateDbcDammV2Ix,
  dammV2Swap2Ix,
  quoteDammV2ExactOut,
  dbcQuoteDelta,
  deriveDbcCurve,
  quoteDbcExactOut,
  buildDbcLaunchConfig,
  dbcPoolAuthority,
} from "../../packages/sdk/src/meteora/index.js";

const directory = dirname(fileURLToPath(import.meta.url));
const app = resolve(directory, "../..");
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const discriminator = (name: string) =>
  createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
const pda = (name: string, program: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(name)], program)[0];
const tokenProgram = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const account = (name: string, size: number) => {
  const data = Buffer.alloc(size);
  discriminator(name).copy(data);
  return data;
};
async function freePort(excluded: number[] = []): Promise<number> {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
  return excluded.includes(address.port) ? freePort(excluded) : address.port;
}
async function send(
  connection: Connection,
  tx: Transaction | VersionedTransaction,
  signers: Keypair[],
) {
  if (tx instanceof Transaction) tx.sign(...signers);
  else tx.sign(signers);
  const bytes = tx.serialize();
  assert(bytes.length <= 1232);
  const signature = await connection.sendRawTransaction(bytes, {
    skipPreflight: false,
    maxRetries: 0,
  });
  const started = Date.now();
  let submitted = started;
  while (Date.now() - started < 60_000) {
    const status = (await connection.getSignatureStatuses([signature]))
      .value[0];
    assert(!status?.err, JSON.stringify(status?.err));
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return signature;
    if (Date.now() - submitted >= 2_000) {
      await connection.sendRawTransaction(bytes, {
        skipPreflight: true,
        maxRetries: 0,
      });
      submitted = Date.now();
    }
    await delay(100);
  }
  throw new Error("Local confirmation timeout");
}
async function writeAccount(
  path: string,
  address: PublicKey,
  owner: PublicKey,
  data: Buffer,
  lamports = 100_000_000,
) {
  await writeFile(
    path,
    JSON.stringify({
      pubkey: address.toBase58(),
      account: {
        owner: owner.toBase58(),
        lamports,
        executable: false,
        rentEpoch: 0,
        data: [data.toString("base64"), "base64"],
      },
    }),
  );
}

/** Offline D29 rehearsal with the actual M4.1 program and its pinned test config. */
export async function runMeteoraValidatorLaunch(
  flow: "atomic" | "proxima" = "atomic",
) {
  const temporary = await mkdtemp(join(tmpdir(), "onepct-dbc-launch-"));
  const captures = join(temporary, "accounts");
  await mkdir(captures, { recursive: true });
  const wallet = Keypair.generate(),
    mint = Keypair.generate(),
    program = PROGRAM_ID;
  const configSigner = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        await readFile(
          join(directory, "keys/localnet-devnet-dbc-config-TEST-ONLY.json"),
          "utf8",
        ),
      ) as number[],
    ),
  );
  const validatorVersion = execFileSync(
    "solana-test-validator",
    ["--version"],
    { encoding: "utf8" },
  ).trim();
  assert(validatorVersion.startsWith("solana-test-validator 4.3.0 "));
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    cluster: "localnet",
    validatorVersion,
    powerOn: "real-m4.1-program",
    productionDeploymentVerified: false,
    offline: true,
    stage: "setup",
  };
  let child: ChildProcess | undefined;
  let output = "";
  try {
    const artifactPath = join(app, "target/deploy/onepercent.so");
    const artifact = await readFile(artifactPath);
    assert.equal(artifact.subarray(0, 6).toString("hex"), "7f454c460201");
    assert.equal(artifact.readUInt32LE(48), 3, "onepercent requires sBPFv3");
    report.program = {
      address: program.toBase58(),
      artifact: "target/deploy/onepercent.so",
      sha256: hash(artifact),
    };
    const bump = (seed: string) =>
      PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[1];
    // Genesis starts from StockUp. The real instruction creates the absent ledger.
    const config = account("Config", 872);
    config[736] = 1;
    config[737] = bump("config");
    wallet.publicKey.toBuffer().copy(config, 232);
    wallet.publicKey.toBuffer().copy(config, 8);
    (flow === "atomic" ? mint.publicKey : wallet.publicKey)
      .toBuffer()
      .copy(config, 552);
    const machine = account("Machine", 3808);
    machine[8] = 1;
    machine[9] = bump("machine");
    machine[10] = flow === "atomic" ? 1 : 0;
    machine[11] = bump("vault_auth");
    machine[12] = bump("deck");
    machine[13] = bump("config");
    machine[14] = bump("fee_in");
    const port = await freePort();
    const faucetPort = await freePort([port, port + 1]);
    const args = [
      "--reset",
      "--quiet",
      "--ledger",
      join(temporary, "ledger"),
      "--bind-address",
      "127.0.0.1",
      "--rpc-port",
      String(port),
      "--faucet-port",
      String(faucetPort),
      "--gossip-port",
      String(await freeGossipPort([port, port + 1, faucetPort])),
      "--upgradeable-program",
      program.toBase58(),
      artifactPath,
      "none",
    ];
    const provenance = JSON.parse(
      await readFile(join(directory, "programs.json"), "utf8"),
    ) as {
      programs: { programId: string; file: string; sha256: string }[];
    };
    for (const row of provenance.programs) {
      const file = join(directory, row.file);
      assert.equal(hash(await readFile(file)), row.sha256);
      args.push("--upgradeable-program", row.programId, file, "none");
    }
    for (const [name, address, owner, data] of [
      ["config", pda("config", program), program, config],
      ["machine", pda("machine", program), program, machine],
      [
        "fee-in",
        pda("fee_in", program),
        SystemProgram.programId,
        Buffer.alloc(0),
      ],
    ] as const) {
      const path = join(temporary, `${name}.json`);
      await writeAccount(path, address, owner, data);
      args.push("--account", address.toBase58(), path);
    }
    const walletFixture = join(temporary, "wallet-account.json");
    await writeAccount(
      walletFixture,
      wallet.publicKey,
      SystemProgram.programId,
      Buffer.alloc(0),
      500_000_000_000,
    );
    args.push("--account", wallet.publicKey.toBase58(), walletFixture);
    const dammConfig = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";
    args.push(
      "--account",
      dammConfig,
      join(directory, "accounts/damm-customizable.json"),
    );
    args.push(
      "--account",
      dbcPoolAuthority().toBase58(),
      join(directory, "accounts/dbc-pool-authority.json"),
    );
    child = spawn("solana-test-validator", args, {
      cwd: app,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-50_000);
      });
    const connection = new Connection(`http://127.0.0.1:${port}`, "confirmed");
    const started = Date.now();
    while (true) {
      if (child.exitCode !== null)
        throw new Error(`Validator exited: ${output}`);
      try {
        if ((await connection.getSlot()) >= 2) break;
      } catch {
        /* Local startup. */
      }
      if (Date.now() - started > 60_000)
        throw new Error(`Validator timeout: ${output}`);
      await delay(250);
    }
    report.stage = "config";
    // Test-only transport parameters. executeLaunch accepts these only on loopback localnet.
    const localPolicy: LaunchPolicy = {
      landing: {
        cuMarginBps: 1000,
        tipLamports: 1_000_000n,
        maxComputeUnitPriceMicroLamports: 1000n,
      },
      keeper: { sendMaxAttempts: 20, backoffBaseMs: 1000 },
    };
    const events: Record<string, unknown>[] = [];
    const emit = (event: Record<string, unknown>) => {
      events.push(event);
      console.log(JSON.stringify({ event: event.event }));
    };
    report.events = events;
    const base: LaunchInput = {
      command: "config",
      cluster: "localnet",
      rpc: connection.rpcEndpoint,
      program: program.toBase58(),
      mint: mint.publicKey.toBase58(),
      acceptWarnings: true,
      name: "DBC rehearsal",
      symbol: "TEST",
      uri: "https://example.com/dbc-rehearsal.json",
    };
    const options = { directory: join(temporary, "reports"), localPolicy };
    const configResult = await executeLaunch(
      base,
      connection,
      { wallet, mint, config: configSigner },
      emit,
      options,
    );
    report.config = configResult;
    const dbcConfig = new PublicKey(
      (configResult as { config: string }).config,
    );
    const input = { ...base, dbcConfig: dbcConfig.toBase58() };
    if (flow === "proxima") {
      const { runProximaValidatorScenario } =
        await import("../../scripts/e2e-proxima.js");
      report.proxima = await runProximaValidatorScenario(
        connection,
        wallet,
        mint,
        input,
        options,
      );
      report.ok = true;
      report.stage = "complete";
      return report;
    }
    const configInfo = await connection.getAccountInfo(dbcConfig);
    assert(configInfo);
    assert(
      decodeDbcConfig(configInfo.data).feeClaimer.equals(
        pda("fee_in", program),
      ),
    );
    const prefund = await connection.getMinimumBalanceForRentExemption(0);
    const poolToPrefund = launchAddresses({
      wallet: wallet.publicKey,
      mint: mint.publicKey,
      deployment: DEPLOYMENT,
    }).launchPool;
    const prefundSignature = await send(
      connection,
      new Transaction({
        feePayer: wallet.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: mint.publicKey,
          lamports: prefund,
        }),
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: poolToPrefund,
          lamports: prefund,
        }),
      ),
      [wallet],
    );
    report.prefundedAddresses = {
      signature: prefundSignature,
      mintLamports: prefund,
      poolLamports: prefund,
    };
    report.stage = "lookup-table";
    const lutResult = await executeLaunch(
      { ...input, command: "lut" },
      connection,
      { wallet, mint, config: configSigner },
      emit,
      options,
    );
    report.lookupTable = lutResult;
    const lut = (lutResult as { lookupTable: string }).lookupTable;
    const launchInput = { ...input, lut };
    report.stage = "plan";
    const plan = await executeLaunch(
      { ...launchInput, command: "plan" },
      connection,
      { wallet, mint, config: configSigner },
      emit,
      options,
    );
    report.plan = plan;
    assert.equal((plan as { ok: boolean }).ok, true);
    report.stage = "check";
    const check = await executeLaunch(
      { ...launchInput, command: "check" },
      connection,
      { wallet, mint, config: configSigner },
      emit,
      options,
    );
    report.check = check;
    assert.equal((check as { ok: boolean }).ok, true);
    report.stage = "send";
    let launch = await executeLaunch(
      {
        ...launchInput,
        command: "send",
        confirm: mint.publicKey.toBase58().slice(0, 8),
      },
      connection,
      { wallet, mint, config: configSigner },
      emit,
      options,
    );
    const initialLaunch = launch as {
      ok: boolean;
      status?: string;
      signatures: string[];
    };
    if (
      !initialLaunch.ok &&
      initialLaunch.status === "pending_reconciliation"
    ) {
      report.pendingLaunch = initialLaunch;
      assert.equal(initialLaunch.signatures.length, 1);
      // A busy local validator can finalize after the sender's bounded retry policy.
      // Require that exact persisted signature to finalize before resuming its journal.
      const started = Date.now();
      while (true) {
        const statuses = await connection.getSignatureStatuses(
          initialLaunch.signatures,
          { searchTransactionHistory: true },
        );
        report.pendingLaunchStatuses ??= statuses.value;
        assert.equal(statuses.value.length, 1);
        assert.equal(statuses.value[0]?.err ?? null, null);
        if (statuses.value[0]?.confirmationStatus === "finalized") {
          report.finalizedLaunchStatus = statuses.value[0];
          break;
        }
        assert(
          Date.now() - started < 120_000,
          `Local launch finalization timeout: ${JSON.stringify(statuses.value)}`,
        );
        await delay(250);
      }
      launch = await executeLaunch(
        {
          ...launchInput,
          command: "send",
          confirm: mint.publicKey.toBase58().slice(0, 8),
        },
        connection,
        { wallet, mint, config: configSigner },
        emit,
        options,
      );
      assert.deepEqual(
        (launch as { signatures: string[] }).signatures,
        initialLaunch.signatures,
      );
    }
    report.launch = launch;
    assert.equal((launch as { ok: boolean }).ok, true);
    report.stage = "journal-resume";
    const resumed = await executeLaunch(
      {
        ...launchInput,
        command: "send",
        confirm: mint.publicKey.toBase58().slice(0, 8),
      },
      connection,
      { wallet, mint, config: configSigner },
      emit,
      options,
    );
    assert.equal((resumed as { ok: boolean }).ok, true);
    assert.deepEqual(
      (resumed as { signatures: string[] }).signatures,
      (launch as { signatures: string[] }).signatures,
    );
    report.resumedLaunch = resumed;
    report.stage = "report";
    const launchReport = await executeLaunch(
      { ...launchInput, command: "report" },
      connection,
      { wallet: null, mint: null },
      emit,
      options,
    );
    assert.equal((launchReport as { ok: boolean }).ok, true);
    report.launchReport = launchReport;
    const addresses = launchAddresses({
      wallet: wallet.publicKey,
      mint: mint.publicKey,
      deployment: DEPLOYMENT,
    });
    const vault = await connection.getAccountInfo(addresses.vault);
    assert(vault);
    assert.equal(vault.data.readBigUInt64LE(64), TOKEN_1PCT.devBuyAmount);
    assert.equal(await connection.getAccountInfo(addresses.launchAta), null);
    const initialPool = await connection.getAccountInfo(addresses.launchPool);
    assert(initialPool);
    const decoded = decodeDbcPool(initialPool.data);
    assert(decoded.partnerQuoteFee > 0n);
    assert.equal(decoded.creatorQuoteFee, 0n);
    report.devBuy = {
      amount: TOKEN_1PCT.devBuyAmount.toString(),
      walletBalance: "0",
      vaultBalance: vault.data.readBigUInt64LE(64).toString(),
      pool: addresses.launchPool.toBase58(),
      partnerQuoteFee: decoded.partnerQuoteFee.toString(),
      protocolQuoteFee: decoded.protocolQuoteFee.toString(),
    };
    report.stage = "threshold-buy";
    const funded = 100_000_000_000n;
    const groups = launchInstructionGroups({
      wallet: wallet.publicKey,
      mint: mint.publicKey,
      deployment: DEPLOYMENT,
      name: base.name!,
      symbol: base.symbol!,
      uri: base.uri!,
      maxSolCost: funded,
      computeUnitLimit: 1_400_000,
      computeUnitPriceMicroLamports: 0n,
      tip: { recipient: wallet.publicKey, lamports: 0n },
      blockhash: (await connection.getLatestBlockhash()).blockhash,
    });
    // Reuse the launch's ATA/wrap builders, replacing its initialization and exact-out swap.
    const wrap = groups.createAndBuy.filter(
      (ix) => !ix.programId.equals(DBC_PROGRAM_ID),
    );
    const last = wrap.pop();
    assert(last);
    assert(last.programId.equals(tokenProgram) && last.data[0] === 9);
    const buy = new Transaction({
      feePayer: wallet.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...wrap,
      dbcPartialFillIx({
        config: dbcConfig,
        mint: mint.publicKey,
        user: wallet.publicKey,
        amountIn: funded,
      }),
      last,
    );
    const buySignature = await send(connection, buy, [wallet]);
    const completeInfo = await connection.getAccountInfo(addresses.launchPool);
    assert(completeInfo);
    const complete = decodeDbcPool(completeInfo.data);
    report.thresholdBuy = {
      signature: buySignature,
      quoteReserve: complete.quoteReserve.toString(),
    };
    assert(complete.quoteReserve >= 85_000_000_000n);
    const curve = deriveDbcCurve();
    const devQuote = quoteDbcExactOut(
      buildDbcLaunchConfig(),
      TOKEN_1PCT.devBuyAmount,
    );
    assert.equal(
      complete.quoteReserve,
      devQuote.excludedFeeInput +
        dbcQuoteDelta(
          devQuote.nextSqrtPrice,
          curve.migrationSqrtPrice,
          curve.curve[0]!.liquidity,
        ),
    );

    report.thresholdRoundingSurplusLamports = (
      complete.quoteReserve - 85_000_000_000n
    ).toString();
    report.stage = "migration";
    const nft = Keypair.generate();
    const migration = migrateDbcDammV2Ix({
      config: dbcConfig,
      mint: mint.publicKey,
      payer: wallet.publicKey,
      positionNftMint: nft.publicKey,
    });
    const table = (await connection.getAddressLookupTable(new PublicKey(lut)))
      .value;
    assert(table);
    const migrationTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          migration,
        ],
      }).compileToV0Message([table]),
    );
    const migrationTransactionFee = (
      await connection.getFeeForMessage(migrationTx.message)
    ).value;
    assert(migrationTransactionFee !== null);
    const authorityBefore = await connection.getBalance(dbcPoolAuthority());
    const payerBeforeMigration = await connection.getBalance(wallet.publicKey);
    const migrationSignature = await send(connection, migrationTx, [
      wallet,
      nft,
    ]);
    const authorityAfter = await connection.getBalance(dbcPoolAuthority());
    const payerAfterMigration = await connection.getBalance(wallet.publicKey);
    assert.equal(authorityAfter, authorityBefore);
    const migratedDbcInfo = await connection.getAccountInfo(
      addresses.launchPool,
    );
    assert(migratedDbcInfo);
    const migratedDbc = decodeDbcPool(migratedDbcInfo.data);
    const poolAddress = migration.keys[4]!.pubkey,
      positionAddress = migration.keys[7]!.pubkey,
      nftAccountAddress = migration.keys[6]!.pubkey;
    const [poolInfo, positionInfo, nftInfo] =
      await connection.getMultipleAccountsInfo([
        poolAddress,
        positionAddress,
        nftAccountAddress,
      ]);
    assert(poolInfo && positionInfo && nftInfo);
    assert(poolInfo.owner.equals(DAMM_V2_PROGRAM_ID));
    const pool = decodeDammV2Pool(poolInfo.data),
      position = decodeDammV2Position(positionInfo.data);
    const baseFee = Buffer.from(pool.poolFees.baseFee.baseFeeInfo.data);
    assert.equal(baseFee.readBigUInt64LE(0), 25_000_000n);
    assert.equal(baseFee[8], 0);
    assert.equal(baseFee.readUInt16LE(14), 0);
    assert.equal(baseFee.readBigUInt64LE(16), 0n);
    assert.equal(baseFee.readBigUInt64LE(24), 0n);
    assert.equal(pool.collectFeeMode, 1);
    assert.equal(pool.poolFees.dynamicFee.initialized, 0);
    assert.equal(pool.poolFees.compoundingFeeBps, 0);
    assert.equal(position.unlockedLiquidity, 0n);
    assert.equal(position.vestedLiquidity, 0n);
    assert(position.permanentLockedLiquidity > 0n);
    assert(
      new PublicKey(nftInfo.data.subarray(32, 64)).equals(
        pda("fee_in", program),
      ),
    );
    assert.equal(pool.liquidity, position.permanentLockedLiquidity);
    assert.equal(
      pool.permanentLockLiquidity,
      position.permanentLockedLiquidity,
    );
    report.migration = {
      signature: migrationSignature,
      bytes: migrationTx.serialize().length,
      pool: poolAddress.toBase58(),
      position: positionAddress.toBase58(),
      positionNftOwner: pda("fee_in", program).toBase58(),
      poolFeeBps: 250,
      migrationProtocolBaseFee:
        migratedDbc.protocolMigrationBaseFeeAmount.toString(),
      migrationProtocolQuoteFee:
        migratedDbc.protocolMigrationQuoteFeeAmount.toString(),
      protocolLiquidityMigrationFeeBps:
        migratedDbc.protocolLiquidityMigrationFeeBps,
      initialBaseAmount: pool.tokenAAmount.toString(),
      initialQuoteAmount: pool.tokenBAmount.toString(),
      globalAuthorityLamportsBefore: authorityBefore,
      globalAuthorityLamportsAfter: authorityAfter,
      payerRentAndTransactionFeeLamports:
        payerBeforeMigration - payerAfterMigration,
      transactionFeeLamports: migrationTransactionFee,
      rentLamports:
        payerBeforeMigration - payerAfterMigration - migrationTransactionFee,
      baseFeeMode: baseFee[8],
      schedulerPeriods: baseFee.readUInt16LE(14),
      schedulerFrequency: baseFee.readBigUInt64LE(16).toString(),
      schedulerReduction: baseFee.readBigUInt64LE(24).toString(),
      collectFeeMode: pool.collectFeeMode,
      dynamicFeeInitialized: pool.poolFees.dynamicFee.initialized,
      compoundingFeeBps: pool.poolFees.compoundingFeeBps,
      unlockedLiquidity: position.unlockedLiquidity.toString(),
      vestedLiquidity: position.vestedLiquidity.toString(),
      permanentlyLockedLiquidity: position.permanentLockedLiquidity.toString(),
      totalLiquidity: pool.liquidity.toString(),
      poolPermanentlyLockedLiquidity: pool.permanentLockLiquidity.toString(),
    };
    for (const [name, address, snapshot] of [
      ["local-damm-pool", poolAddress, poolInfo],
      ["local-damm-position", positionAddress, positionInfo],
      ["local-damm-position-nft", nftAccountAddress, nftInfo],
    ] as const) {
      await writeFile(join(captures, `${name}.bin`), snapshot.data);
      await writeFile(
        join(captures, `${name}.meta.json`),
        `${JSON.stringify({ cluster: "localnet", observedSlot: await connection.getSlot(), address: address.toBase58(), owner: snapshot.owner.toBase58(), sha256: hash(snapshot.data), signature: migrationSignature }, null, 2)}\n`,
      );
    }
    report.stage = "damm-buy";
    const dammAmount = TOKEN_1PCT.devBuyAmount / 40n;
    const dammQuote = quoteDammV2ExactOut(pool, dammAmount);
    const dammWrap = launchInstructionGroups({
      wallet: wallet.publicKey,
      mint: mint.publicKey,
      deployment: DEPLOYMENT,
      name: base.name!,
      symbol: base.symbol!,
      uri: base.uri!,
      maxSolCost: dammQuote.maxQuoteIn,
      computeUnitLimit: 1_400_000,
      computeUnitPriceMicroLamports: 0n,
      tip: { recipient: wallet.publicKey, lamports: 0n },
      blockhash: (await connection.getLatestBlockhash()).blockhash,
    }).createAndBuy.filter((ix) => !ix.programId.equals(DBC_PROGRAM_ID));
    const dammClose = dammWrap.pop();
    assert(dammClose);
    const buyerBefore = await connection.getAccountInfo(addresses.launchAta);
    assert(buyerBefore);
    const dammTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ...dammWrap,
          dammV2Swap2Ix({
            mint: mint.publicKey,
            user: wallet.publicKey,
            amountOut: dammAmount,
            maxQuoteIn: dammQuote.maxQuoteIn,
          }),
          dammClose,
        ],
      }).compileToV0Message([table]),
    );
    const dammBuySignature = await send(connection, dammTx, [wallet]);
    const [buyerAfter, tradedPool] = await connection.getMultipleAccountsInfo([
      addresses.launchAta,
      poolAddress,
    ]);
    assert(buyerAfter && tradedPool);
    const traded = decodeDammV2Pool(tradedPool.data);
    assert.equal(
      buyerAfter.data.readBigUInt64LE(64) -
        buyerBefore.data.readBigUInt64LE(64),
      dammAmount,
    );
    assert.equal(traded.sqrtPrice, dammQuote.nextSqrtPrice);
    assert.equal(
      traded.protocolBFee - pool.protocolBFee,
      dammQuote.protocolFee,
    );
    assert.equal(traded.protocolAFee - pool.protocolAFee, 0n);
    await writeFile(
      join(captures, "local-damm-after-buy.bin"),
      tradedPool.data,
    );
    await writeFile(
      join(captures, "local-damm-after-buy.meta.json"),
      `${JSON.stringify({ cluster: "localnet", observedSlot: await connection.getSlot(), address: poolAddress.toBase58(), owner: tradedPool.owner.toBase58(), sha256: hash(tradedPool.data), signature: dammBuySignature }, null, 2)}\n`,
    );
    report.dammBuy = {
      signature: dammBuySignature,
      quote: dammQuote,
      output: dammAmount.toString(),
      protocolQuoteFee: (traded.protocolBFee - pool.protocolBFee).toString(),
      protocolBaseFee: "0",
      poolBaseAmountAfter: traded.tokenAAmount.toString(),
      poolQuoteAmountAfter: traded.tokenBAmount.toString(),
    };
    report.events = events;
    report.stage = "complete";
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.message : String(error);
    console.error(
      `Validator exit=${child?.exitCode} signal=${child?.signalCode}\n${output}`,
    );
    const log = await readFile(
      join(temporary, "ledger/validator.log"),
      "utf8",
    ).catch(() => "Validator log unavailable");
    const logPath = join(
      tmpdir(),
      `${basename(temporary)}-${flow}-validator-failure.log`,
    );
    await writeFile(logPath, log);
    console.error(`Validator diagnostics saved to ${logPath}`);
    throw error;
  } finally {
    await mkdir(join(app, "reports/launch"), { recursive: true });
    await writeFile(
      join(app, "reports/launch", `${flow}-validator.json`),
      `${JSON.stringify(report, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
    );
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((yes) => child!.once("exit", () => yes())),
        delay(5_000).then(() => child!.kill("SIGKILL")),
      ]);
    }
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify(
      report,
      (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      2,
    ),
  );
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runMeteoraValidatorLaunch();
