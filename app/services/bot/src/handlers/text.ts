import type { Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY } from "../copy.js";
import { normalizeXrayInput } from "../referral.js";
import { reply } from "./shared.js";
import { handleXray } from "./xray.js";
export async function handleText(ctx: Context, deps: BotDeps): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const input = normalizeXrayInput(ctx.message?.text ?? "");
  if (input) await handleXray(ctx, deps, input);
  else
    await reply(
      ctx,
      /\.sol$/i.test((ctx.message?.text ?? "").trim())
        ? COPY.XRAY_USAGE
        : COPY.UNKNOWN,
    );
}
