import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { SERVICES } from "@onepercent/config";
import type { TxRpc } from "@onepercent/service-kit";

const stockBuyRefusal = z.object({
  InstructionError: z.tuple([
    z.number().int().nonnegative(),
    z.object({
      Custom: z.union([
        z.literal(6071),
        z.literal(6072),
        z.literal(6073),
        z.literal(6074),
      ]),
    }),
  ]),
});
const stockBuyReasons = {
  6071: "stock_buy_pull_in_flight",
  6072: "stock_buy_reveal_delay",
  6073: "stock_buy_listing_notice",
  6074: "stock_buy_reserve",
} as const;

/** Classify an observed simulation or finalized rejection, never transport text. */
export function stockBuyGuardRefusal(error: unknown) {
  const parsed = stockBuyRefusal.safeParse(error);
  if (!parsed.success) return null;
  const code = parsed.data.InstructionError[1].Custom;
  return { code, reason: stockBuyReasons[code] };
}

// Helius Sender documentation, checked 2026-10-10. Provider accounts, not economic parameters.
export const senderTip = {
  recipient: new PublicKey("4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE"),
  dontFront: new PublicKey("jitodontfront111111111111111111111111111111"),
};
export function privateLanding(
  rpc: TxRpc,
  url: string,
  active: () => void,
  onFallback: () => void,
  fetcher: typeof fetch = fetch,
): TxRpc {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== "https:" ||
    !(
      endpoint.hostname === "helius-rpc.com" ||
      endpoint.hostname.endsWith(".helius-rpc.com")
    ) ||
    endpoint.searchParams.has("swqos_only")
  )
    throw new Error("sender_endpoint_invalid");
  return {
    ...rpc,
    async sendRawTransaction(bytes, signal) {
      active();
      signal?.throwIfAborted();
      try {
        const response = await fetcher(url, {
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
            ...(signal ? [signal] : []),
            AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
          ]),
        });
        const result = z
          .object({ result: z.string().min(1) })
          .safeParse(await response.json());
        if (!response.ok || !result.success)
          throw new Error("sender_unavailable");
        return result.data.result;
      } catch {
        active();
        signal?.throwIfAborted();
        onFallback();
        // Ambiguous submission: only replay identical signed bytes. Smaller sizing applies to the next safely replanned trade.
        try {
          return await rpc.sendRawTransaction(bytes, signal);
        } catch {
          active();
          signal?.throwIfAborted();
          // Sender may have accepted these bytes. A secondary rejection cannot
          // prove that the first submission failed, regardless of its RPC code.
          throw new Error("stock_submission_ambiguous");
        }
      }
    },
  };
}
export function blockhashOf(record: { transactionBase64: string }) {
  return VersionedTransaction.deserialize(
    Buffer.from(record.transactionBase64, "base64"),
  ).message.recentBlockhash;
}
