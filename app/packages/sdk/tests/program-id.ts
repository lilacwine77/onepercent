import { createDeploymentSelector } from "../src/deployment.js";
import idl from "../src/idl/onepercent.json" with { type: "json" };

/** Golden-vector deployment identity, used only by tests. */
export const DEPLOYMENT = createDeploymentSelector({ localnet: idl.address })(
  "localnet",
);
export const PROGRAM_ID = DEPLOYMENT.programId;
