import { safeCause } from "@onepercent/service-kit/safe-cause";
import type { Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY, unlinkCopy } from "../copy.js";
import { privateOnly, reply } from "./shared.js";
export async function handleUnlink(ctx: Context, deps: BotDeps): Promise<void> {
  if (await privateOnly(ctx)) return;
  if (!ctx.from || !deps.env.BOT_API_SECRET) return reply(ctx, COPY.LINK_OFF);
  try {
    const wallet = await deps.link.walletOf(ctx.from.id);
    await deps.link.unbind(ctx.from.id);
    await deps.store.setAlerts(ctx.from.id, "off");
    await reply(ctx, wallet ? unlinkCopy(wallet) : COPY.ME_NONE);
  } catch (error) {
    deps.logger.warn({ cause: safeCause(error) }, "bot unlink failed");
    await reply(ctx, COPY.LINK_OFF);
  }
}
