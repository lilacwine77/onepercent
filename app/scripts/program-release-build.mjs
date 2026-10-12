import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const app = dirname(dirname(fileURLToPath(import.meta.url)));
export const BUILD = Object.freeze({
  baseImage:
    "solanafoundation/solana-verifiable-build@sha256:12fd4c0a0790f0fc41ef74b0cdb6bccc167ba6137eb1adb749bac649481c86bd",
  platform: "linux/amd64",
  rust: "1.95.0",
  cargoBuildSbf: "4.3.0",
  platformTools: "v1.57",
  anchorCrates: "0.32.2",
  architecture: "v3",
  features: ["mainnet"],
});
export const buildCommand = [
  "cargo",
  "build-sbf",
  "--manifest-path",
  "programs/onepercent/Cargo.toml",
  "--arch",
  BUILD.architecture,
  "--tools-version",
  BUILD.platformTools,
  "--sbf-out-dir",
  "/output/deploy",
  "--",
  "--locked",
  "--features",
  "mainnet",
  "--target-dir",
  "/output",
];
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function assertReleaseElf(bytes) {
  assert(bytes.length >= 64, "Truncated ELF");
  assert.equal(
    bytes.subarray(0, 6).toString("hex"),
    "7f454c460201",
    "Expected little-endian ELF64",
  );
  assert.equal(bytes.readUInt32LE(48), 3, "Expected sBPFv3");
}
export function releaseManifest({
  commit,
  tree,
  artifact,
  input,
  lock,
  image,
  versions,
}) {
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.match(tree, /^[0-9a-f]{40}$/);
  assertReleaseElf(artifact);
  const publicInput = JSON.parse(input.toString("utf8"));
  return {
    schemaVersion: 1,
    cluster: "mainnet",
    commit,
    tree,
    sourceDirectory: "app",
    cleanCheckout: true,
    programId: publicInput.programId,
    dbcConfig: publicInput.dbcConfig,
    publicInputSha256: sha256(input),
    cargoLockSha256: sha256(lock),
    toolchain: { ...BUILD, image, versions },
    command: buildCommand,
    artifact: {
      file: "onepercent.so",
      bytes: artifact.length,
      sha256: sha256(artifact),
    },
    reproduction: { independentBuilds: 2, byteIdentical: true },
  };
}
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: app,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed`);
  return result.stdout?.trim();
}
export async function buildRelease(args) {
  const { values } = parseArgs({
    args,
    options: { cluster: { type: "string", default: "mainnet" } },
    strict: true,
  });
  assert.equal(
    values.cluster,
    "mainnet",
    "This recipe produces only the mainnet release",
  );
  run(process.execPath, ["scripts/mainnet-release.mjs", "check"]);
  run(process.execPath, [
    "scripts/program-release-check.mjs",
    "--cluster",
    "mainnet",
  ]);
  assert.equal(
    run("git", ["status", "--porcelain", "--untracked-files=all"], true),
    "",
    "Release requires a clean committed checkout; ask the architect to commit the reviewed changes",
  );
  const commit = run("git", ["rev-parse", "HEAD"], true);
  const tree = run("git", ["rev-parse", "HEAD^{tree}"], true);
  run("docker", ["info"], true);
  const scratch = await mkdtemp(join(tmpdir(), "onepercent-release-build-"));
  try {
    const source = join(scratch, "source");
    await mkdir(source);
    const archive = join(scratch, "source.tar");
    run("git", [
      "-C",
      "..",
      "archive",
      "--format=tar",
      `--output=${archive}`,
      commit,
      "app/Cargo.toml",
      "app/Cargo.lock",
      "app/rust-toolchain.toml",
      "app/programs",
      "app/release/mainnet.json",
      "app/release/Dockerfile",
    ]);
    run("tar", ["-xf", archive, "-C", source, "--strip-components=1"]);
    const iid = join(scratch, "image-id");
    run("docker", [
      "build",
      "--platform",
      BUILD.platform,
      "--iidfile",
      iid,
      "-f",
      join(source, "release/Dockerfile"),
      join(source, "release"),
    ]);
    const image = (await readFile(iid, "utf8")).trim();
    const versions = run(
      "docker",
      [
        "run",
        "--rm",
        "--platform",
        BUILD.platform,
        "--entrypoint",
        "bash",
        image,
        "-lc",
        "rustc --version && cargo build-sbf --version",
      ],
      true,
    );
    const outputs = [];
    for (const label of ["first", "second"]) {
      const output = join(scratch, label);
      await mkdir(output);
      // cargo-build-sbf's incidental local signing files stay outside the repository.
      run("docker", [
        "run",
        "--rm",
        "--platform",
        BUILD.platform,
        "--mount",
        `type=bind,source=${source},target=/build,readonly`,
        "--mount",
        `type=bind,source=${output},target=/output`,
        "--workdir",
        "/build",
        "--env",
        "CARGO_INCREMENTAL=0",
        "--env",
        "RUSTUP_TOOLCHAIN=1.95.0",
        "--entrypoint",
        "bash",
        image,
        "-lc",
        `${buildCommand.join(" ")}; result=$?; chown -R ${process.getuid()}:${process.getgid()} /output; exit "$result"`,
      ]);
      outputs.push(await readFile(join(output, "deploy/onepercent.so")));
    }
    assert(
      outputs[0].equals(outputs[1]),
      "Independent release builds differ; no artifact published",
    );
    assert.equal(
      run("git", ["rev-parse", "HEAD"], true),
      commit,
      "Checkout commit changed during release build",
    );
    assert.equal(
      run("git", ["status", "--porcelain", "--untracked-files=all"], true),
      "",
      "Checkout changed during release build",
    );
    const manifest = releaseManifest({
      commit,
      tree,
      artifact: outputs[0],
      image,
      versions,
      input: await readFile(join(source, "release/mainnet.json")),
      lock: await readFile(join(source, "Cargo.lock")),
    });
    const destination = join(app, "target/release/mainnet");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "onepercent.so"), outputs[0]);
    await writeFile(
      join(destination, "onepercent.so.sha256"),
      `${manifest.artifact.sha256}  onepercent.so\n`,
    );
    await writeFile(
      join(destination, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await buildRelease(process.argv.slice(2));
