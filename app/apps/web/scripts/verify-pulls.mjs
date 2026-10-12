#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reuses the browser loader test, so the run cannot drift into a separate verifier.
// The fixture contains recorded local-validator callbacks with a mock VRF provider.
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "onepercent-verify-replay-"));
try {
  const fixture = JSON.parse(
    await readFile(
      join(web, "../../packages/sdk/src/verify/fixtures/validator-pulls.json"),
      "utf8",
    ),
  );
  const reportPath = join(temporary, "report.json");
  const result = spawnSync(
    process.execPath,
    [
      "--preserve-symlinks",
      "../../scripts/test.mjs",
      "src/data/verify.test.ts",
      "--maxWorkers=2",
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ],
    {
      cwd: web,
      encoding: "utf8",
      env: { ...process.env, VITEST_MAX_WORKERS: "2" },
    },
  );
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (
    result.status !== 0 ||
    !report.success ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numPassedTests < 2
  )
    throw new Error(result.stderr || result.stdout || "Verify replay failed");
  console.log(
    JSON.stringify(
      {
        result: "passed",
        pulls: fixture.provenance.pulls,
        source: "recorded local-validator callbacks",
        provider: "mock VRF",
        recordedAt: fixture.provenance.recordedAt,
        programId: fixture.provenance.programId,
        requestSeedVerified: false,
        providerProofVerified: false,
        freshTransactionsSent: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
