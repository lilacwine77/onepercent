import { safeCause, warnCause } from "@onepercent/service-kit";
import {
  createRuntime,
  serviceParams,
  type RuntimeEnv,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { createKeeper, keeperLeaderBridge } from "./index.js";
import { keeperParamsSchema } from "./params.js";
import { runKeeperLeadershipWatchdog } from "./leadership.js";
import type { VrfMonitorOptions } from "./monitoring.js";

type VrfDecoder = VrfMonitorOptions["decodeVrfQueue"];

/** Load the S4 SDK contract; preserve the existing unavailable-export fallback. */
export async function loadVrfDecoder(
  importModule: (url: string) => Promise<unknown> = (url) => import(url),
  resolveModule: (specifier: string) => string = (specifier) =>
    import.meta.resolve(specifier),
): Promise<VrfDecoder | undefined> {
  const specifier = "@onepercent/sdk/verify";
  let resolved: string | undefined;
  try {
    resolved = resolveModule(specifier);
  } catch (error) {
    warnCause("keeper_vrf_module_unavailable", error);
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
    )
      return undefined;
  }
  if (!resolved) throw new Error("keeper_vrf_module_unavailable");
  let module: unknown;
  try {
    // An internal missing export is a broken installed module, never S4 absence.
    module = await importModule(resolved);
  } catch (error) {
    warnCause("keeper_vrf_module_unavailable", error);
    // eslint-disable-next-line preserve-caught-error -- Original cause is logged; preserve the public error contract.
    throw new Error("keeper_vrf_module_unavailable");
  }
  if (
    !module ||
    typeof module !== "object" ||
    !("decodeVrfQueue" in module) ||
    typeof module.decodeVrfQueue !== "function"
  )
    throw new Error("keeper_vrf_decoder_invalid");
  return module.decodeVrfQueue as VrfDecoder;
}

export interface KeeperBootstrapDependencies {
  runtime?: typeof createRuntime;
  keeper?: typeof createKeeper;
  watchdog?: typeof runKeeperLeadershipWatchdog;
  decoder?: () => Promise<VrfDecoder | undefined>;
}

/** D21 worker wiring; shutdown drains background work before the shared pool closes. */
export async function startKeeperWorker(
  options: {
    env: RuntimeEnv;
    configModule: unknown;
    sourceEnv?: NodeJS.ProcessEnv;
  },
  dependencies: KeeperBootstrapDependencies = {},
): Promise<ServiceRuntime> {
  // Validate before opening a pool, loading a role key, or taking the leader lock.
  keeperParamsSchema.parse(options.configModule);
  const decodeVrfQueue = await (dependencies.decoder ?? loadVrfDecoder)();
  const lifetime = new AbortController();
  const bridge = keeperLeaderBridge();
  const terms = new Map<Promise<void>, AbortController>();
  let runtime: ServiceRuntime | undefined;
  let originalStop: ServiceRuntime["stop"] | undefined;
  let watchdog: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    // Invalidate every signing path synchronously, before waiting on any task.
    runtime?.guard?.stop();
    runtime?.key?.destroy();
    lifetime.abort();
    for (const controller of terms.values()) controller.abort();
    const stopLeader = runtime?.leader?.stop();
    stopping = (async () => {
      try {
        await Promise.allSettled([stopLeader, watchdog, ...terms.keys()]);
      } finally {
        await originalStop?.();
      }
    })();
    return stopping;
  };
  const onLeader = (signal: AbortSignal): Promise<void> => {
    const controller = new AbortController();
    const termSignal = AbortSignal.any([
      signal,
      lifetime.signal,
      controller.signal,
    ]);
    const task = bridge.onLeader(termSignal);
    terms.set(task, controller);
    const settled = (error?: unknown) => {
      terms.delete(task);
      // A lost term can finish after its replacement has started.
      if (!termSignal.aborted) fail("keeper_loop_stopped", error);
    };
    // Keep the original promise for S0's error handling, without an unhandled child.
    void task.then(settled, settled);
    return task;
  };
  const fail = (reason: string, error?: unknown) => {
    // stop() invalidates signing and readiness synchronously, then drains work.
    void stop().catch((error) => warnCause("keeper_shutdown_failed", error));
    runtime?.logger.error(
      { reason, ...(error === undefined ? {} : { cause: safeCause(error) }) },
      "keeper worker stopped",
    );
  };

  try {
    runtime = await (dependencies.runtime ?? createRuntime)({
      service: "worker",
      role: "keeper",
      env: options.env,
      sourceEnv: options.sourceEnv,
      onLeader,
    });
    originalStop = runtime.stop;
    runtime.stop = stop;
    const stockRuntime = runtime;
    const keeper = (dependencies.keeper ?? createKeeper)(
      runtime,
      options.configModule,
      {
        decodeVrfQueue,
        onFailure: (error) => fail("keeper_loop_stopped", error),
        extensions: [
          async (context) => {
            // Load provider modules only after role checks and leadership.
            const { createStockExtension } = await import("./stock/runtime.js");
            return createStockExtension(
              stockRuntime,
              options.sourceEnv,
            )(context);
          },
        ],
      },
    );
    watchdog = (dependencies.watchdog ?? runKeeperLeadershipWatchdog)({
      pool: runtime.pool,
      rpc: runtime.rpc,
      alerts: runtime.alerts,
      intervalMs: serviceParams.keeper.scanSeconds * 1000,
      leaderFailoverSeconds: serviceParams.keeper.leaderFailoverSeconds,
      signal: lifetime.signal,
    });
    const watchEnded = (error?: unknown) => {
      if (!lifetime.signal.aborted) fail("keeper_watchdog_stopped", error);
    };
    void watchdog.then(() => watchEnded(), watchEnded);
    bridge.attach(keeper);
    return runtime;
  } catch (error) {
    await stop().catch((error) => warnCause("keeper_shutdown_failed", error));
    throw error;
  }
}
