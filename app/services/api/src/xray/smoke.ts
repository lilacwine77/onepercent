import { warnCause } from "@onepercent/service-kit";
import { performance } from "node:perf_hooks";
import { createXrayDependencies } from "./deps.js";
import { XrayError } from "./error.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: pnpm --filter api xray:smoke <address|name>");
  process.exitCode = 1;
} else {
  try {
    let jupiterCalls = 0;
    const fetcher: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === "api.jup.ag") jupiterCalls += 1;
      return fetch(input, init);
    };
    const { service } = await createXrayDependencies(process.env, undefined, {
      fetch: fetcher,
    });
    for (const pass of ["cold", "repeat"]) {
      const start = performance.now();
      const callsBefore = jupiterCalls;
      const result = await service.get(input);
      console.log(
        JSON.stringify({
          pass,
          address: result.address,
          counts: result.counts,
          valuedBags: result.bags.filter((bag) => bag.valueSol !== undefined)
            .length,
          valuesPartial: result.valuesPartial ?? false,
          jupiterCalls: jupiterCalls - callsBefore,
          cached: result.cached,
          elapsedMs: Math.round(performance.now() - start),
        }),
      );
    }
  } catch (error) {
    warnCause("xray_smoke_failed", error);
    // Never serialize provider exceptions, request URLs or environment contents.
    console.error(
      JSON.stringify({
        error: error instanceof XrayError ? error.code : "smoke_failed",
      }),
    );
    process.exitCode = 1;
  }
}
