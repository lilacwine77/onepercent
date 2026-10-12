import { MAINNET_RELEASE } from "./mainnet-pins.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { anchorBuildCluster } from "./anchor-cluster.mjs";

const directory = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../programs/onepercent/src/params.rs", import.meta.url);
function run(args, environment = {}) {
  return spawnSync(process.execPath, args, {
    cwd: directory,
    env: { ...process.env, ONEPERCENT_CLUSTER: "localnet", ...environment },
    encoding: "utf8",
  });
}

test("localnet and devnet share the checked-in test config pin", () => {
  for (const cluster of ["localnet", "devnet"]) {
    const result = run([
      "--import",
      "tsx",
      "scripts/params-rs.ts",
      "--check",
      "--cluster",
      cluster,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(`compiled parameters \\(${cluster}\\)`),
    );
  }
});

test(
  "mainnet generation, release checks and direct builds fail before changing artifacts",
  { skip: MAINNET_RELEASE.programId !== null },
  () => {
    const before = readFileSync(output);
    for (const args of [
      ["--import", "tsx", "scripts/params-rs.ts", "--cluster", "mainnet"],
      [
        "--import",
        "tsx",
        "scripts/params-rs.ts",
        "--check",
        "--cluster",
        "mainnet",
      ],
      ["scripts/anchor.mjs", "build"],
    ]) {
      const result = run(args, { ONEPERCENT_CLUSTER: "mainnet" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Mainnet release is PENDING/);
      assert.deepEqual(readFileSync(output), before);
    }
  },
);

test(
  "explicit Anchor mainnet selectors reach the PENDING gate before Anchor starts",
  { skip: MAINNET_RELEASE.programId !== null },
  () => {
    const before = readFileSync(output);
    for (const selector of [
      ["--provider.cluster", "mainnet"],
      ["--provider.cluster", "mainnet-beta"],
      ["--provider.cluster=mainnet"],
      ["--provider.cluster=mainnet-beta"],
    ]) {
      const result = run(["scripts/anchor.mjs", "build", ...selector], {
        ONEPERCENT_CLUSTER: undefined,
        PATH: "",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Mainnet release is PENDING/);
      assert.deepEqual(readFileSync(output), before);
    }
  },
);

test("Anchor rejects conflicting cluster selections and requires custom URL classification", () => {
  assert.equal(
    anchorBuildCluster(["build", "--provider.cluster=mainnet-beta"], "mainnet"),
    "mainnet",
  );
  assert.throws(
    () =>
      anchorBuildCluster(["build", "--provider.cluster=mainnet"], "localnet"),
    /must select the same cluster/,
  );
  assert.throws(
    () =>
      anchorBuildCluster([
        "build",
        "--provider.cluster",
        "https://rpc.example",
      ]),
    /requires explicit ONEPERCENT_CLUSTER/,
  );
  assert.equal(
    anchorBuildCluster(
      ["build", "--provider.cluster", "https://rpc.example"],
      "devnet",
    ),
    "devnet",
  );
  assert.throws(
    () => anchorBuildCluster(["build", "--provider.cluster"]),
    /requires a value/,
  );
  assert.throws(
    () =>
      anchorBuildCluster([
        "--provider.cluster=devnet",
        "--provider.cluster=mainnet",
      ]),
    /specified once/,
  );
  const result = run(
    ["scripts/anchor.mjs", "build", "--provider.cluster=mainnet"],
    { ONEPERCENT_CLUSTER: "devnet", PATH: "" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must select the same cluster/);
});
