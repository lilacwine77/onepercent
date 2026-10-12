import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import {
  RpcError,
  type JsonRpcClient,
  warnCause,
} from "@onepercent/service-kit";
import { RpcProxySaturated } from "./rpc-transport.js";

const uint = z.number().int().nonnegative().safe();
const key = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("rpc_address_invalid", error);
    return false;
  }
});
const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
const base64 = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .min(4);
const commitment = z.enum(["processed", "confirmed", "finalized"]);
const common = z
  .object({
    commitment: commitment.optional(),
    minContextSlot: uint.optional(),
  })
  .strict();
const request = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string().max(128), z.number().int().safe(), z.null()]),
    method: z.string(),
    params: z.array(z.unknown()).default([]),
  })
  .strict();
export class RpcRequestError extends Error {
  constructor(readonly status: 400 | 403) {
    super("rpc_request_refused");
  }
}
export function createRpcRequestValidator(deck: string, maxSlice: number) {
  const slice = z.object({ offset: uint, length: uint.max(maxSlice) }).strict();
  const account = common.extend({
    encoding: z.enum(["base64", "base58", "jsonParsed"]).optional(),
    dataSlice: slice.optional(),
  });
  const signatures = z.array(signature).min(1).max(256);
  const methods: Record<string, z.ZodType> = {
    getAccountInfo: z.tuple([key, account.optional()]),
    getMultipleAccounts: z.tuple([
      z.array(key).min(1).max(100),
      account.optional(),
    ]),
    getLatestBlockhash: z.tuple([common.optional()]),
    getBalance: z.tuple([key, common.optional()]),
    getTokenAccountsByOwner: z.tuple([
      key,
      z.union([
        z.object({ mint: key }).strict(),
        z.object({ programId: key }).strict(),
      ]),
      account.optional(),
    ]),
    getTokenAccountBalance: z.tuple([key, common.optional()]),
    getSignatureStatuses: z.tuple([
      signatures,
      z
        .object({ searchTransactionHistory: z.boolean().optional() })
        .strict()
        .optional(),
    ]),
    simulateTransaction: z.tuple([
      base64,
      common.extend({
        encoding: z.literal("base64"),
        sigVerify: z.boolean().optional(),
        replaceRecentBlockhash: z.boolean().optional(),
        innerInstructions: z.boolean().optional(),
        accounts: z
          .object({
            encoding: z.literal("base64"),
            addresses: z
              .array(key)
              .max(100)
              .refine((keys) => !keys.includes(deck)),
          })
          .strict()
          .optional(),
      }),
    ]),
    getMinimumBalanceForRentExemption: z.tuple([uint, common.optional()]),
    getSlot: z.tuple([common.optional()]),
    getBlockHeight: z.tuple([common.optional()]),
    getBlockTime: z.tuple([uint]),
    getFeeForMessage: z.tuple([base64, common.optional()]),
    getRecentPrioritizationFees: z.tuple([z.array(key).max(128).optional()]),
    getSignaturesForAddress: z.tuple([
      key,
      z
        .object({
          limit: uint.min(1).max(10).default(10),
          commitment: z.literal("confirmed").default("confirmed"),
          before: signature.optional(),
          until: signature.optional(),
          minContextSlot: uint.optional(),
        })
        .strict()
        .default({ limit: 10, commitment: "confirmed" }),
    ]),
    getTransaction: z.tuple([
      signature,
      z
        .object({
          commitment: z.literal("confirmed").default("confirmed"),
          maxSupportedTransactionVersion: z.literal(0).default(0),
          encoding: z.enum(["json", "jsonParsed", "base64"]).optional(),
        })
        .strict()
        .default({
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }),
    ]),
  };
  return (input: unknown) => {
    const parsed = request.safeParse(input);
    if (!parsed.success) throw new RpcRequestError(400);
    const body = parsed.data;
    const schema = Object.hasOwn(methods, body.method)
      ? methods[body.method]
      : undefined;
    if (!schema) throw new RpcRequestError(403);
    // JSON-RPC omits optional trailing parameters; zod tuple accepts explicit undefined.
    const counts: Record<string, number> = {
      getTokenAccountsByOwner: 3,
      getBlockTime: 1,
    };
    const count =
      counts[body.method] ??
      ([
        "getSlot",
        "getBlockHeight",
        "getLatestBlockhash",
        "getRecentPrioritizationFees",
      ].includes(body.method)
        ? 1
        : 2);
    const values = [...body.params];
    while (values.length < count) values.push(undefined);
    const params = schema.safeParse(values);
    if (!params.success) throw new RpcRequestError(403);
    if (
      (body.method === "getAccountInfo" && body.params[0] === deck) ||
      (body.method === "getMultipleAccounts" &&
        (body.params[0] as string[]).includes(deck))
    ) {
      const opts = account.safeParse(body.params[1]);
      if (
        !opts.success ||
        !opts.data.dataSlice ||
        opts.data.encoding === "jsonParsed"
      )
        throw new RpcRequestError(403);
    }
    const normalized = params.data as unknown[];
    while (normalized.length && normalized.at(-1) === undefined)
      normalized.pop();
    return { ...body, params: normalized };
  };
}
export function validateRpcRequest(
  input: unknown,
  deck: string,
  maxSlice: number,
) {
  return createRpcRequestValidator(deck, maxSlice)(input);
}
export async function proxyRpc(
  rpc: Pick<JsonRpcClient, "request">,
  body: ReturnType<typeof validateRpcRequest>,
  signal?: AbortSignal,
) {
  try {
    const result = await rpc.request(
      body.method,
      body.params,
      z.json(),
      signal,
    );
    return { jsonrpc: "2.0" as const, id: body.id, result };
  } catch (error) {
    // Admission failures need HTTP backpressure, not a successful HTTP envelope.
    if (error instanceof RpcProxySaturated) throw error;
    warnCause("rpc_request_failed", error);
    // Preserve protocol error codes without reflecting provider messages or credentials.
    return {
      jsonrpc: "2.0" as const,
      id: body.id,
      error: {
        code: error instanceof RpcError ? error.code : -32000,
        message: "RPC request failed",
      },
    };
  }
}
