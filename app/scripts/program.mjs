import { anchorBuildCluster, clusterCargoArgs } from "./anchor-cluster.mjs";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rmdir, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const [operation, ...extra] = process.argv.slice(2);
const commands = {
  identity: [
    "run",
    "--example",
    "cluster_identity",
    "--profile",
    "test",
    "--quiet",
  ],
  test: [
    "test",
    "--no-fail-fast",
    "--manifest-path",
    "programs/onepercent/Cargo.toml",
  ],
  clippy: [
    "clippy",
    "--manifest-path",
    "programs/onepercent/Cargo.toml",
    "--profile",
    "test",
    "--lib",
    "--",
    "-D",
    "warnings",
  ],
  report: ["test", "--test", "bench_cu_sizes", "--", "--nocapture"],
  golden: ["test", "--test", "golden"],
  mock: [
    "build-sbf",
    "--manifest-path",
    "test-programs/mock-vrf/Cargo.toml",
    "--sbf-out-dir",
    "target/deploy",
    "--arch",
    "v3",
  ],
};
if (!(operation in commands))
  throw new Error(`Unknown program operation: ${operation}`);
const environment = {
  ...process.env,
  RUSTUP_TOOLCHAIN: "1.95.0",
  PROPTEST_CASES: process.env.PROPTEST_CASES ?? "1000",
  ...(operation === "golden" ? { UPDATE_GOLDEN: "1" } : {}),
};

// LLVM needs an output path without a percent sign; artifacts remain in target/.
const targetDirectory = resolve(
  appDirectory,
  environment.CARGO_TARGET_DIR || "target",
);
let temporaryDirectory;
let targetAlias;
if (targetDirectory.includes("%")) {
  await mkdir(targetDirectory, { recursive: true });
  temporaryDirectory = await mkdtemp(join(tmpdir(), "onepercent-program-"));
  targetAlias = join(temporaryDirectory, "target");
  await symlink(targetDirectory, targetAlias, "dir");
  environment.CARGO_TARGET_DIR = targetAlias;
}

if (operation === "mock" && targetAlias) {
  commands.mock[commands.mock.indexOf("--sbf-out-dir") + 1] = join(
    targetAlias,
    "deploy",
  );
}

let child;
const interrupt = () => child?.kill("SIGINT");
const terminate = () => child?.kill("SIGTERM");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
let result;
try {
  const args = [...commands[operation], ...extra];
  child = spawn(
    "cargo",
    operation === "mock"
      ? args
      : clusterCargoArgs(
          args,
          anchorBuildCluster([], environment.ONEPERCENT_CLUSTER),
        ),
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
