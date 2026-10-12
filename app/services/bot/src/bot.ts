import { safeCause, warnCause } from "@onepercent/service-kit/safe-cause";
import { Bot } from "grammy";
import type { AbortSignal as TelegramSignal } from "abort-controller";
import type { UserFromGetMe } from "grammy/types";
import type { Logger } from "pino";
import type { BotEnv } from "./env.js";
import type { BotStore } from "./store.js";
import type { XrayClient } from "./clients/xray.js";
import type { GoClient } from "./clients/go.js";
import type { MachineClient } from "./clients/machine.js";
import type { LinkClient } from "./clients/link.js";
import type { Clock, RateLimiter, RateRule } from "./ratelimit.js";
import { secretGuard } from "./guard.js";
import { COPY, rateLimitedCopy, descriptionCopy } from "./copy.js";
import { RATE_RULES } from "./limits.js";
import { ExpiringMap } from "./memory.js";
import { normalizeXrayInput } from "./referral.js";
import { handleStart } from "./handlers/start.js";
import { handleXray } from "./handlers/xray.js";
import { handleFeed } from "./handlers/feed.js";
import { handleRip } from "./handlers/rip.js";
import { handleLink } from "./handlers/link.js";
import { handleMe } from "./handlers/me.js";
import { handleAlerts } from "./handlers/alerts.js";
import { handleHits } from "./handlers/hits.js";
import { handleText } from "./handlers/text.js";
import { handleMachine } from "./handlers/machine.js";
import { handleUnlink } from "./handlers/unlink.js";
import { handleCallback } from "./handlers/callback.js";
export const ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "my_chat_member",
] as const;
export interface BotDeps {
  env: BotEnv;
  store: BotStore;
  rateLimiter: RateLimiter;
  xray: XrayClient;
  link: LinkClient;
  go?: GoClient;
  machine?: MachineClient;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn">;
  botInfo?: UserFromGetMe;
}
export function createBot(deps: BotDeps): Bot {
  if (!deps.env.TELEGRAM_BOT_TOKEN) throw new Error("bot disabled");
  const bot = new Bot(deps.env.TELEGRAM_BOT_TOKEN, { botInfo: deps.botInfo });
  bot.on("my_chat_member", async (ctx) => {
    if (["kicked", "left"].includes(ctx.myChatMember.new_chat_member.status))
      await deps.store.markBlocked(ctx.chat.id);
  });
  bot.on("message:migrate_to_chat_id", async (ctx) => {
    await deps.store.migrateChat(ctx.chat.id, ctx.message.migrate_to_chat_id);
  });
  // Ignore ordinary group chatter; only handled commands and taps spend replies.
  bot.use(async (ctx, next) => {
    const match = /^\/([a-z]+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/.exec(
      ctx.message?.text ?? "",
    );
    const name = match?.[1];
    const addressed =
      !match?.[2] || match[2].toLowerCase() === ctx.me.username.toLowerCase();
    const handled =
      (addressed && name !== undefined && Object.hasOwn(COPY.COMMANDS, name)) ||
      ["xray_help", "feed_menu", "rip_menu"].includes(
        ctx.callbackQuery?.data ?? "",
      );
    if (ctx.chat && ctx.chat.type !== "private" && !handled) return;
    if (
      ctx.chat &&
      ctx.chat.type !== "private" &&
      handled &&
      !deps.rateLimiter.consume(`group:${ctx.chat.id}`, RATE_RULES.group).ok
    )
      return;
    await next();
  });
  bot.use(secretGuard);
  const notified = new ExpiringMap<string, true>(() => deps.clock.now());
  bot.use(async (ctx, next) => {
    if (ctx.myChatMember || !ctx.chat) return;
    const userId =
      ctx.from?.id ??
      (ctx.senderChat?.id === ctx.chat.id ? ctx.senderChat.id : undefined);
    if (userId === undefined) return;
    const key =
      ctx.chat.type === "private" ? `${userId}` : `${userId}:${ctx.chat.id}`;
    const raw = ctx.message?.text ?? "";
    const token = /^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/.exec(raw)?.[1];
    const command =
      token && Object.hasOwn(COPY.COMMANDS, token)
        ? token
        : ctx.callbackQuery
          ? "callback"
          : "text";
    const rules: RateRule[] = [RATE_RULES.update];
    if (
      command === "xray" ||
      (ctx.chat.type === "private" && normalizeXrayInput(raw))
    )
      rules.push(RATE_RULES.xray);
    if (command === "link") rules.push(RATE_RULES.link);
    if (
      ctx.chat.type === "private" &&
      (["feed", "rip", "me"].includes(command) ||
        ["feed_menu", "rip_menu"].includes(ctx.callbackQuery?.data ?? ""))
    )
      rules.push(RATE_RULES.deepLink);
    const start = deps.clock.now();
    for (const rule of rules) {
      const result = deps.rateLimiter.consume(key, rule);
      if (!result.ok) {
        const id = `${key}:${rule.name}`;
        if (
          !notified.get(id) &&
          notified.set(id, true, start + result.retryAfterS * 1000)
        ) {
          const text = rateLimitedCopy(result.retryAfterS);
          if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text });
          else await ctx.reply(text, { parse_mode: "HTML" });
        }
        deps.logger.info({
          command,
          outcome: "rate_limited",
          latency: deps.clock.now() - start,
        });
        return;
      }
    }
    let outcome = "ok";
    try {
      await next();
    } catch (error) {
      deps.logger.warn({ cause: safeCause(error) }, "bot command failed");
      outcome = "failed";
    }
    deps.logger.info({ command, outcome, latency: deps.clock.now() - start });
  });
  bot.command("machine", (ctx) => handleMachine(ctx, deps));
  bot.command("unlink", (ctx) => handleUnlink(ctx, deps));
  bot.command("start", (ctx) => handleStart(ctx, deps));
  bot.command("xray", (ctx) => handleXray(ctx, deps, ctx.match));
  bot.command("feed", (ctx) => handleFeed(ctx, deps));
  bot.command("rip", (ctx) => handleRip(ctx, deps));
  bot.command("link", (ctx) => handleLink(ctx, deps));
  bot.command("me", (ctx) => handleMe(ctx, deps));
  bot.command("alerts", (ctx) => handleAlerts(ctx, deps));
  bot.command("hits", (ctx) => handleHits(ctx, deps));
  bot.callbackQuery(["feed_menu", "rip_menu"], async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({ text: COPY.PRIVATE_ONLY });
      return;
    }
    await ctx.answerCallbackQuery();
    if (ctx.callbackQuery.data === "feed_menu") await handleFeed(ctx, deps);
    else {
      ctx.match = "";
      await handleRip(ctx, deps);
    }
  });
  bot.callbackQuery("xray_help", handleCallback);
  bot.on("message:text", (ctx) => handleText(ctx, deps));
  return bot;
}
export async function registerCommandMenus(
  bot: Bot,
  signal?: TelegramSignal,
  onError?: (error: unknown) => void,
): Promise<void> {
  const command = (name: keyof typeof COPY.COMMANDS) => ({
    command: name,
    description: COPY.COMMANDS[name],
  });
  const scopes = [
    {
      names: [
        "start",
        "xray",
        "machine",
        "feed",
        "rip",
        "link",
        "me",
        "alerts",
        "unlink",
      ] as const,
      scope: { type: "all_private_chats" as const },
    },
    {
      names: ["xray", "machine", "hits"] as const,
      scope: { type: "all_group_chats" as const },
    },
  ];
  for (const item of scopes) {
    if (signal?.aborted) return;
    try {
      await bot.api.setMyCommands(
        item.names.map(command),
        { scope: item.scope },
        signal,
      );
    } catch (error) {
      if (!onError) throw error;
      if (!signal?.aborted) onError(error);
      else warnCause("bot_commands_aborted", error);
    }
  }
}
export async function registerBotProfile(
  bot: Bot,
  host: string,
  logger: Pick<Logger, "warn">,
  signal?: TelegramSignal,
): Promise<void> {
  const warn = (method: string, error: unknown) =>
    logger.warn({ method, cause: safeCause(error) }, "bot profile unavailable");
  await registerCommandMenus(bot, signal, (error) =>
    warn("setMyCommands", error),
  );
  const calls = [
    [
      "setMyDescription",
      () => bot.api.setMyDescription(descriptionCopy(host), {}, signal),
    ],
    [
      "setMyShortDescription",
      () => bot.api.setMyShortDescription(COPY.SHORT_DESCRIPTION, {}, signal),
    ],
  ] as const;
  for (const [method, call] of calls) {
    if (signal?.aborted) return;
    try {
      await call();
    } catch (error) {
      warn(method, error);
    }
  }
}
