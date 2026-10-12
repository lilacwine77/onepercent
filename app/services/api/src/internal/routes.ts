import { Hono, type Context } from "hono";
import {
  bearerMatches,
  serviceParams,
  type ServiceMetrics,
  warnCause,
} from "@onepercent/service-kit";
import type { z } from "zod";
import { SignerErrorResponse, SignerErrorReason } from "@onepercent/sdk/api";
import { SignerError } from "./error.js";
import { rateParamsSchema } from "./params.js";
import { feedResponseSchema, ipHashSchema } from "../intake/schema.js";
import type { IntakeService } from "../intake/service.js";
import {
  sellBackQuoteRequestSchema,
  sellBackQuoteResponseSchema,
  type QuoteService,
} from "../quote/index.js";

export interface SignerLimiter {
  limit(
    key: string,
    max: number,
    windowS: number,
  ): Promise<{ ok: boolean; retryAfterS: number }>;
}
type Rates = z.infer<typeof rateParamsSchema>;
const paths = {
  "intake-signer": "/feed/attest",
  "quote-signer": "/sellback/quote",
} as const;
function safeReason(error: unknown) {
  const parsed = SignerErrorReason.safeParse(
    error instanceof Error ? error.message : undefined,
  );
  if (parsed.success) return parsed.data;
  // D24: keep transport/auth failures inside S4's exact six-code contract.
  return error instanceof SignerError && error.status === 401
    ? "role_mismatch"
    : "evidence_unavailable";
}
function handleErrors(app: Hono) {
  app.onError((error, context) => {
    warnCause("signer_request_failed", error);
    const reason = safeReason(error);
    const status = error instanceof SignerError ? error.status : 503;
    if (error instanceof SignerError && error.retryAfterS)
      context.header("Retry-After", String(error.retryAfterS));
    return context.json(SignerErrorResponse.parse({ reason }), status);
  });
}
async function limited(limiter: SignerLimiter, key: string, max: number) {
  const result = await limiter.limit(key, max, 60);
  if (!result.ok)
    throw new SignerError(
      429,
      "rate_limited",
      Math.max(1, Math.ceil(result.retryAfterS)),
    );
}
async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (error) {
    warnCause("invalid_request", error);
    throw new SignerError(400, "invalid_request");
  }
}

/** One route per process; a private role can never call the other role's signer. */
export function createInternalSignerApp(
  options: {
    token: string;
    limiter: SignerLimiter;
    rates: Rates;
    metrics?: ServiceMetrics;
    logDecision?(fields: {
      role: string;
      result: string;
      durationMs: number;
    }): void;
  } & (
    | { role: "intake-signer"; service: IntakeService }
    | { role: "quote-signer"; service: QuoteService }
  ),
) {
  if (options.token.length < 32 || /\s/.test(options.token))
    throw new Error("invalid_internal_token");
  const rates = rateParamsSchema.parse(options.rates);
  const app = new Hono();
  handleErrors(app);
  app.post(`/internal${paths[options.role]}`, async (c) => {
    const started = performance.now();
    try {
      if (!bearerMatches(c.req.header("authorization"), options.token))
        throw new SignerError(401, "unauthorized");
      const ipHash = c.req.header("x-client-ip-hash");
      if (!ipHashSchema.safeParse(ipHash).success)
        throw new SignerError(400, "invalid_request");
      const raw = await body(c);
      const parsed =
        options.role === "intake-signer"
          ? options.service.requestSchema.safeParse(raw)
          : sellBackQuoteRequestSchema.safeParse(raw);
      if (!parsed.success) throw new SignerError(400, "invalid_request");
      const wallet =
        "wallet" in parsed.data ? parsed.data.wallet : parsed.data.owner;
      await limited(
        options.limiter,
        `onepct:signer:${options.role}:wallet:${wallet}`,
        rates.rateLimitPerMinutePerWallet,
      );
      const result = await options.service.handle(
        parsed.data,
        ipHash!,
        AbortSignal.any([
          c.req.raw.signal,
          AbortSignal.timeout(serviceParams.transport.rpcTimeoutMs),
        ]),
      );
      options.logDecision?.({
        role: options.role,
        result: "ok",
        durationMs: performance.now() - started,
      });
      options.metrics?.signerRequestsTotal.inc({
        role: options.role,
        result: "ok",
      });
      if ("refused" in result)
        for (const refusal of result.refused)
          options.metrics?.signerRefusalsTotal.inc({
            role: options.role,
            reason: refusal.reason,
          });
      if ("ok" in result && !result.ok)
        options.metrics?.signerRefusalsTotal.inc({
          role: options.role,
          reason: result.reason,
        });
      return c.json(
        options.role === "intake-signer"
          ? feedResponseSchema.parse(result)
          : sellBackQuoteResponseSchema.parse(result),
      );
    } catch (error) {
      const reason = safeReason(error);
      options.logDecision?.({
        role: options.role,
        result: reason,
        durationMs: performance.now() - started,
      });
      options.metrics?.signerRequestsTotal.inc({
        role: options.role,
        result: reason,
      });
      if (reason === "rate_limited")
        options.metrics?.rateLimitedTotal.inc({ route: paths[options.role] });
      throw error;
    }
  });
  return app;
}
