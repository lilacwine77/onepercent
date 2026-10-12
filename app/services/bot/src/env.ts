import { z } from "zod";
import { isIP } from "node:net";

function isPrivateHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(name) === 4) {
    const [first, second] = name.split(".").map(Number);
    return (
      first === 127 ||
      first === 10 ||
      (first === 172 && second! >= 16 && second! <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }
  if (isIP(name) === 6) {
    const prefix = Number.parseInt(name.split(":")[0]!, 16);
    return (
      name === "::1" ||
      (prefix & 0xfe00) === 0xfc00 ||
      (prefix & 0xffc0) === 0xfe80
    );
  }
  return (
    name === "localhost" ||
    !name.includes(".") ||
    [".localhost", ".internal", ".local"].some((suffix) =>
      name.endsWith(suffix),
    )
  );
}

const origin = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      ["http:", "https:"].includes(url.protocol)
    );
  }, "Expected an HTTP origin")
  .transform((value) => new URL(value).origin);
const envSchema = z.object({
  PUBLIC_WEB_URL: origin
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" || url.hostname === "localhost";
    }, "Expected HTTPS except for localhost")
    .default("http://localhost:5173"),
  PUBLIC_API_URL: origin
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" || isPrivateHost(url.hostname);
    }, "Expected HTTPS except for localhost or a private host")
    .default("http://localhost:3000"),
  BOT_API_SECRET: z.string().min(32).optional(),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(
      /^\d+:[A-Za-z0-9_-]+$/,
      "Expected a Telegram bot token in ID:token format",
    )
    .optional(),
  DATABASE_URL: z.url().optional(),
  PRIVATE_HOST: z.string().default("127.0.0.1"),
  PRIVATE_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  FLAG_BOT_ALERTS: z
    .string()
    .optional()
    .transform((value) => (value === "on" ? "on" : "off")),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type BotEnv = z.infer<typeof envSchema>;

export class EnvironmentError extends Error {}

export function parseEnv(input: NodeJS.ProcessEnv): BotEnv {
  const values = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value === "" ? undefined : value,
    ]),
  );
  const result = envSchema.safeParse(values);
  if (!result.success) {
    throw new EnvironmentError(
      `Invalid bot environment:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
