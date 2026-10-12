import { warnCause } from "./safe-cause.js";
import { Hono } from "hono";
import type { Registry } from "prom-client";
import type { RoleGuard } from "./keys.js";
export function createHealthApp(options: {
  version: string;
  commit: string;
  registry: Registry;
  guard?: RoleGuard;
  checks: Record<string, () => Promise<unknown>>;
  timeoutMs: number;
  isClosing?: () => boolean;
}) {
  const app = new Hono();
  app.get("/health", (c) => {
    if (options.isClosing?.())
      return c.json({ ok: false, reason: "stopping" }, 503);
    const status = options.guard?.status() ?? { ok: true };
    return c.json(
      { ...status, version: options.version, commit: options.commit },
      status.ok ? 200 : 503,
    );
  });
  app.get("/ready", async (c) => {
    const checks = await Promise.all(
      Object.entries(options.checks).map(async ([name, check]) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            check(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("timeout")),
                options.timeoutMs,
              );
            }),
          ]);
          return [name, true] as const;
        } catch (error) {
          warnCause("health_check_failed", error);
          return [name, false] as const;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }),
    );
    const key = options.guard?.status() ?? { ok: true };
    const ok = checks.every(([, ok]) => ok) && key.ok && !options.isClosing?.();
    return c.json(
      { ok, checks: Object.fromEntries(checks), key },
      ok ? 200 : 503,
    );
  });
  app.get("/metrics", async (c) => {
    c.header("Content-Type", options.registry.contentType);
    return c.body(await options.registry.metrics());
  });
  return app;
}
