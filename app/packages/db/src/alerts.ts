import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./client.js";
import { alerts } from "./schema.js";
import { jsonObjectSchema, type JsonObject } from "./types.js";

export type AlertSeverity = "info" | "warning" | "critical";
export interface AlertInput {
  key: string;
  severity: AlertSeverity;
  payload: JsonObject;
  dedupeSeconds: number;
}
const alertInputSchema = z
  .object({
    key: z.string().min(1),
    severity: z.enum(["info", "warning", "critical"]),
    payload: jsonObjectSchema,
    dedupeSeconds: z.number().int().positive(),
  })
  .strict();

/** Atomically records every occurrence; true grants this caller the notification. */
export async function recordAlert(
  db: Database,
  input: AlertInput,
): Promise<boolean> {
  const event = alertInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const now = sql`clock_timestamp()`;
    // ON CONFLICT holds the row lock until the notification claim commits.
    await tx
      .insert(alerts)
      .values({
        key: event.key,
        severity: event.severity,
        firstAt: now,
        lastAt: now,
        count: 1n,
        payload: event.payload,
      })
      .onConflictDoUpdate({
        target: alerts.key,
        set: {
          severity: event.severity,
          lastAt: now,
          count: sql`${alerts.count} + 1`,
          payload: event.payload,
        },
      });
    const claimed = await tx
      .update(alerts)
      .set({ notifiedAt: now })
      .where(
        and(
          eq(alerts.key, event.key),
          or(
            isNull(alerts.notifiedAt),
            lte(
              alerts.notifiedAt,
              sql`clock_timestamp() - ${event.dedupeSeconds} * interval '1 second'`,
            ),
          ),
        ),
      )
      .returning({ key: alerts.key });
    return claimed.length === 1;
  });
}
