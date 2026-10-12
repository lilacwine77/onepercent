import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Compatibility entry point; D29 launch rehearsals execute the Meteora driver. */
export async function runLaunchValidatorPrefix() {
  const { runMeteoraValidatorLaunch } =
    await import("../meteora/validator-launch.js");
  return runMeteoraValidatorLaunch();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runLaunchValidatorPrefix();
