#!/usr/bin/env node
import { OpsError } from "../input.js";
import { runDeployment } from "./runtime.js";

try {
  const result = await runDeployment(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof OpsError ? error.code : "deployment_failed" })}\n`,
  );
  process.exitCode = 1;
}
