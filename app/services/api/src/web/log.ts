import { randomBytes } from "node:crypto";
import { createServiceLogger } from "@onepercent/service-kit";
export interface WebLogger {
  warn(data: Record<string, unknown>, message: string): void;
}
export function createWebLogger(env: NodeJS.ProcessEnv): WebLogger {
  return createServiceLogger(
    {
      service: "api",
      role: "public",
      cluster: env.CLUSTER || "localnet",
      version: env.APP_VERSION || "unknown",
      commit: env.GIT_COMMIT || "unknown",
    },
    {
      ipSalt: env.LOG_IP_SALT || randomBytes(32).toString("hex"),
      level: env.LOG_LEVEL || "info",
      secretValues: Object.entries(env)
        .filter(
          ([name, value]) =>
            value &&
            /SECRET|TOKEN|PASSWORD|API[_-]?KEY|LOG_IP_SALT/i.test(name),
        )
        .map(([, value]) => value!),
    },
  );
}
export function webRouteName(path: string): string {
  if (path === "/api/values") return "values";
  if (path === "/api/beacon") return "beacon";
  if (path === "/api/web/config") return "config";
  if (path === "/api/events") return "events";
  if (path === "/api/highlights") return "highlights";
  if (path === "/api/send") return "send";
  if (path.startsWith("/api/royalties/")) return "royalties";
  if (path.startsWith("/api/logo/")) return "logo";
  return "unknown";
}
