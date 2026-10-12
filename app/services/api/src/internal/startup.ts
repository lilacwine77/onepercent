import { loadMarketEnv } from "@onepercent/market";
import {
  bearerMatches,
  type ServiceRuntime,
  safeCause,
  warnCause,
} from "@onepercent/service-kit";
import { SignerErrorResponse } from "@onepercent/sdk/api";
import { Hono } from "hono";
import { z } from "zod";
import { createIndexerTimeReader } from "../intake/store.js";
import { SignerError } from "./error.js";
import { createRuntimeSignerApp } from "./runtime.js";

/** SWITCH to S1's shared status schema when it is merged. scanSlot is its
 * completed polling boundary; asOfSlot is only the last applied transaction. */
export function createIndexerStatusTimeReader(
  runtime: Pick<ServiceRuntime, "rpc" | "redis">,
) {
  return createIndexerTimeReader({
    rpc: runtime.rpc,
    readIndexedSlot: async () => {
      try {
        const raw = await runtime.redis.get("onepct:indexer:status");
        const status = z
          .object({
            available: z.literal(true).optional(),
            scanSlot: z
              .string()
              .regex(/^\d+$/)
              .transform(Number)
              .pipe(z.number().int().nonnegative().safe()),
          })
          .parse(JSON.parse(raw ?? "null"));
        return status.scanSlot;
      } catch (error) {
        warnCause("indexer_lag", error);
        throw new SignerError(503, "indexer_lag");
      }
    },
  });
}

/** Mount before listenRuntime; no second port, listener, runtime or role key. */
export function mountPrivateSigner(
  runtime: ServiceRuntime,
  options: Partial<Parameters<typeof createRuntimeSignerApp>[1]> = {},
) {
  try {
    const app = createRuntimeSignerApp(runtime, {
      ...options,
      marketEnv: options.marketEnv ?? loadMarketEnv(),
      indexerTime:
        options.indexerTime ?? createIndexerStatusTimeReader(runtime),
    });
    runtime.health.route("/", app);
  } catch (error) {
    // D24: a pending compiled parameter keeps the process observable. Never
    // turn key isolation, credential or unexpected startup failures into readiness.
    if (
      !(error instanceof SignerError) ||
      error.reason !== "params_unavailable"
    )
      throw error;
    runtime.logger.warn(
      { reason: error.reason, role: runtime.role, cause: safeCause(error) },
      "signer parameters unavailable",
    );
    const unavailable = new Hono();
    unavailable.get("/health", (c) =>
      c.json(
        {
          ok: false,
          reason: error.reason,
          version: runtime.env.APP_VERSION,
          commit: runtime.env.GIT_COMMIT,
        },
        503,
      ),
    );
    unavailable.get("/ready", (c) =>
      c.json(
        {
          ok: false,
          reason: error.reason,
          checks: { parameters: false },
          key: runtime.guard?.status() ?? { ok: false },
        },
        503,
      ),
    );
    const path =
      runtime.role === "intake-signer"
        ? "/internal/feed/attest"
        : "/internal/sellback/quote";
    unavailable.post(path, (c) => {
      if (
        !runtime.env.INTERNAL_TOKEN ||
        !bearerMatches(
          c.req.header("authorization"),
          runtime.env.INTERNAL_TOKEN,
        )
      )
        return c.json(
          SignerErrorResponse.parse({ reason: "role_mismatch" }),
          401,
        );
      return c.json(
        SignerErrorResponse.parse({ reason: "evidence_unavailable" }),
        503,
      );
    });
    // The replacement is mounted before listenRuntime, so S0's health handlers
    // cannot shadow these 503s. Metrics and the normal shutdown lifecycle remain.
    unavailable.route("/", runtime.health);
    runtime.health = unavailable;
  }
}
