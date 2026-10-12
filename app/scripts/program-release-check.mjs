import assert from "node:assert/strict";
import { MAINNET_RELEASE } from "./mainnet-pins.mjs";
import { PROGRAM_IDS } from "./anchor-cluster.mjs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

// Release checks default to mainnet even when development uses localnet.
const { values } = parseArgs({
  options: { cluster: { type: "string", default: "mainnet" } },
  strict: true,
  allowPositionals: false,
});
const cluster = values.cluster === "mainnet-beta" ? "mainnet" : values.cluster;
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/params-rs.ts", "--check", "--cluster", cluster],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const identity = spawnSync(
  process.execPath,
  ["scripts/program.mjs", "identity"],
  {
    encoding: "utf8",
    env: { ...process.env, ONEPERCENT_CLUSTER: cluster },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
if (identity.error) throw identity.error;
if (identity.status !== 0) process.exit(identity.status ?? 1);
const [programId, dbcConfig] = identity.stdout.trim().split(/\s+/);
assert.equal(
  programId,
  PROGRAM_IDS[cluster],
  "Compiled program ID differs from selected cluster",
);
assert.equal(
  dbcConfig,
  cluster === "mainnet"
    ? MAINNET_RELEASE.dbcConfig
    : "AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k",
  "Compiled DBC config differs from selected cluster",
);
console.log(`Compiled identity (${cluster}): ${programId}; DBC ${dbcConfig}`);
