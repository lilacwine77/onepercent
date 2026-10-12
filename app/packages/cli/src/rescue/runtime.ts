import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import {
  ONEPERCENT_PROGRAM_IDS,
  SERVICES,
  VRF,
  validateProgramIds,
  validateRescueParams,
  type ProgramCluster,
} from "@onepercent/config";
import { createDeploymentSelector } from "@onepercent/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  GET_EVERYTHING_BACK_ORDER,
  RescuePreconditionError,
  RpcScanRefusedError,
  readCore,
  readClock,
  readBinder,
  findDeckEntries,
  findOwnPulls,
  findOpenPulls,
  findPullsPaying,
  findMyVaultDeposits,
  planTakeBack,
  planRedeem,
  planRefund,
  planSettle,
  planCloseVaults,
  planWithdrawOwed,
  planCloseBinder,
  planAdvancePhase,
  phaseCrankState,
  planEverythingBackStage,
  type RescuePlan,
  type RescuePlanOptions,
  type RescueStage,
  type RescueRemaining,
} from "@onepercent/sdk/rescue";
import { parseRescueArgs, RescueCliError, type RescueInput } from "./input.js";
import { sendRescueTransaction, canRetryCardMoved } from "./send.js";

export function jsonRecord(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}
export function connectRescue(url: string): Connection {
  return new Connection(url, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
        redirect: "error",
      }),
  });
}
export interface RescueDependencies {
  connect(url: string): Connection;
  readText(path: string): Promise<string>;
  emit(record: Record<string, unknown>): void;
  confirm(): Promise<boolean>;
}
export const rescueDependencies: RescueDependencies = {
  connect: connectRescue,
  readText: (path) => readFile(path, "utf8"),
  emit: (record) => {
    process.stdout.write(`${jsonRecord(record)}\n`);
  },
  async confirm() {
    if (!process.stdin.isTTY || !process.stderr.isTTY)
      throw new RescueCliError("confirmation_requires_terminal", 4);
    const terminal = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return (
        (
          await terminal.question("Send the simulated transaction? Type yes: ")
        ).trim() === "yes"
      );
    } finally {
      terminal.close();
    }
  },
};

const GENESIS: Partial<Record<ProgramCluster, string>> = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};

function publishedProgramId(cluster: ProgramCluster): string | null {
  if (cluster === "localnet") return null;
  try {
    const published = validateProgramIds(ONEPERCENT_PROGRAM_IDS)[cluster];
    if (published && new PublicKey(published).toBase58() !== published)
      throw new Error();
    return published;
  } catch {
    throw new RescueCliError("invalid_deployment_program_id", 4);
  }
}

/** Published ids or an explicit --program, through the SDK deployment selector; never a guess. */
export function selectDeployment(input: RescueInput) {
  const published = publishedProgramId(input.cluster);
  const selected = input.program ?? published;
  if (!selected)
    throw new RescueCliError(
      "program_id_not_published_use_advanced_program",
      4,
    );
  const deployment = createDeploymentSelector({
    [input.cluster]: selected,
  })(input.cluster);
  return { deployment, custom: selected !== published };
}

/** The RPC must serve the selected cluster; a local validator is never mainnet or devnet. */
export async function checkCluster(rpc: Connection, cluster: ProgramCluster) {
  const genesis = await rpc.getGenesisHash();
  const expected = GENESIS[cluster];
  if (
    expected ? genesis !== expected : Object.values(GENESIS).includes(genesis)
  )
    throw new RescueCliError("rpc_cluster_mismatch", 4);
}

export async function readSigner(input: RescueInput, deps: RescueDependencies) {
  if (!input.signerFile) return undefined;
  let bytes: Uint8Array | undefined;
  try {
    const parsed: unknown = JSON.parse(await deps.readText(input.signerFile));
    bytes = Uint8Array.from(
      z.array(z.number().int().min(0).max(255)).length(64).parse(parsed),
    );
    const signer = Keypair.fromSecretKey(bytes);
    const ownedBytes = bytes;
    return { signer, clear: () => ownedBytes.fill(0) };
  } catch {
    bytes?.fill(0);
    throw new RescueCliError("invalid_signer_file", 4);
  }
}

export async function discoverWallet(
  rpc: Connection,
  programId: PublicKey,
  wallet: PublicKey,
) {
  const [binder, deck] = await Promise.all([
    readBinder(rpc, programId, wallet),
    findDeckEntries(rpc, programId, wallet),
  ]);
  const pulls = binder
    ? await findOwnPulls(rpc, programId, wallet, binder.pull_nonce)
    : [];
  const scanErrors: string[] = [];
  const optional = async <T>(kind: string, read: () => Promise<T>) => {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof RpcScanRefusedError)) throw error;
      scanErrors.push(kind);
      return null;
    }
  };
  const [paying, vaults] = await Promise.all([
    optional("paying", () => findPullsPaying(rpc, programId, wallet)),
    optional("vaults", () => findMyVaultDeposits(rpc, programId, wallet)),
  ]);
  return { wallet, deck, binder, pulls, paying, vaults, scanErrors };
}

export async function resolvePulls(
  input: RescueInput,
  rpc: Connection,
  programId: PublicKey,
): Promise<PublicKey[]> {
  if (input.paying)
    return (
      await findPullsPaying(rpc, programId, new PublicKey(input.paying))
    ).map((p) => p.address);
  const status = input.command === "refund" ? 1 : 2;
  if (input.allOpen || input.allDue) {
    const pulls = await findOpenPulls(rpc, programId, status);
    if (!input.allDue) return pulls.map((p) => p.address);
    const clock = await readClock(rpc);
    return pulls
      .filter(
        (p) => p.created_ts + BigInt(VRF.timeoutSeconds) <= clock.unixTimestamp,
      )
      .map((p) => p.address);
  }
  const selections = input.pulls ?? [];
  const needsSeqScan = selections.some((value) => /^\d+$/.test(value));
  const scanned = needsSeqScan
    ? await findOpenPulls(rpc, programId, status)
    : [];
  return selections.map((value) => {
    if (!/^\d+$/.test(value)) return new PublicKey(value);
    const pull = scanned.find((p) => p.seq === BigInt(value));
    if (!pull)
      throw new RescueCliError("pull_sequence_not_found_use_address", 4);
    return pull.address;
  });
}

export function pendingReport(
  plan: RescuePlan,
  laterStages: readonly string[],
  reason: string,
) {
  return [
    ...plan.remaining,
    ...plan.transactions.map((pending) => ({
      action: pending.action,
      addresses: pending.addresses,
      indices: pending.indices,
      details: pending.details,
      reason,
    })),
    ...laterStages.map((action) => ({
      action,
      reason: "Later stage not attempted",
    })),
  ];
}

type CommandStage = RescueStage | "close-vaults" | "advance-phase";
function commandStage(
  command: Exclude<RescueInput["command"], "status" | "find" | "all">,
): CommandStage {
  if (command === "close-my-cards") return "close-binder";
  if (command === "crank") return "advance-phase";
  return command;
}

/** Rebuild a stage from chain before every next transaction, never replay indices. */
export async function runRescue(
  args: readonly string[],
  deps: RescueDependencies = rescueDependencies,
): Promise<number> {
  const input = parseRescueArgs(args);
  validateRescueParams();
  const { deployment, custom } = selectDeployment(input);
  const programId = deployment.programId;
  const rpc = deps.connect(input.rpc);
  const emit = deps.emit;
  emit({
    type: "connection",
    rpcHost: new URL(input.rpc).host,
    programId,
    cluster: deployment.cluster,
    published: !custom,
    ...(custom
      ? {
          warning:
            "Custom or unpublished program selected. Check its identity and upgrade authority before signing.",
        }
      : {}),
  });
  await checkCluster(rpc, deployment.cluster);
  const core = await readCore(rpc, programId);
  if (input.command === "status") {
    emit({
      type: "status",
      ...core,
      phaseCrank: phaseCrankState({
        config: core.config,
        machine: core.machine,
        now: core.clock.unixTimestamp,
      }),
    });
    return 0;
  }
  emit({ type: "status", ...core });
  if (input.command === "find") {
    const positions = await discoverWallet(
      rpc,
      programId,
      new PublicKey(input.wallet!),
    );
    emit({ type: "positions", ...positions });
    return positions.scanErrors.length ? 3 : 0;
  }
  const signerHandle = await readSigner(input, deps);
  const signer = signerHandle?.signer;
  let sent = 0;
  let lastPlan: RescuePlan | undefined;
  let laterStages: readonly string[] = [];
  try {
    const wallet = signer?.publicKey ?? new PublicKey(input.wallet!);
    if (input.wallet && !wallet.equals(new PublicKey(input.wallet)))
      throw new RescueCliError("signer_wallet_mismatch", 4);
    emit({ type: "wallet", wallet });
    let indices = input.indices ? [...input.indices] : undefined;
    const expectedDeck =
      input.command === "take-back" && indices
        ? (await findDeckEntries(rpc, programId, wallet)).filter((row) =>
            indices!.includes(row.deckIndex),
          )
        : undefined;
    const expectedCards =
      input.command === "redeem" && indices
        ? ((await readBinder(rpc, programId, wallet))?.cards ?? [])
            .map((row, cardIndex) => ({ ...row, cardIndex }))
            .filter((row) => indices!.includes(row.cardIndex))
        : undefined;
    const pulls =
      input.command === "settle" || input.command === "refund"
        ? await resolvePulls(input, rpc, programId)
        : [];
    const stages: CommandStage[] =
      input.command === "all"
        ? [...GET_EVERYTHING_BACK_ORDER]
        : [commandStage(input.command)];
    const remaining: RescueRemaining[] = [];
    let previews = 0;
    let movedRetries = 0;
    for (const stage of stages) {
      laterStages = stages.slice(stages.indexOf(stage));
      let previousConfirmed: string | undefined;
      for (;;) {
        const block = await rpc.getLatestBlockhash("confirmed");
        const options: RescuePlanOptions = {
          rpc,
          programId,
          wallet,
          blockhash: block.blockhash,
        };
        let plan: RescuePlan;
        if (input.command === "all")
          plan = await planEverythingBackStage(options, stage as RescueStage);
        else if (stage === "take-back")
          plan = await planTakeBack({
            ...options,
            indices,
            expected: expectedDeck,
          });
        else if (stage === "redeem")
          plan = await planRedeem({
            ...options,
            indices,
            expected: expectedCards,
          });
        else if (stage === "settle")
          plan = await planSettle({ ...options, pulls });
        else if (stage === "refund")
          plan = await planRefund({ ...options, pulls });
        else if (stage === "withdraw-owed")
          plan = await planWithdrawOwed(options);
        else if (stage === "close-binder")
          plan = await planCloseBinder(options);
        else if (stage === "advance-phase")
          plan = await planAdvancePhase(options);
        else
          plan = await planCloseVaults({
            ...options,
            mints: input.mints?.map((mint) => new PublicKey(mint)),
          });
        lastPlan = plan;
        laterStages = stages.slice(stages.indexOf(stage) + 1);
        if (!plan.transactions.length) {
          if (stage === "advance-phase") {
            // A transition that is not due is a precondition, unless this run already cranked.
            const notDue = plan.remaining.filter((row) =>
              row.reason.startsWith("NoTransitionDue"),
            );
            if (notDue.length && sent === 0) {
              emit({
                type: "remaining",
                items: plan.remaining,
                sent,
                previews,
              });
              return 4;
            }
            remaining.push(
              ...plan.remaining.filter((row) => !notDue.includes(row)),
            );
            break;
          }
          remaining.push(...plan.remaining);
          break;
        }
        if (sent + previews >= input.max) {
          emit({
            type: "remaining",
            items: [
              ...remaining,
              ...pendingReport(
                plan,
                stages.slice(stages.indexOf(stage) + 1),
                "Transaction limit reached; refresh from chain to resume.",
              ),
            ],
            sent,
            previews,
          });
          return 2;
        }
        // Repeated identical work means the RPC has not reflected the confirmed transaction.
        const first = plan.transactions[0]!;
        const fingerprint = jsonRecord({
          action: first.action,
          addresses: first.addresses,
          indices: first.indices,
          message:
            first.transaction instanceof Object
              ? unsignedInstructions(first.transaction)
              : [],
        });
        if (fingerprint === previousConfirmed) {
          emit({
            type: "remaining",
            items: [
              ...remaining,
              ...pendingReport(
                plan,
                stages.slice(stages.indexOf(stage) + 1),
                "Confirmed state has not advanced; retry discovery with a current RPC.",
              ),
            ],
            sent,
            previews,
          });
          return 2;
        }
        const preview = input.dryRun || input.unsigned;
        const items = preview
          ? plan.transactions.slice(0, input.max - previews)
          : [first];
        let rebuild = false;
        for (const item of items) {
          const result = await sendRescueTransaction(
            {
              programId,
              rpc,
              signer,
              dryRun: input.dryRun,
              unsigned: input.unsigned,
              yes: input.yes,
              emit,
              confirm: deps.confirm,
            },
            item,
            block.lastValidBlockHeight,
          );
          if (result.signature) sent++;
          if (result.state === "card-moved") {
            if (canRetryCardMoved(movedRetries++)) {
              rebuild = true;
              break;
            }
            throw new RescueCliError("card_moved_retries_exhausted", 2);
          }
          if (result.state === "expired") {
            rebuild = true;
            break;
          }
          if (
            result.state === "ambiguous" ||
            result.state === "cancelled" ||
            result.state === "failed"
          ) {
            emit({
              type: "remaining",
              items: [
                ...remaining,
                ...pendingReport(
                  plan,
                  stages.slice(stages.indexOf(stage) + 1),
                  result.state === "ambiguous"
                    ? "Resolve the reported signature before retrying"
                    : "Not completed; refresh from chain before resuming",
                ),
              ],
              sent,
            });
            return result.state === "failed" && sent === 0 ? 4 : 2;
          }
          if (result.state === "preview") {
            previews++;
            continue;
          }
          movedRetries = 0;
          previousConfirmed = fingerprint;
          if (indices)
            indices = indices.filter((n) => !item.indices?.includes(n));
        }
        if (rebuild) continue;
        if (preview) {
          if (items.length < plan.transactions.length) {
            emit({
              type: "remaining",
              items: [
                ...remaining,
                ...pendingReport(
                  {
                    ...plan,
                    transactions: plan.transactions.slice(items.length),
                  },
                  stages.slice(stages.indexOf(stage) + 1),
                  "Preview transaction limit reached; refresh from chain to resume.",
                ),
              ],
              sent,
              previews,
            });
            return 2;
          }
          remaining.push(...plan.remaining);
          break;
        }
      }
    }
    if (input.command === "all" && !input.dryRun && !input.unsigned) {
      const latest = await discoverWallet(rpc, programId, wallet);
      emit({ type: "positions", ...latest });
      if (
        latest.binder &&
        !remaining.some((row) => row.action === "close-binder")
      )
        remaining.push({
          action: "close-binder",
          address: latest.binder.address.toBase58(),
          reason:
            "The Binder remains in the final chain read; refresh and resume.",
        });
      if (
        latest.binder &&
        latest.binder.sol_owed > 0n &&
        !remaining.some((row) => row.action === "withdraw-owed")
      )
        remaining.push({
          action: "withdraw-owed",
          address: latest.binder.address.toBase58(),
          reason:
            "Owed SOL remains in the final chain read; refresh and resume.",
        });
      for (const vault of latest.vaults ?? [])
        if (
          !remaining.some(
            (row) =>
              row.action === "close-vault" &&
              row.address === vault.mint.toBase58(),
          )
        )
          remaining.push({
            action: "close-vault",
            address: vault.mint.toBase58(),
            reason: vault.closable
              ? "A closable vault deposit remains in the final chain read."
              : "Comes back when that coin's vault is empty and unlisted",
          });
      if (latest.deck.length)
        remaining.push({
          action: "take-back",
          reason:
            "Deck entries remain in the final chain read; refresh and resume.",
        });
      if (latest.binder?.cards.length)
        remaining.push({
          action: "redeem",
          reason:
            "Cards remain in the final chain read; a reveal may have arrived during recovery.",
        });
      for (const pull of latest.pulls)
        remaining.push({
          action: pull.status === 1 ? "refund" : "settle",
          address: pull.address.toBase58(),
          reason: "Pull remains open in the final chain read.",
        });
      for (const pull of latest.paying ?? [])
        remaining.push({
          action: "settle",
          address: pull.address.toBase58(),
          reason:
            "An unsettled Pull still pays this wallet in the final chain read.",
        });
      for (const scan of latest.scanErrors)
        remaining.push({
          action: scan === "paying" ? "settle" : "close-vault",
          reason: "rpc_scan_refused: final discovery was incomplete",
        });
    }
    if (input.dryRun || input.unsigned)
      emit({
        type: "preview",
        reason:
          "No transaction sent. Later stages may depend on earlier transactions; rerun after each confirmed stage.",
      });
    emit({ type: "remaining", items: remaining, sent, previews });
    if (remaining.some((item) => item.reason.includes("rpc_scan_refused")))
      return 3;
    return remaining.length ? 2 : 0;
  } catch (error) {
    if (sent > 0) {
      emit({
        type: "remaining",
        sent,
        error: rescueExit(error).code,
        items: lastPlan
          ? pendingReport(
              lastPlan,
              laterStages,
              "Last observed plan; execution state is uncertain until a fresh chain read succeeds.",
            )
          : [],
        reason:
          "Execution stopped after signed transactions. Check the reported signatures and refresh positions from chain before resuming.",
      });
      return 2;
    }
    throw error;
  } finally {
    signerHandle?.clear();
  }
}

// Omit the changing blockhash while retaining the exact instruction identity.
function unsignedInstructions(tx: import("@onepercent/sdk").BuiltTransaction) {
  if ("instructions" in tx)
    return tx.instructions.map((ix) => ({
      programId: ix.programId,
      keys: ix.keys,
      data: ix.data.toString("base64"),
    }));
  return {
    keys: tx.message.staticAccountKeys,
    instructions: tx.message.compiledInstructions,
  };
}

export function rescueExit(error: unknown): { code: string; exitCode: number } {
  if (error instanceof RescueCliError)
    return { code: error.code, exitCode: error.exitCode };
  if (error instanceof RpcScanRefusedError)
    return { code: "rpc_scan_refused", exitCode: 3 };
  if (error instanceof RescuePreconditionError)
    return { code: error.code, exitCode: 4 };
  return { code: "rescue_failed", exitCode: 1 };
}
