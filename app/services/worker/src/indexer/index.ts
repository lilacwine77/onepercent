import { isRpcNodeLag, safeCause } from "@onepercent/service-kit";
import { EventStream, type ServiceRuntime } from "@onepercent/service-kit";
import { AccountReconciler } from "./reconcile.js";
import { IndexerStore, type StoreOptions } from "./store.js";
import { SolanaTxSource, createIndexerRpc } from "./source.js";
import { EventPublisher } from "./publication.js";
import { IndexerEngine } from "./engine.js";
import { IndexerTelemetry } from "./telemetry.js";
import { LogsWakeup, websocketUrl } from "./wakeup.js";
import { BLOCK0, PROGRAM_IDS } from "@onepercent/config";
import { Block0Indexer } from "./season/block0.js";
import {
  indexerEnvSchema,
  indexerSettingsSchema,
  vrfAlertThresholdsSchema,
  type VrfAlertThresholds,
} from "./settings.js";

export interface StartIndexerOptions {
  /** Config SERVICES, validated here. */
  services: unknown;
  royaltyPerDustCardBps: number;
  /** M6.1 owns these thresholds. Their absence disables only the VRF alerts. */
  vrfAlertThresholds?: VrfAlertThresholds;
  recomputeProvenance?: StoreOptions["recomputeProvenance"];
  env?: NodeJS.ProcessEnv;
}

/** S0's worker entry attaches this only for ROLE=indexer and awaits stop before runtime.stop. */
export function createIndexer(
  runtime: ServiceRuntime,
  options: StartIndexerOptions,
) {
  if (runtime.role !== "indexer" || runtime.key)
    throw new Error("indexer_role_required");
  const settings = indexerSettingsSchema.parse(options.services);
  const vrfAlerts = vrfAlertThresholdsSchema
    .optional()
    .parse(options.vrfAlertThresholds);
  const env = indexerEnvSchema.parse(options.env ?? process.env);
  const rpc = createIndexerRpc(runtime, env.INDEXER_RPC_URL_FALLBACK, settings);
  const shutdown = new AbortController();
  const cancellableRpc: Pick<typeof rpc, "request"> = {
    request: (method, params, schema, signal) =>
      rpc.request(
        method,
        params,
        schema,
        AbortSignal.any([shutdown.signal, ...(signal ? [signal] : [])]),
      ),
  };
  const source = new SolanaTxSource(cancellableRpc, runtime.env.PROGRAM_ID);
  const store = new IndexerStore(runtime.pool, {
    programId: runtime.env.PROGRAM_ID,
    royaltyPerDustCardBps: options.royaltyPerDustCardBps,
    recomputeProvenance: options.recomputeProvenance,
    alert: (key, payload) =>
      runtime.alerts.alert(key, "warning", payload).then(() => undefined),
  });
  const reconciler = new AccountReconciler({
    rpc: cancellableRpc,
    pool: runtime.pool,
    programId: runtime.env.PROGRAM_ID,
    deckChunkBytes: settings.indexer.deckChunkBytes,
    alert: runtime.alerts.alert.bind(runtime.alerts),
    metrics: runtime.metrics,
  });
  const publisher = new EventPublisher(
    runtime.pool,
    new EventStream(runtime.redis, {
      key: "onepct:events",
      maxLength: settings.api.sseReplayEvents,
    }),
    settings.api.sseReplayEvents,
    {
      clear: () => runtime.redis.del("onepct:events").then(() => undefined),
      exists: () => runtime.redis.exists("onepct:events").then((n) => n > 0),
    },
  );
  const telemetry = new IndexerTelemetry(runtime, runtime.pool, {
    lagAlertSeconds: settings.indexer.lagAlertSeconds,
    vrfAlerts,
  });
  const block0 = new Block0Indexer({
    store,
    rpc: cancellableRpc,
    programId: runtime.env.PROGRAM_ID,
    dbcProgram: PROGRAM_IDS.meteoraDbc,
    slots: BLOCK0.slots,
  });
  const reportStale = async (reason: "poll_failed" | "rpc_node_lag") => {
    const slot = await source.confirmedSlot().catch((error) => {
      if (!isRpcNodeLag(error))
        runtime.logger.warn(
          { reason: "indexer_slot_unavailable", cause: safeCause(error) },
          "indexer stale slot unavailable",
        );
      return null;
    });
    const time =
      slot === null
        ? null
        : await source.blockTime(slot).catch((error) => {
            if (!isRpcNodeLag(error))
              runtime.logger.warn(
                {
                  reason: "indexer_block_time_unavailable",
                  cause: safeCause(error),
                },
                "indexer stale time unavailable",
              );
            return null;
          });
    await (
      reason === "rpc_node_lag"
        ? telemetry.stale(slot, time, reason)
        : telemetry.stale(slot, time)
    ).catch((error) => {
      runtime.logger.warn(
        { reason: "indexer_stale_report_failed", cause: safeCause(error) },
        "indexer stale report failed",
      );
    });
  };
  const engine = new IndexerEngine({
    source,
    store,
    programId: runtime.env.PROGRAM_ID,
    maintenanceRetryMs: settings.indexer.pollMs,
    onNodeLag: () => reportStale("rpc_node_lag"),
    onMaintenanceFailure: async (kind, error, attempt) => {
      if (!isRpcNodeLag(error))
        runtime.logger.warn(
          {
            kind,
            attempt,
            cause: safeCause(error),
            reason:
              error instanceof Error &&
              error.message === "deck_changed_during_read"
                ? "deck_changed_during_read"
                : "reconcile_retry",
          },
          "indexer reconciliation deferred",
        );
      await runtime.redis.hincrby("onepct:indexer:reconcile_retries", kind, 1);
    },
    reconciler,
    beforePoll: (signal) => rpc.probe(signal),
    publish: () => publisher.flush(),
    afterApply: (tx) => telemetry.applied(tx),
    accountReconcileSeconds: settings.indexer.accountReconcileSeconds,
    deckReconcileSeconds: settings.indexer.deckReconcileSeconds,
    status: async (confirmed, last, through) => {
      try {
        if (await block0.poll(confirmed, through, shutdown.signal))
          await publisher.flush();
      } catch (error) {
        // Missing archival evidence keeps the board pending without stalling
        // ingestion or suppressing the indexer's independently measured lag.
        if (!isRpcNodeLag(error))
          runtime.logger.warn(
            { reason: "block0_evidence_unavailable", cause: safeCause(error) },
            "block0 rebuild deferred",
          );
      }
      const tipTime = source.blockTime(confirmed);
      const [confirmedTime, scanTime] = await Promise.all([
        tipTime,
        through === confirmed ? tipTime : source.blockTime(through),
      ]);
      await telemetry.healthy(
        confirmed,
        last,
        confirmedTime,
        scanTime,
        through,
      );
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;
  let active: Promise<void> | undefined;
  const poll = (): Promise<void> => {
    if (!running) return Promise.resolve();
    if (active) return active;
    clearTimeout(timer);
    active = engine
      .poll()
      .catch(async (error) => {
        if (!running) return;
        runtime.logger.warn(
          { reason: "indexer_poll_failed", cause: safeCause(error) },
          "indexer poll failed",
        );
        await reportStale("poll_failed");
      })
      .finally(() => {
        active = undefined;
        if (running) {
          timer = setTimeout(() => {
            void poll();
          }, settings.indexer.pollMs);
          timer.unref();
        }
      });
    return active;
  };
  const websocket = new LogsWakeup({
    url: env.INDEXER_WS_URL ?? websocketUrl(runtime.env.RPC_URL),
    programId: runtime.env.PROGRAM_ID,
    retryMs: settings.indexer.pollMs,
    timeoutMs: settings.transport.rpcTimeoutMs,
    poll: () => {
      void poll();
    },
  });
  return {
    store,
    reconciler,
    engine,
    async start() {
      if (stopped) throw new Error("indexer_stopped");
      if (running) return;
      running = true;
      websocket.start();
      engine.maintenance.start();
      await poll();
    },
    async stop() {
      stopped = true;
      running = false;
      clearTimeout(timer);
      websocket.stop();
      shutdown.abort();
      await engine.stop();
      await active;
    },
  };
}

/** Drain indexer writes before S0 closes Redis/Postgres; S0 owns signals and deadlines. */
export function attachIndexerShutdown(
  runtime: Pick<ServiceRuntime, "stop">,
  indexer: { stop(): Promise<void> },
): void {
  const stopRuntime = runtime.stop;
  let stopped: Promise<void> | undefined;
  runtime.stop = () =>
    (stopped ??= (async () => {
      try {
        await indexer.stop();
      } finally {
        await stopRuntime();
      }
    })());
}

export { IndexerStore } from "./store.js";
export { IndexerEngine } from "./engine.js";
export { SolanaTxSource } from "./source.js";
