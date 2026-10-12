import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import * as config from "@onepercent/config";
import { readFile } from "node:fs/promises";
import { SERVICES, SOLANA_GENESIS_HASHES as GENESIS } from "@onepercent/config";
import { configLayout } from "@onepercent/sdk";
import * as squads from "@sqds/multisig";
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import {
  OpsError,
  initParamsSchema,
  parseBoundary,
  parseCli,
  type CliInput,
  publicKeySchema,
} from "./input.js";
import {
  loadHitlistExtension,
  type ExtensionLoader,
  type PreparedExtension,
} from "./extensions.js";
import {
  adminConfigInstruction,
  guardianInstruction,
  initializeInstruction,
  verifyDraftInstruction,
  programDataPda,
  pda,
} from "./m1-adapter.js";
import { runLutLifecycle } from "./lut-lifecycle.js";
import {
  decodeExtensionInstruction,
  verifyExtensionInstructions,
} from "./extension-instructions.js";

export { GENESIS };

export type OpsRpc = Pick<
  Connection,
  | "getGenesisHash"
  | "getLatestBlockhash"
  | "getSlot"
  | "getBlockTime"
  | "getBlockHeight"
  | "getSignatureStatuses"
  | "getAddressLookupTable"
  | "getAccountInfo"
  | "getAccountInfoAndContext"
  | "simulateTransaction"
  | "sendRawTransaction"
  | "confirmTransaction"
>;
export interface MultisigState {
  transactionIndex: bigint;
  timeLock: number;
  threshold: number;
  members: { key: PublicKey; permissions: { mask: number } }[];
}
export interface OpsDependencies {
  connect(url: string): OpsRpc;
  readText(path: string): Promise<string>;
  readMultisig(rpc: OpsRpc, address: PublicKey): Promise<MultisigState>;
  confirm?(prompt: string, expected: string): Promise<string>;
  sleep?(ms: number): Promise<void>;
  emit?(record: Record<string, unknown>): void;
}

export const defaultDependencies: OpsDependencies = {
  sleep,
  async confirm(prompt, expected) {
    if (!process.stdin.isTTY || !process.stderr.isTTY)
      throw new OpsError("confirmation_requires_terminal");
    const terminal = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return await terminal.question(`${prompt}\nType ${expected}: `);
    } finally {
      terminal.close();
    }
  },
  emit(record) {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  },
  connect(url) {
    return new Connection(url, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
        }),
    });
  },
  readText: (path) => readFile(path, "utf8"),
  async readMultisig(rpc, address) {
    const account = await rpc.getAccountInfo(address, "confirmed");
    if (
      !account ||
      account.executable ||
      !account.owner.equals(squads.PROGRAM_ID) ||
      !account.data
        .subarray(0, 8)
        .equals(Buffer.from(squads.accounts.multisigDiscriminator))
    )
      throw new OpsError("invalid_squads_account");
    const [state] = squads.accounts.Multisig.fromAccountInfo(account);
    return {
      transactionIndex: BigInt(state.transactionIndex.toString()),
      timeLock: state.timeLock,
      threshold: state.threshold,
      members: state.members,
    };
  },
};

function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OpsError("invalid_json_file");
  }
}
async function requireCluster(rpc: OpsRpc, cluster: CliInput["cluster"]) {
  if ((await rpc.getGenesisHash()) !== GENESIS[cluster])
    throw new OpsError("rpc_cluster_mismatch");
}

export interface OperationPlan {
  instructions: TransactionInstruction[];
  lookupTable?: string;
}

async function validateSeason(input: CliInput, rpc: OpsRpc) {
  if (input.command.name !== "set-season") return;
  const slot = input.command.snapshotSlot;
  const finalized = parseBoundary(
    z.number().int().nonnegative().safe(),
    await rpc.getSlot("finalized"),
  );
  if (slot <= 0n || slot > BigInt(finalized))
    throw new OpsError("season_slot_not_finalized");
  const timestamp = await rpc.getBlockTime(Number(slot));
  if (timestamp === null) throw new OpsError("season_block_time_unknown");
  if (
    !Number.isSafeInteger(timestamp) ||
    BigInt(timestamp) !== input.command.snapshotTs
  )
    throw new OpsError("season_ts_mismatch");
}

async function readInit(
  input: CliInput,
  deps: Pick<OpsDependencies, "readText">,
) {
  if (input.command.name !== "init") return undefined;
  const params = parseBoundary(
    initParamsSchema,
    readJson(await deps.readText(input.command.path)),
  );
  const governance: unknown = Reflect.get(config, "GOVERNANCE");
  const maximum: unknown =
    governance && typeof governance === "object"
      ? Reflect.get(governance, "initRentBufferMaxLamports")
      : undefined;
  if (typeof maximum !== "bigint" || maximum <= 0n)
    throw new OpsError("init_rent_buffer_limit_unavailable");
  if (params.rent_buffer_lamports > maximum)
    throw new OpsError("init_rent_buffer_exceeded");
  if (input.cluster === "mainnet" && input.multisig !== undefined) {
    const [vault] = squads.getVaultPda({
      multisigPda: new PublicKey(input.multisig!),
      index: input.vaultIndex,
    });
    if (params.admin !== vault.toBase58())
      throw new OpsError("init_admin_must_be_vault");
  }
  return params;
}

export function verifyOperationInstruction(
  input: CliInput,
  instruction: TransactionInstruction,
  initParams?: z.infer<typeof initParamsSchema>,
) {
  if (input.command.name === "extension")
    return decodeExtensionInstruction(
      instruction,
      new PublicKey(input.programId),
    );
  if (!instruction.programId.equals(new PublicKey(input.programId)))
    throw new OpsError("instruction_program_mismatch");
  const command = input.command;
  switch (command.name) {
    case "init":
      if (!initParams) throw new OpsError("init_params_missing");
      return verifyDraftInstruction(instruction, {
        instruction: "initialize",
        action: null,
        args: initParams,
      });
    case "set-season":
      return verifyDraftInstruction(instruction, {
        instruction: "admin_config",
        action: "setSeason",
        args: {
          snapshot_slot: command.snapshotSlot,
          snapshot_ts: command.snapshotTs,
          stock_up_ts: command.stockUpTs,
        },
      });
    case "role":
      return verifyDraftInstruction(instruction, {
        instruction: "admin_config",
        action: "setRole",
        args: { role: command.role, key: command.publicKey },
      });
    case "guardian": {
      const action = Object.keys(command.action)[0]!;
      return verifyDraftInstruction(instruction, {
        instruction: "guardian",
        action,
        args: Object.values(command.action)[0],
      });
    }
    default:
      throw new OpsError("instruction_decode_failed");
  }
}

export function publicSignature(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let result = "";
  while (number > 0n) {
    result = alphabet[Number(number % 58n)]! + result;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result;
}

async function buildDraftOperation(
  input: CliInput,
  authority: PublicKey,
  rpc: OpsRpc,
  deps: Pick<OpsDependencies, "readText">,
  initParams?: z.infer<typeof initParamsSchema>,
): Promise<OperationPlan> {
  const programId = new PublicKey(input.programId);
  const command = input.command;
  switch (command.name) {
    case "extension":
      throw new OpsError("extension_builder_required");
    case "init": {
      const params = initParams ?? (await readInit(input, deps))!;
      return {
        instructions: [
          initializeInstruction({
            programId,
            authority,
            programData: programDataPda(programId),
            params,
          }),
        ],
      };
    }
    case "set-season":
      return {
        instructions: [
          adminConfigInstruction({
            programId,
            admin: authority,
            action: {
              setSeason: {
                snapshot_slot: command.snapshotSlot,
                snapshot_ts: command.snapshotTs,
                stock_up_ts: command.stockUpTs,
              },
            },
          }),
        ],
      };
    case "role":
      return {
        instructions: [
          adminConfigInstruction({
            programId,
            admin: authority,
            action: {
              setRole: {
                role: command.role,
                key: new PublicKey(command.publicKey),
              },
            },
          }),
        ],
      };
    case "guardian":
      return {
        instructions: [
          guardianInstruction({
            programId,
            signer: authority,
            action: command.action,
          }),
        ],
      };
    case "lut-create": {
      const recentSlot = parseBoundary(
        z.number().int().positive().safe(),
        await rpc.getSlot("finalized"),
      );
      const [instruction, address] =
        AddressLookupTableProgram.createLookupTable({
          authority,
          payer: authority,
          recentSlot,
        });
      return { instructions: [instruction], lookupTable: address.toBase58() };
    }
    case "lut-extend":
    case "lut-freeze": {
      const lookupTable = new PublicKey(command.address);
      const table = (
        await rpc.getAddressLookupTable(lookupTable, {
          commitment: "confirmed",
        })
      ).value;
      if (
        !table ||
        !table.key.equals(lookupTable) ||
        !table.state.authority?.equals(authority) ||
        !table.isActive()
      )
        throw new OpsError("lut_missing_inactive_or_wrong_authority");
      if (command.name === "lut-freeze") {
        if (table.state.addresses.length === 0) throw new OpsError("lut_empty");
        return {
          instructions: [
            AddressLookupTableProgram.freezeLookupTable({
              lookupTable,
              authority,
            }),
          ],
          lookupTable: command.address,
        };
      }
      const existing = new Set(
        table.state.addresses.map((address) => address.toBase58()),
      );
      if (command.addresses.some((address) => existing.has(address)))
        throw new OpsError("duplicate_lut_address");
      if (existing.size + command.addresses.length > 256)
        throw new OpsError("lut_capacity_exceeded");
      return {
        instructions: [
          AddressLookupTableProgram.extendLookupTable({
            lookupTable,
            authority,
            payer: authority,
            addresses: command.addresses.map(
              (address) => new PublicKey(address),
            ),
          }),
        ],
        lookupTable: command.address,
      };
    }
  }
}

export async function buildOperation(
  input: CliInput,
  authority: PublicKey,
  rpc: OpsRpc,
  deps: Pick<OpsDependencies, "readText">,
  initParams?: z.infer<typeof initParamsSchema>,
): Promise<OperationPlan> {
  const checkedInit = initParams ?? (await readInit(input, deps));
  const plan = await buildDraftOperation(
    input,
    authority,
    rpc,
    deps,
    checkedInit,
  );
  if (!input.command.name.startsWith("lut-")) {
    for (const instruction of plan.instructions)
      verifyOperationInstruction(input, instruction, checkedInit);
  }
  return plan;
}

function unsigned(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
) {
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(),
  );
  try {
    if (tx.serialize().length > 1232)
      throw new OpsError("transaction_too_large_split_lut_extension");
  } catch (error) {
    if (error instanceof OpsError) throw error;
    throw new OpsError("transaction_too_large_split_lut_extension");
  }
  return tx;
}

const simulationSchema = z.object({
  context: z.object({ slot: z.number().int().nonnegative().safe() }),
  value: z.object({
    err: z.unknown(),
    unitsConsumed: z.number().int().nonnegative().optional(),
  }),
});
function safeSimulationError(error: unknown) {
  if (error === null) return null;
  const custom = z
    .object({
      InstructionError: z.tuple([
        z.number().int().nonnegative(),
        z.strictObject({ Custom: z.number().int().nonnegative() }),
      ]),
    })
    .safeParse(error);
  if (custom.success) return custom.data;
  // Only protocol-defined symbolic error names are safe to echo. Unknown provider
  // text may contain its URL or credentials, including inside simulation errors.
  const names = z.enum([
    "AccountNotFound",
    "BlockhashNotFound",
    "InvalidAccountForFee",
    "InsufficientFundsForFee",
    "InvalidInstructionData",
    "InvalidAccountData",
    "InvalidArgument",
    "IncorrectProgramId",
    "MissingRequiredSignature",
    "AccountAlreadyInitialized",
    "UninitializedAccount",
    "NotEnoughAccountKeys",
    "AccountBorrowFailed",
    "ReadonlyLamportChange",
    "ReadonlyDataModified",
    "PrivilegeEscalation",
    "ComputationalBudgetExceeded",
    "ProgramFailedToComplete",
    "ProgramFailedToCompile",
    "InvalidSeeds",
    "InvalidRealloc",
    "ArithmeticOverflow",
    "UnsupportedProgramId",
    "AccountInUse",
  ]);
  const top = names.safeParse(error);
  if (top.success) return top.data;
  const instruction = z
    .object({
      InstructionError: z.tuple([z.number().int().nonnegative(), names]),
    })
    .safeParse(error);
  return instruction.success ? instruction.data : "simulation_failed";
}
async function simulate(rpc: OpsRpc, tx: VersionedTransaction) {
  const result = parseBoundary(
    simulationSchema,
    await rpc.simulateTransaction(tx, {
      commitment: "confirmed",
      sigVerify: false,
    }),
  );
  return {
    slot: result.context.slot,
    ok: result.value.err === null,
    error: safeSimulationError(result.value.err),
    unitsConsumed: result.value.unitsConsumed ?? null,
  };
}

const serializedInstruction = (instruction: TransactionInstruction) => ({
  programId: instruction.programId.toBase58(),
  accounts: instruction.keys.map((key) => ({
    pubkey: key.pubkey.toBase58(),
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  })),
  dataBase64: instruction.data.toString("base64"),
});

async function currentMainnetAdmin(rpc: OpsRpc, programId: PublicKey) {
  const account = await rpc.getAccountInfo(
    pda("config", programId),
    "finalized",
  );
  if (
    !account ||
    account.executable ||
    !account.owner.equals(programId) ||
    account.data.length !== configLayout.size
  )
    throw new OpsError("mainnet_admin_config_invalid");
  let state;
  try {
    state = configLayout.decode(account.data);
  } catch {
    throw new OpsError("mainnet_admin_config_invalid");
  }
  if (state.version !== 1 || state.admin.equals(PublicKey.default))
    throw new OpsError("mainnet_admin_config_invalid");
  return state.admin;
}

/** D21/D23 isolate ops-wallet LUT, guardian and deployer signing. */
export async function runOps(
  argv: string[],
  deps: OpsDependencies = defaultDependencies,
  loadExtension: ExtensionLoader = loadHitlistExtension,
) {
  const input = parseCli(argv);
  const extension =
    input.command.name === "extension" ? await loadExtension() : null;
  const rpc = deps.connect(input.rpcUrl);
  await requireCluster(rpc, input.cluster);
  if (input.opsWallet)
    return runLutLifecycle(input, rpc, deps, {
      requireCluster,
      unsigned,
      simulate,
    });
  await validateSeason(input, rpc);
  const initParams = await readInit(input, deps);
  if (
    input.cluster === "mainnet" &&
    input.command.name === "init" &&
    input.multisig !== undefined
  )
    await deps.readMultisig(rpc, new PublicKey(input.multisig!));
  let prepared: PreparedExtension | null = null;
  if (extension && input.command.name === "extension") {
    const raw = await extension.prepare({
      cluster: input.cluster,
      programId: new PublicKey(input.programId),
      args: input.command.args,
      rpc: {
        getAccountInfo: rpc.getAccountInfo.bind(rpc),
        getSlot: rpc.getSlot.bind(rpc),
        getAddressLookupTable: rpc.getAddressLookupTable.bind(rpc),
      },
    });
    prepared = parseBoundary(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("report"),
          ok: z.boolean(),
          report: z.record(z.string(), z.json()),
        }),
        z.strictObject({
          kind: z.literal("transaction"),
          verifyIntent: z
            .custom<
              Extract<
                PreparedExtension,
                { kind: "transaction" }
              >["verifyIntent"]
            >((value) => typeof value === "function")
            .optional(),
          build: z.custom<(authority: PublicKey) => Promise<OperationPlan>>(
            (value) => typeof value === "function",
          ),
        }),
      ]),
      raw,
    );
    if (prepared.kind === "report")
      return {
        cluster: input.cluster,
        mode: "extension-report",
        ok: prepared.ok,
        report: prepared.report,
        simulation: null,
      };
  }
  // Extension modules return instructions; this runner remains the only signer
  // and always uses the same cluster, simulation and proposal checks.
  const makePlan = async (authority: PublicKey): Promise<OperationPlan> => {
    if (!prepared || prepared.kind !== "transaction")
      return buildOperation(input, authority, rpc, deps, initParams);
    const plan = parseBoundary(
      z.strictObject({
        instructions: z.array(z.instanceof(TransactionInstruction)).min(1),
        lookupTable: publicKeySchema.optional(),
      }),
      await prepared.build(authority),
    );
    if (
      plan.instructions.some((instruction) =>
        instruction.keys.some(
          (key) => key.isSigner && !key.pubkey.equals(authority),
        ),
      )
    )
      throw new OpsError("extension_foreign_signer");
    if (
      input.cluster === "mainnet" &&
      plan.instructions.some((instruction) =>
        instruction.programId.equals(AddressLookupTableProgram.programId),
      )
    )
      throw new OpsError("mainnet_lut_requires_ops_wallet_lifecycle");
    const decoded = verifyExtensionInstructions(
      plan.instructions,
      new PublicKey(input.programId),
      authority,
    );
    if (!prepared.verifyIntent)
      throw new OpsError("extension_intent_verifier_required");
    if (
      input.command.name !== "extension" ||
      prepared.verifyIntent(decoded, input.command.args) !== true
    )
      throw new OpsError("extension_intent_mismatch");
    return plan;
  };
  const localSigning =
    input.cluster === "devnet" ||
    input.keypair !== undefined ||
    input.command.name === "guardian" ||
    input.command.name === "init";
  if (localSigning) parseBoundary(z.string().min(1), input.keypair);
  else if (!input.adminAddress) {
    parseBoundary(publicKeySchema, input.multisig);
    parseBoundary(publicKeySchema, input.creator);
  }
  const latest = parseBoundary(
    z.strictObject({
      blockhash: z.string().refine((v) => {
        try {
          return new PublicKey(v).toBase58() === v;
        } catch {
          return false;
        }
      }),
      lastValidBlockHeight: z.number().int().nonnegative().safe(),
    }),
    await rpc.getLatestBlockhash("confirmed"),
  );
  if (input.adminAddress && !input.keypair) {
    const authority = await currentMainnetAdmin(
      rpc,
      new PublicKey(input.programId),
    );
    if (String(authority) !== input.adminAddress)
      throw new OpsError("mainnet_admin_signer_mismatch");
    const plan = await makePlan(authority);
    const tx = unsigned(plan.instructions, authority, latest.blockhash);
    const simulation = await simulate(rpc, tx);
    return {
      ok: simulation.ok,
      cluster: input.cluster,
      mode: "unsigned-admin-transaction",
      programId: input.programId,
      authority: input.adminAddress,
      ...latest,
      instructions: plan.instructions.map((instruction) => ({
        ...serializedInstruction(instruction),
        decoded: verifyOperationInstruction(input, instruction, initParams),
      })),
      unsignedTransactionBase64: Buffer.from(tx.serialize()).toString("base64"),
      simulation,
    };
  }
  if (localSigning) {
    // D31 authorizes the one current admin directly. Read its finalized identity
    // before opening a signer; simulation still checks the instruction on-chain.
    let admin: PublicKey | null = null;
    if (
      input.cluster === "mainnet" &&
      !["init", "guardian"].includes(input.command.name)
    ) {
      admin = await currentMainnetAdmin(rpc, new PublicKey(input.programId));
    }
    const bytes = parseBoundary(
      z.array(z.number().int().min(0).max(255)).length(64),
      readJson(await deps.readText(input.keypair!)),
    );
    const secret = Uint8Array.from(bytes);
    bytes.fill(0);
    let signer: Keypair;
    try {
      signer = Keypair.fromSecretKey(secret);
    } catch {
      secret.fill(0);
      throw new OpsError("invalid_keypair_file");
    }
    try {
      if (admin && !signer.publicKey.equals(admin))
        throw new OpsError("mainnet_admin_signer_mismatch");
      const plan = await makePlan(signer.publicKey);
      const decoded = input.command.name.startsWith("lut-")
        ? []
        : plan.instructions.map((instruction) =>
            verifyOperationInstruction(input, instruction, initParams),
          );
      const tx = unsigned(
        plan.instructions,
        signer.publicKey,
        latest.blockhash,
      );
      const simulation = await simulate(rpc, tx);
      if (!simulation.ok)
        return {
          cluster: input.cluster,
          mode: `${input.cluster}-not-sent`,
          simulation,
        };
      if (input.cluster === "mainnet") {
        const expected = `${input.programId.slice(0, 4)}${input.programId.slice(-4)}`;
        deps.emit?.({
          mode: "mainnet-local-plan",
          cluster: input.cluster,
          programId: input.programId,
          signer: signer.publicKey.toBase58(),
          instructions: plan.instructions.map((instruction, index) => ({
            ...serializedInstruction(instruction),
            decoded: decoded[index],
          })),
          simulation,
        });
        if (!deps.confirm) throw new OpsError("confirmation_requires_terminal");
        if (
          (await deps.confirm(
            "Confirm the displayed mainnet transaction",
            expected,
          )) !== expected
        )
          throw new OpsError("mainnet_confirmation_mismatch");
      }
      await requireCluster(rpc, input.cluster);
      tx.sign([signer]);
      const signature = publicSignature(tx.signatures[0]!);
      try {
        const returned = await rpc.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        });
        if (returned !== signature)
          throw new OpsError("rpc_signature_mismatch");
        const confirmed = await rpc.confirmTransaction(
          { ...latest, signature },
          "confirmed",
        );
        if (confirmed.value.err !== null)
          return {
            cluster: input.cluster,
            mode: `${input.cluster}-unconfirmed`,
            ok: false,
            signature,
            error: "transaction_confirmation_failed",
            simulation,
          };
      } catch (error) {
        return {
          cluster: input.cluster,
          mode: `${input.cluster}-unconfirmed`,
          ok: false,
          signature,
          error:
            error instanceof OpsError
              ? error.code
              : "transaction_confirmation_unknown",
          simulation,
        };
      }
      return {
        cluster: input.cluster,
        mode: `${input.cluster}-confirmed`,
        signature,
        authority: signer.publicKey.toBase58(),
        ...(plan.lookupTable ? { lookupTable: plan.lookupTable } : {}),
        simulation,
      };
    } finally {
      secret.fill(0);
    }
  }
  const multisigPda = new PublicKey(input.multisig!);
  const creator = new PublicKey(input.creator!);
  const state = await deps.readMultisig(rpc, multisigPda);
  if (state.transactionIndex < 0n || state.transactionIndex >= (1n << 64n) - 1n)
    throw new OpsError("invalid_squads_transaction_index");
  // Squads v4 Initiate permission is bit 0. No proposal is submitted here.
  if (
    !state.members.some(
      (member) =>
        member.key.equals(creator) &&
        squads.types.Permissions.has(
          member.permissions,
          squads.types.Permission.Initiate,
        ),
    )
  )
    throw new OpsError("squads_creator_cannot_initiate");
  const transactionIndex = state.transactionIndex + 1n;
  const [vault] = squads.getVaultPda({ multisigPda, index: input.vaultIndex });
  const plan = await makePlan(vault);
  const decoded = plan.instructions.map((instruction) =>
    verifyOperationInstruction(input, instruction, initParams),
  );
  const inner = unsigned(plan.instructions, vault, latest.blockhash);
  const simulation = await simulate(rpc, inner);
  const transactionMessage = new TransactionMessage({
    payerKey: vault,
    recentBlockhash: latest.blockhash,
    instructions: plan.instructions,
  });
  const create = squads.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex,
    creator,
    vaultIndex: input.vaultIndex,
    ephemeralSigners: 0,
    transactionMessage,
  });
  const propose = squads.instructions.proposalCreate({
    multisigPda,
    transactionIndex,
    creator,
    isDraft: false,
  });
  const createTx = unsigned([create], creator, latest.blockhash);
  const proposalTx = unsigned([propose], creator, latest.blockhash);
  const createSimulation = await simulate(rpc, createTx);
  const proposalSimulation = await simulate(rpc, proposalTx);
  let sequenceSimulation;
  try {
    const sequence = unsigned([create, propose], creator, latest.blockhash);
    sequenceSimulation = {
      ...(await simulate(rpc, sequence)),
      scope: "create_then_propose",
    };
  } catch (error) {
    if (
      !(error instanceof OpsError) ||
      error.code !== "transaction_too_large_split_lut_extension"
    )
      throw error;
    sequenceSimulation = {
      ok: false,
      slot: null,
      unitsConsumed: null,
      error: "squads_sequence_too_large",
      scope: "create_then_propose",
    };
  }
  const [transaction] = squads.getTransactionPda({
    multisigPda,
    index: transactionIndex,
  });
  const [proposal] = squads.getProposalPda({ multisigPda, transactionIndex });
  return {
    cluster: input.cluster,
    mode: "unsigned-squads-proposal",
    submitted: false,
    signed: false,
    ok: simulation.ok && createSimulation.ok && sequenceSimulation.ok,
    warnings: decoded.some(
      (row) =>
        row.instruction === "admin_config" &&
        row.action === "setRole" &&
        (row.args as { role: number }).role === 0,
    )
      ? ["admin_role_change"]
      : [],
    multisig: multisigPda.toBase58(),
    vault: vault.toBase58(),
    creator: creator.toBase58(),
    transactionIndex: transactionIndex.toString(),
    transaction: transaction.toBase58(),
    proposal: proposal.toBase58(),
    observedGovernance: {
      threshold: state.threshold,
      timeLockSeconds: state.timeLock,
      members: state.members.length,
    },
    latestBlockhash: latest,
    instructions: plan.instructions.map((instruction, index) => ({
      ...serializedInstruction(instruction),
      decoded: decoded[index],
    })),
    lookupTable: plan.lookupTable ?? null,
    simulation: {
      ...simulation,
      scope: "inner_vault_instructions",
      signatureVerification: false,
    },
    sequenceSimulation,
    unsignedTransactions: [
      {
        purpose: "vault_transaction_create",
        simulation: createSimulation,
        base64: Buffer.from(createTx.serialize()).toString("base64"),
      },
      {
        purpose: "proposal_create",
        dependsOn: "vault_transaction_create",
        simulation: proposalSimulation,
        base64: Buffer.from(proposalTx.serialize()).toString("base64"),
      },
    ],
  };
}
