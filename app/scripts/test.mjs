import {
  access,
  mkdtemp,
  realpath,
  rmdir,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
// Vite and Vitest interpret literal '%' characters in paths as URL escapes.
// Match the landing's local runner: use the same files through a temporary alias.
const temporary = workspace.includes("%")
  ? await mkdtemp(join(tmpdir(), "onepercent-tests-"))
  : null;
const workspaceAlias = temporary ? join(temporary, "app") : workspace;
if (temporary) await symlink(workspace, workspaceAlias, "dir");

let vitest;
let cleaning;
async function clean() {
  cleaning ??= (async () => {
    await vitest?.close();
    if (temporary) {
      await unlink(workspaceAlias);
      await rmdir(temporary);
    }
  })();
  return cleaning;
}

const signals = { SIGINT: 130, SIGTERM: 143 };
for (const [signal, exitCode] of Object.entries(signals)) {
  process.once(signal, () => {
    void clean().finally(() => process.exit(exitCode));
  });
}

try {
  const vitestEntry = await realpath(
    join(workspace, "node_modules/vitest/dist/node.js"),
  );
  const { parseCLI, startVitest } = await import(
    pathToFileURL(join(workspaceAlias, relative(workspace, vitestEntry))).href
  );
  const { filter, options } = parseCLI([
    "vitest",
    "run",
    ...process.argv.slice(2),
  ]);
  const workerLimit = process.env.VITEST_MAX_WORKERS;
  if (workerLimit !== undefined) {
    const maximum = Number(workerLimit);
    if (!Number.isSafeInteger(maximum) || maximum < 1)
      throw new Error("VITEST_MAX_WORKERS must be a positive integer");
    const requested =
      typeof options.maxWorkers === "number" ? options.maxWorkers : maximum;
    options.maxWorkers = Math.min(requested, maximum);
  }
  const requestedRoot = resolve(process.cwd(), options.root || ".");
  const root = join(workspaceAlias, relative(workspace, requestedRoot));

  if (typeof options.config === "string") {
    options.config = join(
      workspaceAlias,
      relative(workspace, resolve(requestedRoot, options.config)),
    );
  } else if (options.config !== false) {
    for (const name of ["vitest.config.ts", "vite.config.ts"]) {
      const config = join(root, name);
      try {
        await access(config);
        options.config = config;
        break;
      } catch {
        // This package can use Vitest defaults without a local config.
      }
    }
  }

  vitest = await startVitest(
    filter,
    { ...options, root, run: true, watch: false },
    { resolve: { preserveSymlinks: true } },
  );
} finally {
  await clean();
}
