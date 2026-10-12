// The bot must never ask for, receive, store or derive private keys or seed phrases.
import type { MiddlewareFn } from "grammy";
import { warnCause } from "@onepercent/service-kit/safe-cause";
import { COPY } from "./copy.js";
export function looksLikeCredential(text: string): boolean {
  const trimmed = text.trim();
  const tokens = trimmed.split(/\s+/);
  if (
    [12, 15, 18, 21, 24].includes(tokens.length) &&
    tokens.every((token) => /^[a-z]{3,8}$/i.test(token))
  )
    return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{85,90}$/.test(trimmed)) return true;
  if (!/^\[\s*\d+(?:\s*,\s*\d+)*\s*\]$/.test(trimmed)) return false;
  const numbers = trimmed.slice(1, -1).split(",").map(Number);
  return (
    numbers.length === 64 &&
    numbers.every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  );
}
export const secretGuard: MiddlewareFn = async (ctx, next) => {
  if (ctx.chat?.type !== "private") return next();
  const contents = [ctx.message?.text, ctx.message?.caption];
  const containsCredential = contents.some((text) => {
    if (!text) return false;
    const remainder = text.replace(
      /^\s*\/[a-z0-9_]+(?:@[a-z0-9_]+)?(?:\s+|$)/i,
      "",
    );
    return looksLikeCredential(text) || looksLikeCredential(remainder);
  });
  if (!containsCredential) return next();
  try {
    await ctx.deleteMessage();
  } catch (error) {
    warnCause("bot_credential_message_delete_failed", error);
  }
  await ctx.reply(COPY.SECRET_GUARD, { parse_mode: "HTML" });
};
