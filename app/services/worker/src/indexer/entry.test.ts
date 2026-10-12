import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  role: "indexer",
  runtime: {
    stop: vi.fn(async () => undefined),
    logger: { info: vi.fn() },
  },
  indexer: {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    store: {},
    reconciler: {},
  },
  server: { close: vi.fn() },
  dispose: vi.fn(),
  createRuntime: vi.fn(),
  startKeeperWorker: vi.fn(),
  startExecutorWorker: vi.fn(),
  createIndexer: vi.fn(),
  attachIndexerShutdown: vi.fn(),
  listenRuntime: vi.fn(),
  installShutdown: vi.fn(),
  reportStartupFailure: vi.fn(),
  replayIndexer: vi.fn(),
}));

vi.mock("@onepercent/service-kit", () => ({
  createRuntime: stubs.createRuntime,
  listenRuntime: stubs.listenRuntime,
  installShutdown: stubs.installShutdown,
  reportStartupFailure: stubs.reportStartupFailure,
}));
vi.mock("../roles.js", () => ({
  loadWorkerRole: () => ({ role: stubs.role, env: {} }),
}));
vi.mock("./index.js", () => ({
  createIndexer: stubs.createIndexer,
  attachIndexerShutdown: stubs.attachIndexerShutdown,
}));
vi.mock("./replay.js", () => ({ replayIndexer: stubs.replayIndexer }));
vi.mock("../executor/bootstrap.js", () => ({
  startExecutorWorker: stubs.startExecutorWorker,
}));

const originalArgv = process.argv;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  stubs.role = "indexer";
  stubs.indexer.start.mockResolvedValue(undefined);
  stubs.createRuntime.mockResolvedValue(stubs.runtime);
  stubs.startKeeperWorker.mockResolvedValue(stubs.runtime);
  stubs.startExecutorWorker.mockResolvedValue(stubs.runtime);
  // D21 adds this sibling bootstrap on rebase; do not load keeper jobs here.
  if (existsSync(new URL("../keeper/bootstrap.ts", import.meta.url))) {
    vi.doMock("../keeper/bootstrap.js", () => ({
      startKeeperWorker: stubs.startKeeperWorker,
    }));
  }
  stubs.createIndexer.mockReturnValue(stubs.indexer);
  stubs.listenRuntime.mockReturnValue(stubs.server);
  stubs.installShutdown.mockReturnValue(stubs.dispose);
});
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

describe("worker indexer entry", () => {
  it("attaches the indexer and S0 shutdown before starting ingestion", async () => {
    await import("../index.js");
    expect(stubs.createIndexer).toHaveBeenCalledWith(
      stubs.runtime,
      expect.objectContaining({
        services: expect.objectContaining({ indexer: expect.any(Object) }),
        royaltyPerDustCardBps: expect.any(Number),
      }),
    );
    expect(stubs.attachIndexerShutdown).toHaveBeenCalledWith(
      stubs.runtime,
      stubs.indexer,
    );
    expect(stubs.installShutdown).toHaveBeenCalledWith(stubs.runtime, [
      stubs.server,
    ]);
    expect(stubs.installShutdown.mock.invocationCallOrder[0]).toBeLessThan(
      stubs.indexer.start.mock.invocationCallOrder[0]!,
    );
  });

  it.each(["keeper", "executor", "monitor"])(
    "does not attach indexer work to ROLE=%s",
    async (role) => {
      stubs.role = role;
      await import("../index.js");
      expect(stubs.createIndexer).not.toHaveBeenCalled();
      expect(stubs.indexer.start).not.toHaveBeenCalled();
      expect(stubs.installShutdown).toHaveBeenCalledOnce();
      expect(stubs.reportStartupFailure).not.toHaveBeenCalled();
    },
  );

  it("closes resources when indexer startup fails", async () => {
    const failure = new Error("startup_failed");
    stubs.indexer.start.mockRejectedValueOnce(failure);
    await import("../index.js");
    expect(stubs.runtime.stop).toHaveBeenCalledOnce();
    expect(stubs.server.close).toHaveBeenCalledOnce();
    expect(stubs.dispose).toHaveBeenCalledOnce();
    expect(stubs.reportStartupFailure).toHaveBeenCalledWith(failure);
  });
});

describe("offline indexer replay command", () => {
  it("passes the requested slot and closes runtime without starting ingestion", async () => {
    process.argv = ["node", "replay-cli", "--from-slot", "42"];
    stubs.replayIndexer.mockResolvedValue({ fromSlot: "42", hashes: {} });
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await import("./replay-cli.js");
    expect(stubs.replayIndexer).toHaveBeenCalledWith({
      store: stubs.indexer.store,
      reconciler: stubs.indexer.reconciler,
      argv: ["--from-slot", "42"],
    });
    expect(output).toHaveBeenCalledWith('{"fromSlot":"42","hashes":{}}\n');
    expect(stubs.indexer.start).not.toHaveBeenCalled();
    expect(stubs.listenRuntime).not.toHaveBeenCalled();
    expect(stubs.runtime.stop).toHaveBeenCalledOnce();
    expect(stubs.dispose).toHaveBeenCalledOnce();
  });

  it("rejects a different role before opening runtime resources", async () => {
    stubs.role = "keeper";
    await import("./replay-cli.js");
    expect(stubs.createRuntime).not.toHaveBeenCalled();
    expect(stubs.replayIndexer).not.toHaveBeenCalled();
    expect(stubs.reportStartupFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: "indexer_role_required" }),
    );
  });
});
