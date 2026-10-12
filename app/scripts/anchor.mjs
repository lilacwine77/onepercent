import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rmdir, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorBuildCluster, anchorClusterArgs } from "./anchor-cluster.mjs";

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const environment = { ...process.env, RUSTUP_TOOLCHAIN: "1.95.0" };
environment.ONEPERCENT_CLUSTER = anchorBuildCluster(
  process.argv.slice(2),
  environment.ONEPERCENT_CLUSTER,
);
// Direct anchor:build calls have the same cluster pin gate as program:build.
const parameters = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/params-rs.ts", "--check"],
  { cwd: appDirectory, env: environment, stdio: "inherit" },
);
if (parameters.error) throw parameters.error;
if (parameters.status !== 0) process.exit(parameters.status ?? 1);
const targetDirectory = resolve(
  appDirectory,
  environment.CARGO_TARGET_DIR || "target",
);

// LLVM's temporary output-file handling rejects a literal % in the output path.
// The alias keeps all build artifacts in this workspace's ignored target folder.
let temporaryDirectory;
let targetAlias;
if (targetDirectory.includes("%")) {
  await mkdir(targetDirectory, { recursive: true });
  temporaryDirectory = await mkdtemp(join(tmpdir(), "onepercent-anchor-"));
  targetAlias = join(temporaryDirectory, "target");
  await symlink(targetDirectory, targetAlias, "dir");
  environment.CARGO_TARGET_DIR = targetAlias;
}

let child;
const interrupt = () => child?.kill("SIGINT");
const terminate = () => child?.kill("SIGTERM");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);

let result;
try {
  child = spawn(
    "anchor",
    anchorClusterArgs(process.argv.slice(2), environment.ONEPERCENT_CLUSTER),
    {
      cwd: appDirectory,
      env: environment,
      stdio: "inherit",
    },
  );
  result = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  if (targetAlias) await unlink(targetAlias);
  if (temporaryDirectory) await rmdir(temporaryDirectory);
}

if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.code ?? 1;
