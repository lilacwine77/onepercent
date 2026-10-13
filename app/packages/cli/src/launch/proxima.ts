import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import * as anchorNamespace from "@anchor-lang/core";
import { BPS_DENOMINATOR, PROGRAM_IDS, TX_LIMITS } from "@onepercent/config";
import {
  adminConfigInstruction,
  advancePhaseInstruction,
  launchAddresses,
  powerOnIx,
  proximaDepositInstructions,
  type LaunchIdentity,
} from "@onepercent/sdk";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { z } from "zod";
import { OpsError } from "../input.js";
import {
  buildLaunchReport,
  decodeLaunchConfig,
  decodeLaunchMachine,
  LaunchCheckError,
} from "./checks.js";
import {
  migrationQuoteThreshold,
  requirePinnedLaunchIdentity,
  type LaunchInput,
} from "./input.js";
import { devnetLaunchPolicy } from "./devnet-transport.js";
import {
  launchPriorityPrice,
  loadLandingClient,
  readLaunchPolicy,
  type LaunchPolicy,
} from "./landing.js";
import {
  launchJson,
  rebroadcastLaunchAttempt,
  requireLaunchCluster,
} from "./runtime.js";
import { checkProximaState, type ProximaState } from "./proxima-state.js";

const anchor =
  (Reflect.get(anchorNamespace, "default") as
    typeof anchorNamespace | undefined) ?? anchorNamespace;
const tipRecipient = new PublicKey(
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
);
const snapshot = (account: AccountInfo<Buffer> | null) => {
  if (!account) return null;
  if (!Number.isSafeInteger(account.lamports) || account.lamports < 0)
    throw new OpsError("unsafe_rpc_lamports");
  return { ...account, lamports: BigInt(account.lamports) };
};
const recordSchema = z.strictObject({
  command: z.enum(["set-mint", "stock-up", "deposit", "power-on"]),
  identity: z.string(),
  signature: z.string(),
  encoded: z.string(),
  lastValidBlockHeight: z.number().int().nonnegative().safe(),
  units: z.number().int().positive().max(1_400_000),
  microLamports: z.string().regex(/^\d+$/),
  tipLamports: z.string().regex(/^\d+$/),
});
type Record = z.infer<typeof recordSchema>;

export async function readProximaState(
  rpc: Connection,
  identity: LaunchIdentity,
  minContextSlot = 0,
) {
  const a = launchAddresses(identity);
  const response = await rpc.getMultipleAccountsInfoAndContext(
    [
      a.config,
      a.machine,
      a.mint,
      a.launchPool,
      a.dbcConfig,
      a.vault,
      a.ledger,
      a.launchAta,
      SYSVAR_CLOCK_PUBKEY,
    ],
    { commitment: "finalized", minContextSlot },
  );
  const [config, machine, mint, pool, dbc, vault, ledger, launchAta, clock] =
    response.value.map(snapshot);
  if (!clock || clock.data.length !== 40)
    throw new OpsError("chain_clock_unavailable");
  const tokens =
    mint &&
    mint.owner.equals(
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    )
      ? await rpc.getTokenAccountsByOwner(
          identity.wallet,
          { mint: identity.mint },
          { commitment: "finalized", minContextSlot: response.context.slot },
        )
      : { value: [] };
  const state: ProximaState = {
    config: config!,
    machine: machine!,
    mint: mint!,
    pool: pool!,
    dbc: dbc!,
    vault: vault!,
    ledger: ledger!,
    launchAta: launchAta!,
    launchTokens: tokens.value.map(({ account }) => snapshot(account)!),
    now: clock.data.readBigInt64LE(32),
  };
  return { state, slot: response.context.slot };
}

function coreInstructions(
  command: Record["command"],
  identity: LaunchIdentity,
  payer: PublicKey,
) {
  if (command === "set-mint")
    return [
      adminConfigInstruction(identity.deployment.programId, {
        admin: payer,
        action: { setTokenMint: { mint: identity.mint } },
      }),
    ];
  if (command === "stock-up")
    return [advancePhaseInstruction(identity.deployment.programId)];
  if (command === "deposit") return proximaDepositInstructions(identity);
  return [
    powerOnIx(identity.deployment, {
      launchWallet: payer,
      mint: identity.mint,
      tokenProgram: new PublicKey(PROGRAM_IDS.splToken),
    }),
  ];
}
function transaction(
  core: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  fees: Pick<Record, "units" | "microLamports" | "tipLamports">,
) {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: fees.units }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: BigInt(fees.microLamports),
        }),
        ...core,
        ...(BigInt(fees.tipLamports) > 0n
          ? [
              SystemProgram.transfer({
                fromPubkey: payer,
                toPubkey: tipRecipient,
                lamports: BigInt(fees.tipLamports),
              }),
            ]
          : []),
      ],
    }).compileToV0Message(),
  );
}

/** Proxima creates the mint and pool; this flow only accepts their public addresses. */
export async function executeProxima(
  input: LaunchInput,
  rpc: Connection,
  wallet: Keypair | null,
  options: {
    directory: string;
    localPolicy?: LaunchPolicy;
    emit(record: { [key: string]: unknown }): void;
  },
) {
  const deployment = requirePinnedLaunchIdentity(input);
  if (input.mintKeypair)
    throw new OpsError("proxima_requires_public_mint_only");
  if (input.command === "verify") {
    if (input.flow === "atomic")
      throw new OpsError("proxima_verify_requires_proxima_flow");
    if (
      input.wallet !== undefined ||
      wallet ||
      input.mintKeypair !== undefined ||
      input.dbcConfigKeypair !== undefined ||
      input.confirm !== undefined
    )
      throw new OpsError("proxima_verify_is_read_only");
    if (!input.mint) throw new OpsError("proxima_mint_required");
    if (!input.poolCreator) throw new OpsError("proxima_pool_creator_required");
  }
  const configAddress = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    deployment.programId,
  )[0];
  const config = decodeLaunchConfig(
    snapshot(await rpc.getAccountInfo(configAddress, "finalized")),
    deployment.programId,
  );
  const identity: LaunchIdentity = {
    deployment,
    wallet: config.launchWallet,
    mint: input.mint ? new PublicKey(input.mint) : config.tokenMint,
  };
  if (input.walletAddress && input.walletAddress !== identity.wallet.toBase58())
    throw new OpsError("proxima_launch_wallet_mismatch");
  const poolCreator = input.poolCreator
    ? new PublicKey(input.poolCreator)
    : undefined;
  const threshold = migrationQuoteThreshold(input);
  const read = async (minSlot = 0) => {
    const result = await readProximaState(rpc, identity, minSlot);
    if (
      input.command === "set-mint" &&
      decodeLaunchMachine(result.state.machine, deployment.programId).phase !==
        0
    )
      throw new OpsError("proxima_set_mint_requires_setup");
    return {
      ...result,
      checked: checkProximaState(
        identity,
        result.state,
        threshold,
        poolCreator,
      ),
    };
  };
  let observed: Awaited<ReturnType<typeof read>>;
  try {
    observed = await read();
    if (input.command === "verify" && !observed.checked.launchVerified)
      throw new LaunchCheckError("proxima_launch_not_created");
  } catch (error) {
    if (
      ["check", "plan", "verify"].includes(input.command) &&
      error instanceof LaunchCheckError
    )
      return {
        ok: false,
        flow: "proxima",
        checks: [{ id: "proxima.state", status: "NO-GO", detail: error.code }],
      };
    throw error;
  }
  const result = () => ({
    ok: true,
    flow: "proxima",
    observedSlot: observed.slot,
    ...observed.checked,
  });
  if (["check", "plan", "verify"].includes(input.command)) return result();
  if (input.command === "report") {
    const a = launchAddresses(identity);
    const state = observed.state;
    const report = buildLaunchReport({
      cluster: input.cluster,
      programId: deployment.programId,
      observedSlot: observed.slot,
      config: state.config,
      machine: state.machine,
      ledger: state.ledger,
      mint: state.mint,
      pool: state.pool,
      dbcConfigAccount: state.dbc,
      expectedDbcConfig: a.dbcConfig,
      migrationQuoteThreshold: threshold,
      vault: state.vault,
      launchTokenAccounts: state.launchTokens,
      ...(input.lut ? { launchLookupTable: new PublicKey(input.lut) } : {}),
      landedForm: "proxima-separate",
      signatures: [],
    });
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const path = join(
      options.directory,
      `proxima-${input.cluster}-${identity.mint.toBase58()}-report.json`,
    );
    await writeFile(
      path,
      `${launchJson({ ...report, evidence: "finalized-account-state", externalLaunch: "Proxima", ...observed.checked })}\n`,
      { mode: 0o600 },
    );
    return { ...report, evidence: "finalized-account-state", reportFile: path };
  }
  if (!["set-mint", "stock-up", "deposit", "power-on"].includes(input.command))
    throw new OpsError("proxima_command_invalid");
  const command = input.command as Record["command"];
  const policy =
    options.localPolicy ??
    (input.cluster === "devnet"
      ? devnetLaunchPolicy(input.cluster)
      : readLaunchPolicy());
  if (!policy) throw new OpsError("launch_landing_policy_unavailable");
  if (!wallet || input.confirm !== identity.mint.toBase58().slice(0, 8))
    throw new OpsError("proxima_signer_or_confirmation_required");
  if (command === "set-mint" && !wallet.publicKey.equals(config.admin))
    throw new OpsError("proxima_admin_required");
  if (command === "set-mint" && poolCreator && !observed.checked.launchVerified)
    throw new OpsError("proxima_launch_not_created");
  if (
    ["deposit", "power-on"].includes(command) &&
    !wallet.publicKey.equals(config.launchWallet)
  )
    throw new OpsError("proxima_launch_wallet_required");
  const complete = () =>
    command === "set-mint"
      ? observed.checked.stage !== "set-mint"
      : command === "stock-up"
        ? !["set-mint", "stock-up"].includes(observed.checked.stage)
        : command === "deposit"
          ? ["power-on", "powered-on"].includes(observed.checked.stage)
          : observed.checked.stage === "powered-on";
  if (complete()) return { ...result(), reconciled: true };
  if (observed.checked.stage !== command)
    throw new OpsError(`proxima_requires_${observed.checked.stage}`);
  if (
    command === "stock-up" &&
    !("seasonReady" in observed.checked && observed.checked.seasonReady)
  )
    throw new OpsError("proxima_season_not_ready");
  const requireSetMintReady = async () => {
    if (command !== "set-mint") return;
    observed = await read(observed.slot);
    if (observed.checked.stage !== "set-mint")
      throw new OpsError("proxima_state_changed");
    if (poolCreator && !observed.checked.launchVerified)
      throw new OpsError("proxima_launch_not_created");
    if (
      !decodeLaunchConfig(
        observed.state.config,
        deployment.programId,
      ).admin.equals(wallet.publicKey)
    )
      throw new OpsError("proxima_admin_required");
  };
  const id = [
    input.cluster,
    input.program,
    input.dbcConfig,
    identity.mint.toBase58(),
    identity.wallet.toBase58(),
    wallet.publicKey.toBase58(),
    threshold.toString(),
    ...(poolCreator ? ["pool-creator", poolCreator.toBase58()] : []),
  ].join(":");
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const path = join(
    options.directory,
    `proxima-${createHash("sha256").update(id).digest("hex")}-${command}.json`,
  );
  const lock = await open(`${path}.lock`, "wx", 0o600).catch(() => {
    throw new OpsError("proxima_operation_locked");
  });
  let landing: Awaited<ReturnType<typeof loadLandingClient>> | null = null;
  try {
    let record: Record | null = null;
    try {
      record = recordSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw new OpsError("proxima_journal_invalid");
    }
    const core = coreInstructions(command, identity, wallet.publicKey);
    if (!record) {
      observed = await read(observed.slot);
      if (observed.checked.stage !== command)
        throw new OpsError("proxima_state_changed");
      const writable = [
        ...new Set([
          wallet.publicKey.toBase58(),
          ...(policy.landing.tipLamports > 0n ? [tipRecipient.toBase58()] : []),
          ...core.flatMap((ix) =>
            ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey.toBase58()),
          ),
        ]),
      ]
        .sort()
        .slice(0, 128)
        .map((key) => new PublicKey(key));
      const microLamports = launchPriorityPrice(
        await rpc.getRecentPrioritizationFees({
          lockedWritableAccounts: writable,
        }),
        policy.landing.maxComputeUnitPriceMicroLamports,
      ).toString();
      const fees = {
        units: 1_400_000,
        microLamports,
        tipLamports: policy.landing.tipLamports.toString(),
      };
      const latest = await rpc.getLatestBlockhash("confirmed");
      const diagnostic = await rpc.simulateTransaction(
        transaction(core, wallet.publicKey, latest.blockhash, fees),
        { sigVerify: false, replaceRecentBlockhash: true },
      );
      if (diagnostic.value.err || !diagnostic.value.unitsConsumed)
        throw new OpsError("proxima_simulation_failed");
      fees.units = Math.min(
        1_400_000,
        Math.ceil(
          (diagnostic.value.unitsConsumed *
            (BPS_DENOMINATOR + policy.landing.cuMarginBps)) /
            BPS_DENOMINATOR,
        ),
      );
      const tx = transaction(core, wallet.publicKey, latest.blockhash, fees);
      if (tx.serialize().length > TX_LIMITS.maxTxBytes)
        throw new OpsError("proxima_transaction_too_large");
      const simulated = await rpc.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (simulated.value.err) throw new OpsError("proxima_simulation_failed");
      await requireLaunchCluster(rpc, input);
      await requireSetMintReady();
      tx.sign([wallet]);
      record = {
        command,
        identity: id,
        ...fees,
        encoded: Buffer.from(tx.serialize()).toString("base64"),
        signature: anchor.utils.bytes.bs58.encode(tx.signatures[0]!),
        lastValidBlockHeight: latest.lastValidBlockHeight,
      };
      await writeFile(`${path}.new`, `${launchJson(record)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(`${path}.new`, path);
    }
    if (
      record.identity !== id ||
      record.command !== command ||
      BigInt(record.microLamports) >
        policy.landing.maxComputeUnitPriceMicroLamports ||
      BigInt(record.tipLamports) !== policy.landing.tipLamports
    )
      throw new OpsError("proxima_journal_identity_mismatch");
    const signed = VersionedTransaction.deserialize(
      Buffer.from(record.encoded, "base64"),
    );
    const expected = transaction(
      core,
      wallet.publicKey,
      signed.message.recentBlockhash,
      record,
    );
    if (
      !Buffer.from(signed.message.serialize()).equals(
        Buffer.from(expected.message.serialize()),
      ) ||
      anchor.utils.bytes.bs58.encode(signed.signatures[0]!) !== record.signature
    )
      throw new OpsError("proxima_journal_invalid");
    if (input.cluster === "mainnet") landing = await loadLandingClient();
    options.emit({
      event: "proxima_signed",
      command,
      signature: record.signature,
      journal: path,
    });
    await rebroadcastLaunchAttempt(
      rpc,
      {
        form: "single",
        signatures: [record.signature],
        encodedTransactions: [record.encoded],
        lastValidBlockHeight: record.lastValidBlockHeight,
      },
      {
        assertCluster: async () => {
          await requireLaunchCluster(rpc, input);
          await requireSetMintReady();
        },
        emit: options.emit,
        sleep,
        submit: (encoded) =>
          landing
            ? landing.sendSingle(encoded)
            : rpc.sendRawTransaction(Buffer.from(encoded, "base64"), {
                skipPreflight: false,
                maxRetries: 0,
              }),
      },
    );
    while (true) {
      const status = (
        await rpc.getSignatureStatuses([record.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (status?.err) throw new OpsError("proxima_transaction_failed");
      if (status?.confirmationStatus === "finalized") {
        observed = await read(status.slot);
        if (!complete()) throw new OpsError("proxima_postcondition_failed");
        return { ...result(), signature: record.signature, journal: path };
      }
      if ((await rpc.getBlockHeight("finalized")) > record.lastValidBlockHeight)
        throw new OpsError("proxima_reconciliation_required");
      await sleep(1_000);
    }
  } finally {
    await lock.close();
    await unlink(`${path}.lock`);
  }
}
