import { warnCause } from "@onepercent/service-kit/safe-cause";
import { createServer, type Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import type { createDatabase } from "@onepercent/db";
import { BOT_OPS, SERVICES } from "@onepercent/config";
type Pool = ReturnType<typeof createDatabase>["pool"];
const connect = (pool: Pool) => pool.connect();
type Connection = Awaited<ReturnType<typeof connect>>;
export interface RuntimeState {
  polling: boolean;
  lock: boolean;
  stopping: boolean;
}
export async function databaseReady(pool?: Pool): Promise<boolean> {
  if (!pool) return true;
  try {
    await pool.query("SELECT 1");
    const result = await pool.query<{ missing: string | null }>(
      `SELECT name AS missing FROM unnest(ARRAY['tg_chats','tg_referrals','tg_links','link_nonces','go_sessions','notify_jobs','notify_cursors','digest_runs']) AS name WHERE to_regclass(name) IS NULL LIMIT 1`,
    );
    return result.rows.length === 0;
  } catch (error) {
    warnCause("bot_database_unavailable", error);
    return false;
  }
}
export function healthServer(
  state: RuntimeState,
  ready: () => Promise<boolean>,
): Server {
  return createServer((req, res) => {
    void (async () => {
      if (
        req.method !== "GET" ||
        (req.url !== "/health" && req.url !== "/ready")
      ) {
        res.writeHead(404).end();
        return;
      }
      const ok =
        req.url === "/health"
          ? state.polling && state.lock && !state.stopping
          : !state.stopping && (await ready());
      res.writeHead(ok ? 200 : 503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify(
          req.url === "/health"
            ? { ok, polling: state.polling, lock: state.lock }
            : { ok },
        ),
      );
    })().catch((error) => {
      warnCause("bot_health_failed", error);
      res.writeHead(503).end();
    });
  });
}
/** Holds the advisory lock on one checked-out session until polling has stopped. */
export class BotLock {
  private client: Connection | undefined;
  private monitor: NodeJS.Timeout | undefined;
  private checking = false;
  private lost = false;
  constructor(
    private readonly pool: Pool,
    private readonly onLost: () => void,
    private readonly wait = (ms: number, signal: AbortSignal): Promise<void> =>
      sleep(ms, undefined, { signal }),
  ) {}
  async acquire(signal: AbortSignal): Promise<boolean> {
    const client = await connect(this.pool);
    this.client = client;
    client.on("error", this.lose);
    client.on("end", this.lose);
    await client.query("SET idle_session_timeout = '30s'");
    while (!signal.aborted && !this.lost) {
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('onepct:bot')) AS acquired",
      );
      if (result.rows[0]?.acquired) {
        if (signal.aborted || this.lost) return false;
        this.monitor = setInterval(() => {
          void this.check();
        }, BOT_OPS.lockRetrySeconds * 1000);
        this.monitor.unref();
        return true;
      }
      try {
        await this.wait(BOT_OPS.lockRetrySeconds * 1000, signal);
      } catch (error) {
        warnCause("bot_lock_wait_failed", error);
        return false;
      }
    }
    return false;
  }
  private lose = (error?: unknown) => {
    if (error !== undefined) warnCause("bot_lock_connection_failed", error);
    if (!this.lost) {
      this.lost = true;
      this.onLost();
    }
  };
  private async check(): Promise<void> {
    if (this.checking || this.lost || !this.client) return;
    this.checking = true;
    try {
      await this.client.query("SELECT 1");
    } catch (error) {
      warnCause("bot_lock_check_failed", error);
      this.lose();
    } finally {
      this.checking = false;
    }
  }
  async release(): Promise<void> {
    clearInterval(this.monitor);
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    const ignoreClosingError = (error: unknown) => {
      warnCause("bot_lock_close_failed", error);
    };
    client.on("error", ignoreClosingError);
    client.once("end", () =>
      client.removeListener("error", ignoreClosingError),
    );
    client.removeListener("error", this.lose);
    client.removeListener("end", this.lose);
    try {
      if (!this.lost)
        await client.query("SELECT pg_advisory_unlock(hashtext('onepct:bot'))");
    } finally {
      client.release(true);
    }
  }
}
export const botDatabaseOptions = (connectionString: string) => ({
  connectionString,
  connectionTimeoutMillis: SERVICES.transport.dbStatementTimeoutMs,
  query_timeout: SERVICES.transport.dbStatementTimeoutMs,
  statement_timeout: SERVICES.transport.dbStatementTimeoutMs,
  keepAlive: true,
  application_name: "onepct:bot",
});

/** Cleanup must finish even when the dedicated connection lost its unlock reply. */
export async function closeBotRuntime(
  release: () => Promise<unknown>,
  closeHealth: () => Promise<unknown>,
  closeDatabase: () => Promise<unknown>,
): Promise<boolean> {
  const first = await Promise.allSettled([Promise.resolve().then(release)]);
  const rest = await Promise.allSettled([
    Promise.resolve().then(closeHealth),
    Promise.resolve().then(closeDatabase),
  ]);
  for (const result of [...first, ...rest]) {
    if (result.status === "rejected")
      warnCause("bot_cleanup_failed", result.reason);
  }
  return [...first, ...rest].every((result) => result.status === "fulfilled");
}
