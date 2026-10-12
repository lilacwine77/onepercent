import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { parsePullRevealedLogs } from "./adapter.js";

const notification = z.object({
  method: z.literal("logsNotification"),
  params: z.object({
    subscription: z.number().int(),
    result: z.object({
      context: z.object({ slot: z.number().int().nonnegative().safe() }),
      value: z.object({
        err: z.unknown().nullable(),
        logs: z.array(z.string()),
        signature: z.string(),
      }),
    }),
  }),
});
/** The socket only requests a scan; every decision is re-read at confirmed. */
export function subscribeReveals(options: {
  url: string;
  programId: PublicKey;
  signal: AbortSignal;
  retryMs: number;
  timeoutMs: number;
  trigger(): void;
  failed(error?: unknown): void;
  createSocket?: (url: string) => WebSocket;
}): () => void {
  const url = new URL(options.url);
  if (!["https:", "http:", "wss:", "ws:"].includes(url.protocol))
    throw new Error("invalid_ws_url");
  url.protocol =
    url.protocol === "https:"
      ? "wss:"
      : url.protocol === "http:"
        ? "ws:"
        : url.protocol;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(deadline);
    socket?.close();
    options.signal.removeEventListener("abort", stop);
  };
  const connect = () => {
    if (stopped || options.signal.aborted) return;
    let subscription: number | undefined;
    let current: WebSocket;
    try {
      current = (options.createSocket ?? ((value) => new WebSocket(value)))(
        url.href,
      );
    } catch (error) {
      options.failed(error);
      timer = setTimeout(connect, options.retryMs);
      return;
    }
    socket = current;
    let disconnected = false;
    const reconnect = (error?: unknown) => {
      if (disconnected) return;
      disconnected = true;
      clearTimeout(deadline);
      current.close();
      if (!stopped && !options.signal.aborted) {
        options.failed(error);
        timer = setTimeout(connect, options.retryMs);
      }
    };
    deadline = setTimeout(reconnect, options.timeoutMs);
    current.addEventListener("open", () => {
      current.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "logsSubscribe",
          params: [
            { mentions: [options.programId.toBase58()] },
            { commitment: "confirmed" },
          ],
        }),
      );
    });
    current.addEventListener("message", (event) => {
      if (
        stopped ||
        options.signal.aborted ||
        disconnected ||
        typeof event.data !== "string"
      )
        return;
      let body: unknown;
      try {
        body = JSON.parse(event.data);
      } catch (error) {
        reconnect(error);
        return;
      }
      const ack = z
        .object({
          jsonrpc: z.literal("2.0"),
          id: z.literal(1),
          result: z.number().int(),
        })
        .safeParse(body);
      if (ack.success) {
        subscription = ack.data.result;
        clearTimeout(deadline);
        return;
      }
      const parsed = notification.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.params.subscription !== subscription ||
        parsed.data.params.result.value.err !== null
      )
        return;
      const logs = parsed.data.params.result.value.logs;
      if (parsePullRevealedLogs(logs, options.programId).length)
        options.trigger();
    });
    current.addEventListener("error", (event) => {
      // WebSocket ErrorEvent fields are accessors; extract the transport error
      // here so the logger does not need to invoke arbitrary error getters.
      const failure = event as ErrorEvent;
      reconnect(
        failure.error ?? new Error(failure.message || "keeper_logs_error"),
      );
    });
    current.addEventListener("close", reconnect);
  };
  options.signal.addEventListener("abort", stop, { once: true });
  connect();
  return stop;
}
