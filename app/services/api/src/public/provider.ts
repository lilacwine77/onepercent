import { warnCause } from "@onepercent/service-kit";
import type { PublicSettings } from "./settings.js";

/** Shared across a provider's quote requests and retries; no URL is retained in errors. */
export function createProviderFetch(
  fetcher: typeof fetch,
  settings: PublicSettings["transport"],
): typeof fetch {
  const circuits = new Map<string, { failures: number; until: number }>();
  return async (input, init) => {
    const origin = new URL(input instanceof Request ? input.url : String(input))
      .origin;
    const circuit = circuits.get(origin) ?? { failures: 0, until: 0 };
    circuits.set(origin, circuit);
    if (Date.now() < circuit.until) throw new Error("provider_unavailable");
    const signal = AbortSignal.any([
      AbortSignal.timeout(settings.rpcTimeoutMs),
      ...(init?.signal ? [init.signal] : []),
    ]);
    try {
      const response = await fetcher(input, { ...init, signal });
      if (response.status >= 500) throw new Error("provider_unavailable");
      circuit.failures = 0;
      circuit.until = 0;
      return response;
    } catch (error) {
      warnCause("provider_unavailable", error);
      if (++circuit.failures >= settings.breakerFailureThreshold)
        circuit.until = Date.now() + settings.breakerOpenSeconds * 1_000;
      // eslint-disable-next-line preserve-caught-error -- Original cause is logged; preserve the public error contract.
      throw new Error("provider_unavailable");
    }
  };
}
