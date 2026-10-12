import {
  EnvironmentError,
  loadRoleEnv,
  runtimeEnvSchema,
} from "@onepercent/service-kit";
import { z } from "zod";
const workerRole = z.enum(["indexer", "keeper", "executor", "monitor"]);
export function loadWorkerRole(env: NodeJS.ProcessEnv = process.env) {
  const parsed = workerRole.safeParse(env.ROLE || "indexer");
  if (!parsed.success) throw new EnvironmentError("ROLE");
  return {
    role: parsed.data,
    env: loadRoleEnv(parsed.data, runtimeEnvSchema, env),
  };
}
