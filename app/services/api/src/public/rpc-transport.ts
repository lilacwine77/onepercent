import {
  JsonRpcClient,
  RpcError,
  RpcUnavailable,
  warnCause,
} from "@onepercent/service-kit";
import type { z } from "zod";
import type { PublicSettings } from "./settings.js";

export class RpcProxySaturated extends Error {
  constructor(readonly retryAfterS: number) {
    super("rpc_proxy_saturated");
  }
}

/** Client-shaped work is a request rejection, not an upstream outage. */
export class RpcResponseTooLarge extends RpcError {
  constructor() {
    super(-32000);
  }
}
export class RpcRequestCancelled extends RpcError {
  constructor() {
    super(-32000);
  }
}
export class RpcHeavyRequestTimeout extends RpcError {
  constructor() {
    super(-32000);
  }
}

const heavyMethods = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getTokenAccountsByOwner",
  "getSignaturesForAddress",
  "getTransaction",
  "getBlockTime",
  "simulateTransaction",
]);

async function boundedResponse(
  response: Response,
  maxResponseBytes: number,
): Promise<Response> {
  const declared = response.headers.get("content-length");
  if (
    declared &&
    /^\d+$/.test(declared) &&
    BigInt(declared) > BigInt(maxResponseBytes)
  ) {
    await response.body?.cancel().catch((error) => {
      warnCause("rpc_body_cancel_failed", error);
    });
    throw new RpcResponseTooLarge();
  }
  // The RPC client does not consume HTTP failures. Release those bodies here.
  if (!response.ok) {
    await response.body?.cancel();
    return new Response(null, { status: response.status });
  }
  if (!response.body) throw new RpcUnavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch((error) => {
          warnCause("rpc_body_cancel_failed", error);
        });
        throw new RpcResponseTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, { status: response.status });
}

/** A separate client and breaker: browser traffic never shares runtime.rpc. */
export function createPublicRpcClient(options: {
  url: string;
  transport: PublicSettings["transport"];
  api: PublicSettings["api"];
  fetch?: typeof fetch;
}): Pick<JsonRpcClient, "request"> {
  const client = new JsonRpcClient({
    url: options.url,
    timeoutMs: options.transport.rpcTimeoutMs,
    failureThreshold: options.transport.breakerFailureThreshold,
    recoverMs: options.transport.breakerOpenSeconds * 1000,
    fetch: async (input, init) => {
      // JsonRpcClient creates this body; no caller-controlled metadata is trusted.
      const { method, params } = JSON.parse(String(init?.body)) as {
        method: string;
        params: unknown[];
      };
      const history = params[1] as
        { searchTransactionHistory?: boolean } | undefined;
      const heavy =
        heavyMethods.has(method) ||
        (method === "getSignatureStatuses" &&
          history?.searchTransactionHistory === true);
      try {
        const upstream = await (options.fetch ?? fetch)(input, {
          ...init,
          redirect: "error",
        });
        if (heavy && (upstream.status === 408 || upstream.status === 504)) {
          await upstream.body?.cancel().catch((error) => {
            warnCause("rpc_body_cancel_failed", error);
          });
          throw new RpcHeavyRequestTimeout();
        }
        return await boundedResponse(upstream, options.api.rpcMaxResponseBytes);
      } catch (error) {
        if (error instanceof RpcError) throw error;
        warnCause("rpc_transport_failed", error);
        const signal = init?.signal;
        if (signal?.aborted) {
          if (signal.reason instanceof RpcRequestCancelled) throw signal.reason;
          if (
            heavy &&
            signal.reason instanceof DOMException &&
            signal.reason.name === "TimeoutError"
          )
            throw new RpcHeavyRequestTimeout();
        }
        throw error;
      }
    },
  });
  let active = 0;
  return {
    async request<T>(
      method: string,
      params: unknown[],
      schema: z.ZodType<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      if (active >= options.api.rpcMaxConcurrent)
        throw new RpcProxySaturated(options.api.rpcCapacityRetryAfterSeconds);
      active += 1;
      // Mark caller cancellation independently of the client's transport deadline.
      const caller = signal ? new AbortController() : undefined;
      const cancel = () => caller?.abort(new RpcRequestCancelled());
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      try {
        return await client.request(method, params, schema, caller?.signal);
      } finally {
        signal?.removeEventListener("abort", cancel);
        active -= 1;
      }
    },
  };
}
