import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type { serve } from "@hono/node-server";
import type { Logger } from "pino";
import { afterEach, expect, it, vi } from "vitest";
import { installShutdown } from "../src/runtime.js";

vi.mock("../src/params.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/params.js")>();
  return {
    ...actual,
    serviceParams: {
      ...actual.serviceParams,
      transport: { ...actual.serviceParams.transport, shutdownDrainMs: 1_234 },
    },
  };
});

const originalExitCode = process.exitCode;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  process.exitCode = originalExitCode;
});

function fixture(
  options: { stopPending?: boolean; closePending?: boolean } = {},
) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const once = vi
    .spyOn(process, "once")
    .mockImplementation((event, listener) => {
      listeners.set(String(event), listener);
      return process;
    });
  const on = vi.spyOn(process, "on").mockImplementation((event, listener) => {
    listeners.set(String(event), listener);
    return process;
  });
  const runtime = {
    stop: vi.fn(() =>
      options.stopPending ? new Promise<void>(() => {}) : Promise.resolve(),
    ),
    logger: { error: vi.fn(), flush: vi.fn() } as unknown as Logger,
  };
  const server = Object.assign(new EventEmitter(), {
    close: vi.fn((callback: (error?: Error) => void) => {
      if (!options.closePending) callback();
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  });
  const dispose = installShutdown(runtime, [
    server as unknown as ReturnType<typeof serve>,
  ]);
  once.mockRestore();
  on.mockRestore();
  return { runtime, server, dispose, listeners };
}

it("invalidates the runtime before draining servers and completes normal shutdown once", async () => {
  vi.useFakeTimers();
  const { runtime, server, dispose, listeners } = fixture();
  try {
    listeners.get("SIGTERM")!();
    listeners.get("SIGINT")!();
    await vi.runAllTimersAsync();
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(runtime.stop.mock.invocationCallOrder[0]).toBeLessThan(
      server.close.mock.invocationCallOrder[0]!,
    );
    expect(server.closeIdleConnections).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    dispose();
  }
});

it("forces active HTTP connections closed at the configured drain deadline when cleanup stalls", async () => {
  vi.useFakeTimers();
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
  const { runtime, server, dispose, listeners } = fixture({
    stopPending: true,
    closePending: true,
  });
  try {
    listeners.get("SIGTERM")!();
    await vi.advanceTimersByTimeAsync(1_233);
    expect(exit).not.toHaveBeenCalled();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(runtime.logger.error).toHaveBeenCalledWith(
      { reason: "shutdown_timeout" },
      "shutdown deadline reached",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(process.exitCode).toBe(1);
  } finally {
    dispose();
  }
});

it.each(["exception", "rejection"] as const)(
  "logs %s safely and exits 1 in a real process",
  (mode) => {
    const runtimePath = fileURLToPath(
      new URL("../src/runtime.ts", import.meta.url),
    );
    const logPath = fileURLToPath(new URL("../src/log.ts", import.meta.url));
    const workspace = fileURLToPath(new URL("../../../", import.meta.url));
    const source = `
    import { installShutdown } from ${JSON.stringify(runtimePath)};
    import { createServiceLogger } from ${JSON.stringify(logPath)};
    const logger = createServiceLogger({service:'worker',role:'indexer',cluster:'localnet',version:'test',commit:'test'}, {ipSalt:'test-salt',secretValues:['provider-secret']});
    installShutdown({logger,stop:async()=>{}}, []);
    setInterval(() => {}, 1_000);
    const error = new Error('provider-secret https://rpc.invalid/private?api-key=private-key-value');
    ${mode === "exception" ? "setImmediate(() => { throw error; });" : "void Promise.reject(error);"}
  `;
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        source,
      ],
      {
        cwd: workspace,
        env: { PATH: process.env.PATH ?? "" },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    const output = result.stdout + result.stderr;
    expect(output).toContain(
      mode === "exception" ? "uncaught_exception" : "unhandled_rejection",
    );
    for (const secret of [
      "provider-secret",
      "private-key-value",
      "https://rpc.invalid",
      "api-key=",
    ])
      expect(output).not.toContain(secret);
  },
  35_000,
);
