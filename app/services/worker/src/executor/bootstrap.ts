import { z } from "zod";
import {
  PublicKey,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  EXECUTOR_POLICY,
  SERVICES,
  parseProgramCluster,
} from "@onepercent/config";
import { createDeploymentSelector } from "@onepercent/sdk";
import {
  createRuntime,
  KeeperLeader,
  createTxRpc,
  withSender,
  EnvironmentError,
  type RuntimeEnv,
  type ServiceRuntime,
  TxSender,
  safeCause,
  warnCause,
} from "@onepercent/service-kit";
import { Executor } from "./engine.js";
import { ExecutorSource } from "./source.js";
import { PostgresExecutorStore } from "./store.js";
import { jupiterSwap } from "./jupiter.js";
import { assertSwapMode, stubSwap } from "./compose.js";
import { executorP1, type P1ExecutorPort } from "./p1.js";

import { executorTransport } from "./transport.js";

const settingsSchema = z.object({
  EXECUTOR_SWAP: z.enum(["jupiter", "stub"]).default("jupiter"),
  EXECUTOR_JUPITER_API_KEY: z.string().min(1).optional(),
  EXECUTOR_STUB_QUOTE_ACCOUNT: z.string().optional(),
  PROTOCOL_LOOKUP_TABLE: z.string().optional(),
  HELIUS_SENDER_URL: z.url().optional(),
});
export async function startExecutorWorker(
  options: { env: RuntimeEnv; sourceEnv?: NodeJS.ProcessEnv },
  dependencies: {
    runtime?: typeof createRuntime;
    p1?: P1ExecutorPort;
  } = {},
): Promise<ServiceRuntime> {
  const sourceEnv = options.sourceEnv ?? process.env;
  const settings = settingsSchema.parse(sourceEnv);
  assertSwapMode(options.env.CLUSTER, settings.EXECUTOR_SWAP);
  const cluster = parseProgramCluster(options.env.CLUSTER);
  const deployment = createDeploymentSelector({
    [cluster]: options.env.PROGRAM_ID,
  })(cluster);
  const runtime = await (dependencies.runtime ?? createRuntime)({
    service: "worker",
    role: "executor",
    env: options.env,
    sourceEnv,
  });
  const originalStop = runtime.stop;
  let leader: KeeperLeader | undefined;
  const terms = new Set<Promise<void>>();
  let stopping: Promise<void> | undefined;
  runtime.stop = () => {
    runtime.guard?.stop();
    runtime.key?.destroy();
    return (stopping ??= (async () => {
      await leader?.stop();
      await Promise.allSettled([...terms]);
      await originalStop();
    })());
  };
  try {
    if (!runtime.key || !runtime.guard)
      throw new Error("executor_runtime_required");
    const p1 = dependencies.p1 ?? executorP1;
    const transport = executorTransport(cluster, SERVICES.landing);
    if (
      transport.tipLamports === null ||
      transport.maxComputeUnitPriceMicroLamports === null
    ) {
      runtime.guard.stop();
      runtime.logger.error(
        { reason: "executor_landing_parameters_pending" },
        "executor unavailable until landing measurements",
      );
      return runtime;
    }
    if (!settings.PROTOCOL_LOOKUP_TABLE)
      throw new EnvironmentError("PROTOCOL_LOOKUP_TABLE");
    const source = new ExecutorSource(runtime.rpc, deployment);
    await source.assertCluster(runtime.env.RPC_URL);
    const protocolLut = await source.lookupTable(
      new PublicKey(settings.PROTOCOL_LOOKUP_TABLE),
    );
    if (protocolLut.state.authority) throw new Error("executor_lut_not_frozen");
    const key = runtime.key;
    const guard = runtime.guard;
    const fail = (error?: unknown) => {
      void runtime
        .stop()
        .catch((error) => warnCause("executor_shutdown_failed", error));
      runtime.logger.error(
        {
          reason: "executor_loop_stopped",
          ...(error === undefined ? {} : { cause: safeCause(error) }),
        },
        "executor worker stopped",
      );
    };
    const onLeader = async (signal: AbortSignal) => {
      const assertActive = () => {
        signal.throwIfAborted();
        leader!.assertLeader();
        guard.assertAuthorized();
      };
      await source.assertCluster(runtime.env.RPC_URL, signal);
      const store = new PostgresExecutorStore(runtime.pool, assertActive);
      const baseRpc = createTxRpc(runtime.rpc);
      const rpc =
        runtime.env.CLUSTER === "mainnet-beta"
          ? withSender(baseRpc, {
              endpoint: settings.HELIUS_SENDER_URL,
              timeoutMs: SERVICES.transport.rpcTimeoutMs,
              assertActive,
            })
          : baseRpc;
      const sender = new TxSender({
        rpc,
        signer: key,
        role: "executor",
        assertAuthorized: () => guard.assertAuthorized(),
        assertLeader: assertActive,
        journal: store,
        ...SERVICES.keeper,
        cuMarginBps: SERVICES.landing.cuMarginBps,
        maxComputeUnitPriceMicroLamports:
          transport.maxComputeUnitPriceMicroLamports,
      });
      const executor = new Executor({
        deployment,
        policy: EXECUTOR_POLICY,
        signer: key.publicKey,
        p1,
        protocolLut,
        tipLamports: transport.tipLamports,
        store,
        sender,
        assertActive,
        onFailure: fail,
        snapshot: async (commitment, signal) => {
          await source.assertCluster(runtime.env.RPC_URL, signal);
          return source.snapshot(commitment, signal);
        },
        reference: (snapshot, signal) => source.reference(snapshot, signal),
        blockhash: async (signal) =>
          (await baseRpc.getLatestBlockhash(signal)).blockhash,
        residue: (signal) => source.residue(key.publicKey, signal),
        receipt: (signature, signal) =>
          source.receipt(signature, key.publicKey, signal),
        slippage: (kind, value) =>
          runtime.metrics.executorSlippageBps.set({ kind }, value),
        swap: async (plan, minOut, expected, signal) => {
          if (settings.EXECUTOR_SWAP === "stub") {
            if (
              !settings.EXECUTOR_STUB_QUOTE_ACCOUNT ||
              expected === undefined ||
              expected < minOut
            )
              throw new Error("executor_stub_evidence_missing");
            return stubSwap(
              deployment,
              key.publicKey,
              plan.snapshot.config.token_mint,
              expected,
              plan.amount,
              new PublicKey(settings.EXECUTOR_STUB_QUOTE_ACCOUNT),
            );
          }
          return jupiterSwap({
            plan,
            signer: key.publicKey,
            apiKey: settings.EXECUTOR_JUPITER_API_KEY ?? "",
            lookupTable: (address, signal) =>
              source.lookupTable(address, signal),
            signal,
          });
        },
        measure: async (plan, signal) => {
          const { blockhash } = await baseRpc.getLatestBlockhash(signal);
          // Solana's transaction maximum, used only for unsigned CU measurement.
          const transaction = new VersionedTransaction(
            new TransactionMessage({
              payerKey: key.publicKey,
              recentBlockhash: blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
                ...plan.instructions,
              ],
            }).compileToV0Message([...(plan.lookupTables ?? [])]),
          );
          const simulation = await baseRpc.simulateTransaction(
            transaction,
            signal,
          );
          if (simulation.err !== null || !simulation.unitsConsumed)
            throw new Error("executor_simulation_failed");
          return simulation.unitsConsumed;
        },
        alert: async (name, payload) => {
          await runtime.alerts.alert(name, "critical", payload);
        },
        result: (kind, result) =>
          runtime.metrics.executorTradesTotal.inc({ kind, result }),
        log: (record) =>
          record.cause
            ? runtime.logger.warn(record, "executor decision")
            : runtime.logger.info(record, "executor decision"),
      });
      await executor.onLeader(signal);
    };
    leader = new KeeperLeader({
      connectionString: options.env.DATABASE_URL,
      lockKey: "onepct:executor",
      tickMs: SERVICES.keeper.scanSeconds * 1000,
      followerRetrySeconds: SERVICES.keeper.followerRetrySeconds,
      leaderFailoverSeconds: SERVICES.keeper.leaderFailoverSeconds,
      onLeader(signal) {
        const task = onLeader(signal);
        terms.add(task);
        const settled = (error?: unknown) => {
          terms.delete(task);
          if (signal.aborted) return;
          fail(error);
        };
        void task.then(() => settled(), settled);
        return task;
      },
      onError: (reason) =>
        runtime.logger.error({ reason }, "executor leader unavailable"),
    });
    await leader.start();
    return runtime;
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}
