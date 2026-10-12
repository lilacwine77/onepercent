import { warnCause } from "@onepercent/service-kit/safe-cause";
import { HIT_TIERS } from "@onepercent/config";
import type { InlineKeyboard } from "grammy";
import { BOT } from "../limits.js";
import type { Clock } from "../ratelimit.js";
import type { BotStore } from "../store.js";
import { ExpiringMap, MEMORY_ENTRY_LIMIT } from "../memory.js";
import {
  hitTemplate,
  royaltyTemplate,
  type HitEvent,
  type Notification,
  type RoyaltyEvent,
} from "./templates.js";
export type { HitEvent, RoyaltyEvent } from "./templates.js";
export type Delivery =
  | "sent"
  | "not_started"
  | "opted_out"
  | "below_min_tier"
  | "blocked"
  | "failed";
export interface NotificationSender {
  royalty(chatId: number, event: RoyaltyEvent): Promise<Delivery>;
  hit(chatId: number, event: HitEvent): Promise<Delivery>;
}
export interface NotificationApi {
  sendMessage(
    chatId: number,
    text: string,
    options: { parse_mode: "HTML"; reply_markup?: InlineKeyboard },
  ): Promise<unknown>;
}
interface SenderDeps {
  api: NotificationApi;
  store: BotStore;
  clock: Clock;
  webUrl: string;
  maxEntries?: number;
}

function telegramError(error: unknown): { code?: number; retryAfter?: number } {
  if (typeof error !== "object" || error === null) return {};
  const value = error as {
    error_code?: unknown;
    parameters?: { retry_after?: unknown };
  };
  return {
    code: typeof value.error_code === "number" ? value.error_code : undefined,
    retryAfter:
      typeof value.parameters?.retry_after === "number"
        ? value.parameters.retry_after
        : undefined,
  };
}

// No production caller yet. The event worker will provide the explicit opt-in path.
export function createNotificationSender({
  api,
  store,
  clock,
  webUrl,
  maxEntries = MEMORY_ENTRY_LIMIT,
}: SenderDeps): NotificationSender {
  const globalSends: number[] = [];
  const chatSends = new ExpiringMap<number, number>(
    () => clock.now(),
    maxEntries,
  );
  const groupSends = new ExpiringMap<number, number[]>(
    () => clock.now(),
    maxEntries,
  );
  let queue = Promise.resolve();
  let queued = 0;

  async function gate(chatId: number, tier?: string): Promise<Delivery | null> {
    if (tier !== undefined) {
      const tiers: readonly string[] = [
        ...HIT_TIERS.map((entry) => entry.id),
        "jackpot",
        "onePct",
      ];
      if (tiers.indexOf(tier) < tiers.indexOf(BOT.hitPostMinKind))
        return "below_min_tier";
    }
    if (chatId < 0)
      return (await store.getGroupHits(chatId)) ? null : "opted_out";
    if (!(await store.hasStarted(chatId))) return "not_started";
    return (await store.getAlerts(chatId)) === "live" ? null : "opted_out";
  }

  async function throttle(chatId: number): Promise<boolean> {
    let now = clock.now();
    while (globalSends.length && globalSends[0]! <= now - 1000)
      globalSends.shift();
    const group = groupSends.get(chatId) ?? [];
    while (group.length && group[0]! <= now - 60_000) group.shift();
    const previous = chatSends.get(chatId);
    const earliest = Math.max(
      now,
      globalSends.length >= BOT.maxMessagesPerSecond
        ? globalSends[0]! + 1000
        : now,
      previous === undefined ? now : previous + 1000,
      chatId < 0 && group.length >= 20 ? group[0]! + 60_000 : now,
    );
    if (earliest > now) await clock.sleep(earliest - now);
    now = clock.now();
    // Reserve every attempt, including retries, before handing it to Telegram.
    if (!chatSends.set(chatId, now, now + 1_000)) return false;
    if (chatId < 0) {
      group.push(now);
      if (!groupSends.set(chatId, group, now + 60_000)) return false;
    }
    globalSends.push(now);
    return true;
  }

  function enqueue(
    chatId: number,
    render: () => Notification,
    tier?: string,
  ): Promise<Delivery> {
    if (queued >= maxEntries) return Promise.resolve("failed");
    queued++;
    const job = queue
      .then(async (): Promise<Delivery> => {
        const refused = await gate(chatId, tier);
        if (refused) return refused;
        try {
          const message = render();
          for (let attempt = 0; attempt < 2; attempt++) {
            if (!(await throttle(chatId))) return "failed";
            // A queued delivery must honour a later opt-out too.
            const changed = await gate(chatId, tier);
            if (changed) return changed;
            try {
              await api.sendMessage(chatId, message.text, {
                parse_mode: "HTML",
                ...(message.reply_markup
                  ? { reply_markup: message.reply_markup }
                  : {}),
              });
              return "sent";
            } catch (error) {
              warnCause("bot_notification_send_failed", error);
              const { code, retryAfter } = telegramError(error);
              if (code === 403) {
                await store.markBlocked(chatId);
                return "blocked";
              }
              if (
                code !== 429 ||
                attempt !== 0 ||
                retryAfter === undefined ||
                !Number.isFinite(retryAfter) ||
                retryAfter < 0
              )
                return "failed";
              await clock.sleep(retryAfter * 1000);
            }
          }
        } catch (error) {
          warnCause("bot_notification_failed", error);
        }
        return "failed";
      })
      .finally(() => {
        queued--;
      });
    queue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
  return {
    royalty: (chatId, event) =>
      chatId < 0
        ? Promise.resolve("opted_out")
        : enqueue(chatId, () => royaltyTemplate(event)),
    hit: (chatId, event) =>
      enqueue(chatId, () => hitTemplate(event, webUrl), event.tier),
  };
}
