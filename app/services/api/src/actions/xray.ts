import { warnCause } from "@onepercent/service-kit";
import { XRAY } from "@onepercent/config";
import type { ApiDependencies } from "../link/index.js";
import { clientIpKey } from "../link/ratelimit.js";
import { XrayError } from "../xray/error.js";
import type {
  ActionError,
  ActionGetResponse,
  ExternalLinkResponse,
} from "@solana/actions-spec";
import type { Hono } from "hono";
import { publicKeyBytes } from "../link/base58.js";
import { COPY } from "./copy.js";
import {
  formatSolDisplay,
  joinDescription,
  truncateDisplay,
} from "./format.js";
import { ActionPostRequestSchema } from "./spec.js";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import type { XrayPort } from "./xray-port.js";

export function fallbackIcon(webOrigin: string): string {
  // TODO(art): the architect supplies 1080-square Blink images in M5.2.
  return new URL("/assets/pack-3d.png", webOrigin).href;
}
export function keptRefQuery(ref: string | undefined): string {
  return ref &&
    (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref) || /^[a-z0-9_]{3,16}$/.test(ref))
    ? `?ref=${encodeURIComponent(ref)}`
    : "";
}
export function genericXray(
  webOrigin: string,
  ref: string | undefined,
): ActionGetResponse {
  return {
    type: "action",
    icon: fallbackIcon(webOrigin),
    title: COPY.xrayTitle,
    description: COPY.xrayDescription,
    label: COPY.xrayLabel,
    links: {
      actions: [
        {
          type: "external-link",
          label: COPY.xrayLabel,
          href: `/api/actions/xray${keptRefQuery(ref)}`,
        },
      ],
    },
  } satisfies ActionGetResponse;
}
export function registerXray(
  app: Hono,
  deps: ApiDependencies,
  xray: XrayPort,
): void {
  const { webOrigin } = deps;
  for (const path of ["/api/actions/xray", "/api/actions/xray/:address"]) {
    app.get(path, async (context) => {
      const input =
        context.req.param("address") ??
        context.req.query("address") ??
        context.req.query("addr");
      const generic = genericXray(webOrigin, context.req.query("ref"));
      if (!deps.blinksXray) {
        return context.json({
          ...generic,
          links: undefined,
          disabled: true,
          error: { message: COPY.off },
        });
      }
      if (input === undefined) return context.json(generic);
      const address = input.trim();
      const isName = /^[^\s/]{1,100}\.sns$/i.test(address);
      if (!isName && !publicKeyBytes(address))
        return context.json(
          { message: COPY.actionInvalidAddress } satisfies ActionError,
          400,
        );
      const limited = await deps.linkRateLimiter.consume(
        `actions-xray:${clientIpKey(context, deps)}`,
        { limit: XRAY.rateLimitPerMinutePerIp, windowMs: 60_000 },
      );
      if (!limited.ok) {
        context.header("Retry-After", String(limited.retryAfterS));
        return context.json(
          { message: COPY.actionRateLimited(limited.retryAfterS) },
          429,
        );
      }
      try {
        const ref = keptRefQuery(context.req.query("ref"))
          ? context.req.query("ref")
          : undefined;
        const data = XrayResultSchema.parse(
          await xray.get(address, ref ? { ref } : undefined),
        );
        const { bags, feedable, checkAtFeed, sellable } = data.counts;
        const description = joinDescription([
          bags ? COPY.bags(bags) : "",
          feedable ? COPY.feedable(feedable) : "",
          checkAtFeed ? COPY.checkAtFeed(checkAtFeed) : "",
          sellable
            ? COPY.bids(sellable, formatSolDisplay(data.totals.sellValueSol))
            : "",
        ]);
        return context.json({
          ...genericXray(webOrigin, ref ?? data.address),
          icon: data.share.squareUrl,
          title: truncateDisplay(
            COPY.xrayFor(
              `${data.address.slice(0, 4)}…${data.address.slice(-4)}`,
            ),
            40,
          ),
          description:
            description ||
            (data.counts.empty
              ? COPY.emptyAccounts(
                  data.counts.empty,
                  formatSolDisplay(data.totals.rentBackSol),
                )
              : COPY.xrayClean),
        } satisfies ActionGetResponse);
      } catch (error) {
        warnCause("xray_action_failed", error);
        if (
          error instanceof XrayError &&
          error.status >= 400 &&
          error.status < 500 &&
          (error.code === "invalid_address" || error.code === "name_not_found")
        ) {
          return context.json(
            {
              message:
                error.code === "invalid_address"
                  ? COPY.actionInvalidAddress
                  : COPY.nameNotFound,
            },
            400,
          );
        }
        context.header("Cache-Control", "no-store");
        return context.json({
          ...generic,
          error: { message: COPY.xrayBusy },
        } satisfies ActionGetResponse);
      }
    });
    app.post(path, async (context) => {
      if (!deps.blinksXray) return context.json({ message: COPY.off }, 403);
      let body: unknown;
      try {
        body = await context.req.json();
      } catch (error) {
        warnCause("action_body_invalid", error);
        body = null;
      }
      const parsed = ActionPostRequestSchema.safeParse(body);
      if (!parsed.success || !publicKeyBytes(parsed.data.account))
        return context.json(
          { message: COPY.badRequest } satisfies ActionError,
          400,
        );
      return context.json({
        type: "external-link",
        externalLink: `${webOrigin}/x/${parsed.data.account}${keptRefQuery(context.req.query("ref")) || keptRefQuery(parsed.data.account)}`,
      } satisfies ExternalLinkResponse);
    });
  }
}
