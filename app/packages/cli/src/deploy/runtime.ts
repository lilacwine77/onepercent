import { readFile, realpath, stat } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as constants from "@onepercent/config";
import { configLayout, machineLayout } from "@onepercent/sdk";
import type { Config } from "@onepercent/sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AccountInfo, TransactionInstruction } from "@solana/web3.js";
import { z } from "zod";
import { OpsError, parseBoundary } from "../input.js";
import {
  adminConfigInstruction,
  decodeDraftInstruction,
  initializeInstruction,
  pda,
  programDataPda,
  UPGRADEABLE_LOADER,
} from "../m1-adapter.js";
import { GENESIS, publicSignature } from "../runtime.js";
import { deploymentInitSchema, parseDeploymentInput } from "./input.js";
import type { DeploymentInit, DeploymentInput } from "./input.js";

type Rpc = Pick<
  Connection,
  | "getGenesisHash"
  | "getSlot"
  | "getBlockTime"
  | "getMultipleAccountsInfoAndContext"
  | "getLatestBlockhash"
  | "simulateTransaction"
  | "sendRawTransaction"
  | "confirmTransaction"
>;
export type DeploymentDependencies = {
  connect(url: string): Rpc;
  readText(path: string): Promise<string>;
  readSigner(path: string): Promise<Keypair>;
  emit(record: Record<string, unknown>): void;
};
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
export async function readExternalSigner(path: string): Promise<Keypair> {
  const resolved = await realpath(path);
  const within = relative(await realpath(root), resolved);
  if (within === "" || (!within.startsWith("..") && !isAbsolute(within)))
    throw new OpsError("deployment_signer_must_be_outside_repository");
  const info = await stat(resolved);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new OpsError("deployment_signer_permissions");
  let bytes: number[] = [];
  try {
    bytes = parseBoundary(
      z.array(z.number().int().min(0).max(255)).length(64),
      JSON.parse(await readFile(resolved, "utf8")),
    );
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw new OpsError("deployment_signer_invalid");
  } finally {
    bytes.fill(0);
  }
}
const defaults: DeploymentDependencies = {
  connect: (url) =>
    new Connection(url, {
      commitment: "finalized",
      disableRetryOnRateLimit: true,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(
            constants.SERVICES.transport.rpcTimeoutMs,
          ),
        }),
    }),
  readText: (path) => readFile(path, "utf8"),
  readSigner: readExternalSigner,
  emit: (record) => process.stderr.write(`${JSON.stringify(record)}\n`),
};
export function deploymentAddresses(program: PublicKey) {
  const protocolLutAddresses = [
    pda("config", program),
    pda("machine", program),
    pda("deck", program),
    pda("vault_auth", program),
    SystemProgram.programId,
    SYSVAR_INSTRUCTIONS_PUBKEY,
  ].map(String);
  return {
    program: String(program),
    programData: String(programDataPda(program)),
    config: protocolLutAddresses[0],
    machine: protocolLutAddresses[1],
    deck: protocolLutAddresses[2],
    vaultAuth: protocolLutAddresses[3],
    feeIn: String(pda("fee_in", program)),
    protocolLutAddresses,
  };
}
export function verifyProgramAuthority(
  program: AccountInfo<Buffer> | null,
  programData: AccountInfo<Buffer> | null,
  address: PublicKey,
) {
  if (
    !program ||
    !programData ||
    !program.executable ||
    programData.executable ||
    !program.owner.equals(UPGRADEABLE_LOADER) ||
    !programData.owner.equals(UPGRADEABLE_LOADER) ||
    program.data.length !== 36 ||
    program.data.readUInt32LE(0) !== 2 ||
    !new PublicKey(program.data.subarray(4)).equals(programDataPda(address)) ||
    programData.data.length < 45 ||
    programData.data.readUInt32LE(0) !== 3 ||
    programData.data[12] !== 1
  )
    throw new OpsError("deployment_program_or_authority_invalid");
  return new PublicKey(programData.data.subarray(13, 45));
}
export function verifyConfig(
  config: Config,
  init: DeploymentInit,
  admin: string,
) {
  const keys = [
    "keeper",
    "executor",
    "intake_signer",
    "quote_signer",
    "launch_wallet",
    "team_wallet",
    "token_mint",
  ] as const;
  if (
    config.version !== 1 ||
    String(config.admin) !== admin ||
    keys.some((key) => String(config[key]) !== init.params[key]) ||
    config.guardians.some(
      (key, index) => String(key) !== init.params.guardians[index],
    ) ||
    config.team_wallets.some(
      (key, index) => String(key) !== init.params.team_wallets[index],
    ) ||
    String(config.vrf_queues[config.active_queue]) !== init.params.vrf_queue ||
    config.admin_paused !== 0 ||
    config.guardian_paused !== 0 ||
    config.disabled_roles !== 0
  )
    throw new OpsError("deployment_config_mismatch");
}
async function requireCluster(rpc: Rpc, input: DeploymentInput) {
  const observed = await rpc.getGenesisHash();
  if (input.cluster === "localnet") {
    if (Object.values(GENESIS).some((hash) => hash === observed))
      throw new OpsError("rpc_cluster_mismatch");
  } else if (observed !== GENESIS[input.cluster])
    throw new OpsError("rpc_cluster_mismatch");
}
async function state(rpc: Rpc, program: PublicKey, minContextSlot?: number) {
  const result = await rpc.getMultipleAccountsInfoAndContext(
    [
      program,
      programDataPda(program),
      pda("config", program),
      pda("machine", program),
    ],
    {
      commitment: "finalized",
      ...(minContextSlot === undefined ? {} : { minContextSlot }),
    },
  );
  const [p, pd, c, m] = result.value;
  const upgradeAuthority = verifyProgramAuthority(
    p ?? null,
    pd ?? null,
    program,
  );
  for (const [account, length] of [
    [c, configLayout.size],
    [m, machineLayout.size],
  ] as const)
    if (
      account &&
      (account.executable ||
        !account.owner.equals(program) ||
        account.data.length !== length)
    )
      throw new OpsError("deployment_state_account_invalid");
  if (Boolean(c) !== Boolean(m))
    throw new OpsError("deployment_state_incomplete");
  return {
    slot: result.context.slot,
    upgradeAuthority,
    config: c ? configLayout.decode(c.data) : null,
    machine: m ? machineLayout.decode(m.data) : null,
  };
}
function publicState(observed: Awaited<ReturnType<typeof state>>) {
  return {
    slot: observed.slot,
    upgradeAuthority: String(observed.upgradeAuthority),
    admin: observed.config ? String(observed.config.admin) : null,
    phase: observed.machine?.phase ?? null,
    seasonSet: observed.config?.season_set ?? null,
  };
}
export async function runDeployment(argv: string[], deps = defaults) {
  const input = parseDeploymentInput(argv);
  let json: unknown;
  try {
    json = JSON.parse(await deps.readText(input.init));
  } catch {
    throw new OpsError("deployment_init_file_invalid");
  }
  const init = parseBoundary(deploymentInitSchema, json);
  const program = new PublicKey(input.program);
  if (input.cluster === "mainnet") {
    const ids: unknown = Reflect.get(constants, "ONEPERCENT_PROGRAM_IDS");
    if (
      !ids ||
      typeof ids !== "object" ||
      Reflect.get(ids, "mainnet") !== input.program
    )
      throw new OpsError("deployment_mainnet_program_not_pinned");
  }
  const addresses = deploymentAddresses(program);
  if (["validate", "addresses"].includes(input.command))
    return {
      ok: true,
      cluster: input.cluster,
      founderAdmin: init.founder_admin,
      deployer: init.params.admin,
      opsWallet: init.ops_wallet,
      ...addresses,
    };
  const rpc = deps.connect(input.rpc);
  await requireCluster(rpc, input);
  if (input.command === "season-point") {
    const slot = await rpc.getSlot("finalized");
    const ts = await rpc.getBlockTime(slot);
    if (ts === null) throw new OpsError("season_block_time_unknown");
    return { ok: true, slot, ts };
  }
  const before = await state(rpc, program);
  if (input.command === "check") {
    const expected =
      input.stage === "handoff" ? init.founder_admin : init.params.admin;
    if (String(before.upgradeAuthority) !== expected)
      throw new OpsError("deployment_upgrade_authority_mismatch");
    if (input.stage === "deployed") {
      if (before.config) throw new OpsError("deployment_already_initialized");
    } else {
      if (!before.config) throw new OpsError("deployment_not_initialized");
      verifyConfig(before.config, init, expected);
    }
    return { ok: true, ...addresses, ...publicState(before) };
  }
  let instruction: TransactionInstruction;
  if (input.command === "init") {
    if (String(before.upgradeAuthority) !== init.params.admin)
      throw new OpsError("deployment_init_requires_upgrade_authority");
    if (before.config) {
      verifyConfig(before.config, init, init.params.admin);
      return { ok: true, alreadyApplied: true, ...publicState(before) };
    }
    instruction = initializeInstruction({
      programId: program,
      authority: new PublicKey(init.params.admin),
      programData: programDataPda(program),
      params: init.params,
    });
  } else {
    if (!before.config || !before.machine)
      throw new OpsError("deployment_not_initialized");
    if (
      input.command === "transfer-admin" &&
      String(before.config.admin) === init.founder_admin
    ) {
      verifyConfig(before.config, init, init.founder_admin);
      return { ok: true, alreadyApplied: true, ...publicState(before) };
    }
    verifyConfig(before.config, init, init.params.admin);
    if (input.command === "set-season") {
      if (
        BigInt(input.slot!) > BigInt(await rpc.getSlot("finalized")) ||
        (await rpc.getBlockTime(input.slot!)) !== input.ts
      )
        throw new OpsError("deployment_season_not_finalized_or_mismatch");
      if (before.config.season_set !== 0 || before.machine.phase !== 0)
        throw new OpsError("deployment_season_already_set_or_wrong_phase");
    }
    instruction = adminConfigInstruction({
      programId: program,
      admin: new PublicKey(init.params.admin),
      action:
        input.command === "transfer-admin"
          ? { setRole: { role: 0, key: new PublicKey(init.founder_admin) } }
          : {
              setSeason: {
                snapshot_slot: BigInt(input.slot!),
                snapshot_ts: BigInt(input.ts!),
                stock_up_ts: BigInt(input.stockUpTs!),
              },
            },
    });
  }
  const latest = await rpc.getLatestBlockhash("finalized");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: new PublicKey(init.params.admin),
      recentBlockhash: latest.blockhash,
      instructions: [instruction],
    }).compileToV0Message(),
  );
  if (tx.serialize().length > constants.TX_LIMITS.maxTxBytes)
    throw new OpsError("deployment_transaction_too_large");
  const simulation = await rpc.simulateTransaction(tx, {
    commitment: "finalized",
    sigVerify: false,
  });
  if (simulation.value.err !== null)
    throw new OpsError("deployment_simulation_failed");
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        program: input.program,
        command: input.command,
        init: json,
        data: instruction.data.toString("base64"),
        keys: instruction.keys.map((key) => ({
          ...key,
          pubkey: String(key.pubkey),
        })),
      }),
    )
    .digest("hex");
  const confirmation = `${input.program}:${input.command}:${digest}`;
  deps.emit({
    mode: "deployment-plan",
    cluster: input.cluster,
    ...addresses,
    signer: init.params.admin,
    instruction: decodeDraftInstruction(instruction),
    confirmation,
  });
  if (input.confirm !== confirmation)
    throw new OpsError("deployment_confirmation_required");
  await requireCluster(rpc, input);
  const signer = await deps.readSigner(input.wallet!);
  if (String(signer.publicKey) !== init.params.admin)
    throw new OpsError("deployment_signer_mismatch");
  tx.sign([signer]);
  const signature = publicSignature(tx.signatures[0]!);
  deps.emit({ mode: "deployment-signature", signature });
  let slot: number;
  try {
    if (
      (await rpc.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "finalized",
        maxRetries: 0,
      })) !== signature
    )
      throw new OpsError("deployment_signature_mismatch");
    const confirmed = await rpc.confirmTransaction(
      { signature, ...latest },
      "finalized",
    );
    if (confirmed.value.err !== null)
      throw new OpsError("deployment_transaction_failed");
    slot = confirmed.context.slot;
  } catch {
    return {
      ok: false,
      signature,
      error: "deployment_reconcile_signature_before_retry",
    };
  }
  const after = await state(rpc, program, slot);
  if (!after.config) throw new OpsError("deployment_not_initialized");
  verifyConfig(
    after.config,
    init,
    input.command === "transfer-admin" ? init.founder_admin : init.params.admin,
  );
  if (
    input.command === "set-season" &&
    (after.config.season_set !== 1 ||
      after.config.snapshot_slot !== BigInt(input.slot!) ||
      after.config.snapshot_ts !== BigInt(input.ts!) ||
      after.config.stock_up_ts !== BigInt(input.stockUpTs!))
  )
    throw new OpsError("deployment_season_postcondition_failed");
  return { ok: true, signature, ...addresses, ...publicState(after) };
}
