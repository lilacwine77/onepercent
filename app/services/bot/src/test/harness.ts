import { readFileSync } from "node:fs";
import pino from "pino";
import { vi } from "vitest";
import type { Update, UserFromGetMe } from "grammy/types";
import { createBot } from "../bot.js";
import {
  ConfigResponse,
  MachineResponse,
  type ValueSnapshot,
} from "../clients/machine.js";
import { parseEnv } from "../env.js";
import { InMemoryBotStore } from "../store.js";
import { InMemoryRateLimiter, type Clock } from "../ratelimit.js";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";

export const fixture = XrayResultSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/xray-result.json", import.meta.url),
      "utf8",
    ),
  ),
);
export const ADDRESS = fixture.address;
export const predeployConfigFixture: Record<string, unknown> = JSON.parse(
  readFileSync(
    new URL("./fixtures/config-predeploy.json", import.meta.url),
    "utf8",
  ),
);
export const NONCE = "0123456789abcdef0123456789abcdef";
export const TEST_BEARER = "offline-test-bearer-".repeat(3);
export const BOT_INFO: UserFromGetMe = {
  id: 12345,
  is_bot: true,
  first_name: "1% Machine",
  username: "OnepercentTestBot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
export class FakeClock implements Clock {
  value = 0;
  now = () => this.value;
  sleep = async (ms: number) => {
    this.value += ms;
  };
  advance(ms: number) {
    this.value += ms;
  }
}
export interface Call {
  method: string;
  payload: Record<string, unknown>;
  at: number;
}
export function harness(
  options: {
    secret?: boolean;
    wallet?: string | null;
    admin?: boolean;
    sessions?: boolean;
  } = {},
) {
  const clock = new FakeClock();
  const store = new InMemoryBotStore();
  const logs: string[] = [];
  const logger = pino(
    { level: "trace" },
    {
      write: (line: string) => {
        logs.push(line);
      },
    },
  );
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "12345:offline_fixture",
    PUBLIC_WEB_URL: "https://onepercent.test",
    PUBLIC_API_URL: "https://api.onepercent.test",
    ...(options.secret === false ? {} : { BOT_API_SECRET: TEST_BEARER }),
  });
  const xray = { get: vi.fn(async () => structuredClone(fixture)) };
  const link = {
    createNonce: vi.fn(async () => ({
      nonce: NONCE,
      expiresAt: "2026-10-08T12:10:00.000Z",
    })),
    unbind: vi.fn(async () => true),
    walletOf: vi.fn(async () =>
      options.wallet === undefined ? ADDRESS : options.wallet,
    ),
  };
  const go = {
    create: vi.fn(async () => [
      { id: "a".repeat(32), expiresAt: "2026-10-08T12:10:00.000Z" },
      { id: "b".repeat(32), expiresAt: "2026-10-08T12:10:00.000Z" },
      { id: "c".repeat(32), expiresAt: "2026-10-08T12:10:00.000Z" },
    ]),
  };
  const machine = {
    config: vi.fn(async () => ConfigResponse.parse(predeployConfigFixture)),
    machine: vi.fn(async () =>
      MachineResponse.parse({
        deck: { len: 61240, free: 60000 },
        coverage: { maxQty: [10, 10, 0, 2] },
        vrf: { busy: false },
        jackpot: { tokens: "0", cost: "0" },
      }),
    ),
    value: vi.fn(async (): Promise<ValueSnapshot> => ({
      status: "unavailable",
      reason: "no_route",
    })),
  };
  const bot = createBot({
    env,
    clock,
    store,
    logger,
    xray,
    link,
    machine,
    ...(options.sessions ? { go } : {}),
    rateLimiter: new InMemoryRateLimiter(clock),
    botInfo: BOT_INFO,
  });
  const calls: Call[] = [];
  bot.api.config.use(async (previous, method, payload) => {
    calls.push({
      method,
      payload: payload as Record<string, unknown>,
      at: clock.now(),
    });
    const result: unknown =
      method === "getChatMember"
        ? {
            status: options.admin ? "administrator" : "member",
            user: { id: 42, is_bot: false, first_name: "User" },
          }
        : method === "sendMessage"
          ? {
              message_id: calls.length,
              date: 0,
              chat: { id: 42, type: "private" },
              text: "test",
            }
          : true;
    return { ok: true, result } as Awaited<ReturnType<typeof previous>>;
  });
  let id = 0;
  function message(text: string, group = false, anonymous = false): Update {
    const chat = group
      ? { id: -100, type: "supergroup" as const, title: "Test group" }
      : { id: 42, type: "private" as const, first_name: "User" };
    const command = text.match(/^\/[a-z]+(?:@[A-Za-z0-9_]+)?/i)?.[0];
    return {
      update_id: ++id,
      message: {
        message_id: id,
        date: 0,
        chat,
        from: { id: 42, is_bot: false, first_name: "User" },
        ...(anonymous ? { sender_chat: chat } : {}),
        text,
        ...(command
          ? {
              entities: [
                { type: "bot_command", offset: 0, length: command.length },
              ],
            }
          : {}),
      },
    };
  }
  function callback(group = false, data = "xray_help"): Update {
    return {
      update_id: ++id,
      callback_query: {
        id: `callback-${id}`,
        from: { id: 42, is_bot: false, first_name: "User" },
        chat_instance: "offline-chat",
        data,
        message: {
          message_id: id,
          date: 0,
          chat: group
            ? { id: -100, type: "supergroup", title: "Test group" }
            : { id: 42, type: "private", first_name: "User" },
        },
      },
    };
  }
  function added(): Update {
    return {
      update_id: ++id,
      my_chat_member: {
        chat: { id: -100, type: "supergroup", title: "Test group" },
        from: { id: 42, is_bot: false, first_name: "User" },
        date: 0,
        old_chat_member: { status: "left", user: BOT_INFO },
        new_chat_member: { status: "member", user: BOT_INFO },
      },
    };
  }
  return {
    bot,
    calls,
    logs,
    store,
    clock,
    xray,
    link,
    go,
    machine,
    env,
    message,
    callback,
    added,
    texts: () =>
      calls
        .filter((call) => call.method === "sendMessage")
        .map((call) => String(call.payload.text)),
    send: (text: string, group = false, anonymous = false) =>
      bot.handleUpdate(message(text, group, anonymous)),
  };
}
