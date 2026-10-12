import { Connection } from "@solana/web3.js";
import { createRpcFetch } from "./rpc-fetch";
// Imported dynamically by transaction routes; never part of the Home/X-ray entry.
export const createRpc = (
  origin = window.location.origin,
  schedule: <T>(run: (signal?: AbortSignal) => Promise<T>) => Promise<T> = (
    run,
  ) => run(),
) => {
  const rpcFetch = createRpcFetch(origin);
  return new Connection(`${origin}/api/rpc`, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (url, options) =>
      schedule((cancel) =>
        rpcFetch(url, cancel ? { ...options, signal: cancel } : options),
      ),
  });
};
