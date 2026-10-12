import { warnCause } from "@onepercent/service-kit";
import type { GoStore } from "../go/store.js";
import { Hono } from "hono";
import { COPY } from "../actions/copy.js";
import pino from "pino";
import type { ApiEnv } from "../env.js";
import type { XrayPort } from "../actions/xray-port.js";
import { InMemoryLinkRateLimiter, type LinkRateLimiter } from "./ratelimit.js";
import { InMemoryLinkStore, type Clock, type LinkStore } from "./store.js";
import { registerLinkRoutes } from "./routes.js";

export interface ApiDependencies {
  webOrigin: string;
  secret?: string;
  trustProxyHeader?: string;
  ipSalt?: string;
  cluster?: "mainnet-beta" | "devnet" | "localnet";
  blinksXray?: boolean;
  goStore?: GoStore;
  clock: Clock;
  linkStore: LinkStore;
  linkRateLimiter: LinkRateLimiter;
  xrayPort?: XrayPort;
  logger: { info(message: string): void };
}
export function defaultDeps(
  env: Pick<ApiEnv, "WEB_ORIGIN" | "BOT_API_SECRET" | "TRUST_PROXY_HEADER">,
): ApiDependencies {
  const clock = Date.now;
  return {
    webOrigin: env.WEB_ORIGIN,
    secret: env.BOT_API_SECRET,
    trustProxyHeader: env.TRUST_PROXY_HEADER,
    clock,
    linkStore: new InMemoryLinkStore(clock),
    linkRateLimiter: new InMemoryLinkRateLimiter(clock),
    logger: pino({ name: "link" }),
  };
}
export function registerLink(app: Hono, deps: ApiDependencies): void {
  if (!deps.secret) deps.logger.info("link disabled");
  const routes = new Hono();
  routes.onError((error, context) => {
    warnCause("link_request_failed", error);
    return context.json({ message: COPY.unavailable }, 503);
  });
  registerLinkRoutes(routes, deps);
  app.route("/", routes);
}
