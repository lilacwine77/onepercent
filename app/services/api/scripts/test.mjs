import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { constants } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const runner = fileURLToPath(
  new URL("../../../scripts/test.mjs", import.meta.url),
);
const args = process.argv.slice(2);
// Resolve pnpm's physical package path before loading its transitive imports
// under --preserve-symlinks, as the shared test runner does for Vitest itself.
const { defaultExclude } = await import(
  pathToFileURL(
    await realpath(fileURLToPath(import.meta.resolve("vitest/config"))),
  ).href
);
// The wall-clock budget measures one scan, without unrelated renderer/test workers.
// Focused commands retain their exact arguments and the shared runner's behavior.
const groups = args.length
  ? [args]
  : [
      // CLI exclusions replace Vitest defaults, so retain them explicitly.
      [...defaultExclude, "src/xray/scale.test.ts"].flatMap((pattern) => [
        "--exclude",
        pattern,
      ]),
      ["src/xray/scale.test.ts"],
    ];
let child;
let interrupted;
const handlers = new Map();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handler = () => {
    interrupted = signal;
    child?.kill(signal);
  };
  handlers.set(signal, handler);
  process.on(signal, handler);
}

try {
  for (const group of groups) {
    const { code, signal } = await new Promise((resolve, reject) => {
      child = spawn(
        process.execPath,
        ["--preserve-symlinks", runner, ...group],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: "inherit",
        },
      );
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    child = undefined;
    const terminated = interrupted ?? signal;
    const exitCode = terminated
      ? 128 + constants.signals[terminated]
      : (code ?? 1);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      break;
    }
  }
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
}
