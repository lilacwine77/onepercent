import { safeCause } from "@onepercent/service-kit/safe-cause";
import type { Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY, alertsCopy } from "../copy.js";
import { privateOnly, reply } from "./shared.js";
export async function handleAlerts(ctx: Context, deps: BotDeps): Promise<void> {
  if (await privateOnly(ctx)) return;
  if (!ctx.from) return;
  const argument = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (argument && argument !== "on" && argument !== "off")
    return reply(ctx, COPY.UNKNOWN);
  if (argument === "off") {
    await deps.store.setAlerts(ctx.from.id, "off");
    return reply(ctx, COPY.ALERTS_OFF);
  }
  if (!deps.env.BOT_API_SECRET) return reply(ctx, COPY.ALERTS_NEED_LINK);
  try {
    const wallet = await deps.link.walletOf(ctx.from.id);
    if (!wallet) return reply(ctx, COPY.ALERTS_NEED_LINK);
    if (argument === "on") await deps.store.setAlerts(ctx.from.id, "live");
    const mode = await deps.store.getAlerts(ctx.from.id);
    await reply(
      ctx,
      alertsCopy(wallet, mode) +
        (mode === "live" && deps.env.FLAG_BOT_ALERTS !== "on"
          ? `\n${COPY.ALERTS_FROM_ON_AIR}`
          : ""),
    );
  } catch (error) {
    deps.logger.warn({ cause: safeCause(error) }, "bot alerts failed");
    await reply(ctx, COPY.LINK_OFF);
  }
}
