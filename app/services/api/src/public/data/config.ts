import * as compiled from "@onepercent/config";
import { ConfigResponse, type FeatureFlags } from "@onepercent/sdk/api";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { z } from "zod";
import { paramsHash } from "./math.js";

/** Missing G1 exports are explicit nulls; malformed published exports still fail. */
export function configBeforeProgram(
  env: Pick<ServiceRuntime["env"], "CLUSTER" | "PROGRAM_ID">,
  flags: FeatureFlags,
): ConfigResponse {
  const source = z
    .object({
      ONCHAIN_KEYS: z
        .array(z.object({ path: z.string() }))
        .min(1)
        .optional(),
      resolveOnchainKey: z
        .custom<(path: string) => unknown>(
          (value) => typeof value === "function",
        )
        .optional(),
      validateParams: z
        .custom<() => unknown>((value) => typeof value === "function")
        .optional(),
    })
    .parse(compiled);
  const hash =
    source.ONCHAIN_KEYS === undefined ||
    source.resolveOnchainKey === undefined ||
    source.validateParams === undefined
      ? null
      : paramsHash();
  return ConfigResponse.parse({
    cluster: env.CLUSTER,
    programId: env.PROGRAM_ID,
    flags,
    paramsHash: hash,
    asOfSlot: null,
    phase: null,
    roles: null,
    vrf: null,
    season: null,
    paused: null,
  });
}
