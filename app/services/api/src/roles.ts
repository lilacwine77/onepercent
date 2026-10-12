import {
  EnvironmentError,
  loadRoleEnv,
  runtimeEnvSchema,
} from "@onepercent/service-kit";
import { z } from "zod";
import { apiEnvFields } from "./env.js";
import { resolveXraySource } from "./xray/env.js";

const apiRole = z.enum(["public", "intake-signer", "quote-signer"]);
const apiRuntimeEnvSchema = runtimeEnvSchema
  .extend(apiEnvFields)
  .transform(resolveXraySource);

export function loadApiRole(env: NodeJS.ProcessEnv = process.env) {
  const parsed = apiRole.safeParse(env.ROLE || "public");
  if (!parsed.success) throw new EnvironmentError("ROLE");
  const role = parsed.data;
  const config = loadRoleEnv(role, apiRuntimeEnvSchema, env);
  if (role !== "public" && !config.INTERNAL_TOKEN)
    throw new EnvironmentError("INTERNAL_TOKEN");
  return { role, env: config };
}
