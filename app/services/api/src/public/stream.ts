import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import {
  redisEventId,
  type StreamEvent as StoredEvent,
  warnCause,
} from "@onepercent/service-kit";
import { z } from "zod";
import {
  decodeStreamEvent,
  StreamPing,
  streamEventSlot,
  type DecodedStreamEvent,
} from "@onepercent/sdk/api";
import type { PublicSettings } from "./settings.js";
import { PublicHttpError } from "./signer.js";
import { PUBLIC_STREAM_LIMITS } from "./stream-limits.js";

export interface PublicEventSource {
  replayAfter(id?: string): Promise<StoredEvent[]>;
  /** One query confirms a whole poll and replaces payloads with canonical DB data. */
  confirmed(events: readonly StoredEvent[]): Promise<StoredEvent[]>;
}
const cursor = z
  .string()
  .max(64)
  .regex(/^\d+-\d+-\d+$/);
export function parseEventCursor(value?: string): string | undefined {
  if (value === undefined) return undefined;
  try {
    cursor.parse(value);
    redisEventId(value);
    streamEventSlot(value);
    return value;
  } catch (error) {
    warnCause("invalid_event_id", error);
    throw new PublicHttpError(400, "invalid_event_id");
  }
}
export async function confirmedReplay(
  source: PublicEventSource,
  after?: string,
) {
  const rows = await source.replayAfter(after);
  return { rows, confirmed: await source.confirmed(rows) };
}
function after(a: string, b?: string) {
  if (!b) return true;
  const left = a.split("-").map(BigInt),
    right = b.split("-").map(BigInt);
  for (let i = 0; i < left.length; i++) {
    if (left[i]! > right[i]!) return true;
    if (left[i]! < right[i]!) return false;
  }
  return false;
}
type Frame =
  DecodedStreamEvent | { event: "ping"; data: { asOfSlot: number | null } };
export interface StreamSubscription {
  initial: readonly DecodedStreamEvent[];
  next(): Promise<Frame | null>;
  close(): void;
  onClose(callback: () => void): void;
  readonly closed: boolean;
}
interface Client {
  ip: string;
  cursor?: string;
  ready: boolean;
  closed: boolean;
  queue: Frame[];
  waiting?: (frame: Frame | null) => void;
  onClose?: () => void;
}
type Limits = {
  maxClients: number;
  maxClientsPerIp: number;
  queuedEventsPerClient: number;
};

/** One instance per public router/process; no polling or SQL belongs to a client. */
export class PublicStreamHub {
  private clients = new Set<Client>();
  private perIp = new Map<string, number>();
  private history: DecodedStreamEvent[] = [];
  private retained: StoredEvent[] = [];
  private observed?: string;
  private canonical = new Map<string, string>();
  private ready = false;
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private lastPing = 0;
  constructor(
    private readonly source: PublicEventSource,
    private readonly settings: PublicSettings,
    private readonly options: {
      limits?: Limits;
      autoPoll?: boolean;
      now?: () => number;
    } = {},
  ) {}
  private get limits() {
    return this.options.limits ?? PUBLIC_STREAM_LIMITS;
  }
  private close(client: Client) {
    if (client.closed) return;
    client.closed = true;
    client.queue.length = 0;
    client.waiting?.(null);
    client.waiting = undefined;
    this.clients.delete(client);
    const count = (this.perIp.get(client.ip) ?? 1) - 1;
    if (count > 0) this.perIp.set(client.ip, count);
    else this.perIp.delete(client.ip);
    client.onClose?.();
    if (this.clients.size === 0) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.history = [];
      this.retained = [];
      this.observed = undefined;
      this.canonical.clear();
      this.ready = false;
    }
  }
  private push(client: Client, frame: Frame) {
    if (client.closed) return;
    if (client.waiting) {
      const receive = client.waiting;
      client.waiting = undefined;
      receive(frame);
    } else if (client.queue.length >= this.limits.queuedEventsPerClient)
      this.close(client);
    else client.queue.push(frame);
  }
  isCurrent(event: DecodedStreamEvent) {
    return this.canonical.get(event.id) === event.data.signature;
  }
  async open(ip: string, cursor?: string): Promise<StreamSubscription> {
    const validCursor = parseEventCursor(cursor);
    const firstClient = this.clients.size === 0;
    if (
      this.clients.size >= this.limits.maxClients ||
      (this.perIp.get(ip) ?? 0) >= this.limits.maxClientsPerIp
    )
      throw new PublicHttpError(
        429,
        "stream_capacity",
        this.settings.api.ssePingSeconds,
      );
    const client: Client = {
      ip,
      cursor: validCursor,
      ready: false,
      closed: false,
      queue: [],
    };
    this.clients.add(client);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    try {
      if (firstClient || !this.ready) await this.poll();
      const initial = this.history.filter((event) =>
        after(event.id, validCursor),
      );
      client.cursor = initial.at(-1)?.id ?? validCursor;
      client.ready = true;
      return {
        initial,
        get closed() {
          return client.closed;
        },
        next: async () => {
          if (client.closed) return null;
          const queued = client.queue.shift();
          if (queued) return queued;
          return new Promise<Frame | null>((resolve) => {
            client.waiting = resolve;
          });
        },
        close: () => this.close(client),
        onClose: (callback) => {
          client.onClose = callback;
          if (client.closed) callback();
        },
      };
    } catch (error) {
      this.close(client);
      throw error;
    }
  }
  /** Also exposed for deterministic tests; concurrent callers share the same read. */
  poll(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.read()
      .catch((error) => {
        for (const client of [...this.clients]) this.close(client);
        throw error;
      })
      .finally(() => {
        this.running = undefined;
        if (this.clients.size && this.options.autoPoll !== false) {
          clearTimeout(this.timer);
          this.timer = setTimeout(
            () => {
              void this.poll().catch((error) => {
                warnCause("public_stream_poll_failed", error);
              });
            },
            Math.min(
              this.settings.indexer.pollMs,
              this.settings.api.ssePingSeconds * 1000,
            ),
          );
          this.timer.unref?.();
        }
      });
    return this.running;
  }
  private async read() {
    // Redis uses approximate trimming, so advance through raw IDs instead of
    // repeatedly reading the oldest COUNT entries. Revalidate retained entries
    // in the same SQL batch to remove forks even when no new event appears.
    const rows = await this.source.replayAfter(this.observed);
    const limit = this.settings.api.sseReplayEvents;
    if (rows.length > limit) throw new Error("stream_window_exceeded");
    const combined = [
      ...new Map(
        [...this.retained, ...rows].map((event) => [event.id, event]),
      ).values(),
    ];
    const confirmed = await this.source.confirmed(combined);
    if (confirmed.length > combined.length)
      throw new Error("stream_window_exceeded");
    this.observed = rows.at(-1)?.id ?? this.observed;
    this.retained = combined.slice(-limit);
    const events = confirmed.map(decodeStreamEvent);
    this.history = events.slice(-limit);
    this.canonical = new Map(
      events.map((event) => [event.id, event.data.signature]),
    );
    this.ready = true;
    for (const client of this.clients) {
      client.queue = client.queue.filter(
        (frame) => frame.event === "ping" || this.isCurrent(frame),
      );
      if (!client.ready) continue;
      for (const event of events)
        if (after(event.id, client.cursor)) {
          this.push(client, event);
          client.cursor = event.id;
        }
    }
    const now = (this.options.now ?? Date.now)();
    if (!this.lastPing) this.lastPing = now;
    if (now - this.lastPing >= this.settings.api.ssePingSeconds * 1000) {
      const asOfSlot = events.at(-1)?.data.asOfSlot ?? null;
      for (const client of this.clients)
        if (client.ready)
          this.push(client, {
            event: "ping",
            data: StreamPing.parse({ asOfSlot }),
          });
      this.lastPing = now;
    }
  }
}

export async function publicStream(
  context: Context,
  hub: PublicStreamHub,
  ipHash: string,
) {
  const subscription = await hub.open(
    ipHash,
    context.req.header("Last-Event-ID"),
  );
  return streamSSE(context, async (stream) => {
    const abort = () => {
      subscription.close();
      stream.abort();
    };
    subscription.onClose(() => stream.abort());
    stream.onAbort(() => subscription.close());
    context.req.raw.signal.addEventListener("abort", abort, { once: true });
    const emit = async (frame: Frame) => {
      if (frame.event !== "ping" && !hub.isCurrent(frame)) return;
      await stream.writeSSE({
        ...(frame.event !== "ping" ? { id: frame.id } : {}),
        event: frame.event,
        data: JSON.stringify(frame.data),
      });
    };
    try {
      if (context.req.raw.signal.aborted) return;
      for (const event of subscription.initial) {
        if (subscription.closed) return;
        await emit(event);
      }
      while (!subscription.closed && !stream.aborted) {
        const frame = await subscription.next();
        if (frame === null) break;
        await emit(frame);
      }
    } finally {
      context.req.raw.signal.removeEventListener("abort", abort);
      subscription.close();
    }
  });
}
