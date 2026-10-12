import { z } from "zod";
import { resolveXraySource, xrayEnvFields } from "./xray/env.js";

export const apiEnvFields = {
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .refine((value) => value === URL.parse(value)?.origin, {
      message: "Use a single HTTP(S) origin without a path or trailing slash",
    })
    .default("http://localhost:5173"),
  APP_VERSION: z.string().min(1).default("0.0.0"),
  GIT_COMMIT: z.string().min(1).default("unknown"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  ...xrayEnvFields,
};
const apiEnvSchema = z.object(apiEnvFields).transform(resolveXraySource);
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): ApiEnv {
  const values = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value === "" ? undefined : value,
    ]),
  );
  const result = apiEnvSchema.safeParse(values);
  if (!result.success)
    throw new Error(
      `Invalid API environment: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return result.data;
}
