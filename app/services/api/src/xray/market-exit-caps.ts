import { warnCause } from "@onepercent/service-kit";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createChainRpc,
  createExitCapClient,
  loadMarketEnv,
  MarketError,
} from "@onepercent/market";
import type { ExitCapSource } from "./provider-types.js";

// X1 bounds the whole lookup, including market rate admission and retries.
const LOOKUP_DEADLINE_MS = 5_000;
interface LookupScope {
  signal: AbortSignal;
  expiresAt: number;
}
const unavailable = () =>
  new MarketError("EXIT_CAP_UNAVAILABLE", { provider: "solana" });
function assertActive(
  scope: LookupScope | undefined,
): asserts scope is LookupScope {
  if (!scope || scope.signal.aborted || Date.now() >= scope.expiresAt)
    throw unavailable();
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch((error) => {
      warnCause("xray_late_exit_cap_failed", error);
    });
    return Promise.reject(unavailable());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(unavailable());
    signal.addEventListener("abort", abort, { once: true });
    void work
      .then(resolve, (error: unknown) => {
        if (signal.aborted) warnCause("xray_late_exit_cap_failed", error);
        reject(error);
      })
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Uses X2's live reserve readers without extending X1's display lookup budget. */
export function createMarketExitCaps(options: {
  rpcUrl: string;
  fetch?: typeof fetch;
}): ExitCapSource {
  const scopes = new AsyncLocalStorage<LookupScope>();
  const fetcher = options.fetch ?? fetch;
  const env = loadMarketEnv({ SOLANA_RPC_URL: options.rpcUrl });
  const guardedFetch: typeof fetch = async (input, init) => {
    const scope = scopes.getStore();
    // Runs after market's shared limiter admits the request; expired queued work never fetches.
    assertActive(scope);
    const signal = init?.signal
      ? AbortSignal.any([scope.signal, init.signal])
      : scope.signal;
    try {
      return await abortable(fetcher(input, { ...init, signal }), signal);
    } catch (error) {
      assertActive(scope);
      throw error;
    }
  };
  // One RPC client means one market-configured limiter shared across every mint lookup.
  const rpc = createChainRpc({ fetch: guardedFetch, env });
  const client = createExitCapClient({ fetch: guardedFetch, env, rpc });
  return {
    async getSellValues(holdings, context = {}) {
      const controller = new AbortController();
      const signal = context.signal
        ? AbortSignal.any([controller.signal, context.signal])
        : controller.signal;
      const scope = { signal, expiresAt: Date.now() + LOOKUP_DEADLINE_MS };
      const timer = setTimeout(() => controller.abort(), LOOKUP_DEADLINE_MS);
      try {
        return await scopes.run(scope, () =>
          client.getSellValues(holdings, { ...context, signal }),
        );
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
    async getExitCap(mint) {
      const controller = new AbortController();
      const scope = {
        signal: controller.signal,
        expiresAt: Date.now() + LOOKUP_DEADLINE_MS,
      };
      const timer = setTimeout(() => controller.abort(), LOOKUP_DEADLINE_MS);
      try {
        return await scopes.run(scope, () =>
          abortable(client.getExitCap(mint), controller.signal),
        );
      } catch (error) {
        warnCause("xray_exit_cap_unavailable", error);
        throw unavailable();
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
