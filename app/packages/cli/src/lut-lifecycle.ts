import * as anchorNamespace from "@anchor-lang/core";
import * as config from "@onepercent/config";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { OpsError, parseBoundary, type CliInput } from "./input.js";
import type { OpsDependencies, OpsRpc } from "./runtime.js";
import { pda } from "./m1-adapter.js";

const anchor =
  (Reflect.get(anchorNamespace, "default") as
    typeof anchorNamespace | undefined) ?? anchorNamespace;
type LutCommand = Extract<
  CliInput["command"],
  { name: "lut-create" | "lut-extend" | "lut-freeze" }
>;
export interface LutHelpers {
  requireCluster(rpc: OpsRpc, cluster: CliInput["cluster"]): Promise<void>;
  unsigned(
    instructions: TransactionInstruction[],
    payer: PublicKey,
    blockhash: string,
  ): VersionedTransaction;
  simulate(
    rpc: OpsRpc,
    transaction: VersionedTransaction,
  ): Promise<{
    slot: number;
    ok: boolean;
    error: unknown;
    unitsConsumed: number | null;
  }>;
}
interface LutStep {
  instructions: TransactionInstruction[];
  added: PublicKey[];
  addressesAfter: PublicKey[];
  creates: boolean;
  freezes: boolean;
}
interface LutObservation {
  slot: number;
  table: AddressLookupTableAccount | null;
}
const slotSchema = z.number().int().nonnegative().safe();
const accountSchema = z.object({
  data: z.instanceof(Buffer),
  owner: z.instanceof(PublicKey),
  executable: z.boolean(),
  lamports: z.number().int().nonnegative().safe(),
});
const addressesEqual = (a: readonly PublicKey[], b: readonly PublicKey[]) =>
  a.length === b.length && a.every((value, index) => value.equals(b[index]!));

export function lutConfirmation(
  input: Pick<CliInput, "cluster" | "programId">,
  command: LutCommand,
  opsWallet: PublicKey,
  observedAddresses: readonly PublicKey[] = [],
): string {
  const programToken = `${input.programId.slice(0, 4)}${input.programId.slice(-4)}`;
  const intentHash = createHash("sha256")
    .update(
      JSON.stringify({
        cluster: input.cluster,
        programId: input.programId,
        action: command.name,
        lookupTable: command.name === "lut-create" ? null : command.address,
        addresses: command.addresses ?? [],
        observedAddresses: observedAddresses.map((address) =>
          address.toBase58(),
        ),
      }),
    )
    .digest("hex");
  return `${input.cluster}:${command.name}:${programToken}:${opsWallet.toBase58()}:${intentHash}`;
}

async function readLut(
  rpc: OpsRpc,
  address: PublicKey,
  minContextSlot = 0,
): Promise<LutObservation> {
  const response = parseBoundary(
    z.object({
      context: z.object({ slot: slotSchema }),
      value: accountSchema.nullable(),
    }),
    await rpc.getAccountInfoAndContext(address, {
      commitment: "finalized",
      minContextSlot,
    }),
  );
  if (response.context.slot < minContextSlot)
    throw new OpsError("lut_stale_finalized_read");
  if (response.value === null)
    return { slot: response.context.slot, table: null };
  const account = response.value;
  if (
    account.executable ||
    !account.owner.equals(AddressLookupTableProgram.programId)
  )
    throw new OpsError("lut_invalid_account_owner");
  try {
    const table = new AddressLookupTableAccount({
      key: address,
      state: AddressLookupTableAccount.deserialize(account.data),
    });
    if (table.state.addresses.length > 256)
      throw new Error("Invalid table length");
    return { slot: response.context.slot, table };
  } catch {
    throw new OpsError("lut_invalid_account_data");
  }
}

/** M1 §15.4 v1 protocol table, in its canonical published order. */
export function protocolLutAddresses(programId: PublicKey): PublicKey[] {
  return [
    pda("config", programId),
    pda("machine", programId),
    pda("deck", programId),
    pda("vault_auth", programId),
    SystemProgram.programId,
    SYSVAR_INSTRUCTIONS_PUBKEY,
  ];
}

async function requireOpsMembership(
  rpc: OpsRpc,
  programId: PublicKey,
  opsWallet: PublicKey,
) {
  // SWITCH to @onepercent/sdk when a decoder preserves these owner, exact-size
  // and version checks. configLayout.decode alone checks neither owner nor version.
  const account = parseBoundary(
    accountSchema.nullable(),
    await rpc.getAccountInfo(pda("config", programId), "finalized"),
  );
  const discriminator = createHash("sha256")
    .update("account:Config")
    .digest()
    .subarray(0, 8);
  if (
    !account ||
    account.executable ||
    !account.owner.equals(programId) ||
    account.data.length !== 872 ||
    !account.data.subarray(0, 8).equals(discriminator) ||
    account.data[736] !== 1
  )
    throw new OpsError("ops_wallet_config_invalid");
  const members = Array.from(
    { length: 8 },
    (_, index) =>
      new PublicKey(account.data.subarray(296 + index * 32, 328 + index * 32)),
  );
  if (!members.some((member) => member.equals(opsWallet)))
    throw new OpsError("ops_wallet_not_in_team_wallets");
}

async function readOpsWallet(
  rpc: OpsRpc,
  opsWallet: PublicKey,
): Promise<bigint> {
  const account = parseBoundary(
    accountSchema.nullable(),
    await rpc.getAccountInfo(opsWallet, "finalized"),
  );
  if (
    !account ||
    account.executable ||
    !account.owner.equals(SystemProgram.programId) ||
    account.data.length !== 0
  )
    throw new OpsError("ops_wallet_invalid_system_account");
  const governance: unknown = Reflect.get(config, "GOVERNANCE");
  const maxLamports: unknown =
    governance && typeof governance === "object"
      ? Reflect.get(governance, "opsWalletMaxLamports")
      : undefined;
  if (typeof maxLamports !== "bigint" || maxLamports <= 0n)
    throw new OpsError("ops_wallet_policy_unavailable");
  const balance = BigInt(account.lamports);
  if (balance > maxLamports)
    throw new OpsError("ops_wallet_balance_cap_exceeded");
  return balance;
}

/** Every first create transaction also adds an address; every last one freezes. */
function stepsFor(input: {
  table: PublicKey;
  authority: PublicKey;
  existing: PublicKey[];
  additions: PublicKey[];
  create?: TransactionInstruction;
  helpers: LutHelpers;
}): LutStep[] {
  const { table, authority, helpers } = input;
  const freeze = AddressLookupTableProgram.freezeLookupTable({
    lookupTable: table,
    authority,
  });
  const fits = (instructions: TransactionInstruction[]) => {
    try {
      helpers.unsigned(instructions, authority, PublicKey.default.toBase58());
      return true;
    } catch (error) {
      if (
        error instanceof OpsError &&
        error.code === "transaction_too_large_split_lut_extension"
      )
        return false;
      throw error;
    }
  };
  const steps: LutStep[] = [];
  const pending = [...input.additions];
  let current = [...input.existing];
  let prefix = input.create ? [input.create] : [];
  while (pending.length > 0) {
    let count = 0;
    let instruction: TransactionInstruction | null = null;
    for (let size = 1; size <= pending.length; size++) {
      const candidate = AddressLookupTableProgram.extendLookupTable({
        lookupTable: table,
        authority,
        payer: authority,
        addresses: pending.slice(0, size),
      });
      if (!fits([...prefix, candidate])) break;
      count = size;
      instruction = candidate;
    }
    if (!instruction || count === 0)
      throw new OpsError("lut_extension_cannot_fit");
    const added = pending.splice(0, count);
    current = [...current, ...added];
    steps.push({
      instructions: [...prefix, instruction],
      added,
      addressesAfter: current,
      creates: prefix.length > 0,
      freezes: false,
    });
    prefix = [];
  }
  const last = steps.at(-1);
  if (last && fits([...last.instructions, freeze])) {
    last.instructions.push(freeze);
    last.freezes = true;
  } else
    steps.push({
      instructions: [freeze],
      added: [],
      addressesAfter: current,
      creates: false,
      freezes: true,
    });
  return steps;
}

function verifyMutable(
  observed: LutObservation,
  expected: PublicKey[],
  authority: PublicKey,
) {
  if (
    !observed.table ||
    !observed.table.isActive() ||
    !observed.table.state.authority?.equals(authority)
  )
    throw new OpsError("lut_missing_inactive_or_wrong_authority");
  if (!addressesEqual(observed.table.state.addresses, expected))
    throw new OpsError("lut_contents_changed");
}
function verifyFrozen(observed: LutObservation, expected: PublicKey[]) {
  if (
    !observed.table ||
    !observed.table.isActive() ||
    observed.table.state.authority !== undefined
  )
    throw new OpsError("lut_not_finalized_frozen");
  if (!addressesEqual(observed.table.state.addresses, expected))
    throw new OpsError("lut_final_contents_mismatch");
}

/** Never advance to another blockhash until this signature has a final outcome. */
async function settleLutStep(input: {
  rpc: OpsRpc;
  deps: OpsDependencies;
  latest: { blockhash: string; lastValidBlockHeight: number };
  signature: string;
  lookupTable: PublicKey;
  expected: PublicKey[];
  freezes: boolean;
  opsWallet: PublicKey;
  minContextSlot: number;
}): Promise<{ status: "finalized" | "failed" | "expired"; slot: number }> {
  const { rpc, deps, latest, signature } = input;
  try {
    const confirmed = parseBoundary(
      z.object({
        context: z.object({ slot: slotSchema }),
        value: z.object({ err: z.unknown() }),
      }),
      await rpc.confirmTransaction({ ...latest, signature }, "finalized"),
    );
    return {
      status: confirmed.value.err === null ? "finalized" : "failed",
      slot: confirmed.context.slot,
    };
  } catch {
    // A timeout is ambiguous; retain the signature and reconcile history.
  }
  const history = async () =>
    parseBoundary(
      z.object({
        context: z.object({ slot: slotSchema }),
        value: z
          .array(
            z
              .object({
                slot: slotSchema,
                err: z.unknown(),
                confirmationStatus: z
                  .enum(["processed", "confirmed", "finalized"])
                  .optional()
                  .nullable(),
              })
              .nullable(),
          )
          .length(1),
      }),
      await rpc.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      }),
    );
  for (;;) {
    try {
      let state = await history();
      if (state.value[0]?.confirmationStatus === "finalized")
        return {
          status: state.value[0].err === null ? "finalized" : "failed",
          slot: state.context.slot,
        };
      const height = parseBoundary(
        slotSchema,
        await rpc.getBlockHeight("finalized"),
      );
      if (height > latest.lastValidBlockHeight) {
        state = await history();
        if (state.value[0]?.confirmationStatus === "finalized")
          return {
            status: state.value[0].err === null ? "finalized" : "failed",
            slot: state.context.slot,
          };
        if (state.value[0] === null) {
          const finalizedSlot = parseBoundary(
            slotSchema,
            await rpc.getSlot("finalized"),
          );
          const observed = await readLut(
            rpc,
            input.lookupTable,
            Math.max(input.minContextSlot, state.context.slot, finalizedSlot),
          );
          try {
            if (input.freezes) verifyFrozen(observed, input.expected);
            else verifyMutable(observed, input.expected, input.opsWallet);
            return { status: "finalized", slot: observed.slot };
          } catch {
            return { status: "expired", slot: observed.slot };
          }
        }
      }
    } catch {
      // RPC unavailability cannot prove finality or authorize the next step.
    }
    await (deps.sleep ?? sleep)(config.WEB.confirmPollMs);
  }
}

export async function runLutLifecycle(
  input: CliInput,
  rpc: OpsRpc,
  deps: OpsDependencies,
  helpers: LutHelpers,
) {
  const command = input.command;
  if (
    command.name !== "lut-create" &&
    command.name !== "lut-extend" &&
    command.name !== "lut-freeze"
  )
    throw new OpsError("invalid_lut_lifecycle_command");
  const opsWallet = new PublicKey(input.opsWallet!);
  const programId = new PublicKey(input.programId);
  await requireOpsMembership(rpc, programId, opsWallet);
  const observedOpsBalanceLamports = (
    await readOpsWallet(rpc, opsWallet)
  ).toString();
  let lookupTable: PublicKey;
  let create: TransactionInstruction | undefined;
  let existing: PublicKey[] = [];
  let additions: PublicKey[] = [];
  let initial: LutObservation;
  if (command.name === "lut-create") {
    additions = (command.addresses ?? []).map(
      (address) => new PublicKey(address),
    );
    if (additions.length === 0)
      throw new OpsError("lut_addresses_required_before_freeze");
    const recentSlot = parseBoundary(
      slotSchema,
      await rpc.getSlot("finalized"),
    );
    [create, lookupTable] = AddressLookupTableProgram.createLookupTable({
      authority: opsWallet,
      payer: opsWallet,
      recentSlot,
    });
    initial = await readLut(rpc, lookupTable);
    if (initial.table) throw new OpsError("lut_already_exists_use_extend");
  } else {
    if (command.name === "lut-freeze" && !command.addresses)
      throw new OpsError("lut_addresses_required_before_freeze");
    lookupTable = new PublicKey(command.address);
    initial = await readLut(rpc, lookupTable);
    if (!initial.table || !initial.table.isActive())
      throw new OpsError("lut_missing_or_inactive");
    existing = initial.table.state.addresses;
    if (command.name === "lut-extend") {
      additions = command.addresses.map((address) => new PublicKey(address));
      if (
        additions.some((address) =>
          existing.some((current) => current.equals(address)),
        )
      )
        throw new OpsError("duplicate_lut_address");
      verifyMutable(initial, existing, opsWallet);
    } else if (
      command.addresses &&
      !addressesEqual(
        existing,
        command.addresses.map((address) => new PublicKey(address)),
      )
    ) {
      throw new OpsError("lut_expected_contents_mismatch");
    }
  }
  const expected = [...existing, ...additions];
  if (expected.length === 0) throw new OpsError("lut_empty");
  if (expected.length > 256) throw new OpsError("lut_capacity_exceeded");
  if (!addressesEqual(expected, protocolLutAddresses(programId)))
    throw new OpsError("lut_protocol_contents_mismatch");
  const alreadyFrozen =
    initial.table?.state.authority === undefined && initial.table !== null;
  if (!alreadyFrozen && initial.table)
    verifyMutable(initial, existing, opsWallet);
  const steps = alreadyFrozen
    ? []
    : stepsFor({
        table: lookupTable,
        authority: opsWallet,
        existing,
        additions,
        create,
        helpers,
      });
  const confirmation = lutConfirmation(input, command, opsWallet, existing);
  const plan = {
    cluster: input.cluster,
    programId: input.programId,
    action: command.name,
    opsWallet: opsWallet.toBase58(),
    lookupTable: lookupTable.toBase58(),
    observedOpsBalanceLamports,
    existingAddresses: existing.map((address) => address.toBase58()),
    addressesAdded: additions.map((address) => address.toBase58()),
    finalAddresses: expected.map((address) => address.toBase58()),
    authorityAfter: null,
    transactions: steps.map((step) => ({
      creates: step.creates,
      adds: step.added.map((address) => address.toBase58()),
      freezes: step.freezes,
      bytes: helpers
        .unsigned(step.instructions, opsWallet, PublicKey.default.toBase58())
        .serialize().length,
    })),
    confirmation: { option: "--confirm-mainnet-lut", value: confirmation },
  };
  deps.emit?.({ event: "lut_plan", ...plan });
  if (alreadyFrozen) {
    verifyFrozen(initial, expected);
    return {
      cluster: input.cluster,
      mode: "lut-frozen",
      ok: true,
      alreadyFrozen: true,
      plan,
      simulation: null,
      signatures: [],
      finalizedVerification: {
        slot: initial.slot,
        authority: null,
        active: true,
        addresses: plan.finalAddresses,
      },
    };
  }
  if (input.lutConfirmation === undefined)
    return {
      cluster: input.cluster,
      mode: "lut-plan",
      ok: false,
      plan,
      simulation: null,
      signatures: [],
      requiresConfirmation: true,
    };
  if (input.lutConfirmation !== confirmation)
    throw new OpsError("lut_confirmation_mismatch");
  const typedConfirmation = `${input.programId.slice(0, 4)}${input.programId.slice(-4)}`;
  if (!deps.confirm) throw new OpsError("interactive_confirmation_required");
  const typed = await deps.confirm(
    `Cluster ${input.cluster}; program ${input.programId}; signer ${opsWallet.toBase58()}. Type ${typedConfirmation} to sign the displayed LUT plan.`,
    typedConfirmation,
  );
  if (typed !== typedConfirmation)
    throw new OpsError("typed_confirmation_mismatch");
  const keypairPath = parseBoundary(z.string().min(1), input.keypair);
  await helpers.requireCluster(rpc, input.cluster);
  let raw: unknown;
  try {
    raw = JSON.parse(await deps.readText(keypairPath)) as unknown;
  } catch {
    throw new OpsError("invalid_keypair_file");
  }
  const bytes = parseBoundary(
    z.array(z.number().int().min(0).max(255)).length(64),
    raw,
  );
  const secret = Uint8Array.from(bytes);
  let signer: Keypair;
  try {
    signer = Keypair.fromSecretKey(secret);
  } catch {
    secret.fill(0);
    throw new OpsError("invalid_keypair_file");
  } finally {
    bytes.fill(0);
    if (Array.isArray(raw)) raw.fill(0);
  }
  const signatures: {
    step: number;
    signature: string;
    status: "signed" | "submitted" | "finalized" | "failed" | "expired";
  }[] = [];
  const simulations: ({ step: number } & Awaited<
    ReturnType<LutHelpers["simulate"]>
  >)[] = [];
  let minContextSlot = initial.slot;
  let previous = existing;
  try {
    if (!signer.publicKey.equals(opsWallet))
      throw new OpsError("ops_wallet_keypair_mismatch");
    for (const [index, step] of steps.entries()) {
      const before = await readLut(rpc, lookupTable, minContextSlot);
      if (step.creates) {
        if (before.table) throw new OpsError("lut_appeared_before_create");
      } else verifyMutable(before, previous, opsWallet);
      await readOpsWallet(rpc, opsWallet);
      await requireOpsMembership(rpc, programId, opsWallet);
      const latest = parseBoundary(
        z.object({ blockhash: z.string(), lastValidBlockHeight: slotSchema }),
        await rpc.getLatestBlockhash("confirmed"),
      );
      const tx = helpers.unsigned(
        step.instructions,
        opsWallet,
        latest.blockhash,
      );
      const simulation = await helpers.simulate(rpc, tx);
      simulations.push({ step: index, ...simulation });
      deps.emit?.({
        event: "lut_simulation",
        lookupTable: lookupTable.toBase58(),
        step: index,
        ...simulation,
      });
      if (!simulation.ok) throw new OpsError("lut_simulation_failed");
      await readOpsWallet(rpc, opsWallet);
      await requireOpsMembership(rpc, programId, opsWallet);
      await helpers.requireCluster(rpc, input.cluster);
      tx.sign([signer]);
      const signature = anchor.utils.bytes.bs58.encode(tx.signatures[0]!);
      const attempt = {
        step: index,
        signature,
        status: "signed" as
          "signed" | "submitted" | "finalized" | "failed" | "expired",
      };
      signatures.push(attempt);
      deps.emit?.({
        event: "lut_transaction_prepared",
        lookupTable: lookupTable.toBase58(),
        ...attempt,
      });
      let submissionError: OpsError | undefined;
      try {
        const returned = await rpc.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        });
        if (returned !== signature)
          submissionError = new OpsError("lut_rpc_signature_mismatch");
        else attempt.status = "submitted";
      } catch {
        submissionError = new OpsError("lut_operation_failed");
      }
      const settled = await settleLutStep({
        rpc,
        deps,
        latest,
        signature,
        lookupTable,
        expected: step.addressesAfter,
        freezes: step.freezes,
        opsWallet,
        minContextSlot,
      });
      if (settled.status !== "finalized") {
        attempt.status = settled.status;
        throw (
          submissionError ??
          new OpsError(
            settled.status === "expired"
              ? "lut_transaction_expired"
              : "lut_transaction_failed",
          )
        );
      }
      attempt.status = "finalized";
      minContextSlot = Math.max(minContextSlot, settled.slot);
      const after = await readLut(rpc, lookupTable, minContextSlot);
      if (step.freezes) verifyFrozen(after, step.addressesAfter);
      else verifyMutable(after, step.addressesAfter, opsWallet);
      previous = step.addressesAfter;
    }
    const final = await readLut(rpc, lookupTable, minContextSlot);
    verifyFrozen(final, expected);
    return {
      cluster: input.cluster,
      mode: "lut-frozen",
      ok: true,
      alreadyFrozen: false,
      plan,
      simulation: null,
      signatures,
      simulations,
      finalizedVerification: {
        slot: final.slot,
        authority: null,
        active: true,
        addresses: plan.finalAddresses,
      },
    };
  } catch (error) {
    let observed: {
      slot: number;
      exists: boolean;
      authority: string | null;
      addresses: string[];
    } | null = null;
    try {
      const state = await readLut(rpc, lookupTable, minContextSlot);
      observed = {
        slot: state.slot,
        exists: state.table !== null,
        authority: state.table?.state.authority?.toBase58() ?? null,
        addresses:
          state.table?.state.addresses.map((address) => address.toBase58()) ??
          [],
      };
    } catch {
      /* Final state remains unknown until an operator reconciles it. */
    }
    return {
      cluster: input.cluster,
      mode: "lut-incomplete",
      ok: false,
      plan,
      simulation: null,
      signatures,
      simulations,
      observed,
      error: error instanceof OpsError ? error.code : "lut_operation_failed",
      requiresRecovery: true,
    };
  } finally {
    secret.fill(0);
  }
}
