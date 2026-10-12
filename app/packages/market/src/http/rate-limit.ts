import { defaultClock, type Clock } from "../clock.js";
import type { MarketEnv } from "../env.js";
import { MarketError, noopLogger, type MarketLogger } from "../errors.js";
import {
  BPS_DENOMINATOR,
  MARKET,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from "../params.js";

export type JupiterPlan = keyof typeof MARKET.jupiter.planRequestsPerMinute;

export class SlidingWindowLimiter {
  private readonly timestamps: number[] = [];
  private pending: Promise<void> = Promise.resolve();

  constructor(
    readonly capacity: number,
    private readonly clock: Clock = defaultClock,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new MarketError("INVALID_INPUT", {
        message: "Rate capacity must be a positive integer",
      });
    }
  }

  acquire(): Promise<void> {
    const next = this.pending.then(() => this.take());
    this.pending = next.catch(() => {});
    return next;
  }

  private async take(): Promise<void> {
    const windowMs = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE;
    for (;;) {
      const nowMs = this.clock.nowMs();
      while (
        this.timestamps.length &&
        (this.timestamps[0] ?? nowMs) + windowMs <= nowMs
      ) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < this.capacity) {
        this.timestamps.push(nowMs);
        return;
      }
      await this.clock.sleep(
        Math.max(0, (this.timestamps[0] ?? nowMs) + windowMs - nowMs),
      );
    }
  }
}

export function createJupiterLimiter(options: {
  env: MarketEnv;
  clock?: Clock;
  logger?: MarketLogger;
  plan?: JupiterPlan;
  shareBps?: number;
}): SlidingWindowLimiter {
  const shareBps = options.shareBps ?? BPS_DENOMINATOR;
  const plan = options.env.jupiterApiKey
    ? (options.plan ?? MARKET.jupiter.plan)
    : "keyless";
  if (
    !Number.isSafeInteger(shareBps) ||
    shareBps <= 0 ||
    shareBps > BPS_DENOMINATOR ||
    !Object.hasOwn(MARKET.jupiter.planRequestsPerMinute, plan)
  ) {
    throw new MarketError("INVALID_INPUT", {
      message: "Invalid Jupiter rate limit options",
    });
  }
  if (!options.env.jupiterApiKey) {
    (options.logger ?? noopLogger).warn(
      { provider: "jupiter", plan },
      "Using Jupiter keyless limit",
    );
  }
  return new SlidingWindowLimiter(
    Math.floor(
      (MARKET.jupiter.planRequestsPerMinute[plan] * shareBps) / BPS_DENOMINATOR,
    ),
    options.clock,
  );
}
