import { BLINKS_OPS } from "@onepercent/config";
import { clientIpKey } from "../link/ratelimit.js";
import { responseCache } from "./cache.js";
import { Hono } from "hono";
import type { ActionError } from "@solana/actions-spec";
import type { ApiDependencies } from "../link/index.js";
import { ACTIONS_JSON } from "./actions-json.js";
import { COPY } from "./copy.js";
import { resolveActionCluster } from "./cluster.js";
import { actionHeaders } from "./headers.js";
import {
  createRipService,
  limitRipAccount,
  registerRip,
  ripOutcome,
  setRipOutcome,
  type RipDependencies,
} from "./rip.js";
import { createRipDependencies } from "./runtime.js";
import { registerBlinkImages } from "./images.js";
import { type ServiceRuntime, warnCause } from "@onepercent/service-kit";
import { registerXray } from "./xray.js";
import { xrayService } from "../xray/service.js";

export function registerActions(
  app: Hono,
  deps: ApiDependencies & {
    publicRuntime?: ServiceRuntime;
    rip?: RipDependencies;
  },
): void {
  const actions = new Hono();
  const rip =
    deps.rip ?? createRipDependencies(deps.publicRuntime, deps.webOrigin);
  const ripService = createRipService(rip);
  const cluster = resolveActionCluster(deps.cluster, rip.cluster);
  actions.use("/actions.json", actionHeaders(cluster));
  actions.use("/api/actions/*", actionHeaders(cluster));
  actions.onError((error, context) => {
    warnCause("action_request_failed", error);
    setRipOutcome(context, "internal_error");
    return context.json(
      { message: COPY.networkError } satisfies ActionError,
      500,
    );
  });
  actions.get("/actions.json", (context) => {
    context.header("Cache-Control", "public, max-age=300");
    return context.json(ACTIONS_JSON);
  });
  actions.use("/api/actions/*", async (context, next) => {
    const started = performance.now();
    await next();
    const route = context.req.path.startsWith("/api/actions/xray")
      ? "xray"
      : context.req.path.startsWith("/api/actions/rip")
        ? "rip"
        : "unknown";
    deps.logger.info(
      JSON.stringify({
        route,
        status: context.res.status,
        ...(ripOutcome(context) ? { outcome: ripOutcome(context) } : {}),
        latencyMs: Math.round(performance.now() - started),
      }),
    );
  });
  actions.use("/api/actions/*", responseCache(deps.clock));
  actions.use("/api/actions/*", async (context, next) => {
    if (context.req.method === "POST") {
      if (/^\/api\/actions\/rip(?:\/[^/]+)?$/.test(context.req.path)) {
        const limited = await limitRipAccount(context, rip);
        if (limited) return limited;
      }
      const limited = await deps.linkRateLimiter.consume(
        `actions-post:${clientIpKey(context, deps)}`,
        { limit: BLINKS_OPS.postPerMinutePerIp, windowMs: 60_000 },
      );
      if (!limited.ok) {
        setRipOutcome(context, "ip_limit");
        context.header("Retry-After", String(limited.retryAfterS));
        return context.json(
          { message: COPY.actionRateLimited(limited.retryAfterS) },
          429,
        );
      }
    }
    await next();
  });
  registerXray(actions, deps, deps.xrayPort ?? xrayService);
  registerRip(actions, rip, ripService);
  registerBlinkImages(actions, rip, ripService);
  actions.all("/actions.json", (context) =>
    context.json({ message: COPY.actionNotFound } satisfies ActionError, 404),
  );
  actions.all("/api/actions/*", (context) =>
    context.json({ message: COPY.actionNotFound } satisfies ActionError, 404),
  );
  app.route("/", actions);
}
