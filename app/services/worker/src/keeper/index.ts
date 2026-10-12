import { isRpcNodeLag, safeCause, warnCause } from "@onepercent/service-kit";
import { keeperPriorityCap } from "./transport.js";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TxSender,
  createTxRpc,
  serviceParams,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { KeeperChain } from "./adapter.js";
import { Keeper, type KeeperExtension, type KeeperMonitor } from "./keeper.js";
import { subscribeReveals } from "./logs.js";
import { keeperParamsSchema } from "./params.js";
import { PostgresKeeperStore } from "./store.js";
import { FeeChainReader } from "./fees/chain.js";
import { createFeeKeeper, feeKeeperParamsSchema } from "./fees/index.js";
import { createVrfMonitor, type VrfMonitorOptions } from "./monitoring.js";
export { Keeper } from "./keeper.js";
export { keeperParamsSchema } from "./params.js";
export { PostgresKeeperStore } from "./store.js";

function waitForScan(
  milliseconds: number,
  signal: AbortSignal,
  register: (trigger: () => void) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      register(() => undefined);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    register(finish);
    if (signal.aborted) finish();
  });
}
/** configModule must be the exports of @onepercent/config after M1/P0 merge. */
export function createKeeper(
  runtime: ServiceRuntime,
  configModule: unknown,
  options: {
    monitor?: KeeperMonitor;
    decodeVrfQueue?: VrfMonitorOptions["decodeVrfQueue"];
    extensions?: readonly KeeperExtension[];
    websocketUrl?: string;
    onFailure?: (error: unknown) => void;
  } = {},
) {
  if (
    runtime.role !== "keeper" ||
    !runtime.key ||
    !runtime.guard ||
    !runtime.leader
  )
    throw new Error("keeper_runtime_required");
  const params = keeperParamsSchema.parse(configModule);
  const { key, guard, leader } = runtime;
  const chain = new KeeperChain(
    runtime.rpc,
    new PublicKey(runtime.env.PROGRAM_ID),
    params.TX_LIMITS,
    key.publicKey,
  );
  const forTerm = (signal: AbortSignal, shouldYield: () => boolean) => {
    const assertActive = () => {
      signal.throwIfAborted();
      leader.assertLeader();
    };
    const store = new PostgresKeeperStore(runtime.pool, {
      assertActive,
      sendMaxAttempts: params.SERVICES.keeper.sendMaxAttempts,
    });
    const rpc = createTxRpc(runtime.rpc);
    const feeParams = feeKeeperParamsSchema.safeParse(configModule);
    if (
      !feeParams.success &&
      configModule &&
      typeof configModule === "object" &&
      "KEEPER_POLICY" in configModule
    )
      throw new Error("fee_keeper_params_invalid");
    const feeReader = feeParams.success
      ? new FeeChainReader({
          rpc: runtime.rpc,
          programId: new PublicKey(runtime.env.PROGRAM_ID),
          payer: key.publicKey,
          cluster:
            runtime.env.CLUSTER === "mainnet-beta"
              ? "mainnet"
              : runtime.env.CLUSTER,
          lookupTable: runtime.env.PROTOCOL_LOOKUP_TABLE,
        })
      : undefined;
    signal.addEventListener("abort", () => feeReader?.clearEphemeral(), {
      once: true,
    });
    const sender = new TxSender({
      rpc,
      signer: {
        publicKey: key.publicKey,
        signTransaction: (transaction) => {
          feeReader?.signAuxiliary(transaction);
          key.signTransaction(transaction);
        },
      },
      role: "keeper",
      journal: store,
      assertAuthorized: () => guard.assertAuthorized(),
      assertLeader: assertActive,
      ...params.SERVICES.keeper,
      cuMarginBps: params.SERVICES.landing.cuMarginBps,
      maxComputeUnitPriceMicroLamports: keeperPriorityCap(
        runtime.env.CLUSTER,
        params.SERVICES.landing.maxComputeUnitPriceMicroLamports,
      ),
    });
    const keeper = new Keeper({
      chain,
      params,
      store,
      sender,
      assertLeader: assertActive,
      shouldYield,
      ...(feeReader && feeParams.success
        ? {
            fees: createFeeKeeper({
              reader: feeReader,
              store,
              runtime,
              params: feeParams.data,
              sendMaxAttempts: params.SERVICES.keeper.sendMaxAttempts,
              assertActive,
            }),
            lookupTables: (signal: AbortSignal) =>
              feeReader.lookupTables(signal),
          }
        : {}),
      measure: async (instructions, signal, lookupTables) => {
        const latest = await rpc.getLatestBlockhash(signal);
        const transaction = new VersionedTransaction(
          new TransactionMessage({
            payerKey: key.publicKey,
            recentBlockhash: latest.blockhash,
            instructions: [...instructions],
          }).compileToV0Message([...(lookupTables ?? [])]),
        );
        const result = await rpc.simulateTransaction(transaction, signal);
        if (
          result.err !== null ||
          !result.unitsConsumed ||
          !Number.isSafeInteger(result.unitsConsumed)
        )
          throw new Error("compute_measurement_failed");
        return result.unitsConsumed;
      },
      hooks: {
        alert: async (name, reason, payload) => {
          await runtime.alerts.alert(name, "warning", { reason, ...payload });
        },
        result: (kind, status) => {
          runtime.metrics.keeperJobsTotal.inc({ kind, status });
          if (kind === "fee-chain")
            runtime.metrics.feeChainRunsTotal.inc({ result: status });
        },
        latency: (seconds) => {
          if (seconds >= 0)
            runtime.metrics.settleLatencySeconds.observe(seconds);
        },
        log: (record) =>
          record.cause
            ? runtime.logger.warn(record, "keeper decision")
            : runtime.logger.info(record, "keeper decision"),
      },
    });
    return keeper;
  };
  let vrfMonitor: ReturnType<typeof createVrfMonitor> | undefined;
  const monitorPoll: KeeperMonitor =
    options.monitor ??
    (async (snapshot, now, signal) => {
      vrfMonitor ??= createVrfMonitor({
        rpc: runtime.rpc,
        pool: runtime.pool,
        metrics: runtime.metrics,
        alerts: runtime.alerts,
        vrfProgramId: snapshot.config.vrfProgram.toBase58(),
        decodeVrfQueue:
          options.decodeVrfQueue ??
          (() => {
            throw new Error("vrf_decoder_pending");
          }),
        occupancyAlertBps: params.MONITOR.vrfQueueOccupancyAlertBps,
        expiriesPerThousandRipsAlert:
          params.MONITOR.vrfExpiriesPerThousandRipsAlert,
        expiryClusterPerWallet24h:
          params.SERVICES.monitor.vrfExpiryClusterPerWallet24h,
      });
      await vrfMonitor.poll({
        chainNow: now,
        queues: snapshot.config.vrfQueues.map((key) => key.toBase58()),
        signal,
      });
    });
  const onLeader = async (parentSignal: AbortSignal): Promise<void> => {
    if (parentSignal.aborted) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([parentSignal, controller.signal]);
    let requested = false;
    const keeper = forTerm(signal, () => requested);
    let trigger = () => undefined as void;
    const scanSoon = () => {
      requested = true;
      trigger();
    };
    const stopLogs = subscribeReveals({
      url: options.websocketUrl ?? runtime.env.RPC_URL,
      programId: new PublicKey(runtime.env.PROGRAM_ID),
      signal,
      retryMs: params.SERVICES.keeper.scanSeconds * 1000,
      timeoutMs: serviceParams.transport.rpcTimeoutMs,
      trigger: scanSoon,
      failed: (error) =>
        runtime.logger.warn(
          { reason: "keeper_logs_unavailable", cause: safeCause(error) },
          "keeper scan fallback",
        ),
    });
    // K1 owns its own policy cadence and only receives the current leader signal.
    const extensions = (options.extensions ?? []).map(async (run) => {
      await run({
        signal,
        assertLeader: () => {
          signal.throwIfAborted();
          leader.assertLeader();
        },
      });
      if (!signal.aborted) throw new Error("keeper_extension_stopped");
    });
    const monitor = async () => {
      while (!signal.aborted) {
        try {
          const snapshot = await chain.snapshot("confirmed", signal);
          const now = await chain.chainNow();
          signal.throwIfAborted();
          await monitorPoll(snapshot, now, signal);
        } catch (error) {
          if (!signal.aborted)
            runtime.logger.warn(
              {
                reason: isRpcNodeLag(error)
                  ? "keeper_rpc_node_lag"
                  : "keeper_monitor_failed",
                cause: safeCause(error),
              },
              "keeper monitor unavailable",
            );
        }
        await waitForScan(
          params.SERVICES.keeper.scanSeconds * 1000,
          signal,
          () => undefined,
        );
      }
    };
    const scan = async () => {
      while (!signal.aborted) {
        requested = false;
        try {
          await keeper.scan(signal);
        } catch (error) {
          if (!signal.aborted)
            runtime.logger.warn(
              {
                reason: isRpcNodeLag(error)
                  ? "keeper_rpc_node_lag"
                  : "keeper_scan_failed",
                cause: safeCause(error),
              },
              "keeper scan unavailable",
            );
        }
        if (!requested)
          await waitForScan(
            params.SERVICES.keeper.scanSeconds * 1000,
            signal,
            (value) => {
              trigger = value;
            },
          );
      }
    };
    const tasks = [...extensions, monitor(), scan()];
    try {
      // Every child is part of the term. K1 stopping must stop stock leadership.
      await Promise.race(tasks);
      if (!signal.aborted) throw new Error("keeper_loop_stopped");
    } catch (error) {
      if (!parentSignal.aborted) {
        guard.stop();
        // Release the session before draining children: an in-flight provider
        // call may ignore cancellation, but must never retain leadership.
        if (options.onFailure) options.onFailure(error);
        else
          void leader
            .stop()
            .catch((error) => warnCause("keeper_shutdown_failed", error));
      }
      throw error;
    } finally {
      controller.abort();
      stopLogs();
      await Promise.allSettled(tasks);
    }
  };
  return { onLeader };
}
/** S0 calls onLeader during createRuntime, before its runtime object is returned. */
export function keeperLeaderBridge() {
  let attached: ReturnType<typeof createKeeper> | undefined;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return {
    attach(keeper: ReturnType<typeof createKeeper>) {
      if (attached) throw new Error("keeper_already_attached");
      attached = keeper;
      resolveReady();
    },
    async onLeader(signal: AbortSignal) {
      // Shutdown before attach must never leave an active term waiting forever.
      let onAbort: () => void = () => undefined;
      try {
        await Promise.race([
          ready,
          new Promise<void>((resolve) => {
            onAbort = resolve;
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", onAbort, { once: true });
          }),
        ]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      if (!signal.aborted) await attached?.onLeader(signal);
    },
  };
}
