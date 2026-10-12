import { safeCause } from "@onepercent/service-kit/safe-cause";
import type { Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY, meCopy } from "../copy.js";
import { privateOnly, reply, walletButtons } from "./shared.js";
export async function handleMe(ctx: Context, deps: BotDeps): Promise<void> {
  if (await privateOnly(ctx)) return;
  if (!deps.env.BOT_API_SECRET || !ctx.from) return reply(ctx, COPY.LINK_OFF);
  try {
    const wallet = await deps.link.walletOf(ctx.from.id);
    await reply(
      ctx,
      wallet
        ? meCopy(wallet, await deps.store.getAlerts(ctx.from.id))
        : COPY.ME_NONE,
      wallet ? await walletButtons(ctx, deps, "cards") : undefined,
    );
  } catch (error) {
    deps.logger.warn({ cause: safeCause(error) }, "bot me failed");
    await reply(ctx, COPY.LINK_OFF);
  }
}
