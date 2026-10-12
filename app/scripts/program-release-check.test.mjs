import { MAINNET_RELEASE } from "./mainnet-pins.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

// The TS-only CI job tests orchestration with a Cargo stub. The program CI job
// runs these release checks against real compiled constants for both clusters.
function cargoStub(t, wrongIdentity = false, wrongDbc = false) {
  const directory = mkdtempSync(join(tmpdir(), "onepercent-release-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, "cargo"),
    `#!${process.execPath}
const args = process.argv.slice(2);
if (!args.includes("cluster_identity")) process.exit(2);
const devnet = args.includes("devnet");
const id = ${wrongIdentity} ? "11111111111111111111111111111111" : devnet
  ? "DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr"
  : "DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe";
console.log(id + " " + (${wrongDbc} ? "11111111111111111111111111111111" : "AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k"));
`,
    { mode: 0o700 },
  );
  return directory + delimiter + process.env.PATH;
}

function check(args, cluster, path = process.env.PATH) {
  return spawnSync(
    process.execPath,
    ["scripts/program-release-check.mjs", ...args],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, ONEPERCENT_CLUSTER: cluster, PATH: path },
    },
  );
}

test("an explicit devnet release accepts the compiled cluster identity", (t) => {
  const result = check(["--cluster", "devnet"], "mainnet", cargoStub(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /compiled parameters \(devnet\)/);
  assert.match(
    result.stdout,
    /Compiled identity \(devnet\): DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr;/,
  );
});

test("the localnet release checks the default Cargo identity", (t) => {
  const result = check(["--cluster", "localnet"], "devnet", cargoStub(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Compiled identity \(localnet\): DoNH1Cxvv9umyWV9i77LEK4CoqTotDxPRzPxPBzjMJpe;/,
  );
});

test("a wrong compiled identity fails the release check", (t) => {
  const result = check(["--cluster", "devnet"], "devnet", cargoStub(t, true));
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Compiled program ID differs from selected cluster/,
  );
});

test("a wrong compiled DBC pin fails even when the program identity matches", (t) => {
  const result = check(
    ["--cluster", "devnet"],
    "devnet",
    cargoStub(t, false, true),
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Compiled DBC config differs from selected cluster/,
  );
});

test(
  "the default release rejects the pending mainnet pin even in a devnet shell",
  { skip: MAINNET_RELEASE.programId !== null },
  () => {
    const result = check([], "devnet");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Mainnet release is PENDING/);
  },
);

test("an unknown release cluster fails closed", () => {
  const result = check(["--cluster", "unknown"], "devnet");
  assert.notEqual(result.status, 0);
});
