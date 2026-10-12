import { registerWeb } from "./web/router.js";
import { createWebDependencies, type WebDependencies } from "./web/deps.js";
import {
  createXrayRouter,
  type XrayRouterDependencies,
} from "./xray/router.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { ActionError } from "@solana/actions-spec";
import { actionHeaders } from "./actions/headers.js";
import { resolveActionCluster } from "./actions/cluster.js";
import { COPY as ACTION_COPY } from "./actions/copy.js";
import { registerActions } from "./actions/index.js";
import {
  defaultDeps,
  registerLink,
  type ApiDependencies,
} from "./link/index.js";
import type { ApiEnv } from "./env.js";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { registerPublic } from "./public/index.js";
import { registerGo } from "./go/index.js";

export function createApi(
  env: Pick<
    ApiEnv,
    | "WEB_ORIGIN"
    | "APP_VERSION"
    | "GIT_COMMIT"
    | "BOT_API_SECRET"
    | "TRUST_PROXY_HEADER"
  >,
  deps: Partial<ApiDependencies> & {
    xray?: XrayRouterDependencies;
    health?: (request: Request) => Response | Promise<Response>;
    web?: WebDependencies;
    publicRuntime?: ServiceRuntime;
  } = {},
) {
  const app = new Hono();
  registerWeb(
    app,
    deps.web ?? createWebDependencies({ WEB_ORIGIN: env.WEB_ORIGIN }),
  );
  app.use("*", (context, next) =>
    context.req.path === "/actions.json" ||
    context.req.path.startsWith("/api/actions/")
      ? next()
      : cors({
          origin: [env.WEB_ORIGIN],
          allowMethods: ["GET", "POST"],
          allowHeaders: context.req.path.startsWith("/api/xray/")
            ? ["Content-Type", "cf-turnstile-response"]
            : context.req.path === "/api/stream"
              ? ["Content-Type", "Last-Event-ID"]
              : ["Content-Type"],
          exposeHeaders: ["Retry-After"],
        })(context, next),
  );
  // S4 audit: bound every API body before any X1/X3/S4 handler parses JSON.
  const maxSize = 64 * 1024;
  const defaultBodyLimit = bodyLimit({ maxSize });
  const actionsBodyLimit = bodyLimit({
    maxSize,
    onError: async (context) => {
      const cluster = resolveActionCluster(
        deps.cluster,
        deps.publicRuntime?.env?.CLUSTER,
        process.env.CLUSTER,
      );
      await actionHeaders(cluster)(context, async () => {});
      return context.json(
        { message: ACTION_COPY.badRequest } satisfies ActionError,
        413,
      );
    },
  });
  app.use("/api/*", (context, next) =>
    (context.req.path.startsWith("/api/actions/")
      ? actionsBodyLimit
      : defaultBodyLimit)(context, next),
  );
  const resolved = {
    ...defaultDeps(env),
    ...deps,
    xrayPort: deps.xrayPort ?? deps.xray?.service,
  };
  registerActions(app, resolved);
  registerLink(app, resolved);
  registerGo(app, resolved);
  app.get("/health", (context) =>
    deps.health
      ? deps.health(context.req.raw)
      : context.json({
          ok: true,
          version: env.APP_VERSION,
          commit: env.GIT_COMMIT,
        }),
  );
  app.route("/", createXrayRouter(deps.xray));
  registerPublic(app, deps.publicRuntime);
  return app;
}
