import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });
export const xrayEnvFields = {
  HELIUS_API_KEY: z.string().min(1).optional(),
  HELIUS_RPC_URL: httpUrl.optional(),
  JUPITER_API_KEY: z.string().min(1).optional(),
  JUPITER_MAX_RPS: z.coerce.number().positive().finite().optional(),
  XRAY_SOURCE: z.enum(["live", "fixtures"]).optional(),
  XRAY_SNS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  FEED_SNAPSHOT_SLOT: z.coerce.number().int().positive().safe().optional(),
  PUBLIC_WEB_URL: httpUrl.default("http://localhost:5173"),
  PUBLIC_API_URL: httpUrl.default("http://localhost:3000"),
  WEB_SHELL_URL: httpUrl.optional(),
  TRUST_PROXY_HEADER: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/)
    .optional(),
  TURNSTILE_SECRET: z.string().min(1).optional(),
  BOT_API_SECRET: z.string().min(32).optional(),
};
const fieldsSchema = z.object(xrayEnvFields);
type ParsedXrayFields = z.infer<typeof fieldsSchema>;
export function resolveXraySource<T extends ParsedXrayFields>(
  env: T,
  context: z.RefinementCtx,
): T & { XRAY_SOURCE: "live" | "fixtures" } {
  const source =
    env.XRAY_SOURCE ??
    (env.HELIUS_RPC_URL || env.HELIUS_API_KEY ? "live" : "fixtures");
  if (source === "live" && !env.HELIUS_RPC_URL && !env.HELIUS_API_KEY) {
    context.addIssue({
      code: "custom",
      path: ["HELIUS_RPC_URL"],
      message: "HELIUS_RPC_URL or HELIUS_API_KEY required",
    });
  }
  if (source === "live" && !env.TURNSTILE_SECRET) {
    context.addIssue({
      code: "custom",
      path: ["TURNSTILE_SECRET"],
      message: "TURNSTILE_SECRET required",
    });
  }
  return { ...env, XRAY_SOURCE: source };
}
export const xrayEnvSchema = fieldsSchema.transform(resolveXraySource);
export type XrayEnv = z.infer<typeof xrayEnvSchema>;

export function parseXrayEnv(input: NodeJS.ProcessEnv): XrayEnv {
  const values = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value === "" ? undefined : value,
    ]),
  );
  const parsed = xrayEnvSchema.safeParse(values);
  // Report names only: zod issue values can contain provider credentials.
  if (!parsed.success)
    throw new Error(
      `Invalid X-ray environment: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return parsed.data;
}

export function heliusRpcUrl(env: XrayEnv): string {
  if (env.HELIUS_RPC_URL) return env.HELIUS_RPC_URL;
  if (!env.HELIUS_API_KEY) throw new Error("Missing Helius configuration");
  const url = new URL("https://mainnet.helius-rpc.com/");
  url.searchParams.set("api-key", env.HELIUS_API_KEY);
  return url.href;
}
