// The bot must never ask for, receive, store or derive private keys or seed phrases.
import { AbortController as TelegramAbortController } from "abort-controller";
import { createDatabase } from "@onepercent/db";
import { ALLOWED_UPDATES, createBot, registerBotProfile } from "./bot.js";
import { InMemoryBotStore } from "./store.js";
import { PgBotStore } from "./store-pg.js";
import { InMemoryRateLimiter, systemClock } from "./ratelimit.js";
import { createXrayClient } from "./clients/xray.js";
import { createLinkClient } from "./clients/link.js";
import { createGoClient } from "./clients/go.js";
import { createMachineClient } from "./clients/machine.js";
import {
  BotLock,
  closeBotRuntime,
  botDatabaseOptions,
  databaseReady,
  healthServer,
} from "./runtime.js";
import { assertBotKeyIsolation, KeyVariableError } from "./keyguard.js";
import pino from "pino";
import { safeCause } from "@onepercent/service-kit/safe-cause";
import { EnvironmentError, parseEnv } from "./env.js";

const logger = pino({ name: "bot" });
async function main(): Promise<void> {
  assertBotKeyIsolation(process.env);
  const env = parseEnv(process.env);
  logger.level = env.LOG_LEVEL;
  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.info("bot disabled");
    return;
  }
  const database = env.DATABASE_URL
    ? createDatabase(botDatabaseOptions(env.DATABASE_URL))
    : undefined;
  if (!database) logger.warn("bot memory stores");
  database?.pool.on("error", (error) =>
    logger.warn({ cause: safeCause(error) }, "bot database unavailable"),
  );
  const bot = createBot({
    env,
    store: database ? new PgBotStore(database.pool) : new InMemoryBotStore(),
    rateLimiter: new InMemoryRateLimiter(systemClock),
    xray: createXrayClient(env.PUBLIC_API_URL, env.BOT_API_SECRET),
    link: createLinkClient(env.PUBLIC_API_URL, env.BOT_API_SECRET),
    go: createGoClient(env.PUBLIC_API_URL, env.BOT_API_SECRET),
    machine: createMachineClient(env.PUBLIC_API_URL),
    clock: systemClock,
    logger,
  });
  bot.catch((error) =>
    logger.warn({ cause: safeCause(error.error) }, "bot command failed"),
  );
  const initialization = new TelegramAbortController();
  const controller = new AbortController();
  const state = { polling: false, lock: !database, stopping: false };
  const health = healthServer(state, () => databaseReady(database?.pool));
  let stopPolling: Promise<void> | undefined;
  const shutdown = () => {
    if (state.stopping) return;
    state.stopping = true;
    state.polling = false;
    initialization.abort();
    controller.abort();
    if (bot.isRunning())
      stopPolling = bot.stop().catch((error) => {
        logger.warn({ cause: safeCause(error) }, "bot shutdown failed");
        process.exitCode = 1;
      });
  };
  const lock = database
    ? new BotLock(database.pool, () => {
        state.lock = false;
        logger.warn("bot lock lost");
        process.exitCode = 1;
        shutdown();
      })
    : undefined;
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await new Promise<void>((resolve, reject) => {
      health.once("error", reject);
      health.listen(env.PRIVATE_PORT, env.PRIVATE_HOST, resolve);
    });
    if (lock) state.lock = await lock.acquire(controller.signal);
    if (state.stopping || !state.lock) return;
    await bot.init(initialization.signal);
    if (state.stopping) return;
    await registerBotProfile(
      bot,
      new URL(env.PUBLIC_WEB_URL).host,
      logger,
      initialization.signal,
    );
    if (state.stopping) return;
    await bot.start({
      allowed_updates: [...ALLOWED_UPDATES],
      onStart: () => {
        if (!state.stopping) state.polling = true;
        logger.info("bot started");
      },
    });
  } catch (error) {
    if (!state.stopping) throw error;
    logger.warn({ cause: safeCause(error) }, "bot stopping");
  } finally {
    shutdown();
    await stopPolling;
    const cleaned = await closeBotRuntime(
      async () => {
        await lock?.release();
      },
      () => new Promise<void>((resolve) => health.close(() => resolve())),
      async () => {
        await database?.close();
      },
    );
    if (!cleaned) {
      logger.error("bot cleanup failed");
      process.exitCode = 1;
    }
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    logger.info("bot stopped");
    logger.flush();
  }
}
main().catch((error: unknown) => {
  logger.warn(
    { cause: safeCause(error) },
    error instanceof KeyVariableError
      ? error.variable
      : error instanceof EnvironmentError
        ? error.message
        : "bot failed",
  );
  process.exitCode = 1;
});
