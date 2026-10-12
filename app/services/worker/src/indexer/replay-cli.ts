import { PACK_SPLIT_BPS, SERVICES } from "@onepercent/config";
import {
  createRuntime,
  installShutdown,
  reportStartupFailure,
  type ServiceRuntime,
} from "@onepercent/service-kit";
import { loadWorkerRole } from "../roles.js";
import { attachIndexerShutdown, createIndexer } from "./index.js";
import { replayIndexer } from "./replay.js";

let runtime: ServiceRuntime | undefined;
let dispose: (() => void) | undefined;
try {
  const { role, env } = loadWorkerRole();
  if (role !== "indexer") throw new Error("indexer_role_required");
  runtime = await createRuntime({ service: "worker", role, env });
  const indexer = createIndexer(runtime, {
    services: SERVICES,
    royaltyPerDustCardBps: PACK_SPLIT_BPS.royaltyPerDustCard,
  });
  attachIndexerShutdown(runtime, indexer);
  dispose = installShutdown(runtime, []);
  // Offline maintenance: no listener, polling timer or WebSocket subscription.
  const result = await replayIndexer({
    store: indexer.store,
    reconciler: indexer.reconciler,
    argv: process.argv.slice(2),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  reportStartupFailure(error);
} finally {
  await runtime?.stop().catch(reportStartupFailure);
  dispose?.();
}
