import { warnCause } from "@onepercent/service-kit";
import { BOT_OPS } from "@onepercent/config";
import { z } from "zod";
import { Hono, type MiddlewareHandler } from "hono";
import { isBotAuthorized } from "../link/auth.js";
import type { ApiDependencies } from "../link/index.js";
import { clientIpKey } from "../link/ratelimit.js";
import { COPY } from "../actions/copy.js";
import { GoCreateSchema, GoId, goTarget } from "./schema.js";
import { InMemoryGoStore } from "./store.js";

export function registerGo(app: Hono, deps: ApiDependencies): void {
  const routes = new Hono();
  const store = deps.goStore ?? new InMemoryGoStore();
  const observe: MiddlewareHandler = async (context, next) => {
    const started = performance.now();
    context.header("Cache-Control", "no-store");
    await next();
    deps.logger.info(
      JSON.stringify({
        route: context.req.path.endsWith("/redeem") ? "go_redeem" : "go_create",
        status: context.res.status,
        latencyMs: Math.round(performance.now() - started),
      }),
    );
  };
  routes.use("/api/go", observe);
  routes.use("/api/go/*", observe);
  routes.onError((error, context) => {
    warnCause("go_request_failed", error);
    return context.json({ message: COPY.networkError }, 503);
  });
  routes.post("/api/go", async (context) => {
    if (!deps.secret) return context.json({ message: COPY.linkDisabled }, 503);
    if (!isBotAuthorized(context.req.header("Authorization"), deps.secret))
      return context.json({ message: COPY.unauthorized }, 401);
    const parsed = GoCreateSchema.safeParse(
      await context.req.json().catch((error) => {
        warnCause("go_body_invalid", error);
        return null;
      }),
    );
    if (!parsed.success) return context.json({ message: COPY.badRequest }, 400);
    const { count, ...input } = parsed.data;
    const limited = await deps.linkRateLimiter.consume(
      `go:${input.telegramUserId}`,
      { limit: BOT_OPS.apiLimits.goSessionsPerUserPer600s, windowMs: 600_000 },
      count,
    );
    if (!limited.ok) {
      context.header("Retry-After", String(limited.retryAfterS));
      return context.json(
        { message: COPY.actionRateLimited(limited.retryAfterS) },
        429,
      );
    }
    return context.json(
      { sessions: await store.create(input, count, deps.clock()) },
      201,
    );
  });
  routes.post("/api/go/redeem", async (context) => {
    const limited = await deps.linkRateLimiter.consume(
      `go-redeem:${clientIpKey(context, deps)}`,
      { limit: BOT_OPS.apiLimits.goRedeemPerIpPer60s, windowMs: 60_000 },
    );
    if (!limited.ok) {
      context.header("Retry-After", String(limited.retryAfterS));
      return context.json(
        { message: COPY.actionRateLimited(limited.retryAfterS) },
        429,
      );
    }
    const parsed = z
      .object({ id: GoId })
      .strict()
      .safeParse(
        await context.req.json().catch((error) => {
          warnCause("go_body_invalid", error);
          return null;
        }),
      );
    if (!parsed.success) return context.json({ message: COPY.badRequest }, 400);
    const result = await store.redeem(parsed.data.id, deps.clock());
    if (result.status !== "open")
      return context.json(
        {
          message:
            result.status === "gone" ? COPY.linkExpired : COPY.actionNotFound,
        },
        result.status === "gone" ? 410 : 404,
      );
    return context.json({ target: goTarget(result.session) });
  });
  app.route("/", routes);
}
