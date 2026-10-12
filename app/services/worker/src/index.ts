import { safeCause } from "@onepercent/service-kit";
import {
  createRuntime,
  listenRuntime,
  installShutdown,
  reportStartupFailure,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { loadWorkerRole } from "./roles.js";
import * as config from "@onepercent/config";

let runtime: ServiceRuntime | undefined;
let dispose: (() => void) | undefined;
const servers: ReturnType<typeof listenRuntime>[] = [];
try {
  const { role, env } = loadWorkerRole();
  // Refuse foreign key variables before loading business dependencies.
  runtime =
    role === "keeper"
      ? await (
          await import("./keeper/bootstrap.js")
        ).startKeeperWorker({ env, configModule: config })
      : role === "executor"
        ? await (
            await import("./executor/bootstrap.js")
          ).startExecutorWorker({ env })
        : await createRuntime({ service: "worker", role, env });
  const indexerModule =
    role === "indexer" ? await import("./indexer/index.js") : undefined;
  const indexer = indexerModule
    ? indexerModule.createIndexer(runtime, {
        services: config.SERVICES,
        royaltyPerDustCardBps: config.PACK_SPLIT_BPS.royaltyPerDustCard,
      })
    : undefined;
  if (indexer) indexerModule!.attachIndexerShutdown(runtime, indexer);
  servers.push(listenRuntime(runtime));
  dispose = installShutdown(runtime, servers);
  await indexer?.start();
  // The monitor remains health-only until its milestone.
  runtime.logger.info("service listening");
} catch (error) {
  const stopped = runtime?.stop();
  for (const server of servers) server.close();
  await stopped?.catch((error) => {
    runtime?.logger.warn(
      { reason: "worker_shutdown_failed", cause: safeCause(error) },
      "worker shutdown failed",
    );
  });
  dispose?.();
  reportStartupFailure(error);
}
