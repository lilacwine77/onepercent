import { WEB } from "@onepercent/config/web";
import { EventsResponse, StreamEvent, StreamPing } from "@onepercent/web-api";
import { z } from "zod";
import { api } from "./api";

export type TransportEvent = z.infer<typeof StreamEvent>;
export type LiveSnapshot = Readonly<{
  onAir: boolean;
  lastEvent: TransportEvent | null;
  mode: "stopped" | "connecting" | "sse" | "polling";
}>;
export const stoppedLiveSnapshot: LiveSnapshot = {
  onAir: false,
  lastEvent: null,
  mode: "stopped",
};
export interface SseHandlers {
  lastEventId: string;
  onOpen(): void;
  onEvent(name: string, id: string, data: string): void;
  onError(): void;
}
export type SseConnector = (handlers: SseHandlers) => { close(): void };

/** Fetch permits a real Last-Event-ID header when changing between polling and SSE. */
export const connectSse: SseConnector = (handlers) => {
  const controller = new AbortController();
  let closed = false;
  let failed = false;
  const fail = () => {
    if (!closed && !failed) {
      failed = true;
      controller.abort();
      handlers.onError();
    }
  };
  const openingDeadline = setTimeout(fail, WEB.httpTimeoutMs);
  const run = async () => {
    const response = await fetch("/api/stream", {
      headers: {
        Accept: "text/event-stream",
        ...(handlers.lastEventId
          ? { "Last-Event-ID": handlers.lastEventId }
          : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(openingDeadline);
    if (
      !response.ok ||
      !response.headers
        .get("Content-Type")
        ?.toLowerCase()
        .startsWith("text/event-stream") ||
      !response.body
    )
      throw new Error("Invalid event stream");
    if (closed || failed) return;
    handlers.onOpen();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let frameBytes = 0;
    let name = "message";
    let id = "";
    let data: string[] = [];
    const line = (value: string) => {
      frameBytes += new TextEncoder().encode(value).byteLength;
      if (frameBytes > WEB.streamFrameMaxBytes)
        throw new Error("Event frame too large");
      if (!value) {
        if (data.length) handlers.onEvent(name, id, data.join("\n"));
        name = "message";
        id = "";
        data = [];
        frameBytes = 0;
        return;
      }
      if (value.startsWith(":")) return;
      const colon = value.indexOf(":");
      const field = colon < 0 ? value : value.slice(0, colon);
      let entry = colon < 0 ? "" : value.slice(colon + 1);
      if (entry.startsWith(" ")) entry = entry.slice(1);
      if (field === "event") name = entry;
      if (field === "id" && !entry.includes("\0")) id = entry;
      if (field === "data") data.push(entry);
    };
    try {
      for (;;) {
        const part = await reader.read();
        if (closed || failed) return;
        if (part.done) throw new Error("Event stream ended");
        if (part.value.byteLength > WEB.streamFrameMaxBytes)
          throw new Error("Event chunk too large");
        buffer += decoder.decode(part.value, { stream: true });
        if (
          new TextEncoder().encode(buffer).byteLength > WEB.streamFrameMaxBytes
        )
          throw new Error("Event line too large");
        for (;;) {
          const match = /\r\n|\r|\n/.exec(buffer);
          if (
            !match ||
            (match[0] === "\r" && match.index + 1 === buffer.length)
          )
            break;
          line(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
          if (closed || failed) return;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  };
  void run()
    .catch(fail)
    .finally(() => clearTimeout(openingDeadline));
  return {
    close() {
      closed = true;
      clearTimeout(openingDeadline);
      controller.abort();
    },
  };
};

interface LiveStreamOptions {
  now?: () => number;
  connect?: SseConnector;
  poll?: (after: string, signal: AbortSignal) => Promise<unknown>;
}
function compareId(a: string, b: string): number {
  if (!b) return 1;
  const left = a.split("-").map(BigInt),
    right = b.split("-").map(BigInt);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]! < right[index]!) return -1;
    if (left[index]! > right[index]!) return 1;
  }
  return 0;
}
/** Transport only: M3.3 must decode confirmed events before displaying any TV entry. */
export class LiveStream {
  private readonly now: () => number;
  private readonly connect: SseConnector;
  private readonly loadPoll: (
    after: string,
    signal: AbortSignal,
  ) => Promise<unknown>;
  private source?: ReturnType<SseConnector>;
  private connectionToken: object | null = null;
  private runToken: object | null = null;
  private errors = 0;
  private lastId = "";
  private lastAt: number | null = null;
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private state: LiveSnapshot = stoppedLiveSnapshot;
  private pollingTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private staleTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private controller?: AbortController;
  private retained = 0;
  constructor(
    private readonly onEvent: (event: TransportEvent) => void = () => undefined,
    options: LiveStreamOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.connect = options.connect ?? connectSse;
    this.loadPoll =
      options.poll ??
      ((after, signal) =>
        api(
          `/api/events${after ? `?after=${encodeURIComponent(after)}` : ""}`,
          z.unknown(),
          { signal },
        ));
  }
  snapshot = (): LiveSnapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  retain = () => {
    this.retained += 1;
    this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retained -= 1;
      if (!this.retained) this.stop();
    };
  };
  onAir() {
    return (
      this.runToken !== null &&
      this.lastAt !== null &&
      this.now() - this.lastAt < WEB.liveStaleAfterMs
    );
  }
  private publish(update: Partial<LiveSnapshot> = {}) {
    const next = { ...this.state, ...update, onAir: this.onAir() };
    if (
      next.mode === this.state.mode &&
      next.onAir === this.state.onAir &&
      next.lastEvent === this.state.lastEvent
    )
      return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  start() {
    if (this.runToken) return;
    this.runToken = {};
    this.lastAt = null;
    this.errors = 0;
    this.open(this.runToken);
  }
  private receive(event: TransportEvent) {
    const duplicate =
      this.seen.has(event.id) || compareId(event.id, this.lastId) <= 0;
    // Replayed business events do not count as a new liveness observation.
    if (!duplicate) this.refresh();
    if (duplicate) {
      this.publish();
      return;
    }
    this.seen.add(event.id);
    if (this.seen.size > WEB.streamDedupeMax)
      this.seen.delete(this.seen.values().next().value!);
    this.lastId = event.id;
    this.publish({ lastEvent: event });
    this.onEvent(event);
  }
  private refresh() {
    this.lastAt = this.now();
    clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => this.publish(), WEB.liveStaleAfterMs);
  }
  private open(run: object) {
    if (this.runToken !== run) return;
    const token = {};
    this.connectionToken = token;
    if (!this.polling) this.publish({ mode: "connecting" });
    const current = () =>
      this.runToken === run && this.connectionToken === token;
    const handlers: SseHandlers = {
      lastEventId: this.lastId,
      onOpen: () => {
        if (current() && !this.polling) this.publish({ mode: "sse" });
      },
      onEvent: (name, id, body) => {
        if (!current()) return;
        let input: unknown;
        try {
          input = JSON.parse(body);
        } catch {
          return;
        }
        if (name === "ping") {
          if (!StreamPing.safeParse(input).success) return;
          this.errors = 0;
          this.stopPolling();
          this.refresh();
          this.publish({ mode: "sse" });
          return;
        }
        // S4 sends the payload in data, with category and cursor in SSE fields.
        // Older recorded fixtures contain the full envelope. Validate those as
        // envelopes so a mismatched embedded cursor cannot become a payload.
        const envelope =
          input !== null &&
          typeof input === "object" &&
          ("event" in input || "id" in input);
        const parsed = StreamEvent.safeParse(
          envelope ? input : { event: name, id, data: input },
        );
        if (
          !parsed.success ||
          parsed.data.event !== name ||
          (id && parsed.data.id !== id)
        )
          return;
        this.errors = 0;
        this.stopPolling();
        this.publish({ mode: "sse" });
        this.receive(parsed.data);
      },
      onError: () => {
        if (!current()) return;
        this.connectionToken = null;
        this.source?.close();
        this.source = undefined;
        this.errors += 1;
        if (this.errors >= WEB.sseFailuresBeforePoll && !this.polling) {
          this.polling = true;
          this.publish({ mode: "polling" });
          this.poll(run);
        } else if (!this.polling) this.publish({ mode: "connecting" });
        clearTimeout(this.reconnectTimer);
        const backoff = Math.min(
          WEB.machinePollHiddenMs,
          WEB.eventsPollMs *
            2 ** Math.min(this.errors - 1, WEB.sseFailuresBeforePoll),
        );
        this.reconnectTimer = setTimeout(() => this.open(run), backoff);
      },
    };
    try {
      const source = this.connect(handlers);
      if (current()) this.source = source;
      else source.close();
    } catch {
      handlers.onError();
    }
  }
  private poll(run: object) {
    if (this.runToken !== run || !this.polling || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    const current = () =>
      this.runToken === run &&
      this.polling &&
      this.controller === controller &&
      !controller.signal.aborted;
    void Promise.resolve()
      .then(() => this.loadPoll(this.lastId, controller.signal))
      .then((body) => {
        if (!current()) return;
        const parsed = EventsResponse.safeParse(body);
        if (!parsed.success) return;
        for (const event of parsed.data) {
          if (!current()) return;
          this.receive(event);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!current()) return;
        this.controller = undefined;
        this.pollingTimer = setTimeout(() => this.poll(run), WEB.eventsPollMs);
      });
  }
  private stopPolling() {
    this.polling = false;
    clearTimeout(this.pollingTimer);
    this.controller?.abort();
    this.controller = undefined;
  }
  stop() {
    this.runToken = null;
    this.connectionToken = null;
    this.source?.close();
    this.source = undefined;
    this.stopPolling();
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.staleTimer);
    this.lastAt = null;
    this.publish({ mode: "stopped" });
  }
}
