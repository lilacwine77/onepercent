import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({ runOps: vi.fn(), runLaunch: vi.fn() }));
vi.mock("../runtime.js", () => ({ runOps: handlers.runOps }));
vi.mock("./runtime.js", () => ({
  runLaunch: handlers.runLaunch,
  launchJson: (value: unknown) => JSON.stringify(value),
}));

async function execute(args: string[]) {
  vi.resetModules();
  const previousArgs = process.argv;
  const previousCode = process.exitCode;
  const output: string[] = [];
  const errors: string[] = [];
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
  try {
    process.argv = ["node", "onepct-ops", ...args];
    process.exitCode = undefined;
    await import("./ops.js");
    return {
      code: process.exitCode,
      output: output.join(""),
      errors: errors.join(""),
    };
  } finally {
    process.argv = previousArgs;
    process.exitCode = previousCode;
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

beforeEach(() => {
  handlers.runOps.mockReset();
  handlers.runLaunch.mockReset();
});

describe("installed operator dispatcher", () => {
  it("routes launch commands and propagates their NO-GO status", async () => {
    handlers.runLaunch.mockResolvedValue({ ok: false });
    const result = await execute(["launch", "check"]);
    expect(handlers.runLaunch).toHaveBeenCalledWith(["launch", "check"]);
    expect(handlers.runOps).not.toHaveBeenCalled();
    expect(result.code).toBe(1);
  });
  it("preserves failed simulation exit status for existing commands", async () => {
    handlers.runOps.mockResolvedValue({ simulation: { ok: false } });
    const result = await execute(["init", "params.json"]);
    expect(handlers.runOps).toHaveBeenCalledWith(["init", "params.json"]);
    expect(handlers.runLaunch).not.toHaveBeenCalled();
    expect(result.code).toBe(1);
  });
  it("preserves success for existing commands", async () => {
    handlers.runOps.mockResolvedValue({ simulation: { ok: true } });
    const result = await execute(["init", "params.json"]);
    expect(result.code).toBeUndefined();
    expect(result.output).toBe('{"simulation":{"ok":true}}\n');
  });
  it.each([
    ["launch", "launch_failed"],
    ["init", "ops_failed"],
  ])("keeps the redacted %s error boundary", async (command, errorCode) => {
    handlers.runLaunch.mockRejectedValue(new Error("private provider details"));
    handlers.runOps.mockRejectedValue(new Error("private provider details"));
    const result = await execute([command!]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.errors)).toEqual({ ok: false, error: errorCode });
  });
});
