import { serve } from "@hono/node-server";
import { PublicKey } from "@solana/web3.js";
import { createDatabase } from "@onepercent/db";
import { z } from "zod";
import {
  EnvironmentError,
  assertKeyIsolation,
  type Role,
  type RuntimeEnv,
} from "./env.js";
import {
  takeRoleKey,
  configRoleReader,
  RoleGuard,
  type KeyRole,
} from "./keys.js";
import { JsonRpcClient } from "./rpc.js";
import { createServiceLogger } from "./log.js";
import { safeCause, warnCause } from "./safe-cause.js";
import { createMetrics } from "./metrics.js";
import { createRedis } from "./redis.js";
import { KeeperLeader } from "./leader.js";
import { AlertService } from "./alert.js";
import { createHealthApp } from "./health.js";
import { serviceParams } from "./params.js";

export async function createRuntime(options: {
  service: "api" | "worker";
  role: Role;
  env: RuntimeEnv;
  sourceEnv?: NodeJS.ProcessEnv;
  onLeader?: (signal: AbortSignal) => void | Promise<void>;
}) {
  const { service, role, env } = options;
  const source = options.sourceEnv ?? process.env;
  assertKeyIsolation(role, source);
  let programId: PublicKey;
  try {
    programId = new PublicKey(env.PROGRAM_ID);
  } catch (error) {
    warnCause("program_id_invalid", error);
    throw new EnvironmentError("PROGRAM_ID");
  }
  const key = takeRoleKey(role, source);
  const cleanup: Array<() => void | Promise<void>> = [() => key?.destroy()];
  try {
    const secretValues = Object.entries(source)
      .filter(
        ([name, value]) =>
          value &&
          !/_KEYPAIR$/i.test(name) &&
          /API[_-]?KEY|TOKEN|PASSWORD|SECRET|LOG_IP_SALT/i.test(name),
      )
      .map(([, value]) => value!);
    secretValues.push(env.LOG_IP_SALT);
    if (env.INTERNAL_TOKEN) secretValues.push(env.INTERNAL_TOKEN);
    for (const value of [
      env.DATABASE_URL,
      env.REDIS_URL,
      env.RPC_URL,
      env.ALERT_WEBHOOK_URL,
    ]) {
      if (!value) continue;
      const url = new URL(value);
      if (url.password) secretValues.push(decodeURIComponent(url.password));
      for (const [name, value] of url.searchParams)
        if (/key|token|secret|password/i.test(name)) secretValues.push(value);
    }
    const logger = createServiceLogger(
      {
        service,
        role,
        cluster: env.CLUSTER,
        version: env.APP_VERSION,
        commit: env.GIT_COMMIT,
      },
      { ipSalt: env.LOG_IP_SALT, level: env.LOG_LEVEL, secretValues },
    );
    const transport = serviceParams.transport;
    const { pool, db } = createDatabase({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: transport.dbStatementTimeoutMs,
      query_timeout: transport.dbStatementTimeoutMs,
      statement_timeout: transport.dbStatementTimeoutMs,
    });
    cleanup.push(() => pool.end());
    pool.on("error", (error) =>
      logger.warn(
        { reason: "db_unavailable", cause: safeCause(error) },
        "database connection failed",
      ),
    );
    const redis = createRedis(env.REDIS_URL, {
      connectTimeout: transport.redisCommandTimeoutMs,
      commandTimeout: transport.redisCommandTimeoutMs,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
    cleanup.push(() => redis.disconnect());
    redis.on("error", (error) =>
      logger.warn(
        { reason: "redis_unavailable", cause: safeCause(error) },
        "redis connection failed",
      ),
    );
    const metrics = createMetrics();
    const rpc = new JsonRpcClient({
      url: env.RPC_URL,
      timeoutMs: transport.rpcTimeoutMs,
      failureThreshold: transport.breakerFailureThreshold,
      recoverMs: transport.breakerOpenSeconds * 1000,
      nodeLagRetry: {
        maxAttempts: transport.rpcNodeLagMaxAttempts,
        backoffBaseMs: transport.rpcNodeLagBackoffBaseMs,
        backoffMaxMs: transport.rpcNodeLagBackoffMaxMs,
      },
    });
    const alerts = new AlertService({
      db,
      secretValues,
      dedupeSeconds: serviceParams.monitor.alertDedupeSeconds,
      ipSalt: env.LOG_IP_SALT,
      webhookUrl: env.ALERT_WEBHOOK_URL,
      timeoutMs: transport.webhookTimeoutMs,
    });
    const guard = key
      ? new RoleGuard({
          role: role as KeyRole,
          publicKey: key.publicKey,
          readConfig: configRoleReader(rpc, programId),
          recheckSeconds: serviceParams.signers.roleRecheckSeconds,
          onUnavailable: async (reason) => {
            logger.warn({ reason }, "role unavailable");
            try {
              await alerts.alert(`${role}:${reason}`, "critical", {
                role,
                reason,
              });
            } catch (error) {
              logger.warn(
                { reason: "alert_unavailable", cause: safeCause(error) },
                "alert persistence failed",
              );
            }
          },
        })
      : undefined;
    if (guard) key!.bind(guard);
    cleanup.push(() => guard?.stop());
    let closing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let leader: KeeperLeader | undefined;
    cleanup.push(() => {
      closing = true;
      clearTimeout(timer);
    });
    cleanup.push(() => leader?.stop());
    const refresh = async () => {
      if (closing) return;
      const startedAt = performance.now();
      await guard?.refresh();
      if (!closing && guard) {
        timer = setTimeout(
          () => {
            void refresh();
          },
          Math.max(
            0,
            serviceParams.signers.roleRecheckSeconds * 1000 -
              transport.rpcTimeoutMs -
              (performance.now() - startedAt),
          ),
        );
        timer.unref();
      }
    };
    // Failed dependencies are visible at /ready; key failure also makes /health 503.
    await redis.connect().catch((error) => {
      logger.warn(
        { reason: "redis_unavailable", cause: safeCause(error) },
        "redis connect failed",
      );
    });
    await refresh();
    if (role === "keeper") {
      leader = new KeeperLeader({
        connectionString: env.DATABASE_URL,
        tickMs: serviceParams.keeper.scanSeconds * 1000,
        followerRetrySeconds: serviceParams.keeper.followerRetrySeconds,
        leaderFailoverSeconds: serviceParams.keeper.leaderFailoverSeconds,
        onChange: (value) => metrics.keeperIsLeader.set(value ? 1 : 0),
        onError: (reason) =>
          logger.warn({ reason }, "keeper leadership unavailable"),
        onLeader: options.onLeader,
      });
      await leader.start();
    }
    const health = createHealthApp({
      version: env.APP_VERSION,
      commit: env.GIT_COMMIT,
      registry: metrics.registry,
      guard,
      timeoutMs: Math.max(
        transport.rpcTimeoutMs,
        transport.dbStatementTimeoutMs,
        transport.redisCommandTimeoutMs,
      ),
      isClosing: () => closing,
      checks: {
        db: () => pool.query("SELECT 1"),
        redis: () => redis.ping(),
        rpc: () => rpc.ready(),
      },
    });
    let stopped: Promise<void> | undefined;
    const stop = () =>
      (stopped ??= (async () => {
        closing = true;
        guard?.stop();
        key?.destroy();
        clearTimeout(timer);
        try {
          await leader?.stop();
        } finally {
          redis.disconnect();
          await pool.end();
          logger.flush();
        }
      })());
    return {
      role,
      env,
      logger,
      pool,
      db,
      redis,
      rpc,
      key,
      guard,
      leader,
      metrics,
      alerts,
      health,
      stop,
    };
  } catch (error) {
    // Invalidate the signer first; then release every successfully opened resource.
    key?.destroy();
    for (const close of cleanup.reverse()) {
      try {
        await close();
      } catch (error) {
        warnCause("startup_cleanup_failed", error);
        /* Continue cleanup after an individual dependency fails. */
      }
    }
    throw error;
  }
}
export type ServiceRuntime = Awaited<ReturnType<typeof createRuntime>>;

export function listenRuntime(runtime: ServiceRuntime) {
  const server = serve({
    fetch: runtime.health.fetch,
    port: runtime.env.PRIVATE_PORT,
    hostname: runtime.env.PRIVATE_HOST,
  });
  return server;
}
export function installShutdown(
  runtime: Pick<ServiceRuntime, "stop" | "logger">,
  servers: ReturnType<typeof serve>[],
): () => void {
  let closing = false;
  let fatalExit = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    clearTimeout(deadline);
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("uncaughtException", uncaughtException);
    process.removeListener("unhandledRejection", unhandledRejection);
    for (const server of servers) server.removeListener("error", serverError);
  };
  const shutdown = () => {
    if (closing) return;
    closing = true;
    // Invalidate authorization before waiting for any HTTP connection to close.
    let stopped: Promise<void>;
    try {
      stopped = runtime.stop();
    } catch (error) {
      runtime.logger.warn(
        { reason: "shutdown_failed", cause: safeCause(error) },
        "service stop failed",
      );
      stopped = Promise.reject(new Error("shutdown_failed"));
    }
    deadline = setTimeout(() => {
      process.exitCode = 1;
      runtime.logger.error(
        { reason: "shutdown_timeout" },
        "shutdown deadline reached",
      );
      for (const server of servers) {
        if ("closeAllConnections" in server) server.closeAllConnections();
      }
      dispose();
      runtime.logger.flush();
      process.exit(1);
    }, serviceParams.transport.shutdownDrainMs);
    deadline.unref();
    const drained = servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          if ("closeIdleConnections" in server) server.closeIdleConnections();
        }),
    );
    void Promise.allSettled([stopped, ...drained]).then((results) => {
      if (results.some((result) => result.status === "rejected")) {
        process.exitCode = 1;
        for (const result of results) {
          if (result.status === "rejected")
            runtime.logger.warn(
              { reason: "shutdown_failed", cause: safeCause(result.reason) },
              "service cleanup failed",
            );
        }
      }
      if (fatalExit) {
        runtime.logger.flush(() => {
          dispose();
          process.exit(1);
        });
      } else {
        dispose();
        runtime.logger.flush();
      }
    });
  };
  const fatal = (reason: string, error: unknown) => {
    fatalExit = true;
    process.exitCode = 1;
    runtime.logger.error({ reason, err: error }, "service fatal error");
    shutdown();
  };
  const uncaughtException = (error: Error) =>
    fatal("uncaught_exception", error);
  const unhandledRejection = (error: unknown) =>
    fatal("unhandled_rejection", error);
  const serverError = (error: Error) => fatal("server_error", error);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.on("uncaughtException", uncaughtException);
  process.on("unhandledRejection", unhandledRejection);
  for (const server of servers) server.on("error", serverError);
  return dispose;
}
export function reportStartupFailure(error: unknown): void {
  // Startup uses the same cause redaction before the service logger exists.
  const variable =
    error instanceof EnvironmentError ? error.variable : "startup_failed";
  const safe = z
    .string()
    .regex(/^[A-Za-z0-9_]+$/)
    .safeParse(variable);
  process.stderr.write(
    `${JSON.stringify({ level: "warn", variable: safe.success ? safe.data : "environment", cause: safeCause(error) })}\n`,
  );
  process.exitCode = 1;
}
