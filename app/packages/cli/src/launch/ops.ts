#!/usr/bin/env node
import { OpsError } from "../input.js";
import { runOps } from "../runtime.js";
import { launchJson, runLaunch } from "./runtime.js";

// Launch and existing operator commands share the installed entry point.
const args = process.argv.slice(2);
const isLaunch = args[0] === "launch";
try {
  const result = isLaunch ? await runLaunch(args) : await runOps(args);
  process.stdout.write(
    `${isLaunch ? launchJson(result) : JSON.stringify(result)}\n`,
  );
  const simulation = "simulation" in result ? result.simulation : undefined;
  if (
    ("ok" in result && result.ok === false) ||
    (simulation &&
      typeof simulation === "object" &&
      "ok" in simulation &&
      simulation.ok === false)
  )
    process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof OpsError ? error.code : isLaunch ? "launch_failed" : "ops_failed" })}\n`,
  );
  process.exitCode = 1;
}
