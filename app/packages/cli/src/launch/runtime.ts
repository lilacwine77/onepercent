import { readFile, mkdir, writeFile, rename, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import * as anchorNamespace from "@anchor-lang/core";
import {
  Connection,
  PublicKey,
  Keypair,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import {
  BPS_DENOMINATOR,
  SERVICES,
  TOKEN_1PCT,
  TX_LIMITS,
} from "@onepercent/config";
import {
  buildLaunchCandidates,
  launchAddresses,
  launchLookupAddresses,
  launchInstructionGroups,
} from "@onepercent/sdk";
import type { LaunchTransactionOptions } from "@onepercent/sdk";
import { buildDbcLaunchConfig, quoteDbcExactOut } from "@onepercent/sdk";
import { z } from "zod";
import { OpsError } from "../input.js";
import { GENESIS } from "../runtime.js";
import {
  launchMetadata,
  parseLaunchInput,
  migrationQuoteThreshold,
  requirePinnedLaunchIdentity,
} from "./input.js";
import type { LaunchInput } from "./input.js";
import {
  readLaunchPolicy,
  launchPriorityPrice,
  loadLandingClient,
} from "./landing.js";
import type { LaunchPolicy } from "./landing.js";
import { devnetLaunchPolicy } from "./devnet-transport.js";
import { sendLaunch } from "./send.js";
import type { LaunchAttempt } from "./send.js";
import {
  buildLaunchReport,
  checkDbcLaunchConfig,
  checkLaunchPrerequisites,
  checkLaunchProgramVersions,
  checkLaunchSimulation,
  checkRehearsalMint,
  decodeLaunchConfig,
  decodeLaunchMachine,
  classifyLaunchMintAccount,
  classifyLaunchPoolAccount,
  LaunchCheckError,
} from "./checks.js";
import type { AccountSnapshot } from "./checks.js";

const anchor =
  (Reflect.get(anchorNamespace, "default") as
    typeof anchorNamespace | undefined) ?? anchorNamespace;
const appDirectory = fileURLToPath(new URL("../../../../", import.meta.url));
const reportDirectory = join(appDirectory, "reports/launch");
// EXT: Solana per-transaction compute ceiling. A diagnostic uses the ceiling;
// the final build uses measured CU and the config's landing.cuMarginBps.
const MAX_COMPUTE_UNITS = 1_400_000;
const SENDER_TIP = new PublicKey(
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
);
export function launchSimulationError(error: unknown) {
  if (error === null) return null;
  const parsed = z
    .object({
      InstructionError: z.tuple([
        z.number().int().nonnegative(),
        z.union([
          z.object({ Custom: z.number().int().nonnegative() }),
          z.string().regex(/^[A-Za-z]{1,64}$/),
        ]),
      ]),
    })
    .safeParse(error);
  return parsed.success ? parsed.data : "transaction_simulation_failed";
}
export const launchJson = (value: unknown) =>
  JSON.stringify(
    value,
    (_, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
function snapshot(account: AccountInfo<Buffer> | null): AccountSnapshot | null {
  if (!account) return null;
  if (!Number.isSafeInteger(account.lamports) || account.lamports < 0)
    throw new OpsError("unsafe_rpc_lamports");
  return { ...account, lamports: BigInt(account.lamports) };
}
function decodedSimulationAccount(value: unknown): AccountSnapshot | null {
  if (value === null) return null;
  const a = z
    .object({
      owner: z.string(),
      data: z.tuple([z.string(), z.literal("base64")]),
      lamports: z.number().int().nonnegative().safe(),
      executable: z.boolean(),
    })
    .parse(value);
  return {
    owner: new PublicKey(a.owner),
    data: Buffer.from(a.data[0], "base64"),
    lamports: BigInt(a.lamports),
    executable: a.executable,
  };
}
async function readSigner(path: string) {
  try {
    const bytes = z
      .array(z.number().int().min(0).max(255))
      .length(64)
      .parse(JSON.parse(await readFile(path, "utf8")));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw new OpsError("invalid_local_signer");
  }
}
export async function requireLaunchCluster(
  connection: Connection,
  input: Pick<LaunchInput, "cluster" | "rpc">,
) {
  const actual = await connection.getGenesisHash();
  if (input.cluster === "localnet") {
    if (Object.values(GENESIS).includes(actual as typeof GENESIS.mainnet))
      throw new OpsError("launch_genesis_mismatch");
    const url = new URL(input.rpc);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new OpsError("localnet_requires_loopback");
  } else if (actual !== GENESIS[input.cluster])
    throw new OpsError("launch_genesis_mismatch");
}
function connect(url: string) {
  return new Connection(url, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (resource, init) =>
      fetch(resource, {
        ...init,
        signal: AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
      }),
  });
}
async function baselineVersions() {
  const data: unknown = JSON.parse(
    await readFile(
      join(appDirectory, "fixtures/meteora/programs.json"),
      "utf8",
    ),
  );
  const baseline = z
    .object({
      programs: z
        .array(
          z.object({
            name: z.string(),
            programId: z.string(),
            deploymentSlot: z.number().int().safe(),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
          }),
        )
        .min(2),
    })
    .parse(data)
    .programs.filter((row) => row.name === "dbc" || row.name === "damm-v2");
  if (
    baseline.length !== 2 ||
    new Set(baseline.map((row) => row.name)).size !== 2
  )
    throw new OpsError("meteora_program_baseline_invalid");
  return baseline.map((row) => ({
    address: row.programId,
    deploySlot: row.deploymentSlot,
    binarySha256: row.sha256,
  }));
}
async function programVersions(connection: Connection) {
  const baseline = await baselineVersions();
  const observed = [];
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  for (const row of baseline) {
    const program = await connection.getAccountInfo(
      new PublicKey(row.address),
      "confirmed",
    );
    if (
      !program ||
      !program.owner.equals(loader) ||
      !program.executable ||
      program.data.length !== 36 ||
      program.data.readUInt32LE(0) !== 2
    )
      throw new OpsError("meteora_program_invalid");
    const data = await connection.getAccountInfo(
      new PublicKey(program.data.subarray(4)),
      "confirmed",
    );
    if (
      !data ||
      !data.owner.equals(loader) ||
      data.data.length < 45 ||
      data.data.readUInt32LE(0) !== 3
    )
      throw new OpsError("meteora_programdata_invalid");
    observed.push({
      programId: row.address,
      deploySlot: Number(data.data.readBigUInt64LE(4)),
      executableHash: createHash("sha256")
        .update(data.data.subarray(45))
        .digest("hex"),
    });
  }
  return {
    observed,
    baseline: baseline.map((row) => ({
      programId: row.address,
      deploySlot: row.deploySlot,
      executableHash: row.binarySha256,
    })),
  };
}

export function launchWritableAccounts(
  input: LaunchTransactionOptions,
): PublicKey[] {
  const groups = launchInstructionGroups(input);
  const writable = new Set([
    input.wallet.toBase58(),
    ...(input.deployment.cluster === "devnet" && input.tip.lamports === 0n
      ? []
      : [input.tip.recipient.toBase58()]),
  ]);
  for (const ix of [...groups.createAndBuy, ...groups.depositAndPowerOn])
    for (const key of ix.keys)
      if (key.isWritable) writable.add(key.pubkey.toBase58());
  return [...writable]
    .sort()
    .slice(0, 128)
    .map((key) => new PublicKey(key));
}

export function observeLaunchState(input: {
  mintAccount: AccountSnapshot | null;
  poolAccount: AccountSnapshot | null;
  machineAccount: AccountSnapshot | null;
  programId: PublicKey;
  mint: PublicKey;
}) {
  const state = classifyLaunchMintAccount(input.mintAccount);
  const poolState = classifyLaunchPoolAccount(input.poolAccount);
  if (poolState === "foreign") return "foreign-pool-account" as const;
  if (state === "absent" && poolState === "absent") return "absent" as const;
  if (state === "foreign") return "foreign-mint-account" as const;
  if (state === "absent" || poolState === "absent")
    return "mint-without-power-on" as const;
  const machine = decodeLaunchMachine(input.machineAccount, input.programId);
  return (machine.phase === 2 || machine.phase === 3) &&
    machine.tokenMint.equals(input.mint)
    ? ("powered-on" as const)
    : ("mint-without-power-on" as const);
}

/** Rebroadcast the journal's exact bytes; only finalized reconciliation may rebuild. */
export async function rebroadcastLaunchAttempt(
  connection: Pick<Connection, "getSignatureStatuses" | "getBlockHeight">,
  attempt: LaunchAttempt,
  deps: {
    assertCluster(): Promise<void>;
    submit(encoded: string): Promise<string>;
    sleep(milliseconds: number): Promise<unknown>;
    emit(record: Record<string, unknown>): void;
  },
) {
  if (
    attempt.form !== "single" ||
    attempt.signatures.length !== 1 ||
    attempt.encodedTransactions.length !== 1
  )
    throw new OpsError("launch_journal_invalid");
  const signature = attempt.signatures[0]!;
  const encoded = attempt.encodedTransactions[0]!;
  while (true) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    if (statuses.value.length !== 1)
      throw new OpsError("launch_signature_status_unavailable");
    const status = statuses.value[0];
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      if (status.err) throw new OpsError("launch_landed_transaction_failed");
      return;
    }
    if (
      (await connection.getBlockHeight("confirmed")) >
      attempt.lastValidBlockHeight
    )
      return;
    await deps.assertCluster();
    try {
      const submitted = await deps.submit(encoded);
      if (submitted !== signature)
        throw new OpsError("landing_signature_mismatch");
    } catch (error) {
      if (error instanceof OpsError) throw error;
      deps.emit({
        event: "launch_transport_ambiguous",
        signatures: [signature],
      });
    }
    await deps.sleep(2_000);
  }
}

export async function planLaunch(
  connection: Connection,
  input: LaunchInput,
  identity: { wallet: PublicKey; mint: PublicKey },
  options: { tip?: PublicKey; localPolicy?: LaunchPolicy } = {},
) {
  const deployment = requirePinnedLaunchIdentity(input);
  const programId = deployment.programId;
  const dbcConfig = new PublicKey(deployment.meteora.dbcConfig);
  const addresses = launchAddresses({ ...identity, deployment });
  const metadata = launchMetadata(input);
  if (options.localPolicy) {
    if (input.cluster !== "localnet")
      throw new OpsError("launch_local_policy_requires_localnet");
    await requireLaunchCluster(connection, input);
  }
  const policy =
    options.localPolicy ??
    (input.cluster === "devnet"
      ? devnetLaunchPolicy(input.cluster)
      : readLaunchPolicy());
  const dbcConfigAccount = snapshot(
    await connection.getAccountInfo(dbcConfig, "confirmed"),
  );
  const threshold = migrationQuoteThreshold(input);
  let dbc:
    | ReturnType<typeof buildDbcLaunchConfig>
    | ReturnType<typeof checkDbcLaunchConfig> = buildDbcLaunchConfig(threshold);
  let diagnosticQuote = false;
  try {
    dbc = checkDbcLaunchConfig(dbcConfigAccount, {
      feeIn: addresses.feeIn,
      migrationQuoteThreshold: threshold,
      cluster: input.cluster,
    });
  } catch {
    diagnosticQuote = true;
  }
  const quoteDetails = quoteDbcExactOut(dbc, TOKEN_1PCT.devBuyAmount);
  const quote = quoteDetails.maxQuoteIn;
  const blockhash = await connection.getLatestBlockhash("confirmed");
  const currentSlot = await connection.getSlot("confirmed");
  let lookupTable: AddressLookupTableAccount | undefined;
  if (input.lut) {
    const account = await connection.getAccountInfo(
      new PublicKey(input.lut),
      "confirmed",
    );
    if (
      !account?.owner.equals(AddressLookupTableProgram.programId) ||
      account.executable
    )
      throw new OpsError("launch_lookup_owner");
    lookupTable = new AddressLookupTableAccount({
      key: new PublicKey(input.lut),
      state: AddressLookupTableAccount.deserialize(account.data),
    });
  }
  const buildOptions: LaunchTransactionOptions = {
    deployment,
    ...identity,
    ...metadata,
    maxSolCost: quote,
    blockhash: blockhash.blockhash,
    lookupTable,
    computeUnitLimit: MAX_COMPUTE_UNITS,
    computeUnitPriceMicroLamports: 0n,
    tip: {
      recipient: options.tip ?? SENDER_TIP,
      lamports: policy?.landing.tipLamports ?? 0n,
    },
  };
  const price = policy
    ? launchPriorityPrice(
        await connection.getRecentPrioritizationFees({
          lockedWritableAccounts: launchWritableAccounts(buildOptions),
        }),
        policy.landing.maxComputeUnitPriceMicroLamports,
      )
    : 0n;
  buildOptions.computeUnitPriceMicroLamports = price;
  const expectedLookupAddresses = launchLookupAddresses(buildOptions);
  const readKeys = [
    addresses.config,
    addresses.machine,
    identity.mint,
    addresses.feeIn,
    identity.wallet,
    addresses.launchPool,
  ];
  const state = await connection.getMultipleAccountsInfoAndContext(readKeys, {
    commitment: "confirmed",
    minContextSlot: currentSlot,
  });
  const [config, machine, mintAccount, feeIn, wallet, poolAccount] =
    state.value.map(snapshot);
  const checks = checkLaunchPrerequisites({
    programId,
    mint: identity.mint,
    launchWallet: identity.wallet,
    config: config!,
    machine: machine!,
    mintAccount: mintAccount!,
    poolAccount: poolAccount!,
    dbcConfigAccount,
    expectedDbcConfig: dbcConfig,
    migrationQuoteThreshold: threshold,
    cluster: input.cluster,
    feeIn: feeIn!,
    rentMinimumLamports: BigInt(
      await connection.getMinimumBalanceForRentExemption(0),
    ),
    lookupTable: lookupTable ?? null,
    expectedLookupAddresses,
    currentSlot: state.context.slot,
  });
  checks.push({
    id: "landing_policy",
    status: policy ? "GO" : "NO-GO",
    detail: policy
      ? "Pinned landing policy available"
      : "K1/S3 landing and retry parameters are unavailable; zero fees below are diagnostic only",
  });
  if (
    input.cluster === "mainnet" &&
    policy &&
    (policy.landing.tipLamports < 1_000_000n || price === 0n)
  )
    checks.push({
      id: "sender_requirements",
      status: "NO-GO",
      detail: "Sender requires its minimum tip and a nonzero priority price",
    });
  const versions = await programVersions(connection);
  checks.push(checkLaunchProgramVersions(versions.observed, versions.baseline));
  checks.push({
    id: "dbc_dev_buy_quote",
    status: diagnosticQuote ? "NO-GO" : "GO",
    detail: diagnosticQuote
      ? "Config mismatch: quote is diagnostic only"
      : "Exact-out dev buy from the pinned DBC integer math mirror",
    value: quoteDetails,
  });
  if (input.cluster !== "mainnet") {
    checks.push({
      id: "rehearsal_mint",
      status: "GO",
      detail:
        "This cluster is a rehearsal; prior devnet evidence is required only before mainnet launch",
    });
  } else if (input.rehearsalMint && input.rehearsalRpc) {
    const rehearsalRpc = connect(input.rehearsalRpc);
    const genesis = await rehearsalRpc.getGenesisHash();
    // D18: full devnet rehearsal replaces the mainnet canary Power-On.
    if (genesis !== GENESIS.devnet)
      throw new OpsError("rehearsal_must_be_devnet");
    const rehearsal = await rehearsalRpc.getAccountInfoAndContext(
      new PublicKey(input.rehearsalMint),
      "confirmed",
    );
    checks.push(
      checkRehearsalMint(snapshot(rehearsal.value), {
        cluster: "devnet",
        mint: new PublicKey(input.rehearsalMint),
        observedSlot: rehearsal.context.slot,
      }),
    );
  } else
    checks.push({
      id: "rehearsal_mint",
      status: "NO-GO",
      detail: "D18 devnet rehearsal mint and RPC are required",
    });

  if (
    lookupTable &&
    lookupTable.state.authority === undefined &&
    !expectedLookupAddresses.every((expected) =>
      lookupTable.state.addresses.some((key) => key.equals(expected)),
    )
  )
    checks.push({
      id: "lut_dbc_accounts_mismatch",
      status: "NO-GO",
      detail: "The frozen lookup table does not match the DBC launch accounts",
    });
  // Invalid tables stay visible as numbered checks; diagnostic bytes use no table.
  if (
    checks.some(
      (check) => check.id === "5.lookup_table" && check.status === "NO-GO",
    )
  )
    buildOptions.lookupTable = undefined;
  let candidates = buildLaunchCandidates(buildOptions);
  const form = "single" as const;
  checks.push({
    id: "launch_transaction_size",
    status: candidates.singleFits ? "GO" : "NO-GO",
    detail: "D28 requires one atomic v0 transaction within the packet limit",
    value: { bytes: candidates.singleSize, limit: TX_LIMITS.maxTxBytes },
  });
  const postKeys = [
    identity.mint,
    addresses.launchPool,
    addresses.vault,
    addresses.launchAta,
    identity.wallet,
    addresses.machine,
    addresses.ledger,
  ];
  async function simulate() {
    if (!candidates.singleFits)
      throw new OpsError("launch_transaction_exceeds_packet_limit");
    const response = await connection.simulateTransaction(candidates.single, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      minContextSlot: state.context.slot,
      accounts: {
        encoding: "base64",
        addresses: postKeys.map((key) => key.toBase58()),
      },
    });
    return {
      slot: response.context.slot,
      err: launchSimulationError(response.value.err),
      units: [response.value.unitsConsumed ?? 0],
      accounts: response.value.accounts?.map(decodedSimulationAccount) ?? [],
    };
  }
  let simulation: Awaited<ReturnType<typeof simulate>> | null = null;
  try {
    simulation = await simulate();
    if (!simulation.err && policy) {
      const limits = simulation.units.map((units) =>
        Math.ceil(
          (units * (BPS_DENOMINATOR + policy.landing.cuMarginBps)) /
            BPS_DENOMINATOR,
        ),
      );
      if (limits.some((units) => units <= 0 || units > MAX_COMPUTE_UNITS))
        throw new OpsError("launch_compute_limit_exceeded");
      buildOptions.computeUnitLimit = limits[0]!;
      candidates = buildLaunchCandidates(buildOptions);
      simulation = await simulate(); // exact final message with its measured budget
    }
    checks.push(
      ...checkLaunchSimulation({
        err: simulation.err,
        mint: simulation.accounts[0] ?? null,
        pool: simulation.accounts[1] ?? null,
        dbcConfigAccount,
        expectedDbcConfig: dbcConfig,
        migrationQuoteThreshold: threshold,
        cluster: input.cluster,
        vault: simulation.accounts[2] ?? null,
        launchTokenAccount: simulation.accounts[3] ?? null,
        expectedMint: identity.mint,
        feeIn: addresses.feeIn,
        vaultAuthority: addresses.vaultAuth,
        expectedPartnerFee: quoteDetails.partnerFee,
      }),
    );
    if (simulation.err === null) {
      const effectReport = buildLaunchReport({
        cluster: input.cluster,
        programId,
        observedSlot: simulation.slot,
        config: config!,
        machine: simulation.accounts[5] ?? null,
        ledger: simulation.accounts[6] ?? null,
        mint: simulation.accounts[0] ?? null,
        pool: simulation.accounts[1] ?? null,
        dbcConfigAccount,
        expectedDbcConfig: dbcConfig,
        migrationQuoteThreshold: threshold,
        vault: simulation.accounts[2] ?? null,
        launchTokenAccounts: [],
        launchLookupTable: lookupTable?.key ?? PublicKey.default,
        landedForm: "single-v0",
        launchSimulation: true,
        signatures: [],
      });
      checks.push(
        ...effectReport.checks.map((check) => ({
          ...check,
          id: `simulation.${check.id}`,
        })),
      );
    }
    const postWallet = simulation.accounts[4];
    checks.push({
      id: "launch_funding",
      status:
        simulation.err === null &&
        wallet &&
        postWallet &&
        postWallet.lamports >= 0n
          ? "GO"
          : "NO-GO",
      detail:
        "Successful simulation debits live wallet including account rent, fees and tip",
      value:
        wallet && postWallet
          ? {
              before: wallet.lamports,
              after: postWallet.lamports,
              totalSpend: wallet.lamports - postWallet.lamports,
            }
          : null,
    });
  } catch (error) {
    checks.push({
      id: "launch_simulation",
      status: "NO-GO",
      detail:
        error instanceof OpsError
          ? error.code
          : "launch_simulation_unavailable",
    });
  }
  const selected = [candidates.single];
  const report = {
    ok: checks.every((c) => c.status !== "NO-GO"),
    cluster: input.cluster,
    programId: input.program,
    mint: identity.mint.toBase58(),
    wallet: identity.wallet.toBase58(),
    dbcConfig: dbcConfig.toBase58(),
    migrationQuoteThreshold: threshold,
    powerOnInterface: "M4.1 powerOnIx",
    quoteLamports: quote,
    form,
    sizes: {
      single: candidates.singleSize,
      limit: TX_LIMITS.maxTxBytes,
    },
    lookupAddresses: expectedLookupAddresses.map((key) => key.toBase58()),
    checks,
    simulation: simulation
      ? {
          slot: simulation.slot,
          error: simulation.err,
          unitsConsumed: simulation.units,
        }
      : null,
    instructions: selected.map((tx) =>
      TransactionMessage.decompile(tx.message, {
        addressLookupTableAccounts: lookupTable ? [lookupTable] : [],
      }).instructions.map((ix) => ({
        programId: ix.programId.toBase58(),
        dataHex: ix.data.toString("hex"),
        accounts: ix.keys.map((k) => ({
          address: k.pubkey.toBase58(),
          signer: k.isSigner,
          writable: k.isWritable,
        })),
      })),
    ),
  };
  return {
    report,
    checks,
    candidates,
    selected,
    form,
    buildOptions,
    blockhash,
    addresses,
    config,
    machine,
    policy,
  };
}

const attemptSchema = z.object({
  form: z.literal("single"),
  signatures: z.array(z.string()).length(1),
  encodedTransactions: z.array(z.string()).length(1),
  lastValidBlockHeight: z.number().int().nonnegative().safe(),
  acceptedWarnings: z
    .array(
      z.object({
        id: z.string(),
        detail: z.string(),
        value: z.unknown().optional(),
      }),
    )
    .optional(),
});
export async function runLaunch(
  argv: string[],
  emit: (record: Record<string, unknown>) => void = (record) =>
    process.stderr.write(`${launchJson(record)}\n`),
) {
  const input = parseLaunchInput(argv);
  const rpc = connect(input.rpc);
  await requireLaunchCluster(rpc, input); // before reading any key file
  const wallet = input.wallet ? await readSigner(input.wallet) : null;
  const mint = input.mintKeypair ? await readSigner(input.mintKeypair) : null;
  const config = input.dbcConfigKeypair
    ? await readSigner(input.dbcConfigKeypair)
    : null;
  return executeLaunch(input, rpc, { wallet, mint, config }, emit);
}

/** CLI execution core also used by local-validator rehearsals with in-memory signers. */
export async function executeLaunch(
  input: LaunchInput,
  rpc: Connection,
  signers: {
    wallet: Keypair | null;
    mint: Keypair | null;
    config?: Keypair | null;
  },
  emit: (record: Record<string, unknown>) => void = () => undefined,
  options: { directory?: string; localPolicy?: LaunchPolicy } = {},
) {
  await requireLaunchCluster(rpc, input);
  if (options.localPolicy && input.cluster !== "localnet")
    throw new OpsError("launch_local_policy_requires_localnet");
  const directory = options.directory ?? reportDirectory;
  if (
    input.cluster === "mainnet" &&
    (input.command === "send" || input.flow === "atomic")
  )
    throw new OpsError("mainnet_requires_proxima_launch");
  if (
    ["set-mint", "stock-up", "deposit", "power-on"].includes(input.command) ||
    (["check", "plan", "report"].includes(input.command) &&
      (input.flow === "proxima" || input.cluster === "mainnet"))
  ) {
    const { executeProxima } = await import("./proxima.js");
    try {
      return await executeProxima(input, rpc, signers.wallet, {
        ...options,
        directory,
        emit,
      });
    } catch (error) {
      if (error instanceof LaunchCheckError) throw new OpsError(error.code);
      throw error;
    }
  }
  const walletSigner = signers.wallet,
    mintSigner = signers.mint;
  if (input.command === "config") {
    if (!walletSigner) throw new OpsError("launch_config_wallet_required");
    const { createLaunchDbcConfig } = await import("./dbc-config.js");
    return createLaunchDbcConfig(rpc, input, walletSigner, {
      directory,
      emit,
      configSigner: signers.config ?? undefined,
    });
  }
  if (!input.dbcConfig) throw new OpsError("launch_dbc_config_required");
  const deployment = requirePinnedLaunchIdentity(input);
  const dbcConfig = new PublicKey(deployment.meteora.dbcConfig);
  const programId = deployment.programId;
  const configAddress = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[0];
  const configAccount = snapshot(
    await rpc.getAccountInfo(configAddress, "finalized"),
  );
  const config = configAccount
    ? decodeLaunchConfig(configAccount, programId)
    : null;
  const wallet =
    walletSigner?.publicKey ??
    (input.walletAddress
      ? new PublicKey(input.walletAddress)
      : config?.launchWallet);
  const mint =
    mintSigner?.publicKey ??
    (input.mint ? new PublicKey(input.mint) : config?.tokenMint);
  if (!wallet || !mint) throw new OpsError("launch_public_identity_required");
  if (
    (input.walletAddress &&
      !wallet.equals(new PublicKey(input.walletAddress))) ||
    (input.mint && !mint.equals(new PublicKey(input.mint)))
  )
    throw new OpsError("launch_identity_mismatch");
  if (input.command === "lut") {
    if (!walletSigner) throw new OpsError("launch_lut_wallet_required");
    const module = await import("./lut.js");
    return module.createLaunchLookupTable(
      rpc,
      { ...input, mint: mint.toBase58() },
      walletSigner!,
      configAccount,
      emit,
      { directory },
    );
  }
  const identity = { wallet, mint };
  if (input.command === "plan" || input.command === "check")
    return (await planLaunch(rpc, input, identity, options)).report;
  await mkdir(directory, { recursive: true });
  const identityId = `${input.cluster}-${programId.toBase58()}-${mint.toBase58()}`;
  const journalFile = join(directory, `${identityId}-attempt.json`);
  const load = async () => {
    try {
      const record = z
        .object({
          cluster: z.string(),
          program: z.string(),
          mint: z.string(),
          wallet: z.string(),
          dbcConfig: z.string(),
          migrationQuoteThreshold: z.string(),
          attempt: attemptSchema,
        })
        .parse(JSON.parse(await readFile(journalFile, "utf8")));
      if (
        record.cluster !== input.cluster ||
        record.program !== input.program ||
        record.mint !== mint.toBase58() ||
        record.wallet !== wallet.toBase58() ||
        record.dbcConfig !== dbcConfig.toBase58() ||
        record.migrationQuoteThreshold !==
          migrationQuoteThreshold(input).toString()
      )
        throw new Error();
      if (
        record.attempt.encodedTransactions.length !== 1 ||
        record.attempt.signatures.length !==
          record.attempt.encodedTransactions.length
      )
        throw new Error();
      record.attempt.encodedTransactions.forEach((encoded, i) => {
        const tx = VersionedTransaction.deserialize(
          Buffer.from(encoded, "base64"),
        );
        if (
          tx.message.version !== 0 ||
          !input.lut ||
          tx.message.addressTableLookups.length !== 1 ||
          !tx.message.addressTableLookups[0]!.accountKey.equals(
            new PublicKey(input.lut),
          ) ||
          !tx.message.staticAccountKeys[0]!.equals(wallet) ||
          anchor.utils.bytes.bs58.encode(tx.signatures[0]!) !==
            record.attempt.signatures[i]
        )
          throw new Error();
      });
      const { validateLaunchAttemptIdentity } = await import("./journal.js");
      await validateLaunchAttemptIdentity(rpc, record.attempt, {
        deployment,
        wallet,
        mint,
        lookupTable: new PublicKey(input.lut!),
        tipRecipient: SENDER_TIP,
      });
      return record.attempt;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return null;
      throw new OpsError("launch_journal_invalid");
    }
  };
  if (input.command === "report") {
    if (!input.lut) throw new OpsError("launch_lookup_table_required");
    const attempt = await load();
    if (!attempt) throw new OpsError("launch_form_evidence_missing");
    const { verifyLandedLaunchEvidence } = await import("./evidence.js");
    const evidence = await verifyLandedLaunchEvidence(
      rpc,
      attempt,
      new PublicKey(input.lut),
    );
    const a = launchAddresses({ ...identity, deployment });
    const state = await rpc.getMultipleAccountsInfoAndContext(
      [a.config, a.machine, a.ledger, a.mint, a.launchPool, a.vault, dbcConfig],
      { commitment: "finalized", minContextSlot: evidence.observedSlot },
    );
    const tokenAccounts = await rpc.getTokenAccountsByOwner(
      wallet,
      { mint },
      { commitment: "finalized", minContextSlot: state.context.slot },
    );
    const [c, m, ledger, token, pool, vault, dbc] = state.value.map(snapshot);
    const result = buildLaunchReport({
      cluster: input.cluster,
      programId,
      observedSlot: state.context.slot,
      config: c!,
      machine: m!,
      ledger: ledger!,
      mint: token!,
      pool: pool!,
      dbcConfigAccount: dbc!,
      expectedDbcConfig: dbcConfig,
      migrationQuoteThreshold: migrationQuoteThreshold(input),
      vault: vault!,
      launchTokenAccounts: tokenAccounts.value.map((row) =>
        snapshot(row.account)!,
      ),
      launchLookupTable: new PublicKey(input.lut),
      landedForm: "single-v0",
      signatures: attempt.signatures,
      programVersions: (await programVersions(rpc)).observed,
    });
    const path = join(
      directory,
      `${input.cluster}-${new Date().toISOString().replaceAll(":", "-")}.json`,
    );
    await writeFile(path, `${launchJson(result)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return { ...result, reportFile: path };
  }
  const policy =
    options.localPolicy ??
    (input.cluster === "devnet"
      ? devnetLaunchPolicy(input.cluster)
      : readLaunchPolicy());
  if (!policy) throw new OpsError("launch_landing_policy_unavailable");
  if (input.confirm !== mint.toBase58().slice(0, 8))
    throw new OpsError("launch_confirmation_mismatch");
  if (!input.lut || !walletSigner || !mintSigner)
    throw new OpsError("launch_signers_and_lookup_required");
  const lock = await open(`${journalFile}.lock`, "wx", 0o600).catch(() => {
    throw new OpsError("launch_already_running_or_lock_requires_review");
  });
  let landing: Awaited<ReturnType<typeof loadLandingClient>> | null = null;
  const a = launchAddresses({ ...identity, deployment });
  let finalizedContextSlot = 0;
  const observe = async () => {
    const state = await rpc.getMultipleAccountsInfoAndContext(
      [a.mint, a.machine, a.launchPool],
      { commitment: "finalized", minContextSlot: finalizedContextSlot },
    );
    if (state.context.slot < finalizedContextSlot)
      throw new OpsError("launch_stale_finalized_state");
    finalizedContextSlot = state.context.slot;
    return observeLaunchState({
      mintAccount: snapshot(state.value[0] ?? null),
      machineAccount: snapshot(state.value[1] ?? null),
      poolAccount: snapshot(state.value[2] ?? null),
      programId,
      mint,
    });
  };
  try {
    finalizedContextSlot = await rpc.getSlot("finalized");
    landing = input.cluster === "mainnet" ? await loadLandingClient() : null;
    return await sendLaunch(
      {
        mint: mint.toBase58(),
        confirm: input.confirm!,
        at: input.at,
        maxPasses: policy.keeper.sendMaxAttempts,
        maxBuilds: policy.keeper.sendMaxAttempts,
      },
      {
        chainNow: async () => {
          const clock = await rpc.getAccountInfo(
            SYSVAR_CLOCK_PUBKEY,
            "confirmed",
          );
          if (!clock || clock.data.length !== 40)
            throw new OpsError("chain_clock_unavailable");
          return Number(clock.data.readBigInt64LE(32));
        },
        observe,
        load,
        emit,
        sleep: () => sleep(policy.keeper.backoffBaseMs),
        finalizedHeight: async () => {
          finalizedContextSlot = Math.max(
            finalizedContextSlot,
            await rpc.getSlot("finalized"),
          );
          return rpc.getBlockHeight({
            commitment: "finalized",
            minContextSlot: finalizedContextSlot,
          });
        },
        history: async (signatures) => {
          const history = await rpc.getSignatureStatuses(signatures, {
            searchTransactionHistory: true,
          });
          // The response context can be processed; only finalized transaction
          // slots may advance the floor of a finalized application read.
          finalizedContextSlot = Math.max(
            finalizedContextSlot,
            ...history.value.flatMap((status) =>
              status?.confirmationStatus === "finalized" ? [status.slot] : [],
            ),
          );
          return history.value.map((status) =>
            status === null
              ? "absent"
              : status.confirmationStatus !== "finalized"
                ? "ambiguous"
                : status.err
                  ? "failed"
                  : "finalized",
          );
        },
        preflight: async () => {
          const plan = await planLaunch(rpc, input, identity, options);
          emit(plan.report);
          if (
            !plan.report.ok ||
            (!input.acceptWarnings &&
              plan.checks.some((c) => c.status === "WARN"))
          )
            throw new OpsError("launch_no_go_or_unaccepted_warning");
        },
        prepare: async () => {
          const plan = await planLaunch(rpc, input, identity, options);
          emit(plan.report);
          if (
            !plan.report.ok ||
            (!input.acceptWarnings &&
              plan.checks.some((c) => c.status === "WARN"))
          )
            throw new OpsError("launch_no_go_or_unaccepted_warning");
          await requireLaunchCluster(rpc, input);
          plan.selected.forEach((tx) => tx.sign([walletSigner, mintSigner]));
          return {
            form: plan.form,
            signatures: plan.selected.map((tx) =>
              anchor.utils.bytes.bs58.encode(tx.signatures[0]!),
            ),
            encodedTransactions: plan.selected.map((tx) =>
              Buffer.from(tx.serialize()).toString("base64"),
            ),
            lastValidBlockHeight: plan.blockhash.lastValidBlockHeight,
            acceptedWarnings: plan.checks
              .filter((check) => check.status === "WARN")
              .map(({ id, detail, value }) => ({ id, detail, value })),
          };
        },
        persist: async (attempt: LaunchAttempt) => {
          const path = `${journalFile}.new`;
          await writeFile(
            path,
            launchJson({
              cluster: input.cluster,
              program: input.program,
              mint: mint.toBase58(),
              wallet: wallet.toBase58(),
              dbcConfig: dbcConfig.toBase58(),
              migrationQuoteThreshold:
                migrationQuoteThreshold(input).toString(),
              attempt,
            }),
            { mode: 0o600 },
          );
          await rename(path, journalFile);
        },
        send: async (attempt) => {
          await rebroadcastLaunchAttempt(rpc, attempt, {
            assertCluster: () => requireLaunchCluster(rpc, input),
            submit: (encoded) =>
              landing
                ? landing.sendSingle(encoded)
                : rpc.sendRawTransaction(Buffer.from(encoded, "base64"), {
                    skipPreflight: false,
                    maxRetries: 0,
                  }),
            emit,
            sleep,
          });
        },
      },
    );
  } finally {
    await lock.close();
    const { unlink } = await import("node:fs/promises");
    await unlink(`${journalFile}.lock`);
  }
}
