import assert from "node:assert/strict";
import test from "node:test";
import { browserDeployment } from "./deployment.mjs";

test("pins only explicitly selected public deployment configuration", () => {
  assert.equal(browserDeployment({}), null);
  assert.deepEqual(
    browserDeployment({
      CLUSTER: "mainnet-beta",
      PROGRAM_ID: "address",
      VITE_CLUSTER: "mainnet",
      SECRET: "private",
    }),
    { cluster: "mainnet", programId: "address" },
  );
  assert.deepEqual(
    browserDeployment({
      CLUSTER: "localnet",
      PROGRAM_ID: "fixture",
      VITE_CLUSTER: "devnet",
    }),
    { cluster: "localnet", programId: "fixture" },
  );
  for (const input of [
    { PROGRAM_ID: "address" },
    { CLUSTER: "devnet" },
    { CLUSTER: "unknown", PROGRAM_ID: "address" },
    { CLUSTER: "devnet", PROGRAM_ID: "address", VITE_CLUSTER: "mainnet" },
  ])
    assert.throws(() => browserDeployment(input));
});
