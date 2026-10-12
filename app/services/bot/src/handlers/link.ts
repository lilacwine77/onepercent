import { safeCause } from "@onepercent/service-kit/safe-cause";
import type { Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY, linkCopy } from "../copy.js";
import { linkTarget } from "../links.js";
import { privateOnly, reply, linkButtons } from "./shared.js";
export async function handleLink(ctx: Context, deps: BotDeps): Promise<void> {
  if (await privateOnly(ctx)) return;
  if (!deps.env.BOT_API_SECRET || !ctx.from) return reply(ctx, COPY.LINK_OFF);
  try {
    const session = await deps.link.createNonce(ctx.from.id, ctx.me.username);
    await reply(
      ctx,
      linkCopy(deps.env.PUBLIC_WEB_URL),
      linkButtons(
        linkTarget(deps.env.PUBLIC_WEB_URL, session.nonce),
        deps.env.PUBLIC_WEB_URL,
      ),
    );
  } catch (error) {
    deps.logger.warn({ cause: safeCause(error) }, "bot link failed");
    await reply(ctx, COPY.LINK_OFF);
  }
}
