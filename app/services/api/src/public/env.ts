import { z } from "zod";
import { loadRoleEnv } from "@onepercent/service-kit";
import { FeatureFlags } from "@onepercent/sdk/api";

const signerUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = URL.parse(value);
  return (
    url !== null && !url.username && !url.password && !url.search && !url.hash
  );
}, "Signer URLs cannot contain credentials, query parameters or fragments");

const publicEnvSchema = z
  .object({
    WEB_ORIGIN: z
      .url({ protocol: /^https?$/ })
      .refine((value) => new URL(value).origin === value),
    INTAKE_SIGNER_URL: signerUrl.optional(),
    INTAKE_INTERNAL_TOKEN: z.string().min(32).optional(),
    QUOTE_SIGNER_URL: signerUrl.optional(),
    QUOTE_INTERNAL_TOKEN: z.string().min(32).optional(),
    TRUST_PROXY_HEADER: z
      .string()
      .regex(/^[a-zA-Z0-9-]+$/)
      .optional(),
  })
  .refine(
    (env) =>
      env.INTAKE_INTERNAL_TOKEN === undefined ||
      env.QUOTE_INTERNAL_TOKEN === undefined ||
      env.INTAKE_INTERNAL_TOKEN !== env.QUOTE_INTERNAL_TOKEN,
    {
      path: ["QUOTE_INTERNAL_TOKEN"],
      message: "Signer tokens must be distinct",
    },
  );
export function loadPublicEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = loadRoleEnv("public", publicEnvSchema, source);
  const flags: Record<string, boolean> = {};
  for (const name of Object.keys(FeatureFlags.shape)) {
    const value = z
      .enum(["on", "off"])
      .default("off")
      .parse(source[`FLAG_${name}`]);
    flags[name] = value === "on";
  }
  return { ...env, flags: FeatureFlags.parse(flags) };
}
