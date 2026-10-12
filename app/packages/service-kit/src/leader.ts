import { warnCause } from "./safe-cause.js";
import { Client } from "pg";

export interface LeaderSession {
  connect(): Promise<unknown>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
  on(event: "error" | "end", listener: () => void): unknown;
}

export interface KeeperLeaderOptions {
  lockKey?: "onepct:keeper" | "onepct:executor";
  connectionString: string;
  tickMs: number;
  followerRetrySeconds: number;
  leaderFailoverSeconds: number;
  /** The returned task must stay pending for the lifetime of its leader term. */
  onLeader?: (signal: AbortSignal) => void | Promise<void>;
  onChange?: (isLeader: boolean) => void;
  onError?: (reason: "leader_connection_failed" | "leader_job_failed") => void;
  sessionFactory?: () => LeaderSession;
  now?: () => number;
}

/** A lock belongs to one dedicated session, never to a pooled query. */
export class KeeperLeader {
  private client: LeaderSession | undefined;
  private controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private leaseTimer: NodeJS.Timeout | undefined;
  private leaseUntil = 0;
  private active = false;
  private leading = false;
  private pending: Promise<void> | undefined;

  constructor(private readonly options: KeeperLeaderOptions) {
    if (
      options.lockKey !== undefined &&
      !["onepct:keeper", "onepct:executor"].includes(options.lockKey)
    )
      throw new Error("invalid_leader_lock");
    const retryMs = options.followerRetrySeconds * 1_000;
    const failoverMs = options.leaderFailoverSeconds * 1_000;
    if (
      ![options.tickMs, retryMs, failoverMs].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ) ||
      2 * options.tickMs + retryMs > failoverMs
    ) {
      throw new Error("Leader probe and retry exceed failover budget");
    }
    this.controller.abort();
  }

  get isLeader(): boolean {
    this.enforceLease();
    return this.leading && !this.controller.signal.aborted;
  }
  get signal(): AbortSignal {
    this.enforceLease();
    return this.controller.signal;
  }

  assertLeader(): void {
    if (!this.isLeader) throw new Error("Keeper leadership unavailable");
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    await this.runTick();
  }

  async stop(): Promise<void> {
    this.active = false;
    clearTimeout(this.timer);
    this.loseLeadership();
    await this.closeClient();
    await this.pending;
  }

  private loseLeadership(): void {
    clearTimeout(this.leaseTimer);
    this.leaseUntil = 0;
    this.controller.abort();
    if (this.leading) {
      this.leading = false;
      try {
        this.options.onChange?.(false);
      } catch (error) {
        warnCause("leader_change_callback_failed", error);
      }
    }
  }

  private reportError(
    reason: "leader_connection_failed" | "leader_job_failed",
  ): void {
    try {
      this.options.onError?.(reason);
    } catch (error) {
      warnCause("leader_error_callback_failed", error);
    }
  }

  private jobEnded(
    client: LeaderSession,
    controller: AbortController,
    error: unknown = new Error("leader_job_stopped"),
  ): void {
    // A task from a lost term may settle after a new term has already started.
    if (
      this.client !== client ||
      this.controller !== controller ||
      controller.signal.aborted
    )
      return;
    this.loseLeadership();
    // Detach and close the failed term's session before notifying observers.
    void this.closeClient(client);
    warnCause("leader_job_failed", error);
    this.reportError("leader_job_failed");
  }

  private enforceLease(): void {
    if (
      this.leading &&
      (this.options.now ?? (() => performance.now()))() >= this.leaseUntil
    ) {
      this.loseLeadership();
      void this.closeClient();
    }
  }

  private renewLease(): void {
    this.leaseUntil =
      (this.options.now ?? (() => performance.now()))() + this.options.tickMs;
    clearTimeout(this.leaseTimer);
    this.leaseTimer = setTimeout(
      () => this.enforceLease(),
      this.options.tickMs,
    );
    this.leaseTimer.unref();
  }

  private async closeClient(client = this.client): Promise<void> {
    if (this.client === client) this.client = undefined;
    if (client)
      await client
        .end()
        .catch((error) => warnCause("leader_close_failed", error));
  }

  private async runTick(): Promise<void> {
    if (!this.active || this.pending) return;
    this.pending = this.tick();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
      if (this.active) {
        const delay = this.isLeader
          ? Math.max(1, Math.floor(this.options.tickMs / 2))
          : this.options.followerRetrySeconds * 1_000;
        this.timer = setTimeout(() => {
          void this.runTick();
        }, delay);
        this.timer.unref();
      }
    }
  }

  private async tick(): Promise<void> {
    try {
      if (!this.client) {
        const client =
          this.options.sessionFactory?.() ??
          new Client({
            connectionString: this.options.connectionString,
            connectionTimeoutMillis: Math.max(
              1,
              Math.floor(this.options.tickMs / 2),
            ),
            query_timeout: Math.max(1, Math.floor(this.options.tickMs / 2)),
            keepAlive: true,
            keepAliveInitialDelayMillis: this.options.tickMs,
            application_name: `${this.options.lockKey ?? "onepct:keeper"}:leader`,
          });
        this.client = client;
        const lost = () => {
          if (this.client !== client) return;
          this.loseLeadership();
          void this.closeClient(client);
        };
        client.on("error", (error?: unknown) => {
          warnCause("leader_connection_failed", error);
          lost();
        });
        client.on("end", lost);
        await client.connect();
        const idleTimeoutMs =
          this.options.leaderFailoverSeconds * 1_000 -
          this.options.followerRetrySeconds * 1_000 -
          this.options.tickMs;
        await client.query(`SET idle_session_timeout = '${idleTimeoutMs}ms'`);
      }
      const client = this.client;
      if (!client || !this.active) return;
      if (this.isLeader) {
        await client.query("SELECT 1");
        if (this.active && this.client === client && this.isLeader)
          this.renewLease();
      } else {
        const result = await client.query(
          `SELECT pg_try_advisory_lock(hashtext('${this.options.lockKey ?? "onepct:keeper"}')) AS acquired`,
        );
        if (
          result.rows[0]?.acquired === true &&
          this.active &&
          this.client === client
        ) {
          const controller = new AbortController();
          this.controller = controller;
          this.leading = true;
          this.renewLease();
          this.options.onChange?.(true);
          try {
            if (this.options.onLeader) {
              const job = this.options.onLeader(controller.signal);
              void Promise.resolve(job).then(
                () => this.jobEnded(client, controller),
                (error) => this.jobEnded(client, controller, error),
              );
            }
          } catch (error) {
            this.jobEnded(client, controller, error);
          }
        }
      }
    } catch (error) {
      warnCause("leader_connection_failed", error);
      this.loseLeadership();
      this.reportError("leader_connection_failed");
      await this.closeClient();
    }
  }
}
