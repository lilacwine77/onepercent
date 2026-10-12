import type { Handler, Hono } from "hono";
import { type ServiceRuntime, safeCause } from "@onepercent/service-kit";
import { createPublicApi } from "./runtime.js";
import { loadPublicEnv } from "./env.js";
import { createPublicData } from "./data/index.js";

export { createPublicApi };
export { createPublicRouter } from "./router.js";
export type { PublicData, PublicRouterOptions } from "./router.js";

/** One additive registration seam; the enclosing API owns CORS and S0 health. */
export function registerPublic(app: Hono, runtime?: ServiceRuntime): void {
  if (!runtime) return;
  if (runtime.role !== "public" || runtime.key)
    throw new Error("public_role_required");
  // Isolation and invalid credentials fail at boot; absent signers stay offline.
  const env = loadPublicEnv(process.env);
  for (const [signer, available] of [
    ["intake", env.INTAKE_SIGNER_URL && env.INTAKE_INTERNAL_TOKEN],
    ["quote", env.QUOTE_SIGNER_URL && env.QUOTE_INTERNAL_TOKEN],
  ]) {
    if (!available)
      runtime.logger.warn(
        { reason: "signer_configuration_missing", signer },
        "public signer unavailable",
      );
  }
  // M6 B14: bootstrap config is independent of P0 service settings and signers.
  const config = createPublicData({ runtime, flags: env.flags });
  app.get("/api/config", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      return context.json(await config.config());
    } catch (error) {
      runtime.logger.warn(
        { reason: "service_unavailable", cause: safeCause(error) },
        "public config unavailable",
      );
      return context.json(
        { asOfSlot: null, error: { code: "service_unavailable" } },
        503,
      );
    }
  });
  let router: Hono | undefined;
  const handler: Handler = async (context) => {
    try {
      router ??= createPublicApi(runtime, process.env, {
        includeHealth: false,
        includeCors: false,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "public_parameters_unavailable"
      )
        throw error;
      runtime.logger.warn(
        { reason: "public_parameters_unavailable", cause: safeCause(error) },
        "public request unavailable",
      );
      context.header("Cache-Control", "no-store");
      return context.json(
        { asOfSlot: null, error: { code: "public_parameters_unavailable" } },
        503,
      );
    }
    return router.fetch(context.req.raw, context.env);
  };
  // Exact S4 routes leave both existing and future sibling lanes untouched.
  for (const path of [
    "/api/machine",
    "/api/me/:wallet",
    "/api/verify/:seq",
    "/api/stream",
    "/api/value",
    "/api/status",
    "/api/block0",
    "/api/creator-fees",
  ])
    app.get(path, handler);
  for (const path of ["/api/feed/attest", "/api/sellback/quote", "/api/rpc"])
    app.post(path, handler);
  app.post("/api/hold/attest", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      { asOfSlot: null, error: { code: "not_available" } },
      404,
    );
  });
}
