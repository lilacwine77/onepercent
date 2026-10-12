import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keeperLeaderBridge } from "./index.js";
import { subscribeReveals } from "./logs.js";
import { discriminator } from "./adapter.js";

class Socket extends EventTarget {
  sent: string[] = [];
  closed = false;
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    this.closed = true;
  }
  message(value: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}
const program = new PublicKey(Buffer.alloc(32, 11));
function logs() {
  const event = Buffer.alloc(161);
  discriminator("event", "PullRevealed").copy(event);
  Buffer.alloc(32, 12).copy(event, 8);
  return [
    `Program ${program} invoke [1]`,
    `Program data: ${event.toString("base64")}`,
    `Program ${program} success`,
  ];
}
afterEach(() => vi.useRealTimers());
describe("keeper runtime integration seam", () => {
  it("attaches after S0 calls onLeader during runtime creation", async () => {
    const bridge = keeperLeaderBridge();
    const controller = new AbortController();
    const term = bridge.onLeader(controller.signal);
    const onLeader = vi.fn(async () => undefined);
    expect(onLeader).not.toHaveBeenCalled();
    bridge.attach({ onLeader });
    await term;
    expect(onLeader).toHaveBeenCalledWith(controller.signal);
  });
  it("does not activate a term aborted before attachment", async () => {
    const bridge = keeperLeaderBridge();
    const controller = new AbortController();
    const term = bridge.onLeader(controller.signal);
    controller.abort();
    await term;
    const onLeader = vi.fn(async () => undefined);
    bridge.attach({ onLeader });
    expect(onLeader).not.toHaveBeenCalled();
    const replacement = new AbortController();
    await bridge.onLeader(replacement.signal);
    expect(onLeader).toHaveBeenCalledWith(replacement.signal);
  });
  it("rejects replacing an attached runtime", () => {
    const bridge = keeperLeaderBridge();
    const keeper = { onLeader: async () => undefined };
    bridge.attach(keeper);
    expect(() => bridge.attach(keeper)).toThrow("keeper_already_attached");
  });
  it("only triggers confirmed successful own-program reveals and closes on abort", () => {
    const socket = new Socket();
    const controller = new AbortController();
    const trigger = vi.fn();
    subscribeReveals({
      url: "https://rpc.example.invalid",
      programId: program,
      signal: controller.signal,
      retryMs: 10,
      timeoutMs: 100,
      trigger,
      failed: vi.fn(),
      createSocket: () => socket as unknown as WebSocket,
    });
    socket.dispatchEvent(new Event("open"));
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      method: "logsSubscribe",
      params: [{ mentions: [program.toBase58()] }, { commitment: "confirmed" }],
    });
    socket.message({ jsonrpc: "2.0", id: 1, result: 4 });
    const message = (subscription: number, err: unknown, lines: string[]) => ({
      method: "logsNotification",
      params: {
        subscription,
        result: {
          context: { slot: 1 },
          value: { signature: "signature", err, logs: lines },
        },
      },
    });
    socket.message(message(4, null, logs()));
    expect(trigger).toHaveBeenCalledTimes(1);
    socket.message(message(5, null, logs()));
    socket.message(message(4, { InstructionError: [0, "error"] }, logs()));
    socket.message(
      message(4, null, [
        `Program ${PublicKey.default} invoke [1]`,
        logs()[1]!,
        `Program ${PublicKey.default} success`,
      ]),
    );
    expect(trigger).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(socket.closed).toBe(true);
    socket.message(message(4, null, logs()));
    expect(trigger).toHaveBeenCalledTimes(1);
  });
  it("reconnects on handshake timeout without disabling the scan fallback", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sockets: Socket[] = [];
    const failed = vi.fn();
    subscribeReveals({
      url: "ws://rpc.example.invalid",
      programId: program,
      signal: controller.signal,
      retryMs: 10,
      timeoutMs: 100,
      trigger: vi.fn(),
      failed,
      createSocket: () => {
        const socket = new Socket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    await vi.advanceTimersByTimeAsync(110);
    expect(sockets).toHaveLength(2);
    expect(sockets[0]!.closed).toBe(true);
    expect(failed).toHaveBeenCalledTimes(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
  });
  it("passes a WebSocket transport error through accessor fields to the fallback logger", () => {
    const controller = new AbortController();
    const socket = new Socket();
    const failed = vi.fn();
    subscribeReveals({
      url: "ws://rpc.example.invalid",
      programId: program,
      signal: controller.signal,
      retryMs: 10,
      timeoutMs: 100,
      trigger: vi.fn(),
      failed,
      createSocket: () => socket as unknown as WebSocket,
    });
    const cause = Object.assign(new Error("connect refused"), {
      code: "ECONNREFUSED",
    });
    const event = new Event("error");
    Object.defineProperty(event, "error", { get: () => cause });
    socket.dispatchEvent(event);
    expect(failed).toHaveBeenCalledExactlyOnceWith(cause);
    expect(socket.closed).toBe(true);
    controller.abort();
  });
});
