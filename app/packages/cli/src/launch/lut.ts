import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import * as namespace from "@anchor-lang/core";
import { GOVERNANCE, TX_LIMITS, WEB } from "@onepercent/config";
import { launchLookupAddresses, DBC_PROGRAM_ID } from "@onepercent/sdk";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type {
  AccountInfo,
  Connection,
  Keypair,
  TransactionInstruction,
} from "@solana/web3.js";
import { z } from "zod";
import { OpsError } from "../input.js";
import { GENESIS } from "../runtime.js";
import {
  checkLaunchLookupTable,
  checkDbcLaunchConfig,
  decodeLaunchConfig,
  type AccountSnapshot,
} from "./checks.js";
import type { LaunchInput } from "./input.js";
import {
  migrationQuoteThreshold,
  selectLaunchDeployment,
  requireLaunchConfigPin,
} from "./input.js";

import { devnetPriorityInstructions } from "./devnet-transport.js";

const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
const defaultDirectory = fileURLToPath(
  new URL("../../../../reports/launch/", import.meta.url),
);
const signerSignature = (tx: VersionedTransaction) =>
  anchor.utils.bytes.bs58.encode(tx.signatures[0]!);
async function requireLutCluster(connection: Connection, input: LaunchInput) {
  const actual = await connection.getGenesisHash();
  if (input.cluster === "localnet") {
    if (
      Object.values(GENESIS).includes(actual as typeof GENESIS.mainnet) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(new URL(input.rpc).hostname)
    )
      throw new OpsError("launch_genesis_mismatch");
  } else if (actual !== GENESIS[input.cluster])
    throw new OpsError("launch_genesis_mismatch");
}
const slotSchema = z.number().int().nonnegative().safe();
const stepSchema = z.object({
  signature: z.string(),
  microLamports: z.string().optional(),
  blockhash: z.string(),
  lastValidBlockHeight: slotSchema,
  before: z.array(z.string()),
  after: z.array(z.string()),
  creates: z.boolean(),
  freezes: z.boolean(),
  status: z.enum(["signed", "submitted", "finalized", "expired", "failed"]),
});
const recordSchema = z.object({
  version: z.literal(1),
  cluster: z.string(),
  program: z.string(),
  mint: z.string(),
  launchWallet: z.string(),
  opsWallet: z.string(),
  lookupTable: z.string(),
  expected: z.array(z.string()),
  steps: z.array(stepSchema),
  complete: z.boolean(),
});
type LutRecord = z.infer<typeof recordSchema>;
type LutStepRecord = z.infer<typeof stepSchema>;
export interface LaunchLutStep {
  instructions: TransactionInstruction[];
  before: PublicKey[];
  after: PublicKey[];
  creates: boolean;
  freezes: boolean;
}
const equal = (left: readonly PublicKey[], right: readonly PublicKey[]) =>
  left.length === right.length &&
  left.every((value, index) => value.equals(right[index]!));
const txFor = (
  instructions: TransactionInstruction[],
  wallet: PublicKey,
  blockhash: string,
) =>
  new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(),
  );
function packetFits(
  instructions: TransactionInstruction[],
  wallet: PublicKey,
): boolean {
  try {
    return (
      txFor(instructions, wallet, PublicKey.default.toBase58()).serialize()
        .length <= TX_LIMITS.maxTxBytes
    );
  } catch {
    return false;
  }
}

/** Freeze is deliberately separate so the extension's slot has ended first. */
export function planLaunchLookupTableSteps(input: {
  table: PublicKey;
  wallet: PublicKey;
  existing: readonly PublicKey[];
  expected: readonly PublicKey[];
  create?: TransactionInstruction;
}): LaunchLutStep[] {
  if (
    input.expected.length === 0 ||
    input.expected.length > 256 ||
    new Set(input.expected.map(String)).size !== input.expected.length ||
    !equal(input.existing, input.expected.slice(0, input.existing.length))
  )
    throw new OpsError("launch_lut_expected_prefix_mismatch");
  const steps: LaunchLutStep[] = [];
  let before = [...input.existing];
  let prefix = input.create ? [input.create] : [];
  while (before.length < input.expected.length) {
    let count = 0;
    let selected: TransactionInstruction | undefined;
    const missing = input.expected.slice(before.length);
    for (let size = 1; size <= missing.length; size++) {
      const extend = AddressLookupTableProgram.extendLookupTable({
        lookupTable: input.table,
        authority: input.wallet,
        payer: input.wallet,
        addresses: missing.slice(0, size),
      });
      if (!packetFits([...prefix, extend], input.wallet)) break;
      count = size;
      selected = extend;
    }
    if (!selected || count === 0)
      throw new OpsError("launch_lut_extension_cannot_fit");
    const after = [...before, ...missing.slice(0, count)];
    steps.push({
      instructions: [...prefix, selected],
      before,
      after,
      creates: prefix.length > 0,
      freezes: false,
    });
    before = after;
    prefix = [];
  }
  steps.push({
    instructions: [
      AddressLookupTableProgram.freezeLookupTable({
        lookupTable: input.table,
        authority: input.wallet,
      }),
    ],
    before,
    after: before,
    creates: false,
    freezes: true,
  });
  return steps;
}

function snapshot(account: AccountInfo<Buffer> | null): AccountSnapshot | null {
  if (!account) return null;
  if (!Number.isSafeInteger(account.lamports) || account.lamports < 0)
    throw new OpsError("unsafe_rpc_lamports");
  return { ...account, lamports: BigInt(account.lamports) };
}
async function readTable(
  connection: Connection,
  address: PublicKey,
  minContextSlot?: number,
) {
  const result = await connection.getAccountInfoAndContext(address, {
    commitment: "finalized",
    ...(minContextSlot === undefined ? {} : { minContextSlot }),
  });
  if (!result.value) return { table: null, slot: result.context.slot };
  if (
    !result.value.owner.equals(AddressLookupTableProgram.programId) ||
    result.value.executable
  )
    throw new OpsError("launch_lut_account_owner");
  return {
    table: new AddressLookupTableAccount({
      key: address,
      state: AddressLookupTableAccount.deserialize(result.value.data),
    }),
    slot: result.context.slot,
  };
}
function mutablePrefix(
  table: AddressLookupTableAccount,
  wallet: PublicKey,
  expected: readonly PublicKey[],
) {
  if (!table.isActive() || !table.state.authority?.equals(wallet))
    throw new OpsError("launch_lut_authority_or_activity");
  if (
    !equal(
      table.state.addresses,
      expected.slice(0, table.state.addresses.length),
    )
  )
    throw new OpsError("launch_lut_expected_prefix_mismatch");
}

async function atomicRecord(path: string, record: LutRecord) {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** One history recheck after finalized expiry; ambiguity never permits a rebuild. */
async function reconcile(
  connection: Connection,
  tableAddress: PublicKey,
  record: LutStepRecord,
  wallet: PublicKey,
): Promise<"finalized" | "expired" | "failed" | "ambiguous"> {
  const history = async () =>
    (
      await connection.getSignatureStatuses([record.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
  const status = await history();
  if (status?.confirmationStatus === "finalized")
    return status.err === null ? "finalized" : "failed";
  const height = await connection.getBlockHeight("finalized");
  if (height <= record.lastValidBlockHeight) return "ambiguous";
  const recheck = await history();
  if (recheck?.confirmationStatus === "finalized")
    return recheck.err === null ? "finalized" : "failed";
  if (recheck) return "ambiguous";
  const finalSlot = await connection.getSlot("finalized");
  const observed = await readTable(connection, tableAddress, finalSlot);
  const before = record.before.map((value) => new PublicKey(value));
  const after = record.after.map((value) => new PublicKey(value));
  if (observed.table && equal(observed.table.state.addresses, after)) {
    if (
      record.freezes &&
      observed.table.state.authority === undefined &&
      observed.table.isActive()
    )
      return "finalized";
    if (
      !record.freezes &&
      observed.table.state.authority?.equals(wallet) &&
      observed.table.isActive()
    )
      return "finalized";
  }
  if (record.creates && observed.table === null) return "expired";
  if (
    !record.creates &&
    observed.table &&
    equal(observed.table.state.addresses, before) &&
    observed.table.state.authority?.equals(wallet) &&
    observed.table.isActive()
  )
    return "expired";
  return "ambiguous";
}

export async function createLaunchLookupTable(
  connection: Connection,
  input: LaunchInput,
  wallet: Keypair,
  configAccount: AccountSnapshot | null,
  emit: (record: Record<string, unknown>) => void,
  options: {
    directory?: string;
    sleep?: (milliseconds: number) => Promise<unknown>;
  } = {},
) {
  await requireLutCluster(connection, input);
  const deployment = selectLaunchDeployment(input);
  const programId = deployment.programId;
  const config = decodeLaunchConfig(configAccount, programId);
  if (
    !input.mint ||
    !config.tokenMint.equals(new PublicKey(input.mint)) ||
    config.tokenMint.equals(PublicKey.default)
  )
    throw new OpsError("launch_lut_config_mint_mismatch");
  if (config.launchWallet.equals(PublicKey.default))
    throw new OpsError("launch_lut_launch_wallet_missing");
  const configAddress = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[0];
  async function requirePayer() {
    const fresh = decodeLaunchConfig(
      snapshot(await connection.getAccountInfo(configAddress, "finalized")),
      programId,
    );
    if (
      !fresh.tokenMint.equals(config.tokenMint) ||
      !fresh.launchWallet.equals(config.launchWallet)
    )
      throw new OpsError("launch_lut_config_changed");
    if (input.cluster === "mainnet") {
      if (
        !fresh.teamWallets.some((address) => address.equals(wallet.publicKey))
      )
        throw new OpsError("launch_lut_ops_wallet_not_published");
      const cap = Reflect.get(GOVERNANCE, "opsWalletMaxLamports") as unknown;
      if (typeof cap !== "bigint" || cap <= 0n)
        throw new OpsError("ops_wallet_cap_unconfigured");
      const account = snapshot(
        await connection.getAccountInfo(wallet.publicKey, "finalized"),
      );
      if (
        !account ||
        !account.owner.equals(
          new PublicKey("11111111111111111111111111111111"),
        ) ||
        account.data.length !== 0 ||
        account.executable ||
        account.lamports > cap
      )
        throw new OpsError("ops_wallet_balance_cap_or_account");
    }
  }
  await requirePayer();
  if (!input.dbcConfig) throw new OpsError("launch_dbc_config_required");
  const dbcConfig = requireLaunchConfigPin(deployment, input.dbcConfig);
  const dbc = snapshot(await connection.getAccountInfo(dbcConfig, "finalized"));
  if (!dbc?.owner.equals(DBC_PROGRAM_ID))
    throw new OpsError("launch_dbc_config_owner");
  checkDbcLaunchConfig(dbc, {
    feeIn: PublicKey.findProgramAddressSync(
      [Buffer.from("fee_in")],
      programId,
    )[0],
    migrationQuoteThreshold: migrationQuoteThreshold(input),
    cluster: input.cluster,
  });
  const expected = launchLookupAddresses({
    deployment,
    wallet: config.launchWallet,
    mint: config.tokenMint,
    name: "Rehearsal",
    symbol: "TEST",
    uri: "https://example.invalid/launch.json",
    maxSolCost: 1n,
    blockhash: PublicKey.default.toBase58(),
    computeUnitLimit: 1,
    computeUnitPriceMicroLamports: 0n,
    tip: {
      recipient: new PublicKey("4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE"),
      lamports: 0n,
    },
  });
  const recentSlot = await connection.getSlot("finalized");
  const [create, derivedAddress] = AddressLookupTableProgram.createLookupTable({
    authority: wallet.publicKey,
    payer: wallet.publicKey,
    recentSlot,
  });
  const tableAddress = input.lut ? new PublicKey(input.lut) : derivedAddress;
  const directory = options.directory ?? defaultDirectory;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(
    directory,
    `lut-${input.cluster}-${tableAddress.toBase58()}.json`,
  );
  const lockPath = join(
    directory,
    `lut-${input.cluster}-${input.program}-${config.tokenMint.toBase58()}.lock`,
  );
  const lock = await open(lockPath, "wx", 0o600).catch(() => {
    throw new OpsError("launch_lut_operation_locked");
  });
  let record: LutRecord = {
    version: 1,
    cluster: input.cluster,
    program: input.program,
    mint: config.tokenMint.toBase58(),
    launchWallet: config.launchWallet.toBase58(),
    opsWallet: wallet.publicKey.toBase58(),
    lookupTable: tableAddress.toBase58(),
    expected: expected.map(String),
    steps: [],
    complete: false,
  };
  const incompatibleTable = () => ({
    ok: false as const,
    lookupTable: tableAddress.toBase58(),
    recordPath: path,
    checks: [
      {
        id: "lut_dbc_accounts_mismatch",
        status: "NO-GO" as const,
        detail:
          "The lookup table does not match the DBC launch accounts; prepare a new frozen lookup table.",
        value: { dbcConfig: dbcConfig.toBase58() },
      },
    ],
  });
  try {
    if (!input.lut) {
      for (const name of await readdir(directory)) {
        if (
          !name.startsWith(`lut-${input.cluster}-`) ||
          !name.endsWith(".json")
        )
          continue;
        const previous = recordSchema.parse(
          JSON.parse(await readFile(join(directory, name), "utf8")),
        );
        if (
          previous.program === record.program &&
          previous.mint === record.mint &&
          !previous.complete &&
          previous.steps.length > 0
        ) {
          // A create that never landed has no table to resume. Its address uses
          // the old recent slot, so retain its journal and create a fresh table
          // only after repeating finalized expiry, history and absence checks.
          const first = previous.steps[0]!;
          if (
            previous.steps.length === 1 &&
            first.creates &&
            !first.freezes &&
            first.before.length === 0 &&
            ["signed", "submitted", "expired"].includes(first.status) &&
            previous.lookupTable !== record.lookupTable
          ) {
            const previousAddress = new PublicKey(previous.lookupTable);
            const reconciled = await reconcile(
              connection,
              previousAddress,
              first,
              new PublicKey(previous.opsWallet),
            );
            if (reconciled === "expired") {
              const finalizedSlot = await connection.getSlot("finalized");
              const finalState = await readTable(
                connection,
                previousAddress,
                finalizedSlot,
              );
              if (finalState.table === null) {
                first.status = "expired";
                await atomicRecord(join(directory, name), previous);
                emit({
                  event: "launch_lut_expired_creation_retained",
                  lookupTable: previous.lookupTable,
                  recordPath: join(directory, name),
                  signature: first.signature,
                  observedSlot: finalState.slot,
                });
                continue;
              }
            }
          }
          emit({
            event: "launch_lut_resume_required",
            lookupTable: previous.lookupTable,
            recordPath: join(directory, name),
          });
          throw new OpsError("launch_lut_resume_recorded_table_required");
        }
      }
    }
    try {
      const previous = recordSchema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
      if (
        [
          "cluster",
          "program",
          "mint",
          "launchWallet",
          "opsWallet",
          "lookupTable",
        ].some(
          (field) =>
            Reflect.get(previous, field) !== Reflect.get(record, field),
        )
      )
        throw new OpsError("launch_lut_record_identity_mismatch");
      if (JSON.stringify(previous.expected) !== JSON.stringify(record.expected))
        return incompatibleTable();
      record = previous;
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        Reflect.get(error, "code") === "ENOENT"
      ))
        throw error;
    }
    if (input.lut) {
      const supplied = await readTable(connection, tableAddress);
      if (
        supplied.table &&
        supplied.table.state.authority === undefined &&
        !equal(supplied.table.state.addresses, expected)
      )
        return incompatibleTable();
    }
    await atomicRecord(path, record); // Address and intent survive any later interruption.
    emit({
      event: "launch_lut_recorded",
      lookupTable: record.lookupTable,
      path,
      opsWallet: record.opsWallet,
      launchWallet: record.launchWallet,
      expected: record.expected,
    });
    const pending = record.steps.at(-1);
    if (
      pending &&
      (pending.status === "signed" || pending.status === "submitted")
    ) {
      const status = await reconcile(
        connection,
        tableAddress,
        pending,
        wallet.publicKey,
      );
      if (status === "ambiguous")
        throw new OpsError("launch_lut_ambiguous_signature_do_not_rebuild");
      pending.status = status;
      await atomicRecord(path, record);
      if (status === "failed")
        throw new OpsError("launch_lut_previous_transaction_failed");
    }
    let observed = await readTable(connection, tableAddress);
    if (
      observed.table?.state.authority === undefined &&
      observed.table !== null
    ) {
      if (!equal(observed.table.state.addresses, expected))
        return incompatibleTable();
      const verified = checkLaunchLookupTable({
        table: observed.table,
        expectedAddresses: expected,
        currentSlot: observed.slot,
      });
      record.complete = true;
      await atomicRecord(path, record);
      return {
        ok: true as const,
        lookupTable: record.lookupTable,
        recordPath: path,
        alreadyFrozen: true,
        verified,
      };
    }
    if (observed.table)
      mutablePrefix(observed.table, wallet.publicKey, expected);
    if (!observed.table && input.lut)
      throw new OpsError("launch_lut_resume_account_missing");
    const steps = planLaunchLookupTableSteps({
      table: tableAddress,
      wallet: wallet.publicKey,
      existing: observed.table?.state.addresses ?? [],
      expected,
      ...(!observed.table ? { create } : {}),
    });
    for (const step of steps) {
      await requirePayer();
      observed = await readTable(connection, tableAddress, observed.slot);
      if (
        step.creates
          ? observed.table !== null
          : !observed.table ||
            !equal(observed.table.state.addresses, step.before)
      )
        throw new OpsError("launch_lut_state_changed");
      if (observed.table)
        mutablePrefix(observed.table, wallet.publicKey, expected);
      if (step.freezes) {
        while (observed.slot <= observed.table!.state.lastExtendedSlot) {
          emit({
            event: "launch_lut_waiting_for_next_slot",
            lookupTable: record.lookupTable,
            lastExtendedSlot: observed.table!.state.lastExtendedSlot,
          });
          await (options.sleep ?? sleep)(WEB.confirmPollMs);
          observed = await readTable(connection, tableAddress, observed.slot);
          if (!observed.table) throw new OpsError("launch_lut_disappeared");
          mutablePrefix(observed.table, wallet.publicKey, expected);
        }
        if (!equal(observed.table!.state.addresses, expected))
          throw new OpsError("launch_lut_freeze_contents_changed");
      }
      const latest = await connection.getLatestBlockhash("confirmed");
      const priority =
        input.cluster === "devnet"
          ? await devnetPriorityInstructions(
              connection,
              input.cluster,
              wallet.publicKey,
              step.instructions,
            )
          : null;
      const tx = txFor(
        priority?.instructions ?? step.instructions,
        wallet.publicKey,
        latest.blockhash,
      );
      if (tx.serialize().length > TX_LIMITS.maxTxBytes)
        throw new OpsError("launch_lut_transaction_too_large");
      const simulation = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        minContextSlot: observed.slot,
      });
      if (simulation.value.err !== null)
        throw new OpsError("launch_lut_simulation_failed");
      await requireLutCluster(connection, input);
      tx.sign([wallet]);
      const attempt: LutStepRecord = {
        ...latest,
        signature: signerSignature(tx),
        ...(priority
          ? { microLamports: priority.microLamports.toString() }
          : {}),
        before: step.before.map(String),
        after: step.after.map(String),
        creates: step.creates,
        freezes: step.freezes,
        status: "signed",
      };
      record.steps.push(attempt);
      await atomicRecord(path, record);
      emit({
        event: "launch_lut_signed",
        lookupTable: record.lookupTable,
        signature: attempt.signature,
        bytes: tx.serialize().length,
        freezes: step.freezes,
      });
      await requireLutCluster(connection, input);
      try {
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        });
        if (signature !== attempt.signature)
          throw new OpsError("launch_lut_signature_mismatch");
        attempt.status = "submitted";
        await atomicRecord(path, record);
        const confirmed = await connection.confirmTransaction(
          { ...latest, signature },
          "finalized",
        );
        observed.slot = Math.max(observed.slot, confirmed.context.slot);
        attempt.status = confirmed.value.err === null ? "finalized" : "failed";
      } catch {
        const status = await reconcile(
          connection,
          tableAddress,
          attempt,
          wallet.publicKey,
        );
        if (status === "ambiguous")
          throw new OpsError("launch_lut_ambiguous_signature_do_not_rebuild");
        attempt.status = status;
      }
      await atomicRecord(path, record);
      if (attempt.status !== "finalized")
        throw new OpsError(`launch_lut_transaction_${attempt.status}`);
      observed = await readTable(connection, tableAddress, observed.slot);
      if (!observed.table || !equal(observed.table.state.addresses, step.after))
        throw new OpsError("launch_lut_post_state_mismatch");
      if (!step.freezes)
        mutablePrefix(observed.table, wallet.publicKey, expected);
    }
    const verified = checkLaunchLookupTable({
      table: observed.table,
      expectedAddresses: expected,
      currentSlot: observed.slot,
    });
    record.complete = true;
    await atomicRecord(path, record);
    return {
      ok: true as const,
      lookupTable: record.lookupTable,
      recordPath: path,
      alreadyFrozen: false,
      signatures: record.steps
        .filter((step) => step.status === "finalized")
        .map((step) => step.signature),
      verified,
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
