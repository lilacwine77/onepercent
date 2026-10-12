import {
  createExitCapClient,
  createJupiterSwapClient,
  createValueClient,
  loadMarketEnv,
} from "@onepercent/market";
import { SERVICES, WSOL_MINT } from "@onepercent/config";
import { z } from "zod";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { createProviderFetch } from "./provider.js";

/** Executable X2 /order plus real-reserve cap, never a list-price estimate. */
export function createPublicValue(
  runtime: Pick<ServiceRuntime, "rpc" | "env">,
  source: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
) {
  const env = loadMarketEnv({ ...source, SOLANA_RPC_URL: runtime.env.RPC_URL });
  const jupiter = createJupiterSwapClient({
    env,
    fetch: createProviderFetch(fetcher, SERVICES.transport),
  });
  const caps = createExitCapClient({
    env,
    fetch: fetcher,
    rpc: {
      call: (schema, method, params) =>
        runtime.rpc.request(method, params, schema),
    },
  });
  const wsol = z.string().parse(WSOL_MINT);
  const client = createValueClient({
    quoteSell: async (mint, amount) =>
      jupiter.quote({ inputMint: mint, outputMint: wsol, amount }),
    getExitCap: (mint) => caps.getExitCap(mint),
  });
  return async (mint: string, amount: bigint) => {
    const asOfSlot = await runtime.rpc.request(
      "getSlot",
      [{ commitment: "confirmed" }],
      z.number().int().safe().nonnegative(),
    );
    const result = await client.valueNow(mint, amount);
    return result.status === "ok"
      ? {
          asOfSlot,
          status: result.status,
          lamports: result.lamports.toString(),
          capped: result.capped,
          label: "if_sold_now" as const,
        }
      : { asOfSlot, status: result.status, reason: result.reason };
  };
}
