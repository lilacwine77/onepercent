import { safeCause } from "@onepercent/service-kit/safe-cause";
import { InlineKeyboard, type Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY, xrayCopy } from "../copy.js";
import { XrayError } from "../clients/xray.js";
import { normalizeXrayInput } from "../referral.js";
import { reply } from "./shared.js";
export async function handleXray(
  ctx: Context,
  deps: BotDeps,
  raw: string,
): Promise<void> {
  if (/^0x/i.test(raw.trim())) return reply(ctx, COPY.SOLANA_ONLY);
  const input = normalizeXrayInput(raw);
  if (!input) return reply(ctx, COPY.XRAY_USAGE);
  try {
    await ctx.replyWithChatAction("typing");
    let ref: string | undefined;
    if (ctx.chat?.type === "private" && ctx.from && deps.env.BOT_API_SECRET) {
      ref =
        (await deps.link.walletOf(ctx.from.id).catch((error) => {
          deps.logger.warn(
            { cause: safeCause(error) },
            "bot xray referral unavailable",
          );
          return null;
        })) ?? undefined;
    }
    const result = await deps.xray.get(input, ref);
    const buttons = new InlineKeyboard();
    if (
      ctx.chat?.type === "private" &&
      result.counts.feedable + result.counts.checkAtFeed > 0
    )
      buttons.text(COPY.BUTTON_FEED_MENU, "feed_menu");
    buttons.url(COPY.BUTTON_SHARE, result.share.xIntentUrl);
    await ctx.reply(xrayCopy(result, input), {
      parse_mode: "HTML",
      reply_markup: buttons,
      link_preview_options: {
        url: result.share.landscapeUrl,
        prefer_large_media: true,
        show_above_text: false,
      },
    });
  } catch (error) {
    deps.logger.warn(
      { cause: safeCause(error) },
      error instanceof XrayError && error.kind === "schema"
        ? "xray_schema_mismatch"
        : "bot xray failed",
    );
    await reply(
      ctx,
      error instanceof XrayError && error.kind === "usage"
        ? COPY.XRAY_USAGE
        : COPY.XRAY_BUSY,
    );
  }
}
