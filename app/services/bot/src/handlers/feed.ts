import type { Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { feedCopy } from "../copy.js";
import { privateOnly, reply, walletButtons } from "./shared.js";
export async function handleFeed(ctx: Context, deps: BotDeps): Promise<void> {
  if (await privateOnly(ctx)) return;
  await reply(ctx, feedCopy(), await walletButtons(ctx, deps, "feed"));
}
