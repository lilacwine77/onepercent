import { safeCause } from "@onepercent/service-kit/safe-cause";
import { InlineKeyboard, type Context } from "grammy";
import { COPY } from "../copy.js";
import { feedTarget, packsTarget, walletLinks } from "../links.js";
import type { BotDeps } from "../bot.js";
export async function reply(
  ctx: Context,
  text: string,
  reply_markup?: InlineKeyboard,
): Promise<void> {
  await ctx.reply(text, {
    parse_mode: "HTML",
    ...(reply_markup ? { reply_markup } : {}),
  });
}
export function linkButtons(target: string, webUrl: string): InlineKeyboard {
  const links = walletLinks(target, webUrl);
  return new InlineKeyboard()
    .url(COPY.BUTTON_LINK_PHANTOM, links.phantom)
    .row()
    .url(COPY.BUTTON_LINK_SOLFLARE, links.solflare)
    .row()
    .url(COPY.BUTTON_LINK_BACKPACK, links.backpack);
}
export async function referral(ctx: Context, deps: BotDeps) {
  return ctx.chat?.type === "private" && ctx.from
    ? deps.store.getPendingReferral(ctx.from.id)
    : null;
}
export async function privateOnly(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type === "private") return false;
  await reply(ctx, COPY.PRIVATE_ONLY);
  return true;
}

const fallbackLogTimes = new WeakMap<BotDeps, number>();
export async function walletButtons(
  ctx: Context,
  deps: BotDeps,
  action: "feed" | "rip" | "cards",
  params: {
    edition?: import("@onepercent/config").PackEdition["id"];
    n?: number;
  } = {},
): Promise<InlineKeyboard> {
  if (ctx.chat?.type !== "private" || !ctx.from)
    throw new Error("private only");
  const targetFor = (ref: Awaited<ReturnType<typeof referral>>) =>
    action === "feed"
      ? feedTarget(deps.env.PUBLIC_WEB_URL, ref)
      : action === "rip"
        ? packsTarget(deps.env.PUBLIC_WEB_URL, params.edition, params.n, ref)
        : new URL("/cards", deps.env.PUBLIC_WEB_URL).href;
  let targets = Array<string>(3).fill(targetFor(null));
  try {
    const ref = await referral(ctx, deps);
    targets = Array<string>(3).fill(targetFor(ref));
    if (!deps.env.BOT_API_SECRET || !deps.go) throw new Error("go unavailable");
    const sessions = await deps.go.create(
      {
        telegramUserId: ctx.from.id,
        action,
        ...params,
        ...(action !== "cards" && ref ? { ref } : {}),
      },
      3,
    );
    if (
      sessions.length !== 3 ||
      new Set(sessions.map((session) => session.id)).size !== 3
    )
      throw new Error("go sessions invalid");
    targets = sessions.map(
      (session) => new URL(`/go/${session.id}`, deps.env.PUBLIC_WEB_URL).href,
    );
  } catch (error) {
    const now = deps.clock.now();
    if (now - (fallbackLogTimes.get(deps) ?? -Infinity) >= 60_000) {
      deps.logger.warn({ cause: safeCause(error) }, "go_fallback");
      fallbackLogTimes.set(deps, now);
    }
  }
  const first = walletLinks(targets[0]!, deps.env.PUBLIC_WEB_URL).phantom;
  const second = walletLinks(targets[1]!, deps.env.PUBLIC_WEB_URL).solflare;
  const third = walletLinks(targets[2]!, deps.env.PUBLIC_WEB_URL).backpack;
  const labels = {
    feed: [
      COPY.BUTTON_FEED_PHANTOM,
      COPY.BUTTON_FEED_SOLFLARE,
      COPY.BUTTON_FEED_BACKPACK,
    ],
    rip: [
      COPY.BUTTON_RIP_PHANTOM,
      COPY.BUTTON_RIP_SOLFLARE,
      COPY.BUTTON_RIP_BACKPACK,
    ],
    cards: [
      COPY.BUTTON_CARDS_PHANTOM,
      COPY.BUTTON_CARDS_SOLFLARE,
      COPY.BUTTON_CARDS_BACKPACK,
    ],
  };
  return new InlineKeyboard()
    .url(labels[action][0]!, first)
    .row()
    .url(labels[action][1]!, second)
    .row()
    .url(labels[action][2]!, third);
}
