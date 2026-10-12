import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB } from "@onepercent/config/web";
import {
  connectSse,
  LiveStream,
  type SseHandlers,
  type TransportEvent,
} from "./stream";
const feed = (slot: number) => ({
  event: "feed",
  id: `${slot}-0-0`,
  data: { seq: String(slot) },
});
function setup(
  poll: (
    after: string,
    signal: AbortSignal,
  ) => Promise<unknown> = async () => [],
) {
  const connections: {
    handlers: SseHandlers;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  const events: TransportEvent[] = [];
  const load = vi.fn(poll);
  const stream = new LiveStream((event) => events.push(event), {
    connect: (handlers) => {
      const connection = { handlers, close: vi.fn() };
      connections.push(connection);
      return connection;
    },
    poll: load,
  });
  const latest = () => connections.at(-1)!;
  const send = (body: ReturnType<typeof feed>) =>
    latest().handlers.onEvent(body.event, body.id, JSON.stringify(body));
  const sendPing = (body: unknown = {}, id = "") =>
    latest().handlers.onEvent("ping", id, JSON.stringify(body));
  async function fallBack() {
    for (let i = 0; i < WEB.sseFailuresBeforePoll; i += 1) {
      latest().handlers.onError();
      if (i < WEB.sseFailuresBeforePoll - 1)
        await vi.advanceTimersByTimeAsync(WEB.eventsPollMs * 2 ** i);
    }
    await vi.advanceTimersByTimeAsync(0);
  }
  return {
    stream,
    connections,
    events,
    load,
    latest,
    send,
    sendPing,
    fallBack,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("fetch", () => {
    throw new Error("Unmocked network in unit test");
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("live transport state", () => {
  it("accepts S4 payload-only frames using the SSE category and cursor", () => {
    const { stream, latest, send, events } = setup();
    stream.start();
    const first = feed(1);
    latest().handlers.onEvent(
      first.event,
      first.id,
      JSON.stringify(first.data),
    );
    expect(stream.snapshot()).toMatchObject({
      onAir: true,
      mode: "sse",
      lastEvent: first,
    });
    // The full-envelope fixture path shares the same cursor and dedupe rules.
    send(first);
    send(feed(2));
    expect(events).toEqual([first, feed(2)]);
    stream.stop();
    stream.start();
    expect(latest().handlers.lastEventId).toBe("2-0-0");
    stream.stop();
  });
  it("rejects payload-only frames without a valid cursor or category", () => {
    const { stream, latest, events } = setup();
    stream.start();
    latest().handlers.onEvent("feed", "", JSON.stringify(feed(1).data));
    latest().handlers.onEvent("feed", "bad", JSON.stringify(feed(1).data));
    latest().handlers.onEvent("unknown", "1-0-0", JSON.stringify(feed(1).data));
    latest().handlers.onEvent("feed", "1-0-0", "[]");
    expect(events).toEqual([]);
    expect(stream.onAir()).toBe(false);
    stream.stop();
  });
  it("is live only after a validated event and expires without any further notification", async () => {
    const { stream, latest, sendPing, events } = setup();
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.start();
    latest().handlers.onOpen();
    expect(stream.snapshot()).toMatchObject({ onAir: false, mode: "sse" });
    sendPing();
    expect(stream.snapshot().onAir).toBe(true);
    expect(stream.snapshot().lastEvent).toBeNull();
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(WEB.liveStaleAfterMs - 1);
    expect(stream.snapshot().onAir).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(stream.snapshot().onAir).toBe(false);
    expect(listener).toHaveBeenCalled();
    stream.stop();
  });
  it("deduplicates IDs with a monotone cursor after old IDs leave the bounded window", () => {
    const { stream, send, events, latest } = setup();
    stream.start();
    for (let i = 1; i <= WEB.streamDedupeMax + 2; i += 1) send(feed(i));
    send(feed(1));
    send(feed(WEB.streamDedupeMax + 2));
    expect(events).toHaveLength(WEB.streamDedupeMax + 2);
    stream.stop();
    stream.start();
    expect(latest().handlers.lastEventId).toBe(
      `${WEB.streamDedupeMax + 2}-0-0`,
    );
    expect(stream.onAir()).toBe(false);
    stream.stop();
  });
  it("does not extend freshness for replayed historical business events", async () => {
    const { stream, send } = setup();
    stream.start();
    send(feed(1));
    await vi.advanceTimersByTimeAsync(WEB.liveStaleAfterMs - 1);
    send(feed(1));
    await vi.advanceTimersByTimeAsync(1);
    expect(stream.onAir()).toBe(false);
    stream.stop();
  });
  it("refreshes on every idless ping without advancing or replacing the business cursor", async () => {
    const { stream, send, sendPing, events, latest } = setup();
    stream.start();
    sendPing({ id: "999-0-0" }, "999-0-0");
    expect(events).toEqual([]);
    send(feed(1));
    await vi.advanceTimersByTimeAsync(WEB.liveStaleAfterMs - 1);
    sendPing({ ts: 0 });
    await vi.advanceTimersByTimeAsync(WEB.liveStaleAfterMs - 1);
    sendPing();
    await vi.advanceTimersByTimeAsync(1);
    expect(stream.onAir()).toBe(true);
    expect(stream.snapshot().lastEvent).toEqual(feed(1));
    expect(events).toEqual([feed(1)]);
    stream.stop();
    stream.start();
    expect(latest().handlers.lastEventId).toBe("1-0-0");
    send(feed(999));
    expect(events).toEqual([feed(1), feed(999)]);
    stream.stop();
  });
  it("backs off SSE attempts and starts exactly one polling loop after the third failure", async () => {
    const { stream, latest, connections, load } = setup();
    stream.start();
    latest().handlers.onError();
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WEB.eventsPollMs - 1);
    expect(connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(2);
    latest().handlers.onError();
    await vi.advanceTimersByTimeAsync(WEB.eventsPollMs * 2);
    expect(connections).toHaveLength(3);
    latest().handlers.onError();
    latest().handlers.onError();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(stream.snapshot().mode).toBe("polling");
    await vi.advanceTimersByTimeAsync(WEB.eventsPollMs);
    expect(load).toHaveBeenCalledTimes(2);
    stream.stop();
  });
  it("keeps polling during SSE retries, then aborts polling only after valid SSE data", async () => {
    const { stream, fallBack, latest, connections, load, sendPing } = setup(
      async () => [feed(5)],
    );
    stream.start();
    await fallBack();
    expect(stream.onAir()).toBe(true);
    expect(load.mock.calls[0]?.[0]).toBe("");
    await vi.advanceTimersByTimeAsync(
      WEB.eventsPollMs * 2 ** (WEB.sseFailuresBeforePoll - 1),
    );
    expect(connections).toHaveLength(4);
    expect(latest().handlers.lastEventId).toBe("5-0-0");
    latest().handlers.onOpen();
    expect(stream.snapshot().mode).toBe("polling");
    sendPing();
    expect(stream.snapshot().mode).toBe("sse");
    expect(stream.snapshot().lastEvent).toEqual(feed(5));
    const before = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(WEB.eventsPollMs);
    expect(load).toHaveBeenCalledTimes(before);
    stream.stop();
  });
  it("validates entire poll batches and ignores malformed or mismatched SSE data", async () => {
    const { stream, latest, fallBack, events } = setup(async () => [
      feed(1),
      { ...feed(2), data: [] },
    ]);
    stream.start();
    latest().handlers.onEvent("ping", "1-0-0", "{bad");
    latest().handlers.onEvent("reveal", "1-0-0", JSON.stringify(feed(1)));
    latest().handlers.onEvent("feed", "99-0-0", JSON.stringify(feed(1)));
    for (const body of [null, [], { ts: "bad" }])
      latest().handlers.onEvent("ping", "", JSON.stringify(body));
    await fallBack();
    expect(stream.snapshot().onAir).toBe(false);
    expect(events).toEqual([]);
    stream.stop();
  });
  it("ignores all callbacks from a closed connection after a new start", async () => {
    const { stream, latest, events, connections } = setup();
    stream.start();
    const old = latest();
    stream.stop();
    stream.start();
    old.handlers.onEvent("ping", "", "{}");
    old.handlers.onEvent("feed", "99-0-0", JSON.stringify(feed(99)));
    old.handlers.onOpen();
    old.handlers.onError();
    expect(events).toEqual([]);
    expect(stream.onAir()).toBe(false);
    await vi.advanceTimersByTimeAsync(WEB.machinePollHiddenMs);
    expect(connections).toHaveLength(2);
    stream.stop();
  });
  it("drops late polling results after SSE has resumed and never schedules the old poll again", async () => {
    let resolve!: (value: unknown) => void;
    const { stream, fallBack, send, events, load } = setup(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    stream.start();
    await fallBack();
    const signal = load.mock.calls[0]![1];
    await vi.advanceTimersByTimeAsync(
      WEB.eventsPollMs * 2 ** (WEB.sseFailuresBeforePoll - 1),
    );
    send(feed(8));
    expect(signal.aborted).toBe(true);
    resolve([feed(99)]);
    await vi.advanceTimersByTimeAsync(WEB.eventsPollMs);
    expect(events.map((event) => event.id)).toEqual(["8-0-0"]);
    expect(load).toHaveBeenCalledTimes(1);
    stream.stop();
  });
  it("keeps the transport until the last observer releases it and makes cleanup idempotent", () => {
    const { stream, connections, latest } = setup();
    const one = stream.retain();
    const two = stream.retain();
    expect(connections).toHaveLength(1);
    one();
    one();
    expect(latest().close).not.toHaveBeenCalled();
    two();
    expect(latest().close).toHaveBeenCalledTimes(1);
    expect(stream.snapshot().mode).toBe("stopped");
  });
});
function createResponse() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
    },
  });
  return {
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    }),
    writer,
  };
}
async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
describe("fetch SSE framing", () => {
  it("bounds connection opening even when fetch ignores abort and ignores the late response", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const handlers = {
      lastEventId: "",
      onOpen: vi.fn(),
      onEvent: vi.fn(),
      onError: vi.fn(),
    };
    const connection = connectSse(handlers);
    await vi.advanceTimersByTimeAsync(WEB.httpTimeoutMs);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    resolve(createResponse().response);
    await flush();
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    connection.close();
  });

  it("uses Last-Event-ID and parses split CRLF, comments and multiline data", async () => {
    const { response, writer } = createResponse();
    const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return response;
    });
    vi.stubGlobal("fetch", fetcher);
    const handlers = {
      lastEventId: "1-0-0",
      onOpen: vi.fn(),
      onEvent: vi.fn(),
      onError: vi.fn(),
    };
    const connection = connectSse(handlers);
    await flush();
    writer.enqueue(
      new TextEncoder().encode(
        ": heartbeat\r\nevent: ping\r\nid: 2-0-0\r\ndata: {\r",
      ),
    );
    await flush();
    writer.enqueue(new TextEncoder().encode('\ndata: "event":"ping"}\r\n\r\n'));
    await flush();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: { "Last-Event-ID": "1-0-0", Accept: "text/event-stream" },
    });
    expect(handlers.onEvent).toHaveBeenCalledWith(
      "ping",
      "2-0-0",
      '{\n"event":"ping"}',
    );
    writer.enqueue(
      new TextEncoder().encode(
        "event: ping\ndata: {}\n\nevent: ping\ndata: {}\n\n",
      ),
    );
    await flush();
    expect(handlers.onEvent).toHaveBeenCalledTimes(3);
    expect(handlers.onEvent).toHaveBeenNthCalledWith(2, "ping", "", "{}");
    expect(handlers.onEvent).toHaveBeenNthCalledWith(3, "ping", "", "{}");
    expect(handlers.onError).not.toHaveBeenCalled();
    connection.close();
  });
  it("rejects oversized frames and wrong content types", async () => {
    const { response, writer } = createResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const handlers = {
      lastEventId: "",
      onOpen: vi.fn(),
      onEvent: vi.fn(),
      onError: vi.fn(),
    };
    connectSse(handlers);
    await flush();
    writer.enqueue(
      new TextEncoder().encode("a".repeat(WEB.streamFrameMaxBytes + 1)),
    );
    await flush();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    connectSse(handlers);
    await flush();
    expect(handlers.onError).toHaveBeenCalledTimes(2);
    expect(handlers.onEvent).not.toHaveBeenCalled();
  });
  it("reports a closed stream once but closing intentionally is silent", async () => {
    const first = createResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => first.response),
    );
    const handlers = {
      lastEventId: "",
      onOpen: vi.fn(),
      onEvent: vi.fn(),
      onError: vi.fn(),
    };
    connectSse(handlers);
    await flush();
    first.writer.close();
    await flush();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    const second = createResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => second.response),
    );
    const connection = connectSse(handlers);
    await flush();
    connection.close();
    second.writer.close();
    await flush();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
  });
});
