import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  ConfigResponse,
  MachineResponse,
  MeResponse,
  VerifyResponse,
  StatusResponse,
  HealthResponse,
  PublicKeyString,
  U64String,
  ValueRequest,
  ValueResponse,
  FeedAttestResponse,
  SellBackQuoteResponse,
  createFeedAttestRequest,
  createSellBackQuoteRequest,
  Block0Response,
  CreatorFeesQuery,
  CreatorFeesResponse,
} from "@onepercent/sdk/api";
import {
  hashClientIp,
  type JsonRpcClient,
  type SlidingWindowLimiter,
  warnCause,
} from "@onepercent/service-kit";
import { cachedRead, type PublicCache } from "./cache.js";
import { createRpcRequestValidator, proxyRpc, RpcRequestError } from "./rpc.js";
import { RpcProxySaturated } from "./rpc-transport.js";
import { PublicHttpError } from "./signer.js";
import {
  publicStream,
  PublicStreamHub,
  type PublicEventSource,
} from "./stream.js";
import { publicSettingsSchema, type PublicSettings } from "./settings.js";

export interface PublicData {
  config(): Promise<unknown>;
  machine(): Promise<unknown>;
  me(wallet: string): Promise<unknown>;
  verify(seq: string): Promise<unknown>;
  status(): Promise<unknown>;
  block0?(): Promise<unknown>;
  creatorFees?(limit: number): Promise<unknown>;
}
export interface PublicRouterOptions {
  /** The composed API owns CORS and delegates /health to S0. */
  includeHealth?: boolean;
  includeCors?: boolean;
  webOrigin: string;
  version: string;
  commit: string;
  cacheNamespace: string;
  ipSalt: string;
  deck: string;
  settings: PublicSettings;
  data: PublicData;
  cache: PublicCache;
  limiter: Pick<SlidingWindowLimiter, "limit">;
  rpc: Pick<JsonRpcClient, "request">;
  events: PublicEventSource;
  clientIp(context: Context): string;
  signer<T>(
    role: "intake" | "quote",
    body: unknown,
    ipHash: string,
    schema: z.ZodType<T>,
  ): Promise<T>;
  value(mint: string, amount: bigint): Promise<unknown>;
  onError?(code: string, error: unknown): void;
}
export function createPublicRouter(options: PublicRouterOptions) {
  const settings = publicSettingsSchema.parse(options.settings);
  const streams = new PublicStreamHub(options.events, settings);
  const rpcActiveByIp = new Map<string, number>();
  const validateRpcRequest = createRpcRequestValidator(
    options.deck,
    settings.api.rpcMaxDataSliceBytes,
  );
  const app = new Hono();
  if (options.includeCors !== false)
    app.use(
      "*",
      cors({
        origin: options.webOrigin,
        allowMethods: ["GET", "POST"],
        allowHeaders: ["Content-Type", "Last-Event-ID"],
        exposeHeaders: ["Retry-After"],
      }),
    );
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.onError((error, context) => {
    const status =
      error.name === "PublicDataNotFound"
        ? 404
        : error instanceof PublicHttpError
          ? error.status
          : error instanceof RpcRequestError
            ? error.status
            : 503;
    const code =
      error instanceof PublicHttpError
        ? error.code
        : error instanceof RpcRequestError
          ? "rpc_request_refused"
          : "service_unavailable";
    if (error instanceof PublicHttpError && error.retryAfterS)
      context.header("Retry-After", String(error.retryAfterS));
    if (options.onError) options.onError(code, error);
    else warnCause(code, error);
    return context.json({ asOfSlot: null, error: { code } }, status);
  });
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const result = schema.safeParse(value);
    if (!result.success) throw new PublicHttpError(400, "invalid_request");
    return result.data;
  };
  const json = async (context: Context): Promise<unknown> => {
    try {
      return await context.req.json();
    } catch (error) {
      warnCause("invalid_request", error);
      throw new PublicHttpError(400, "invalid_request");
    }
  };
  const limitKey = async (key: string, max: number) => {
    const result = await options.limiter.limit(
      `onepct:${options.cacheNamespace}:limit:${key}`,
      max,
      60,
    );
    if (!result.ok)
      throw new PublicHttpError(429, "rate_limited", result.retryAfterS);
  };
  const limited = async (context: Context, route: string, max: number) => {
    const ip = hashClientIp(options.ipSalt, options.clientIp(context));
    await limitKey(`${route}:ip:${ip}`, max);
    return ip;
  };
  if (options.includeHealth !== false)
    app.get("/health", (context) =>
      context.json(
        HealthResponse.parse({
          ok: true,
          version: options.version,
          commit: options.commit,
        }),
      ),
    );
  app.get("/api/config", async (context) =>
    context.json(ConfigResponse.parse(await options.data.config())),
  );
  app.get("/api/machine", async (context) =>
    context.json(
      await cachedRead({
        cache: options.cache,
        key: `onepct:${options.cacheNamespace}:machine`,
        maxAgeMs: settings.api.machineMaxAgeMs,
        schema: MachineResponse,
        read: () => options.data.machine(),
      }),
    ),
  );
  app.get("/api/me/:wallet", async (context) => {
    const wallet = parse(PublicKeyString, context.req.param("wallet"));
    return context.json(
      await cachedRead({
        cache: options.cache,
        key: `onepct:${options.cacheNamespace}:me:${wallet}`,
        maxAgeMs: settings.api.meCacheMs,
        schema: MeResponse,
        read: () => options.data.me(wallet),
      }),
    );
  });
  app.get("/api/verify/:seq", async (context) => {
    const seq = parse(U64String, context.req.param("seq"));
    return context.json(
      VerifyResponse.parse(await options.data.verify(BigInt(seq).toString())),
    );
  });
  app.get("/api/status", async (context) =>
    context.json(StatusResponse.parse(await options.data.status())),
  );
  app.get("/api/block0", async (context) => {
    if (!options.data.block0)
      throw new PublicHttpError(503, "service_unavailable");
    return context.json(Block0Response.parse(await options.data.block0()));
  });
  app.get("/api/creator-fees", async (context) => {
    const { limit } = parse(CreatorFeesQuery, context.req.query());
    if (!options.data.creatorFees)
      throw new PublicHttpError(503, "service_unavailable");
    return context.json(
      CreatorFeesResponse.parse(await options.data.creatorFees(limit)),
    );
  });
  app.get("/api/value", async (context) => {
    const input = parse(ValueRequest, context.req.query());
    await limited(context, "value", settings.api.valuePerMinutePerIp);
    return context.json(
      ValueResponse.parse(
        await options.value(input.mint, BigInt(input.amount)),
      ),
    );
  });
  app.post("/api/feed/attest", async (context) => {
    const ip = await limited(
      context,
      "feed",
      settings.intake.rateLimitPerMinutePerIp,
    );
    const input = await json(context);
    const { wallet } = parse(z.object({ wallet: PublicKeyString }), input);
    await limitKey(
      `feed:wallet:${wallet}`,
      settings.intake.rateLimitPerMinutePerWallet,
    );
    const body = parse(createFeedAttestRequest(settings.tx), input);
    const result = FeedAttestResponse.parse(
      await options.signer("intake", body, ip, FeedAttestResponse),
    );
    if (result.wallet !== body.wallet)
      throw new PublicHttpError(503, "signer_response_mismatch");
    return context.json(result);
  });
  app.post("/api/sellback/quote", async (context) => {
    const ip = await limited(
      context,
      "quote",
      settings.quote.rateLimitPerMinutePerIp,
    );
    const input = await json(context);
    const { owner } = parse(z.object({ owner: PublicKeyString }), input);
    await limitKey(
      `quote:wallet:${owner}`,
      settings.quote.rateLimitPerMinutePerWallet,
    );
    const body = parse(
      createSellBackQuoteRequest(settings.tx.redeemPerTx),
      input,
    );
    const result = SellBackQuoteResponse.parse(
      await options.signer("quote", body, ip, SellBackQuoteResponse),
    );
    if (result.ok && result.quote.owner !== body.owner)
      throw new PublicHttpError(503, "signer_response_mismatch");
    return context.json(result);
  });
  app.post("/api/hold/attest", () => {
    throw new PublicHttpError(404, "not_available");
  });
  app.post("/api/rpc", async (context) => {
    const ip = await limited(context, "rpc", settings.api.rpcPerMinutePerIp);
    const saturated = (
      id: string | number | null,
      retryAfterS = settings.api.rpcCapacityRetryAfterSeconds,
    ) => {
      context.header("Retry-After", String(retryAfterS));
      return context.json(
        {
          jsonrpc: "2.0" as const,
          id,
          error: { code: -32000, message: "RPC capacity reached" },
        },
        503,
      );
    };
    const active = rpcActiveByIp.get(ip) ?? 0;
    if (active >= settings.api.rpcMaxConcurrentPerIp) return saturated(null);
    rpcActiveByIp.set(ip, active + 1);
    let id: string | number | null = null;
    try {
      const body = validateRpcRequest(await json(context));
      id = body.id;
      return context.json(
        await proxyRpc(options.rpc, body, context.req.raw.signal),
      );
    } catch (error) {
      if (error instanceof RpcProxySaturated) {
        warnCause("rpc_proxy_saturated", error);
        return saturated(id, error.retryAfterS);
      }
      throw error;
    } finally {
      const remaining = rpcActiveByIp.get(ip)! - 1;
      if (remaining === 0) rpcActiveByIp.delete(ip);
      else rpcActiveByIp.set(ip, remaining);
    }
  });
  app.get("/api/stream", (context) =>
    publicStream(
      context,
      streams,
      hashClientIp(options.ipSalt, options.clientIp(context)),
    ),
  );
  return app;
}
