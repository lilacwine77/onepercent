import { serve } from "@hono/node-server";
import {
  createRuntime,
  listenRuntime,
  installShutdown,
  reportStartupFailure,
  type ServiceRuntime,
  warnCause,
} from "@onepercent/service-kit";
import { loadApiRole } from "./roles.js";

let runtime: ServiceRuntime | undefined;
const servers: ReturnType<typeof listenRuntime>[] = [];
try {
  const { role, env } = loadApiRole();
  const created = await createRuntime({ service: "api", role, env });
  runtime = created;
  // D22 append: private signer routes share S0's guarded private listener.
  if (role === "intake-signer" || role === "quote-signer") {
    const { mountPrivateSigner } = await import("./internal/startup.js");
    mountPrivateSigner(created);
  }
  servers.push(listenRuntime(created));
  if (role === "public") {
    // Validate isolation before business dependencies can emit startup diagnostics.
    const [
      { createApi },
      { getDefaultXrayDependencies },
      { createWebDependencies },
    ] = await Promise.all([
      import("./app.js"),
      import("./xray/deps.js"),
      import("./web/deps.js"),
    ]);
    const xray = await getDefaultXrayDependencies(env, created.logger);
    const { createM5Dependencies } = await import("./go/dependencies.js");
    const app = createApi(env, {
      ...createM5Dependencies(created),
      xray,
      web: createWebDependencies(process.env, created),
      logger: created.logger,
      health: created.health.fetch,
      publicRuntime: created,
    });
    servers.push(
      serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }),
    );
  }
  // Signer roles are mounted above (S2, D22); the public role serves S4 with X1/X3.
  installShutdown(runtime, servers);
  runtime.logger.info("service listening");
} catch (error) {
  const stopped = runtime?.stop();
  for (const server of servers) server.close();
  await stopped?.catch((error) => {
    warnCause("api_stop_failed", error);
  });
  reportStartupFailure(error);
}
