import { PACK_EDITIONS } from "../limits.js";
import type { Context } from "grammy";
import type { BotDeps } from "../bot.js";
import { COPY, ripCopy } from "../copy.js";
import { privateOnly, reply, walletButtons } from "./shared.js";
export async function handleRip(ctx: Context, deps: BotDeps): Promise<void> {
  if (await privateOnly(ctx)) return;
  const raw = typeof ctx.match === "string" ? ctx.match.trim() : "";
  const args = raw ? raw.split(/\s+/) : [];
  const edition = PACK_EDITIONS.find(
    (entry) =>
      entry.id === args[0]?.toLowerCase() ||
      entry.code.toLowerCase() === args[0]?.toLowerCase(),
  );
  const n = args[1] === undefined ? 1 : Number(args[1]);
  if (
    raw &&
    (!edition ||
      args.length > 2 ||
      !Number.isSafeInteger(n) ||
      n < 1 ||
      n > edition.maxPerRip ||
      (args[1] !== undefined && !/^[1-9]\d*$/.test(args[1])))
  )
    return reply(ctx, COPY.RIP_USAGE);
  await reply(
    ctx,
    ripCopy(edition, n),
    await walletButtons(
      ctx,
      deps,
      "rip",
      edition ? { edition: edition.id, n } : {},
    ),
  );
}
