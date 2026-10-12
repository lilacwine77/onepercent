import { safeCause } from "@onepercent/service-kit/safe-cause";
import { CARDS_PER_PACK, TOKEN_1PCT } from "@onepercent/config";
import { InlineKeyboard, type Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY, machineText as t } from "../copy.js";
import { PACK_EDITIONS, COVERAGE, JACKPOT, SEASON } from "../limits.js";
import { formatSolReceipt, formatUnits } from "../format.js";
import { reply } from "./shared.js";
// TODO(packages/copy): use its shared formatters after M3.1 lands.
const count = (n: number) => n.toLocaleString("en-US");
const dateUtc = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const timeUtc = (ts: number) =>
  `${new Date(ts * 1000).toISOString().slice(11, 16)} UTC`;
export const countdown = (seconds: number) => {
  if (!Number.isFinite(seconds)) throw new RangeError("Invalid countdown");
  const total = Math.max(0, Math.ceil(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remaining = total % 60;
  return `${days ? `${count(days)}d ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
};
const amount = (raw: string) => {
  const [whole, fraction] = formatUnits(BigInt(raw), TOKEN_1PCT.decimals).split(
    ".",
  );
  return `${BigInt(whole!).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
};
export async function handleMachine(
  ctx: Context,
  deps: BotDeps,
): Promise<void> {
  try {
    if (!deps.machine) throw new Error("machine unavailable");
    const config = await deps.machine.config();
    if (config.phase === null) return reply(ctx, t("bot.machine.setup"));
    const now = Math.floor(deps.clock.now() / 1000);
    const { phase, season } = config;
    if (phase === "Setup" && season.stockUpTs === null)
      return reply(ctx, t("bot.machine.setup"));
    if (phase === "Setup")
      return reply(
        ctx,
        t("bot.machine.stockUpSoon", {
          date: dateUtc(season.stockUpTs!),
          time: timeUtc(season.stockUpTs!),
          countdown: countdown(season.stockUpTs! - now),
        }),
      );
    if (
      ["BuysClosed", "FinalPull", "Done"].includes(phase) ||
      (phase === "OnAir" && season.endTs !== null && now >= season.endTs)
    ) {
      return reply(
        ctx,
        `<b>${t("errors.seasonOver")}</b>${phase === "FinalPull" ? `\n${t("bot.machine.finalPull")}` : ""}`,
      );
    }
    const machine = await deps.machine.machine();
    const vars = { deck: count(machine.deck.len) };
    const buttons = new InlineKeyboard();
    const feedOpen = config.flags.FEED && !config.paused.feed;
    if (
      (phase === "StockUp" || phase === "PoweredOn") &&
      feedOpen &&
      ctx.chat?.type === "private"
    )
      buttons.text(COPY.BUTTON_FEED_MENU, "feed_menu");
    if (phase === "StockUp")
      return reply(
        ctx,
        config.paused.feed
          ? `<b>${t("feed.phase.paused")}</b>`
          : !config.flags.FEED
            ? t("bot.machine.feedClosed")
            : t("bot.machine.stockUp", vars),
        buttons,
      );
    if (phase === "PoweredOn") {
      if (season.onAirTs === null) throw new Error("machine invalid response");
      return reply(
        ctx,
        t("bot.machine.poweredOn", {
          ...vars,
          time: timeUtc(season.onAirTs),
          countdown: countdown(season.onAirTs - now),
        }),
        buttons,
      );
    }
    if (season.endTs === null) throw new Error("machine invalid response");
    const lines = [t("bot.machine.onAir", vars)];
    lines.push(
      !config.flags.PACKS
        ? t("bot.machine.packsClosed")
        : config.paused.rip
          ? t("errors.paused")
          : machine.vrf.busy
            ? t("errors.busy")
            : machine.deck.free < CARDS_PER_PACK.dust + COVERAGE.dustBuffer
              ? t("errors.hungry")
              : t("bot.machine.ripUpTo", {
                  editions: PACK_EDITIONS.map((p) => {
                    const n = machine.coverage.maxQty[p.id];
                    return t(
                      n >= 1 ? "bot.machine.edition" : "bot.machine.refilling",
                      { edition: p.name, n: count(n) },
                    );
                  }).join(" ✳ "),
                }),
    );
    if (BigInt(machine.jackpot.tokens) > 0n) {
      const editions = PACK_EDITIONS.filter(
        (p) =>
          BigInt(machine.jackpot.cost) >=
          BigInt(JACKPOT.minPotPriceMultiple) * p.priceLamports,
      )
        .map((p) => p.name)
        .join(", ");
      const quote = machine.tokenMint
        ? await deps.machine
            .value(machine.tokenMint, machine.jackpot.tokens)
            .catch((error) => {
              deps.logger.warn(
                { cause: safeCause(error) },
                "bot machine value unavailable",
              );
              return null;
            })
        : null;
      const value = quote?.status === "ok";
      lines.push(
        t(
          editions
            ? value
              ? "bot.machine.jackpotValue"
              : "bot.machine.jackpot"
            : value
              ? "bot.machine.jackpotNotLiveValue"
              : "bot.machine.jackpotNotLive",
          {
            amount: amount(machine.jackpot.tokens),
            editions,
            ...(value ? { sol: formatSolReceipt(BigInt(quote.lamports)) } : {}),
          },
        ),
      );
    }
    if (
      machine.onePctLiveIndex !== undefined &&
      machine.onePct?.every((card) => card.releaseTs !== undefined)
    ) {
      const of = count(TOKEN_1PCT.onePctCardCount);
      const live = machine.onePctLiveIndex;
      if (live !== null && live >= 0)
        lines.push(t("bot.machine.onePct.live", { k: count(live + 1), of }));
      else {
        const next = machine.onePct.findIndex(
          (card) => card.state.toLowerCase() === "locked",
        );
        if (next >= 0) {
          const ts = machine.onePct[next]!.releaseTs!;
          lines.push(
            t("bot.machine.onePct.next", {
              k: count(next + 1),
              of,
              date: dateUtc(ts),
              time: timeUtc(ts),
            }),
          );
        } else if (
          machine.onePct.length === TOKEN_1PCT.onePctCardCount &&
          machine.onePct.every((card) => card.state.toLowerCase() === "pulled")
        )
          lines.push(t("bot.machine.onePct.done", { of }));
      }
    }
    if (season.endTs - now <= SEASON.lastCallSeconds)
      lines.push(
        t("bot.machine.lastCall", { countdown: countdown(season.endTs - now) }),
      );
    if (config.flags.PACKS) {
      if (ctx.chat?.type === "private")
        buttons.text(COPY.BUTTON_RIP_MENU, "rip_menu");
      else
        buttons.url(
          COPY.BUTTON_RIP_MENU,
          new URL("/rip", deps.env.PUBLIC_WEB_URL).href,
        );
    }
    await reply(ctx, lines.join("\n"), buttons);
  } catch (error) {
    deps.logger.warn({ cause: safeCause(error) }, "bot machine failed");
    await reply(ctx, t("common.networkError"));
  }
}
