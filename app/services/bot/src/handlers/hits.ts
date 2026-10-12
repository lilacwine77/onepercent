import type { Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY } from "../copy.js";
import { reply } from "./shared.js";
export async function handleHits(ctx: Context, deps: BotDeps): Promise<void> {
  if (!ctx.chat || ctx.chat.type === "private")
    return reply(ctx, COPY.HITS_PRIVATE);
  const anonymous = ctx.senderChat?.id === ctx.chat.id;
  const member =
    !anonymous && ctx.from ? await ctx.getChatMember(ctx.from.id) : null;
  if (
    !anonymous &&
    member?.status !== "creator" &&
    member?.status !== "administrator"
  )
    return reply(ctx, COPY.HITS_NOT_ADMIN);
  const argument = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (argument !== "on" && argument !== "off") return reply(ctx, COPY.UNKNOWN);
  await deps.store.setGroupHits(ctx.chat.id, argument === "on");
  await reply(ctx, argument === "on" ? COPY.HITS_ON : COPY.HITS_OFF);
}
