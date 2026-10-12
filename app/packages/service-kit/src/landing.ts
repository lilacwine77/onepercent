import { warnCause } from "./safe-cause.js";
import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { TxRpc } from "./tx.js";
import { z } from "zod";
import { SERVICES } from "@onepercent/config";

// External transport facts: Helius Sender; D28 uses one atomic transaction.
export const LANDING_ENDPOINTS = {
  sender: "https://sender.helius-rpc.com/fast",
} as const;
export const SENDER_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
] as const;
export const SENDER_MIN_TIP_LAMPORTS = 1_000_000n;

export async function landingRpc<T>(
  endpoint: string,
  method: string,
  params: unknown[],
  schema: z.ZodType<T>,
  transport: typeof fetch = fetch,
): Promise<T> {
  try {
    const response = await transport(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
    });
    if (!response.ok) throw new Error();
    const body = z
      .object({ result: schema, error: z.unknown().optional() })
      .parse(await response.json());
    if (body.error) throw new Error();
    return body.result;
  } catch (error) {
    warnCause("landing_rpc_failed", error);
    // eslint-disable-next-line preserve-caught-error -- Cause is logged; preserve the public error contract.
    throw new Error("landing_rpc_failed");
  }
}

export function createLandingClient(transport: typeof fetch = fetch) {
  const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  return {
    sendSingle: (encoded: string) =>
      landingRpc(
        LANDING_ENDPOINTS.sender,
        "sendTransaction",
        [encoded, { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
        signature,
        transport,
      ),
  };
}

export const SENDER_ENDPOINT = LANDING_ENDPOINTS.sender;
export const SENDER_TIP_ACCOUNT = new PublicKey(SENDER_TIP_ACCOUNTS[0]);
// Jito accepts any read-only address with this prefix; the account need not exist.
export const DONT_FRONT = new PublicKey(
  "jitodontfront111111111111111111111111111111",
);

export function senderTip(
  payer: PublicKey,
  lamports: bigint | null,
): TransactionInstruction {
  if (lamports === null) throw new Error("landing_tip_pending");
  if (lamports < SENDER_MIN_TIP_LAMPORTS)
    throw new Error("landing_tip_below_minimum");
  const instruction = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: SENDER_TIP_ACCOUNT,
    lamports,
  });
  instruction.keys.push({
    pubkey: DONT_FRONT,
    isSigner: false,
    isWritable: false,
  });
  return instruction;
}

/** Only transport changes. Fallback sends byte-identical signed material. */
export function withSender(
  rpc: TxRpc,
  options: {
    endpoint?: string;
    timeoutMs: number;
    fetch?: typeof fetch;
    assertActive(): void;
  },
): TxRpc {
  const endpoint = options.endpoint ?? SENDER_ENDPOINT;
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("invalid_sender_endpoint");
  return {
    ...rpc,
    async sendRawTransaction(bytes, signal) {
      signal?.throwIfAborted();
      options.assertActive();
      try {
        const response = await (options.fetch ?? fetch)(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [
              Buffer.from(bytes).toString("base64"),
              { encoding: "base64", skipPreflight: true, maxRetries: 0 },
            ],
          }),
          signal: AbortSignal.any([
            AbortSignal.timeout(options.timeoutMs),
            ...(signal ? [signal] : []),
          ]),
        });
        if (!response.ok) throw new Error("sender_unavailable");
        const result = z
          .object({
            jsonrpc: z.literal("2.0"),
            id: z.literal(1),
            result: z.string().min(1),
          })
          .parse(await response.json());
        return result.result;
      } catch (error) {
        warnCause("sender_fallback", error);
        signal?.throwIfAborted();
        options.assertActive();
        try {
          return await rpc.sendRawTransaction(bytes, signal);
        } catch (error) {
          warnCause("sender_submission_ambiguous", error);
          // Sender may already have accepted these bytes. A fallback preflight
          // rejection says nothing about that submission, so never expose it as
          // proof that this signature cannot land. TxSender must query history.
          // eslint-disable-next-line preserve-caught-error -- Cause is logged; preserve the public error contract.
          throw new Error("sender_submission_ambiguous");
        }
      }
    },
  };
}
