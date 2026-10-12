#!/usr/bin/env node
import { OpsError } from "./input.js";
import { runOps } from "./runtime.js";

try {
  const report = await runOps(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (
    report.simulation?.ok === false ||
    ("ok" in report && report.ok === false)
  )
    process.exitCode = 1;
} catch (error) {
  // Provider messages, file contents, endpoints and paths never reach output.
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof OpsError ? error.code : "ops_failed" })}\n`,
  );
  process.exitCode = 1;
}
