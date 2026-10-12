import { safeCause, warnCause } from "@onepercent/service-kit";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { getConnInfo } from "@hono/node-server/conninfo";
import { SERVICES, WEB } from "@onepercent/config";
import { count, t } from "@onepercent/copy";
import {
  BeaconEvent,
  LogoParams,
  RoyaltiesRequest,
  RoyaltiesResponse,
  ValuesRequest,
  ValuesResponse,
  WebConfigResponse,
  wireJson,
  EventsRequest,
  EventsResponse,
  HighlightsRequest,
  HighlightsResponse,
  SendRequest,
  SendResponse,
} from "@onepercent/web-api";
import { isIP } from "node:net";
import { RpcProxySaturated } from "../public/rpc-transport.js";
import { SendValidationError } from "./send.js";
import { PublicHttpError } from "../public/signer.js";
import { PUBLIC_STREAM_LIMITS } from "../public/stream-limits.js";
import { createWebDependencies, type WebDependencies } from "./deps.js";
import { webRouteName } from "./log.js";
function clientIp(context: Context, deps: WebDependencies): string {
  if (deps.trustedProxyHeader)
    return context.req.header(deps.trustedProxyHeader)?.trim() || "unknown";
  try {
    return getConnInfo(context).remote.address || "unknown";
  } catch (error) {
    warnCause("web_client_ip_unavailable", error);
    return "unknown";
  }
}
async function readBody(context: Context, maximum: number): Promise<unknown> {
  const reader = context.req.raw.body?.getReader();
  if (!reader) throw new Error("Missing body");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > maximum) throw new Error("Body too large");
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch((error) => {
      warnCause("web_body_cancel_failed", error);
    });
  }
}
export function createWebRouter(
  deps: WebDependencies = createWebDependencies(),
) {
  const router = new Hono();
  const sendingByIp = new Map<string, number>();
  for (const path of [
    "/api/values",
    "/api/beacon",
    "/api/logo/*",
    "/api/web/config",
    "/api/events",
    "/api/highlights",
    "/api/send",
    "/api/royalties/*",
  ])
    router.use(
      path,
      cors({
        origin: [deps.webOrigin],
        allowMethods: ["GET", "POST"],
        allowHeaders: ["Content-Type"],
      }),
    );
  router.onError((_error, context) => {
    if (_error instanceof RpcProxySaturated)
      context.header("Retry-After", String(_error.retryAfterS));
    if (
      (_error instanceof PublicHttpError && _error.status === 400) ||
      _error instanceof SendValidationError
    ) {
      deps.logger.warn(
        { reason: "web_request_invalid", cause: safeCause(_error) },
        "Web request invalid",
      );
      return context.json(
        { error: "invalid_request", message: t("errors.generic") },
        400,
      );
    }
    deps.logger.warn(
      {
        reason: "web_route_failed",
        route: webRouteName(context.req.path),
        cause: safeCause(_error),
      },
      "Web request failed",
    );
    return context.json(
      { error: "unavailable", message: t("common.networkError") },
      503,
    );
  });
  router.get("/api/web/config", (context) =>
    context.json(WebConfigResponse.parse(deps.config)),
  );
  const liveActive = new Map<string, number>();
  for (const path of ["/api/events", "/api/highlights"])
    router.use(path, async (context, next) => {
      const ip = clientIp(context, deps);
      if (!deps.liveLimiter) throw new Error("Public parameters unavailable");
      const limit = deps.liveLimiter.take(ip);
      if (
        !limit.allowed ||
        (liveActive.get(ip) ?? 0) >= PUBLIC_STREAM_LIMITS.maxClientsPerIp
      ) {
        context.header("Retry-After", String(limit.retryAfter || 1));
        return context.json(
          {
            error: "rate_limited",
            message: t("errors.rateLimited", {
              s: count(limit.retryAfter || 1),
            }),
          },
          429,
        );
      }
      liveActive.set(ip, (liveActive.get(ip) ?? 0) + 1);
      try {
        await next();
      } finally {
        const remaining = (liveActive.get(ip) ?? 1) - 1;
        if (remaining) liveActive.set(ip, remaining);
        else liveActive.delete(ip);
      }
    });
  router.get("/api/royalties/:wallet", async (context) => {
    const parsed = RoyaltiesRequest.safeParse({
      ...context.req.query(),
      wallet: context.req.param("wallet"),
    });
    if (!parsed.success)
      return context.json(
        { error: "invalid_request", message: t("errors.generic") },
        400,
      );
    const result = await deps.royalties.get(
      parsed.data.wallet,
      parsed.data.before,
    );
    const body = wireJson(result);
    RoyaltiesResponse.parse(JSON.parse(body));
    return context.body(body, 200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
  });
  router.post("/api/send", async (context) => {
    const source = clientIp(context, deps);
    const ip = isIP(source) ? source : "unknown";
    const limit = deps.sendLimiter.take(ip);
    if (!limit.allowed) {
      context.header("Retry-After", String(limit.retryAfter));
      return context.json(
        {
          error: "rate_limited",
          message: t("errors.rateLimited", { s: count(limit.retryAfter) }),
        },
        429,
      );
    }
    const active = sendingByIp.get(ip) ?? 0;
    if (active >= SERVICES.api.rpcMaxConcurrentPerIp)
      throw new RpcProxySaturated(SERVICES.api.rpcCapacityRetryAfterSeconds);
    sendingByIp.set(ip, active + 1);
    try {
      const parsed = SendRequest.safeParse(
        await readBody(context, 2_048).catch((error) => {
          warnCause("web_body_invalid", error);
          return null;
        }),
      );
      if (!parsed.success)
        return context.json(
          { error: "invalid_request", message: t("errors.generic") },
          400,
        );
      const signature = await deps.sender.send(parsed.data.tx);
      context.header("Cache-Control", "no-store");
      return context.json(SendResponse.parse({ signature }));
    } finally {
      const remaining = sendingByIp.get(ip)! - 1;
      if (remaining === 0) sendingByIp.delete(ip);
      else sendingByIp.set(ip, remaining);
    }
  });
  router.get("/api/events", async (context) => {
    const request = EventsRequest.safeParse(context.req.query());
    if (!request.success)
      return context.json(
        { error: "invalid_request", message: t("errors.generic") },
        400,
      );
    const events = await deps.events(request.data.after);
    const body = wireJson(events);
    EventsResponse.parse(JSON.parse(body));
    return context.body(body, 200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
  });
  router.get("/api/highlights", async (context) => {
    const request = HighlightsRequest.safeParse(context.req.query());
    if (!request.success)
      return context.json(
        { error: "invalid_request", message: t("errors.generic") },
        400,
      );
    const result = await deps.highlights(request.data.window);
    const body = wireJson(result);
    HighlightsResponse.parse(JSON.parse(body));
    return context.body(body, 200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
  });
  router.post("/api/values", async (context) => {
    const parsed = ValuesRequest.safeParse(
      await readBody(context, WEB.valuesBatchMax * 256).catch((error) => {
        warnCause("web_body_invalid", error);
        return null;
      }),
    );
    if (!parsed.success)
      return context.json(
        { error: "invalid_request", message: t("errors.generic") },
        400,
      );
    const limit = deps.valuesLimiter.take(
      clientIp(context, deps),
      parsed.data.items.length,
    );
    if (!limit.allowed) {
      context.header("Retry-After", String(limit.retryAfter));
      return context.json(
        {
          error: "rate_limited",
          message: t("errors.rateLimited", { s: count(limit.retryAfter) }),
        },
        429,
      );
    }
    const result = await deps.values.get(parsed.data);
    // Validate the actual wire representation, including every u64, before returning it.
    const body = wireJson(result);
    ValuesResponse.parse(JSON.parse(body));
    return context.body(body, 200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
  });
  router.get("/api/logo/:mint", async (context) => {
    context.header("X-Content-Type-Options", "nosniff");
    const parsed = LogoParams.safeParse(context.req.param());
    if (parsed.success && !deps.logos.hasCached(parsed.data.mint)) {
      // Until PARAMS has a dedicated logo budget, misses use its existing item limit.
      const limit = deps.logoLimiter.take(clientIp(context, deps));
      if (!limit.allowed) {
        context.header("Retry-After", String(limit.retryAfter));
        return context.json(
          {
            error: "rate_limited",
            message: t("errors.rateLimited", { s: count(limit.retryAfter) }),
          },
          429,
        );
      }
    }
    const image = parsed.success
      ? await deps.logos.get(parsed.data.mint)
      : null;
    if (!image) return context.body(null, 404);
    return context.body(Buffer.from(image.bytes), 200, {
      "Content-Type": image.type,
      "Cache-Control": "public, max-age=86400",
    });
  });
  router.post("/api/beacon", async (context) => {
    const event = BeaconEvent.safeParse(
      await readBody(context, 2_048).catch((error) => {
        warnCause("web_body_invalid", error);
        return null;
      }),
    );
    if (!event.success)
      return context.json(
        { error: "invalid_request", message: t("errors.generic") },
        400,
      );
    const limit = deps.beaconLimiter.take(clientIp(context, deps));
    if (!limit.allowed) {
      context.header("Retry-After", String(limit.retryAfter));
      return context.body(null, 429);
    }
    await deps.counters.record(event.data);
    return context.body(null, 204);
  });
  return router;
}
export function registerWeb(app: Hono, deps?: WebDependencies): void {
  app.route("/", createWebRouter(deps));
}
