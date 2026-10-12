import { warnCause } from "./safe-cause.js";
import { recordAlert, type Database, type JsonObject } from "@onepercent/db";
import { z } from "zod";
import { sanitizeLogValue, type LogSanitizerOptions } from "./log.js";

const severitySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof severitySchema>;

export interface AlertServiceOptions extends LogSanitizerOptions {
  db: Database;
  dedupeSeconds: number;
  timeoutMs: number;
  webhookUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class AlertService {
  constructor(private readonly options: AlertServiceOptions) {
    z.number().int().positive().safe().parse(options.dedupeSeconds);
    z.number().int().positive().safe().parse(options.timeoutMs);
    z.string().min(1).parse(options.ipSalt);
    if (options.webhookUrl) {
      const url = new URL(options.webhookUrl);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error("Invalid ALERT_WEBHOOK_URL");
      }
    }
  }

  async alert(
    key: string,
    severity: AlertSeverity,
    payload: Record<string, unknown>,
  ): Promise<{ recorded: boolean; delivered: boolean }> {
    // Operational keys must not contain a URL, credential or request body.
    z.string()
      .regex(/^[a-zA-Z0-9_.:-]+$/)
      .max(256)
      .parse(key);
    severitySchema.parse(severity);
    const sanitized = z
      .record(z.string(), z.json())
      .parse(sanitizeLogValue(payload, this.options)) as JsonObject;
    const recorded = await recordAlert(this.options.db, {
      key,
      severity,
      payload: sanitized,
      dedupeSeconds: this.options.dedupeSeconds,
    });
    if (!recorded || !this.options.webhookUrl)
      return { recorded, delivered: false };
    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(
        this.options.webhookUrl,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, severity, payload: sanitized }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
          redirect: "error",
        },
      );
      await response.body?.cancel();
      return { recorded, delivered: response.ok };
    } catch (error) {
      warnCause("alert_delivery_failed", error);
      // The durable row remains visible when delivery fails. M6.1 adds paging.
      return { recorded, delivered: false };
    }
  }
}
