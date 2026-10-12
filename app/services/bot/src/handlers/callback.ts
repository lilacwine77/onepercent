import type { Context } from "grammy";
import { COPY } from "../copy.js";
import { reply } from "./shared.js";
export async function handleCallback(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  await reply(ctx, COPY.XRAY_USAGE);
}
