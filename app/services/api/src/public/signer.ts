import { warnCause } from "@onepercent/service-kit";
import { z } from "zod";
import { SignerErrorResponse } from "@onepercent/sdk/api";
import type { PublicSettings } from "./settings.js";

export class PublicHttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 429 | 503,
    readonly code: string,
    readonly retryAfterS?: number,
  ) {
    super(code);
  }
}
export interface SignerTarget {
  url: string;
  token: string;
}
const targetSchema = z
  .object({ url: z.url({ protocol: /^https?$/ }), token: z.string().min(32) })
  .strict();

/** Only operator-configured destinations; redirects cannot forward the bearer token. */
export function createSignerProxy(options: {
  intake: SignerTarget | undefined;
  quote: SignerTarget | undefined;
  settings: PublicSettings;
  fetch?: typeof fetch;
}) {
  const targets = {
    intake: targetSchema.optional().parse(options.intake),
    quote: targetSchema.optional().parse(options.quote),
  };
  if (
    targets.intake &&
    targets.quote &&
    targets.intake.token === targets.quote.token
  )
    throw new Error("signer_tokens_must_differ");
  for (const target of Object.values(targets)) {
    if (!target) continue;
    const url = new URL(target.url);
    if (url.username || url.password || url.search || url.hash)
      throw new Error("invalid_signer_url");
  }
  const state = {
    intake: { failures: 0, until: 0 },
    quote: { failures: 0, until: 0 },
  };
  return async <T>(
    role: "intake" | "quote",
    body: unknown,
    ipHash: string,
    schema: z.ZodType<T>,
  ): Promise<T> => {
    const circuit = state[role];
    if (Date.now() < circuit.until)
      throw new PublicHttpError(503, "signer_unavailable");
    const target = targets[role];
    if (!target) throw new PublicHttpError(503, "signer_unavailable");
    let countFailure = true;
    try {
      const response = await (options.fetch ?? fetch)(
        new URL(
          role === "intake"
            ? "/internal/feed/attest"
            : "/internal/sellback/quote",
          target.url,
        ),
        {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${target.token}`,
            "x-client-ip-hash": ipHash,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.settings.transport.rpcTimeoutMs),
        },
      );
      // Reading the body can fail with a transport error too. A parsed refusal
      // proves the signer is reachable and must never open its circuit.
      const text = await response.text();
      countFailure = response.status >= 500;
      const payload: unknown = JSON.parse(text);
      if (!response.ok) {
        const failure = SignerErrorResponse.safeParse(payload);
        if (
          failure.success &&
          (response.status === 429 || response.status === 503)
        ) {
          countFailure = false;
          const retry = Number(response.headers.get("retry-after"));
          throw new PublicHttpError(
            response.status,
            failure.data.reason,
            Number.isSafeInteger(retry) && retry > 0 ? retry : undefined,
          );
        }
        throw new Error("invalid_signer_response");
      }
      countFailure = false;
      const result = schema.parse(payload);
      circuit.failures = 0;
      circuit.until = 0;
      return result;
    } catch (error) {
      warnCause("signer_request_failed", error);
      if (!countFailure) {
        circuit.failures = 0;
        circuit.until = 0;
      } else if (
        ++circuit.failures >= options.settings.transport.breakerFailureThreshold
      )
        circuit.until =
          Date.now() + options.settings.transport.breakerOpenSeconds * 1_000;
      if (error instanceof PublicHttpError) throw error;
      throw new PublicHttpError(503, "signer_unavailable");
    }
  };
}

/** Private S0 readiness exposes only a bounded public status, never its details. */
export function createSignerReadiness(options: {
  intake: SignerTarget | undefined;
  quote: SignerTarget | undefined;
  settings: PublicSettings;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const schema = z.object({
    ok: z.boolean(),
    key: z.object({
      ok: z.boolean(),
      reason: z.enum(["role_mismatch", "role_disabled"]).optional(),
    }),
  });
  const now = options.now ?? Date.now;
  let cached:
    { at: number; value: Awaited<ReturnType<typeof load>> } | undefined;
  let pending: ReturnType<typeof load> | undefined;
  const load = async () => {
    const read = async (role: "intake" | "quote") => {
      if (!options[role]) return "unavailable" as const;
      try {
        const target = targetSchema.parse(options[role]);
        const response = await (options.fetch ?? fetch)(
          new URL("/ready", target.url),
          {
            redirect: "error",
            headers: { authorization: `Bearer ${target.token}` },
            signal: AbortSignal.timeout(
              options.settings.transport.rpcTimeoutMs,
            ),
          },
        );
        const body = schema.parse(await response.json());
        if (!body.key.ok && body.key.reason) return body.key.reason;
        return response.ok && body.ok && body.key.ok
          ? ("ready" as const)
          : ("unavailable" as const);
      } catch (error) {
        warnCause("signer_readiness_unavailable", error);
        return "unavailable" as const;
      }
    };
    const [intake, quote] = await Promise.all([read("intake"), read("quote")]);
    return { intake, quote };
  };
  return async () => {
    if (cached && now() >= cached.at && now() - cached.at < 5_000)
      return cached.value;
    if (pending) return pending;
    const at = now();
    pending = load();
    try {
      const value = await pending;
      cached = { at, value };
      return value;
    } finally {
      pending = undefined;
    }
  };
}
