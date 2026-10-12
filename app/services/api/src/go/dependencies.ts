import {
  SlidingWindowLimiter,
  type ServiceRuntime,
  safeCause,
} from "@onepercent/service-kit";
import type { ApiDependencies } from "../link/index.js";
import { PgLinkStore } from "../link/store-pg.js";
import { RedisLinkRateLimiter } from "../link/ratelimit.js";
import { PgGoStore } from "./store-pg.js";
import type { Clock } from "../link/store.js";

export function createM5Dependencies(
  runtime: ServiceRuntime,
  source: NodeJS.ProcessEnv = process.env,
  clock: Clock = Date.now,
): Partial<ApiDependencies> {
  const linkStore = new PgLinkStore(runtime.pool, clock);
  const goStore = new PgGoStore(runtime.pool);
  const purge = () =>
    Promise.all([linkStore.purge(clock()), goStore.purge(clock())]).catch(
      (error) =>
        runtime.logger.warn(
          { reason: "m5_retention_unavailable", cause: safeCause(error) },
          "session retention unavailable",
        ),
    );
  void purge();
  const timer = setInterval(() => {
    void purge();
  }, 3_600_000);
  timer.unref();
  const stop = runtime.stop;
  runtime.stop = () => {
    clearInterval(timer);
    return stop();
  };
  return {
    clock,
    linkStore,
    goStore,
    linkRateLimiter: new RedisLinkRateLimiter(
      new SlidingWindowLimiter(runtime.redis),
    ),
    cluster: runtime.env.CLUSTER,
    ipSalt: runtime.env.LOG_IP_SALT,
    // TODO(flags.ts): switch to the config reader when its export lands.
    blinksXray: source.FLAG_BLINKS_XRAY === "on",
  };
}
