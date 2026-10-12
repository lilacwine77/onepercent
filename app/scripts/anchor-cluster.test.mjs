import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorBuildCluster,
  anchorClusterArgs,
  clusterCargoArgs,
} from "./anchor-cluster.mjs";

test("localnet is the feature-free default; devnet reaches SBF and IDL Cargo builds", () => {
  assert.equal(anchorBuildCluster([], undefined), "localnet");
  assert.deepEqual(
    anchorClusterArgs(["build", "--", "--arch", "v3"], "localnet"),
    ["build", "--", "--arch", "v3"],
  );
  assert.deepEqual(
    anchorClusterArgs(["build", "--", "--arch", "v3"], "devnet"),
    ["build", "--", "--arch", "v3", "--features", "devnet"],
  );
  assert.deepEqual(
    anchorClusterArgs(["idl", "build", "--", "--lib"], "devnet"),
    ["idl", "build", "--", "--lib", "--features", "devnet"],
  );
  assert.deepEqual(
    clusterCargoArgs(["clippy", "--", "-D", "warnings"], "devnet"),
    ["clippy", "--features", "devnet", "--", "-D", "warnings"],
  );
});
test("cluster feature conflicts fail closed", () => {
  for (const cluster of ["localnet", "devnet", "mainnet"]) {
    assert.throws(() => clusterCargoArgs(["--all-features"], cluster));
    assert.throws(() =>
      clusterCargoArgs(["--features=devnet,mainnet"], cluster),
    );
  }
  assert.throws(() => clusterCargoArgs(["--features", "devnet"], "localnet"));
  assert.throws(() =>
    anchorBuildCluster(["--provider.cluster", "localnet"], "devnet"),
  );
  assert.deepEqual(
    clusterCargoArgs(["--features", "devnet,idl-build"], "devnet"),
    ["--features", "devnet,idl-build"],
  );
});
