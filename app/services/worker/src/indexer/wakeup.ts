import { warnCause } from "@onepercent/service-kit";
import { z } from "zod";

const notificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("logsNotification"),
  params: z.object({
    subscription: z.number().int(),
    result: z.object({
      context: z.object({ slot: z.number().int().nonnegative() }),
      value: z.object({
        signature: z.string(),
        err: z.unknown(),
        logs: z.array(z.string()),
      }),
    }),
  }),
});

/** A WebSocket notification is only a poll hint. Its logs never enter storage. */
export class LogsWakeup {
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  constructor(
    private readonly options: {
      url: string;
      programId: string;
      retryMs: number;
      timeoutMs: number;
      poll: () => void;
      createSocket?: (url: string) => WebSocket;
    },
  ) {}
  start() {
    if (this.closed || this.socket) return;
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(
      this.options.url,
    );
    this.socket = socket;
    let subscription: number | undefined;
    this.deadline = setTimeout(() => socket.close(), this.options.timeoutMs);
    this.deadline.unref();
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "logsSubscribe",
          params: [
            { mentions: [this.options.programId] },
            { commitment: "confirmed" },
          ],
        }),
      );
    });
    socket.addEventListener("message", (message) => {
      try {
        if (typeof message.data !== "string") return;
        const data: unknown = JSON.parse(message.data);
        const ack = z
          .object({
            jsonrpc: z.literal("2.0"),
            id: z.literal(1),
            result: z.number().int().nonnegative(),
          })
          .safeParse(data);
        if (ack.success) {
          subscription = ack.data.result;
          clearTimeout(this.deadline);
          // Reconnects can miss notifications; the durable cursor fills the gap.
          this.options.poll();
          return;
        }
        const notice = notificationSchema.safeParse(data);
        if (notice.success && notice.data.params.subscription === subscription)
          this.options.poll();
      } catch (error) {
        warnCause("indexer_notification_invalid", error);
        /* HTTP polling is authoritative, including malformed notifications. */
      }
    });
    socket.addEventListener("error", (event) => {
      const failure = event as ErrorEvent;
      warnCause(
        "indexer_logs_unavailable",
        failure.error ?? new Error(failure.message || "indexer_logs_error"),
      );
      socket.close();
    });
    socket.addEventListener("close", () => {
      clearTimeout(this.deadline);
      if (this.socket === socket) this.socket = undefined;
      if (!this.closed) {
        this.timer = setTimeout(() => this.start(), this.options.retryMs);
        this.timer.unref();
      }
    });
  }
  stop() {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.socket?.close();
    this.socket = undefined;
  }
}

export function websocketUrl(rpcUrl: string) {
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("invalid_rpc_url");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
