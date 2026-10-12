import { webDeployment } from "../data/deployment";
import { programError } from "@onepercent/sdk/browser";
import type { CopyKey } from "@onepercent/copy";

/** Decode the actual failing program, including an inner VRF failure, through the SDK. */
export function ripSimulationError(
  error: unknown,
  logs: readonly string[],
): CopyKey {
  const parsed = programError(error, {
    programId: webDeployment().programId,
    instruction: "buy_packs",
    logs,
  });
  switch (parsed.copyKey) {
    case "machineChanged":
      return "rip.machineChanged";
    case "refilling":
      return "rip.state.refilling";
    case "hungry":
      return "rip.state.hungry";
    case "busy":
      return "rip.state.busy";
    case "myCardsFull":
      return "rip.myCardsFull";
    case "seasonOver":
      return "errors.seasonOver";
    default:
      return "errors.simulation";
  }
}
