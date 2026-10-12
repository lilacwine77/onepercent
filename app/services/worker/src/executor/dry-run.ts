import { warnCause } from "@onepercent/service-kit";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  EXECUTOR_POLICY,
  SERVICES,
  parseProgramCluster,
} from "@onepercent/config";
import { createDeploymentSelector } from "@onepercent/sdk";
import { JsonRpcClient, createTxRpc } from "@onepercent/service-kit";
import { executorP1 } from "./p1.js";
import {
  assertSwapMode,
  checkPlan,
  composeExecutor,
  stubSwap,
} from "./compose.js";
import { ExecutorSource } from "./source.js";
import { planExecutor } from "./policy.js";
import { executorTransport } from "./transport.js";
import { jupiterSwap } from "./jupiter.js";

/** No key loader, journal, signer, or submission transport is reachable here. */
export async function executorDryRun(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  const index = args.indexOf("--cluster");
  const input = index >= 0 ? args[index + 1] : env.CLUSTER;
  if (!input) throw new Error("executor_cluster_required");
  const cluster = parseProgramCluster(input);
  assertSwapMode(cluster, env.EXECUTOR_SWAP ?? "jupiter");
  const landing = executorTransport(cluster, SERVICES.landing);
  if (
    landing.tipLamports === null ||
    landing.maxComputeUnitPriceMicroLamports === null
  )
    return (["burn", "jackpot"] as const).map((kind) => ({
      kind,
      cluster,
      status: "blocked",
      reason: "executor_landing_parameters_pending",
      signed: false,
      sent: false,
    }));
  if (!env.PROGRAM_ID || !env.RPC_URL || !env.PROTOCOL_LOOKUP_TABLE)
    throw new Error("executor_read_configuration_required");
  const deployment = createDeploymentSelector({ [cluster]: env.PROGRAM_ID })(
    cluster,
  );
  const rpc = new JsonRpcClient({
    url: env.RPC_URL,
    timeoutMs: SERVICES.transport.rpcTimeoutMs,
    failureThreshold: SERVICES.transport.breakerFailureThreshold,
    recoverMs: SERVICES.transport.breakerOpenSeconds * 1000,
  });
  const source = new ExecutorSource(rpc, deployment);
  await source.assertCluster(env.RPC_URL);
  const transport = createTxRpc(rpc);
  const protocolLut = await source.lookupTable(
    new PublicKey(env.PROTOCOL_LOOKUP_TABLE),
  );
  const results = [];
  for (const kind of ["burn", "jackpot"] as const) {
    const { snapshot, reference } = await source.reference(
      await source.snapshot(),
    );
    const decision = planExecutor(kind, snapshot, reference, EXECUTOR_POLICY);
    if (!decision.ok) {
      results.push({
        kind,
        cluster,
        status: "skipped",
        reason: decision.reason,
        signed: false,
        sent: false,
      });
      continue;
    }
    const signer = snapshot.config.executor;
    if ((await source.residue(signer)) !== 0n)
      throw new Error("executor_residue");
    const checked = checkPlan(executorP1, decision.plan, signer);
    if (env.EXECUTOR_SWAP === "stub" && !env.EXECUTOR_STUB_QUOTE_ACCOUNT)
      throw new Error("executor_stub_evidence_missing");
    const swap =
      env.EXECUTOR_SWAP === "stub"
        ? stubSwap(
            deployment,
            signer,
            snapshot.config.token_mint,
            checked.expected,
            decision.plan.amount,
            new PublicKey(env.EXECUTOR_STUB_QUOTE_ACCOUNT!),
          )
        : await jupiterSwap({
            plan: decision.plan,
            signer,
            apiKey: env.EXECUTOR_JUPITER_API_KEY ?? "",
            lookupTable: (address) => source.lookupTable(address),
          });
    const { blockhash } = await transport.getLatestBlockhash();
    const composed = composeExecutor({
      plan: decision.plan,
      p1: executorP1,
      signer,
      swap,
      protocolLut,
      blockhash,
      tipLamports: landing.tipLamports,
      computeUnitLimit: 1_400_000,
    });
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signer,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ...composed.instructions,
        ],
      }).compileToV0Message([...(composed.lookupTables ?? [])]),
    );
    const simulation = await transport.simulateTransaction(transaction);
    if (simulation.err !== null) throw new Error("executor_simulation_failed");
    results.push({
      kind,
      cluster,
      status: "simulated",
      amount: decision.plan.amount.toString(),
      unitsConsumed: simulation.unitsConsumed,
      signed: false,
      sent: false,
    });
  }
  return results;
}
if (
  process.argv[1]?.endsWith("dry-run.ts") ||
  process.argv[1]?.endsWith("dry-run.js")
) {
  try {
    process.stdout.write(
      `${JSON.stringify(await executorDryRun(process.argv.slice(2)))}\n`,
    );
  } catch (error) {
    warnCause("executor_dry_run_failed", error);
    process.exitCode = 1;
  }
}
