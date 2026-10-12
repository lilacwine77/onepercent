import { warnCause } from "@onepercent/service-kit";
import { count } from "@onepercent/copy";
import { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { XRAY } from "@onepercent/eligibility";
import { API_MESSAGES } from "@onepercent/eligibility/copy";
import { renderCardPng } from "../cards/render.js";
import { XrayError } from "./error.js";
import type { XrayEnv } from "./env.js";
import { isBotAuthorized, type RateLimiter } from "./rate-limit.js";
import { canonicalAddress, type XrayService } from "./service.js";
import type { TurnstileVerifier } from "./turnstile.js";
import type { SharePageRenderer } from "./share-page.js";

export interface XrayRouterDependencies {
  service: XrayService;
  limiter: RateLimiter;
  turnstile: TurnstileVerifier;
  env: XrayEnv;
  sharePage: SharePageRenderer;
  renderCard?: typeof renderCardPng;
}
export function createXrayRouter(deps?: XrayRouterDependencies) {
  const router = new Hono();
  const ready = async () =>
    deps ?? (await import("./deps.js")).getDefaultXrayDependencies();
  router.onError((error, context) => {
    warnCause("xray_request_failed", error);
    if (error instanceof XrayError)
      return context.json(
        { error: error.code, message: error.message },
        error.status,
      );
    return context.json(
      { error: "upstream_failed", message: API_MESSAGES.upstream_failed },
      502,
    );
  });
  for (const path of ["/api/xray/*", "/x/*"])
    router.use(path, async (context, next) => {
      const resolved = await ready();
      if (
        isBotAuthorized(
          context.req.header("Authorization"),
          resolved.env.BOT_API_SECRET,
        )
      )
        return next();
      let ip = resolved.env.TRUST_PROXY_HEADER
        ? context.req.header(resolved.env.TRUST_PROXY_HEADER)?.trim()
        : undefined;
      if (!resolved.env.TRUST_PROXY_HEADER) {
        try {
          ip = getConnInfo(context).remote.address;
        } catch (error) {
          warnCause("xray_client_ip_unavailable", error);
          /* Test adapters have no socket. */
        }
      }
      ip ||= "unknown";
      const limit = resolved.limiter.take(ip);
      if (!limit.allowed) {
        context.header("Retry-After", String(limit.retryAfter));
        throw new XrayError("rate_limited", 429, {
          s: count(limit.retryAfter),
        });
      }
      if (
        /^\/api\/xray\/[^/]+$/.test(context.req.path) &&
        limit.count > XRAY.turnstileAfterRequests &&
        !(await resolved.turnstile.verify(
          context.req.header("cf-turnstile-response"),
          ip,
        ))
      )
        throw new XrayError("turnstile_required", 403);
      await next();
    });
  router.get("/api/xray/:address", async (context) => {
    const resolved = await ready();
    return context.json(
      await resolved.service.get(context.req.param("address"), {
        ref: context.req.query("ref"),
      }),
    );
  });
  router.get("/api/xray/:address/card.png", async (context) => {
    const format = context.req.query("format") ?? "landscape";
    if (format !== "landscape" && format !== "square")
      throw new XrayError("invalid_format", 400);
    const resolved = await ready();
    const record = await resolved.service.getRecord(
      context.req.param("address"),
      { ref: context.req.query("ref") },
    );
    const bytes = await (resolved.renderCard ?? renderCardPng)(record, format);
    context.header("Content-Type", "image/png");
    context.header("Cache-Control", "public, max-age=3600");
    return context.body(Buffer.from(bytes));
  });
  router.get("/x/:address", async (context) => {
    // Share URLs are canonical addresses only; malformed input never scans.
    const raw = context.req.param("address");
    const address = canonicalAddress(raw);
    const resolved = await ready();
    // A browser opening a share link always gets the app, which renders its own
    // error states; crawlers still get the 404 status for malformed input.
    if (!address)
      return context.html(await resolved.sharePage.renderShell(raw), 404);
    try {
      const result = await resolved.service.get(address, {
        ref: context.req.query("ref"),
      });
      return context.html(await resolved.sharePage.render(result));
    } catch (error) {
      warnCause("xray_share_fallback", error);
      context.header("Cache-Control", "no-cache");
      return context.html(await resolved.sharePage.renderShell(address));
    }
  });
  return router;
}
