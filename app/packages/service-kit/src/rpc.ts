import { warnCause } from "./safe-cause.js";
import { setTimeout as sleep } from "node:timers/promises";
import { SERVICES } from "@onepercent/config";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SolanaJSONRPCErrorCode,
} from "@solana/web3.js";
import { z } from "zod";

export class RpcUnavailable extends Error {
  constructor() {
    super("rpc_unavailable");
  }
}
export function isRpcNodeLagCode(code: number): boolean {
  return [-32004, -32016, -32007, -32009].includes(code);
}

/** A valid read has no available result yet; no provider payload is retained. */
export class RpcNodeLag extends Error {
  readonly kind = "node_lag";
  constructor() {
    super("rpc_node_lag");
    this.name = "RpcNodeLag";
  }
}

export function isRpcNodeLag(error: unknown): error is RpcError | RpcNodeLag {
  return (
    error instanceof RpcNodeLag ||
    (error instanceof RpcError && error.kind === "node_lag")
  );
}

export interface RpcNodeLagRetry {
  /** Total attempts, including the initial request. */
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

const nodeLagRetry: RpcNodeLagRetry = {
  maxAttempts: SERVICES.transport.rpcNodeLagMaxAttempts,
  backoffBaseMs: SERVICES.transport.rpcNodeLagBackoffBaseMs,
  backoffMaxMs: SERVICES.transport.rpcNodeLagBackoffMaxMs,
};

/** Equal jitter, starting at retryIndex zero; the ceiling includes jitter. */
export function rpcNodeLagDelayMs(
  retryIndex: number,
  random: () => number = Math.random,
  policy: RpcNodeLagRetry = nodeLagRetry,
): number {
  const ceiling = Math.min(
    policy.backoffMaxMs,
    policy.backoffBaseMs * 2 ** retryIndex,
  );
  return Math.ceil(ceiling * (0.5 + random() / 2));
}

/** A valid provider rejection, with no provider message, logs or URL retained. */
export class RpcError extends Error {
  readonly kind:
    "preflight_rejected" | "already_processed" | "node_lag" | "rpc_error";
  constructor(
    readonly code: number,
    transactionError?: unknown,
  ) {
    super(`rpc_error:${code}`);
    this.name = "RpcError";
    this.kind = isRpcNodeLagCode(code)
      ? "node_lag"
      : code ===
          SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE
        ? transactionError === "AlreadyProcessed"
          ? "already_processed"
          : "preflight_rejected"
        : "rpc_error";
  }
}
export class JsonRpcClient {
  private id = 0;
  private failures = 0;
  private openUntil = 0;
  private readonly nodeLagRetry: RpcNodeLagRetry;
  constructor(
    private readonly options: {
      url: string;
      timeoutMs: number;
      failureThreshold: number;
      recoverMs: number;
      fetch?: typeof fetch;
      nodeLagRetry?: RpcNodeLagRetry;
      random?: () => number;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    },
  ) {
    z.url({ protocol: /^https?$/ }).parse(options.url);
    this.nodeLagRetry = options.nodeLagRetry ?? nodeLagRetry;
    for (const n of [
      options.timeoutMs,
      options.failureThreshold,
      options.recoverMs,
      this.nodeLagRetry.maxAttempts,
      this.nodeLagRetry.backoffBaseMs,
      this.nodeLagRetry.backoffMaxMs,
    ])
      if (!Number.isSafeInteger(n) || n <= 0)
        throw new Error("invalid_rpc_options");
    if (this.nodeLagRetry.backoffBaseMs > this.nodeLagRetry.backoffMaxMs)
      throw new Error("invalid_rpc_options");
  }
  async request<T>(
    method: string,
    params: unknown[],
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    // Solana/Helius getters and unsigned simulation are reads. Submission and
    // other methods never enter this retry path, even for a node lag error.
    const retryableRead =
      /^get[A-Z]/.test(method) || method === "simulateTransaction";
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      try {
        return await this.requestOnce(method, params, schema, signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (
          !retryableRead ||
          !isRpcNodeLag(error) ||
          attempt + 1 >= this.nodeLagRetry.maxAttempts
        )
          throw error;
        const delayMs = rpcNodeLagDelayMs(
          attempt,
          this.options.random,
          this.nodeLagRetry,
        );
        if (this.options.sleep) await this.options.sleep(delayMs, signal);
        else await sleep(delayMs, undefined, { signal });
      }
    }
  }
  private async requestOnce<T>(
    method: string,
    params: unknown[],
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (Date.now() < this.openUntil) throw new RpcUnavailable();
    const id = ++this.id;
    try {
      const response = await (this.options.fetch ?? fetch)(this.options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.any([
          AbortSignal.timeout(this.options.timeoutMs),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!response.ok) throw new RpcUnavailable();
      const body: unknown = await response.json();
      const rejection = z
        .object({
          jsonrpc: z.literal("2.0"),
          id: z.literal(id),
          error: z.object({
            code: z.number().int().safe(),
            message: z.string(),
            data: z.unknown().optional(),
          }),
        })
        .strict()
        .safeParse(body);
      if (rejection.success) {
        const detail = z
          .object({ err: z.unknown() })
          .safeParse(rejection.data.error.data);
        // The server answered a valid request: logical rejections are not outages.
        this.failures = 0;
        this.openUntil = 0;
        throw new RpcError(
          rejection.data.error.code,
          detail.success ? detail.data.err : undefined,
        );
      }
      const envelope = z
        .object({
          jsonrpc: z.literal("2.0"),
          id: z.literal(id),
          result: schema,
        })
        .strict()
        .parse(body);
      this.failures = 0;
      this.openUntil = 0;
      return envelope.result;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof RpcError) throw error;
      warnCause("rpc_unavailable", error);
      if (++this.failures >= this.options.failureThreshold)
        this.openUntil = Date.now() + this.options.recoverMs;
      throw new RpcUnavailable();
    }
  }
  async account(address: PublicKey) {
    const result = await this.request(
      "getAccountInfo",
      [address.toBase58(), { commitment: "confirmed", encoding: "base64" }],
      z.object({
        context: z.object({ slot: z.number().int().nonnegative() }),
        value: z
          .object({
            owner: z.string(),
            executable: z.boolean(),
            data: z.tuple([
              z
                .string()
                .regex(
                  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
                ),
              z.literal("base64"),
            ]),
          })
          .nullable(),
      }),
    );
    if (!result.value) throw new RpcUnavailable();
    return {
      owner: new PublicKey(result.value.owner),
      executable: result.value.executable,
      data: Buffer.from(result.value.data[0], "base64"),
      slot: result.context.slot,
    };
  }
  async chainNow(): Promise<bigint> {
    const account = await this.account(SYSVAR_CLOCK_PUBKEY);
    if (
      account.data.length !== 40 ||
      account.executable ||
      account.owner.toBase58() !== "Sysvar1111111111111111111111111111111111111"
    )
      throw new RpcUnavailable();
    return account.data.readBigInt64LE(32);
  }
  async blockTimeNow(): Promise<number> {
    for (const commitment of ["confirmed", "finalized"] as const) {
      try {
        const slot = await this.request(
          "getSlot",
          [{ commitment }],
          z.number().int().nonnegative(),
        );
        const time = await this.request(
          "getBlockTime",
          [slot],
          z.number().int().nonnegative().nullable(),
        );
        if (time !== null) return time;
      } catch (error) {
        if (!isRpcNodeLag(error)) throw error;
      }
    }
    throw new RpcNodeLag();
  }
  async ready(): Promise<void> {
    await this.request(
      "getSlot",
      [{ commitment: "confirmed" }],
      z.number().int().nonnegative(),
    );
  }
}
