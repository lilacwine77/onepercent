import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const cases = [
  ["api", "public", "INTAKE_SIGNER_KEYPAIR"],
  ["api", "intake-signer", "QUOTE_SIGNER_KEYPAIR"],
  ["api", "quote-signer", "INTAKE_SIGNER_KEYPAIR"],
  ["worker", "indexer", "KEEPER_KEYPAIR"],
  ["worker", "keeper", "EXECUTOR_KEYPAIR"],
  ["worker", "executor", "KEEPER_KEYPAIR"],
  ["worker", "monitor", "EXECUTOR_KEYPAIR"],
] as const;

describe("service entrypoint isolation", () => {
  for (const [service, role, foreignVariable] of cases) {
    it(`${role} exits 1 and prints only the foreign variable name`, () => {
      const entrypoint = fileURLToPath(
        new URL(`../../../services/${service}/src/index.ts`, import.meta.url),
      );
      // Resolve workspace packages to source: this test does not need a prior build.
      // No dependency URLs are provided, so even a broken guard cannot contact one.
      const result = spawnSync(
        process.execPath,
        ["--conditions=development", "--import", "tsx", entrypoint],
        {
          cwd: workspace,
          env: {
            PATH: process.env.PATH ?? "",
            ROLE: role,
            [foreignVariable]: "sentinel-never-log-this-value",
          },
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1_000_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        `${JSON.stringify({ level: "warn", variable: foreignVariable, cause: { code: "EnvironmentError", detail: foreignVariable } })}\n`,
      );
    }, 35_000);
  }
});
