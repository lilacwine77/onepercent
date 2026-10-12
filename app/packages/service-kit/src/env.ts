import { z } from "zod";
import { isEncodedKeypair } from "./log.js";

export const roles = [
  "public",
  "intake-signer",
  "quote-signer",
  "indexer",
  "keeper",
  "executor",
  "monitor",
] as const;
export type Role = (typeof roles)[number];
export const roleKeyVariables = {
  public: null,
  "intake-signer": "INTAKE_SIGNER_KEYPAIR",
  "quote-signer": "QUOTE_SIGNER_KEYPAIR",
  indexer: null,
  keeper: "KEEPER_KEYPAIR",
  executor: "EXECUTOR_KEYPAIR",
  monitor: null,
} as const;
export class EnvironmentError extends Error {
  constructor(readonly variable: string) {
    super(variable);
    this.name = "EnvironmentError";
  }
}
// Even an empty foreign variable is a configuration error. Test before parsing anything.
export function assertKeyIsolation(role: Role, env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(env)) {
    if (
      name !== roleKeyVariables[role] &&
      (/(?:_KEYPAIR$|PRIVATE_KEY|SECRET_KEY|MNEMONIC|SEED_PHRASE)/i.test(
        name,
      ) ||
        isEncodedKeypair(env[name] ?? ""))
    ) {
      throw new EnvironmentError(name);
    }
  }
}
export function loadRoleEnv<T>(
  role: Role,
  schema: z.ZodType<T>,
  env: NodeJS.ProcessEnv = process.env,
): T {
  assertKeyIsolation(role, env);
  const values = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = schema.safeParse(values);
  if (!parsed.success)
    throw new EnvironmentError(
      String(parsed.error.issues[0]?.path[0] ?? "environment"),
    );
  return parsed.data;
}
export const runtimeEnvSchema = z.object({
  CLUSTER: z.enum(["localnet", "devnet", "mainnet-beta"]).default("localnet"),
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  RPC_URL: z.url({ protocol: /^https?$/ }),
  PROGRAM_ID: z.string().min(1),
  PROTOCOL_LOOKUP_TABLE: z.string().min(1).optional(),
  LOG_IP_SALT: z.string().min(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  APP_VERSION: z.string().min(1).default("0.0.0"),
  GIT_COMMIT: z.string().min(1).default("unknown"),
  PRIVATE_HOST: z.string().min(1).default("127.0.0.1"),
  PRIVATE_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ALERT_WEBHOOK_URL: z.url({ protocol: /^https?$/ }).optional(),
  INTERNAL_TOKEN: z.string().min(32).optional(),
});
export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;
