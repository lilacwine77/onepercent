import { InlineKeyboard, type Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY } from "../copy.js";
import { parseReferral } from "../referral.js";
import { reply } from "./shared.js";
export async function handleStart(ctx: Context, deps: BotDeps): Promise<void> {
  if (ctx.chat?.type !== "private") return reply(ctx, COPY.START_GROUP);
  if (!ctx.from) return;
  await deps.store.recordStart(ctx.from.id, ctx.chat.id);
  const code = parseReferral(
    typeof ctx.match === "string" ? ctx.match.trim() : "",
  );
  if (code) await deps.store.setPendingReferral(ctx.from.id, code);
  await reply(
    ctx,
    COPY.START,
    new InlineKeyboard()
      .text(COPY.BUTTON_XRAY, "xray_help")
      .url(COPY.BUTTON_HOW, deps.env.PUBLIC_WEB_URL),
  );
}
