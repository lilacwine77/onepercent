import { randomBytes } from "node:crypto";
import type { createDatabase } from "@onepercent/db";
import { z } from "zod";
import {
  CLOSED_NONCE_GRACE_MS,
  SESSION_TTL_SECONDS,
  type Clock,
  type LinkSession,
  type LinkStore,
  type NonceResult,
  type WalletBinding,
} from "./store.js";

export type M5Pool = ReturnType<typeof createDatabase>["pool"];
const rowSchema = z.object({
  nonce: z.string(),
  telegram_user_id: z.coerce.number().int().safe(),
  bot_username: z.string(),
  issued_at: z.date(),
  expires_at: z.date(),
  closed_at: z.date().nullable(),
});
function session(row: unknown): LinkSession {
  const value = rowSchema.parse(row);
  return {
    nonce: value.nonce,
    telegramUserId: value.telegram_user_id,
    botUsername: value.bot_username,
    issuedAt: value.issued_at.toISOString(),
    expiresAt: value.expires_at.toISOString(),
  };
}
export class PgLinkStore implements LinkStore {
  constructor(
    private readonly pool: M5Pool,
    private readonly clock: Clock = Date.now,
  ) {}
  async createNonce(
    telegramUserId: number,
    botUsername: string,
  ): Promise<LinkSession> {
    const now = new Date(this.clock());
    const nonce = randomBytes(16).toString("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`m5:nonce:${telegramUserId}`],
      );
      await client.query(
        "UPDATE link_nonces SET closed_at = $1 WHERE telegram_user_id = $2 AND closed_at IS NULL",
        [now, telegramUserId],
      );
      const result = await client.query(
        "INSERT INTO link_nonces (nonce, telegram_user_id, bot_username, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [
          nonce,
          telegramUserId,
          botUsername,
          now,
          new Date(now.getTime() + SESSION_TTL_SECONDS * 1_000),
        ],
      );
      const created = session(result.rows[0]);
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async peekNonce(nonce: string): Promise<NonceResult> {
    const now = this.clock();
    const result = await this.pool.query(
      "SELECT * FROM link_nonces WHERE nonce = $1 AND expires_at + ($2 * interval '1 millisecond') > $3",
      [nonce, CLOSED_NONCE_GRACE_MS, new Date(now)],
    );
    if (!result.rows[0]) return { status: "missing" };
    const row = rowSchema.parse(result.rows[0]);
    return row.closed_at || row.expires_at.getTime() <= now
      ? { status: "gone" }
      : { status: "open", session: session(row) };
  }
  async takeNonce(nonce: string): Promise<NonceResult> {
    const result = await this.pool.query(
      "UPDATE link_nonces SET closed_at = $2 WHERE nonce = $1 AND closed_at IS NULL AND expires_at > $2 RETURNING *",
      [nonce, new Date(this.clock())],
    );
    if (result.rows[0])
      return { status: "open", session: session(result.rows[0]) };
    return this.peekNonce(nonce);
  }
  async bind(telegramUserId: number, wallet: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize the low-volume one-to-one mutations, including unbind.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('m5:links', 0))",
      );
      await client.query(
        "DELETE FROM tg_links WHERE telegram_user_id = $1 OR wallet = $2",
        [telegramUserId, wallet],
      );
      await client.query(
        "INSERT INTO tg_links (telegram_user_id, wallet, linked_at) VALUES ($1, $2, $3)",
        [telegramUserId, wallet, new Date(this.clock())],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async walletOf(telegramUserId: number): Promise<WalletBinding | null> {
    const result = await this.pool.query(
      "SELECT wallet, linked_at FROM tg_links WHERE telegram_user_id = $1",
      [telegramUserId],
    );
    if (!result.rows[0]) return null;
    const row = z
      .object({ wallet: z.string(), linked_at: z.date() })
      .parse(result.rows[0]);
    return { wallet: row.wallet, linkedAt: row.linked_at.toISOString() };
  }
  async telegramOf(wallet: string): Promise<number | null> {
    const result = await this.pool.query(
      "SELECT telegram_user_id FROM tg_links WHERE wallet = $1",
      [wallet],
    );
    return result.rows[0]
      ? z.coerce.number().int().safe().parse(result.rows[0].telegram_user_id)
      : null;
  }
  async unbind(telegramUserId: number): Promise<boolean> {
    const client = await this.pool.connect();
    const now = new Date(this.clock());
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('m5:links', 0))",
      );
      const result = await client.query(
        "DELETE FROM tg_links WHERE telegram_user_id = $1 RETURNING telegram_user_id",
        [telegramUserId],
      );
      await client.query(
        "UPDATE tg_chats SET alerts = 'off', updated_at = $2 WHERE chat_id = $1 AND kind = 'private'",
        [telegramUserId, now],
      );
      await client.query(
        "UPDATE notify_jobs SET status = 'skipped', outcome = 'opted_out', finished_at = $2 WHERE chat_id = $1 AND status = 'queued'",
        [telegramUserId, now],
      );
      await client.query("COMMIT");
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async purge(now: number): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM link_nonces WHERE expires_at + ($1 * interval '1 millisecond') < $2",
      [CLOSED_NONCE_GRACE_MS, new Date(now)],
    );
    return result.rowCount ?? 0;
  }
}
