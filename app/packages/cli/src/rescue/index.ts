#!/usr/bin/env node
import { RESCUE_HELP } from "./input.js";
import { jsonRecord, rescueExit, runRescue } from "./runtime.js";

// No top-level await: the same entry is bundled as a standalone CommonJS file.
async function main(args: readonly string[]) {
  if (args.includes("--help")) {
    process.stdout.write(RESCUE_HELP);
    return;
  }
  try {
    process.exitCode = await runRescue(args);
  } catch (error) {
    const failure = rescueExit(error);
    process.stderr.write(
      `${jsonRecord({ type: "error", error: failure.code })}\n`,
    );
    process.exitCode = failure.exitCode;
  }
}
void main(process.argv.slice(2));
