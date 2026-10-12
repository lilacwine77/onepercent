import { SERVICES } from "@onepercent/config";
import { createRedis, safeCause, warnCause } from "@onepercent/service-kit";
import type { Beacon } from "@onepercent/web-api";
import type { WebLogger } from "./log.js";
export interface CounterStore {
  increment(hour: string, field: string): Promise<void>;
}
export function beaconField(event: Beacon): string {
  return Object.entries(event)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(":");
}
export class BeaconCounters {
  constructor(
    private readonly store?: CounterStore,
    private readonly now: () => number = Date.now,
  ) {}
  async record(event: Beacon): Promise<void> {
    if (!this.store) throw new Error("Analytics store unavailable");
    await this.store.increment(
      new Date(this.now()).toISOString().slice(0, 13),
      beaconField(event),
    );
  }
}
export class RedisCounterStore implements CounterStore {
  constructor(
    private readonly url: string,
    private readonly logger?: WebLogger,
  ) {
    try {
      const parsed = new URL(url);
      if (
        !["redis:", "rediss:"].includes(parsed.protocol) ||
        !/^\/\d*$/.test(parsed.pathname || "/")
      )
        throw new Error();
    } catch (error) {
      warnCause("redis_url_invalid", error);
      // eslint-disable-next-line preserve-caught-error -- Original cause is logged; preserve the public error contract.
      throw new Error("Invalid REDIS_URL");
    }
  }
  async increment(hour: string, field: string): Promise<void> {
    const redis = createRedis(this.url, {
      connectTimeout: SERVICES.transport.redisCommandTimeoutMs,
      commandTimeout: SERVICES.transport.redisCommandTimeoutMs,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    redis.on("error", (error) => {
      if (this.logger)
        this.logger.warn(
          { reason: "redis_unavailable", cause: safeCause(error) },
          "Web analytics unavailable",
        );
      else warnCause("redis_unavailable", error);
    });
    try {
      await redis.connect();
      await redis.hincrby(`onepct:web:hour:${hour}`, field, 1);
    } catch (error) {
      warnCause("web_analytics_unavailable", error);
      // eslint-disable-next-line preserve-caught-error -- Original cause is logged; preserve the public error contract.
      throw new Error("Analytics store unavailable");
    } finally {
      redis.disconnect();
    }
  }
}
