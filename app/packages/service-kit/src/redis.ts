import { warnCause } from "./safe-cause.js";
import { randomUUID } from "node:crypto";
import { Redis, type RedisOptions } from "ioredis";
import { z } from "zod";

const LIMIT_SCRIPT = `
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local window_ms = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now_ms - window_ms)
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[1]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, math.max(1, math.ceil((tonumber(oldest[2]) + window_ms - now_ms) / 1000))}
end
redis.call('ZADD', KEYS[1], now_ms, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window_ms)
return {1, 0}
`;

export function createRedis(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, { lazyConnect: true, ...options });
}

export class SlidingWindowLimiter {
  constructor(private readonly redis: Pick<Redis, "eval">) {}

  async limit(
    key: string,
    max: number,
    windowS: number,
  ): Promise<{ ok: boolean; retryAfterS: number }> {
    z.string().min(1).parse(key);
    z.number().int().positive().safe().parse(max);
    z.number()
      .int()
      .positive()
      .safe()
      .parse(windowS * 1_000);
    const reply = z
      .tuple([
        z.union([z.literal(0), z.literal(1)]),
        z.number().int().nonnegative(),
      ])
      .parse(
        await this.redis.eval(
          LIMIT_SCRIPT,
          1,
          key,
          max,
          windowS * 1_000,
          randomUUID(),
        ),
      );
    return { ok: reply[0] === 1, retryAfterS: reply[1] };
  }
}

const eventSchema = z
  .object({
    id: z.string().regex(/^\d+-\d+-\d+$/),
    event: z.enum([
      "feed",
      "takeBack",
      "pullOpened",
      "reveal",
      "settle",
      "refund",
      "sellBack",
      "stock",
      "phase",
      "powerOn",
      "onePct",
      "jackpotWon",
      "jackpotBuy",
      "burn",
      "creatorFees",
      "block0",
    ]),
    data: z.record(z.string(), z.json()),
  })
  .strict();

export type StreamEvent = z.infer<typeof eventSchema>;

/** Redis has two ID integers; the lower integer packs two uint32 indices. */
export function redisEventId(id: string): string {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(id);
  if (!match) throw new Error("Invalid event ID");
  const slot = BigInt(match[1]!);
  const txIndex = BigInt(match[2]!);
  const eventIndex = BigInt(match[3]!);
  if (
    slot > 0xffff_ffff_ffff_ffffn ||
    txIndex > 0xffff_ffffn ||
    eventIndex > 0xffff_ffffn
  ) {
    throw new Error("Event ID exceeds Redis range");
  }
  const sequence = (txIndex << 32n) | eventIndex;
  if (slot === 0n && sequence === 0n)
    throw new Error("Event ID must follow genesis");
  return `${slot}-${sequence}`;
}

export class EventStream {
  constructor(
    private readonly redis: Pick<Redis, "xadd" | "xrange">,
    private readonly options: { key: string; maxLength: number },
  ) {
    z.string().min(1).parse(options.key);
    z.number().int().positive().safe().parse(options.maxLength);
  }

  async publish(input: StreamEvent): Promise<void> {
    const event = eventSchema.parse(input);
    try {
      await this.redis.xadd(
        this.options.key,
        "MAXLEN",
        "~",
        this.options.maxLength,
        redisEventId(event.id),
        "event",
        JSON.stringify(event),
      );
    } catch (error) {
      // An ordered indexer can safely resume from an already published cursor.
      if (
        error instanceof Error &&
        error.message ===
          "ERR The ID specified in XADD is equal or smaller than the target stream top item"
      ) {
        warnCause("redis_event_already_published", error);
        return;
      }
      throw error;
    }
  }

  async replayAfter(id?: string): Promise<StreamEvent[]> {
    const result = await this.redis.xrange(
      this.options.key,
      id ? `(${redisEventId(id)}` : "-",
      "+",
      "COUNT",
      this.options.maxLength,
    );
    return result.map(([nativeId, fields]) => {
      const index = fields.findIndex(
        (field, i) => i % 2 === 0 && field === "event",
      );
      if (index < 0 || fields[index + 1] === undefined)
        throw new Error("Invalid stream entry");
      const event = eventSchema.parse(JSON.parse(fields[index + 1]!));
      if (redisEventId(event.id) !== nativeId)
        throw new Error("Stream event ID mismatch");
      return event;
    });
  }
}
