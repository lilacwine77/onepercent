import { randomBytes } from "node:crypto";
import { CLOSED_NONCE_GRACE_MS, SESSION_TTL_SECONDS } from "../link/store.js";
import type { M5Pool } from "../link/store-pg.js";
import { GoInputSchema, type GoInput } from "./schema.js";
import type { GoCreated, GoResult, GoStore } from "./store.js";
export class PgGoStore implements GoStore {
  constructor(private readonly pool: M5Pool) {}
  async create(
    input: GoInput,
    count: 1 | 2 | 3,
    now: number,
  ): Promise<GoCreated[]> {
    const value = GoInputSchema.parse(input);
    const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1_000);
    const ids = Array.from({ length: count }, () =>
      randomBytes(16).toString("hex"),
    );
    await this.pool.query(
      "INSERT INTO go_sessions (id, telegram_user_id, action, edition, n, ref, created_at, expires_at) SELECT unnest($1::text[]), $2, $3, $4, $5, $6, $7, $8",
      [
        ids,
        value.telegramUserId,
        value.action,
        value.edition ?? null,
        value.n ?? null,
        value.ref ?? null,
        new Date(now),
        expiresAt,
      ],
    );
    return ids.map((id) => ({ id, expiresAt: expiresAt.toISOString() }));
  }
  async redeem(id: string, now: number): Promise<GoResult> {
    const updated = await this.pool.query(
      "UPDATE go_sessions SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND expires_at > $2 RETURNING *",
      [id, new Date(now)],
    );
    const row = updated.rows[0];
    if (row)
      return {
        status: "open",
        session: GoInputSchema.parse({
          telegramUserId: Number(row.telegram_user_id),
          action: row.action,
          ...(row.edition === null ? {} : { edition: row.edition }),
          ...(row.n === null ? {} : { n: row.n }),
          ...(row.ref === null ? {} : { ref: row.ref }),
        }),
      };
    const existing = await this.pool.query(
      "SELECT id FROM go_sessions WHERE id = $1 AND expires_at + ($2 * interval '1 millisecond') > $3",
      [id, CLOSED_NONCE_GRACE_MS, new Date(now)],
    );
    return { status: existing.rows[0] ? "gone" : "missing" };
  }
  async purge(now: number): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM go_sessions WHERE expires_at + ($1 * interval '1 millisecond') < $2",
      [CLOSED_NONCE_GRACE_MS, new Date(now)],
    );
    return result.rowCount ?? 0;
  }
}
