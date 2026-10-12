import type { createDatabase } from "@onepercent/db";
import type { AlertMode, BotStore } from "./store.js";
import type { ReferralCode } from "./referral.js";

type Pool = ReturnType<typeof createDatabase>["pool"];
/** The injected clock is also used in SQL; persisted rows contain no message text. */
export class PgBotStore implements BotStore {
  constructor(
    private readonly pool: Pool,
    private readonly now = Date.now,
  ) {}
  async recordStart(_userId: number, chatId: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO tg_chats (chat_id, kind, started_at, updated_at)
      VALUES ($1, 'private', $2, $2) ON CONFLICT (chat_id) DO UPDATE
      SET started_at = $2, blocked_at = NULL, updated_at = $2`,
      [chatId, new Date(this.now())],
    );
  }
  async hasStarted(chatId: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM tg_chats WHERE chat_id = $1
      AND started_at IS NOT NULL AND blocked_at IS NULL`,
      [chatId],
    );
    return result.rows.length > 0;
  }
  async setPendingReferral(
    userId: number,
    code: ReferralCode,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO tg_referrals (telegram_user_id, code, set_at)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING telegram_user_id`,
      [userId, code, new Date(this.now())],
    );
    return result.rows.length > 0;
  }
  async getPendingReferral(userId: number): Promise<ReferralCode | null> {
    const result = await this.pool.query<{ code: ReferralCode }>(
      "SELECT code FROM tg_referrals WHERE telegram_user_id = $1",
      [userId],
    );
    return result.rows[0]?.code ?? null;
  }
  async setAlerts(userId: number, mode: AlertMode): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = new Date(this.now());
      await client.query(
        `INSERT INTO tg_chats (chat_id, kind, alerts, updated_at)
        VALUES ($1, 'private', $2, $3) ON CONFLICT (chat_id) DO UPDATE SET alerts = $2, updated_at = $3`,
        [userId, mode, now],
      );
      if (mode === "off")
        await client.query(
          `UPDATE notify_jobs SET status = 'skipped', outcome = 'opted_out', finished_at = $2
        WHERE chat_id = $1 AND status = 'queued' AND kind IN ('royalty', 'digest')`,
          [userId, now],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async getAlerts(userId: number): Promise<AlertMode> {
    const result = await this.pool.query<{ alerts: AlertMode }>(
      "SELECT alerts FROM tg_chats WHERE chat_id = $1",
      [userId],
    );
    return result.rows[0]?.alerts ?? "off";
  }
  async setGroupHits(chatId: number, on: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO tg_chats (chat_id, kind, hits, updated_at)
      VALUES ($1, 'group', $2, $3) ON CONFLICT (chat_id) DO UPDATE SET hits = $2,
      blocked_at = CASE WHEN $2 THEN NULL ELSE tg_chats.blocked_at END, updated_at = $3`,
      [chatId, on, new Date(this.now())],
    );
  }
  async getGroupHits(chatId: number): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM tg_chats WHERE chat_id = $1 AND hits AND blocked_at IS NULL",
      [chatId],
    );
    return result.rows.length > 0;
  }
  async markBlocked(chatId: number): Promise<void> {
    await this.pool.query(
      `UPDATE tg_chats SET alerts = 'off', hits = false, started_at = NULL,
      blocked_at = $2, updated_at = $2 WHERE chat_id = $1`,
      [chatId, new Date(this.now())],
    );
  }
  async migrateChat(from: number, to: number): Promise<void> {
    if (from === to) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tg_chats (chat_id, kind, hits, blocked_at, updated_at)
        SELECT $2, 'group', hits, blocked_at, $3 FROM tg_chats WHERE chat_id = $1 AND kind = 'group'
        ON CONFLICT (chat_id) DO UPDATE SET hits = EXCLUDED.hits, blocked_at = EXCLUDED.blocked_at, updated_at = $3`,
        [from, to, new Date(this.now())],
      );
      await client.query(
        "UPDATE notify_jobs SET chat_id = $2 WHERE chat_id = $1 AND status = 'queued'",
        [from, to],
      );
      await client.query(
        "DELETE FROM tg_chats WHERE chat_id = $1 AND kind = 'group'",
        [from],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
