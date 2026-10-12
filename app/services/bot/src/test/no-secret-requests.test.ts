import "./setup.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COPY, descriptionCopy, MACHINE_COPY } from "../copy.js";
import { looksLikeCredential } from "../guard.js";
import {
  hitTemplate,
  royaltyTemplate,
  type HitEvent,
} from "../notify/templates.js";
import { BOT } from "../limits.js";
import { ADDRESS, harness, NONCE, TEST_BEARER } from "./harness.js";

const forbiddenRequest =
  /seed|private key|secret key|recovery phrase|mnemonic|passphrase|import (your )?wallet|\b(12|24)[ -]words?\b/i;
const guarded = [
  ...[12, 15, 18, 21, 24].map((count) =>
    Array.from({ length: count }, () => "sample").join(" "),
  ),
  Array.from({ length: 12 }, () => "SAMPLE").join(" "),
  Array.from({ length: 24 }, () => "SaMpLe").join(" "),
  ...[85, 86, 87, 88, 89, 90].map((count) => "A".repeat(count)),
  `[${Array.from({ length: 64 }, (_, index) => index).join(",")}]`,
];
function outgoing(payload: Record<string, unknown>): string[] {
  const strings = [payload.text, payload.caption].filter(
    (value): value is string => typeof value === "string",
  );
  const markup = payload.reply_markup as
    { inline_keyboard?: { text: string }[][] } | undefined;
  const buttons = markup?.inline_keyboard?.flat() ?? [];
  expect(buttons.length).toBeLessThanOrEqual(3);
  for (const text of strings) {
    expect(text.split("\n").length).toBeLessThanOrEqual(BOT.maxMessageLines);
    if (text.includes("\n")) expect(text).toMatch(/^(?:✨ )?<b>/);
    expect(text).not.toMatch(/\.sol\b/i);
  }
  return [...strings, ...buttons.map((button) => button.text)];
}

describe("message safety boundary", () => {
  it.each(guarded)(
    "deletes a credential-shaped private message before anything else (%#)",
    async (text) => {
      const h = harness();
      await h.send(text);
      expect(h.calls.map((call) => call.method)).toEqual([
        "deleteMessage",
        "sendMessage",
      ]);
      expect(h.texts()).toEqual([COPY.SECRET_GUARD]);
      expect(h.xray.get).not.toHaveBeenCalled();
      expect(h.link.createNonce).not.toHaveBeenCalled();
      expect(h.logs).toEqual([]);
      expect(await h.store.hasStarted(42)).toBe(false);
    },
  );
  it.each(guarded)(
    "deletes command arguments that resemble credentials (%#)",
    async (text) => {
      const h = harness();
      await h.send(`/xray ${text}`);
      expect(h.calls.map((call) => call.method)).toEqual([
        "deleteMessage",
        "sendMessage",
      ]);
      expect(h.texts()).toEqual([COPY.SECRET_GUARD]);
      expect(h.xray.get).not.toHaveBeenCalled();
      expect(h.link.createNonce).not.toHaveBeenCalled();
      expect(h.logs).toEqual([]);
    },
  );
  it.each([
    "A".repeat(88),
    `/xray ${"A".repeat(88)}`,
    `/xray@OnepercentTestBot\n${"SaMpLe ".repeat(12)}`,
    `[${Array.from({ length: 64 }, (_, index) => index).join(",")}]`,
  ])("deletes credential-shaped media captions (%#)", async (caption) => {
    const h = harness();
    const update = h.message("");
    await h.bot.handleUpdate({
      update_id: update.update_id,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 42, type: "private", first_name: "User" },
        from: { id: 42, is_bot: false, first_name: "User" },
        photo: [
          {
            file_id: "offline-photo",
            file_unique_id: "photo",
            width: 1,
            height: 1,
          },
        ],
        caption,
      },
    });
    expect(h.calls.map((call) => call.method)).toEqual([
      "deleteMessage",
      "sendMessage",
    ]);
    expect(h.texts()).toEqual([COPY.SECRET_GUARD]);
    expect(h.xray.get).not.toHaveBeenCalled();
    expect(h.link.createNonce).not.toHaveBeenCalled();
    expect(h.logs).toEqual([]);
  });
  it("does not classify valid public addresses or near misses as credentials", () => {
    for (const input of [
      ADDRESS,
      "sample ".repeat(11),
      "sample ".repeat(13),
      "A".repeat(84),
      "A".repeat(91),
      "[" + "256,".repeat(63) + "256]",
      "[1,2,3]",
    ])
      expect(looksLikeCredential(input)).toBe(false);
  });
  it("logs a safe deletion failure and never forwards message contents", async () => {
    const h = harness();
    const output = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    h.bot.api.config.use(async (previous, method, payload, signal) => {
      if (method === "deleteMessage")
        throw Object.assign(
          new Error(
            "delete failed https://api.telegram.test/bot123456789:private-token/deleteMessage",
          ),
          { payload: { text: guarded[0] } },
        );
      return previous(method, payload, signal);
    });
    try {
      await h.send(guarded[0]!);
      expect(h.texts()).toEqual([COPY.SECRET_GUARD]);
      expect(h.logs).toEqual([]);
      expect(output).toHaveBeenCalledOnce();
      expect(JSON.parse(String(output.mock.calls[0]![0]))).toEqual({
        level: "warn",
        reason: "bot_credential_message_delete_failed",
        cause: { code: "Error", detail: "delete failed <redacted>" },
      });
    } finally {
      output.mockRestore();
    }
  });
  it("guards before throttling and leaves group messages untouched", async () => {
    const h = harness();
    for (let n = 0; n < 21; n++) await h.send("hello");
    await h.send(guarded[0]!);
    expect(h.texts().at(-1)).toBe(COPY.SECRET_GUARD);
    const group = harness();
    await group.send(guarded[0]!, true);
    expect(group.calls).toEqual([]);
  });
  it("checks every command, plain text, callback, guard and notifier output, and captures redacted pino logs", async () => {
    const scenarios = [
      ["start", "ref_creator", "ref_invalid!"],
      ["machine", "ignored", "bad"],
      ["unlink", "ignored", "bad"],
      ["xray", ADDRESS, "wrong"],
      ["feed", "ignored", "bad"],
      ["rip", "ah 5", "zz"],
      ["link", "ignored", "bad"],
      ["me", "ignored", "bad"],
      ["alerts", "on", "bad"],
      ["hits", "on", "bad"],
    ];
    const texts: string[] = [];
    const logLines: string[] = [];
    for (const [command, valid, invalid] of scenarios)
      for (const args of ["", valid, invalid])
        for (const group of [false, true]) {
          const h = harness({ admin: true });
          await h.send(`/${command}${args ? ` ${args}` : ""}`, group);
          texts.push(...h.calls.flatMap((call) => outgoing(call.payload)));
          logLines.push(...h.logs);
        }
    for (const text of [ADDRESS, "Alice.SOL", "unknown text", ...guarded])
      for (const group of [false, true]) {
        const h = harness();
        await h.send(text, group);
        texts.push(...h.calls.flatMap((call) => outgoing(call.payload)));
        logLines.push(...h.logs);
      }
    for (const group of [false, true])
      for (const data of ["xray_help", "feed_menu", "rip_menu"]) {
        const h = harness();
        await h.bot.handleUpdate(h.callback(group, data));
        texts.push(...h.calls.flatMap((call) => outgoing(call.payload)));
        logLines.push(...h.logs);
      }
    texts.push(
      ...outgoing({
        ...royaltyTemplate({
          wallet: ADDRESS,
          ticker: '<a href="x">',
          lamports: 20_000_000n,
        }),
      }),
    );
    const hits: HitEvent[] = [
      {
        tier: "holo",
        buyer: ADDRESS,
        edition: "original",
        stockedLamports: 400_000_000n,
      },
      {
        tier: "black",
        buyer: ADDRESS,
        edition: "blue_shift",
        stockedLamports: 3_750_000_000n,
      },
      {
        tier: "jackpot",
        buyer: ADDRESS,
        edition: "signature",
        onePctAmount: 1_000_000n,
      },
      { tier: "onePct", buyer: ADDRESS, edition: "after_hours" },
    ];
    for (const hit of hits)
      texts.push(
        ...outgoing({ ...hitTemplate(hit, "https://onepercent.test") }),
      );
    texts.push(...Object.values(MACHINE_COPY), COPY.SHORT_DESCRIPTION);
    for (const text of texts) expect(text).not.toMatch(forbiddenRequest);
    const description = descriptionCopy("onepercent.test");
    expect(description).toContain(
      "I never ask for a seed phrase or a private key.",
    );
    expect(
      description.replace(
        "I never ask for a seed phrase or a private key.",
        "",
      ),
    ).not.toMatch(forbiddenRequest);
    const webCopy = readFileSync(
      new URL("../../../../apps/web/src/link/copy.ts", import.meta.url),
      "utf8",
    );
    expect(webCopy).not.toMatch(forbiddenRequest);
    const logs = logLines.join("");
    for (const sensitive of [
      ADDRESS,
      NONCE,
      TEST_BEARER,
      "ref_creator",
      "ref_invalid!",
      "Alice.SOL",
      "unknown text",
      ...guarded,
    ])
      expect(logs).not.toContain(sensitive);
    for (const line of logLines) {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.cause) {
        expect(record.level).toBe(40);
        expect(record.cause).toEqual({
          code: expect.any(String),
          detail: expect.any(String),
        });
        continue;
      }
      expect(Object.keys(record).sort()).toEqual([
        "command",
        "hostname",
        "latency",
        "level",
        "outcome",
        "pid",
        "time",
      ]);
    }
  });
});
