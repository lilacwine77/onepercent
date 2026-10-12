// TODO(packages/copy): move when M3 ships packages/copy
import {
  CARDS_PER_PACK,
  PACK_SPLIT_BPS,
  type PackEdition,
} from "@onepercent/config";
import {
  escapeHtml as e,
  formatSol,
  formatSolDisplay,
  sanitizeTicker,
  shortAddress,
} from "./format.js";
import { BOT, PACK_EDITIONS } from "./limits.js";
import type { AlertMode } from "./store.js";
import type { XrayResult } from "@onepercent/eligibility/xray-result";
export const COPY_KEYS = {
  "xray.linePrefix": "X-ray: {who}",
  "xray.seg.bags.one": "1 bag",
  "xray.seg.bags.other": "{n} bags",
  "xray.seg.feedable": "{n} feedable",
  "xray.seg.checkAtFeed": "{n} to check at Feed",
  "xray.seg.bid.one": "1 has a bid ≈{sol} SOL est.",
  "xray.seg.bid.other": "{n} have a bid ≈{sol} SOL est.",
  "xray.seg.empty.one": "1 empty account ≈{sol} SOL rent back",
  "xray.seg.empty.other": "{n} empty accounts ≈{sol} SOL rent back",
  "xray.worst": "Worst: {ticker} {pct} from ATH",
  "bot.xray.clean":
    "<b>X-ray: {who}</b>\nThat wallet’s clean. Nothing to X-ray. Mint condition.",
  "bot.feed":
    "<b>Feed the machine.</b>\nEach bag becomes a Dust Card ✳ {min}–{max} SOL to you when it’s pulled.\nTake it back any time before it’s pulled.\n{footer}",
  "bot.rip.all":
    "<b>Rip a pack.</b>\n{editions}\n{dust} Dust Cards + {hit} hit per pack. Real tokens inside.\n{footer}",
  "bot.rip.editionPrice": "{edition} {price} SOL",
  "bot.rip.one.one":
    "<b>{edition} ✳ {price} SOL</b>\nRip 1 pack in your wallet. The page shows the odds before you sign.\n{footer}",
  "bot.rip.one.other":
    "<b>{edition} ✳ {price} SOL</b>\nRip {n} packs in your wallet. The page shows the odds before you sign.\n{footer}",
  "bot.link":
    "<b>Link a wallet.</b>\nOpens {host} in your wallet to sign one message. No transaction, no fees.\nRead-only: I can show your cards and send the alerts you turn on.\nWorks once, for {minutes} minutes. Don’t forward it.",
  "bot.me.placeholder":
    "<b>Linked: {short}</b>\nOpen My cards to see your cards.\nAlerts: {mode} ✳ /alerts to switch.",
  "bot.alerts.mode.off": "off",
  "bot.alerts.mode.live": "on",
  "bot.alerts.mode.daily": "daily",
  "bot.alerts.on":
    "<b>Alerts on.</b> Royalties for {short}, when your cards are pulled.\n/alerts off to stop.",
  "bot.rateLimited": "One at a time. Try again in {s} s.",
  "bot.royalty.one":
    "<b>+{sol} SOL.</b> Your {ticker} card was pulled.\nPaid to {short}.",
  "bot.hit.stock":
    "<b>{tier} {mult}</b> ✳ {buyer} ripped {anEdition} ✳ stocked at {sol} SOL",
  "bot.hit.jackpot":
    "<b>Jackpot</b> ✳ {buyer} pulled {amount} $1PCT from {anEdition} pack",
  "bot.hit.onePct":
    "✨ <b>The 1%.</b> {buyer} pulled {amount} $1PCT from {anEdition} pack.",
  "bot.unlink.done":
    "<b>Unlinked.</b> This chat no longer knows {short}. Alerts are off.",
  "bot.description":
    "1% Machine. Send /xray and a Solana wallet address to X-ray it. Feed and Rip links open {host} inside your wallet, where you sign. I never ask for a seed phrase or a private key. Admins never DM first.",
  "bot.start":
    "<b>1% Machine.</b>\nSend /xray and any Solana wallet address. No connection, no keys.\nDust in, Packs out.",
  "bot.startGroup":
    "<b>1% Machine.</b> Send /xray and a Solana wallet address.",
  "bot.xray.usage": "Send /xray and a Solana wallet address.",
  "xray.error.evm_not_supported": "Solana wallets only for now.",
  "bot.xray.busy": "The X-ray is busy. Try again in a minute.",
  "bot.footer": "You sign everything in your own wallet. No keys, ever.",
  "bot.rip.usage":
    "Editions: og, bs, sg, ah. Packs: 1 to {maxPacks}, or 1 to {maxPacksAh} for ah. Example: /rip ah 5",
  "bot.linkOff": "Linking is off right now.",
  "bot.me.none":
    "<b>No wallet linked.</b>\nSend /link to link one. Read-only, one signed message.",
  "bot.alerts.off": "<b>Alerts off.</b> I won’t message you.",
  "bot.alerts.needLink": "Link a wallet first: /link.",
  "bot.hits.on":
    "<b>Hit posts on.</b> Holo Foil and up. Posts aren’t live yet.",
  "bot.hits.off": "<b>Hit posts off.</b>",
  "bot.hits.notAdmin": "Only group admins can switch hit posts.",
  "bot.hits.private":
    "Hit posts are for groups. Add me to one and send /hits on.",
  "bot.privateOnly": "Ask me in a private chat.",
  "bot.unknown": "I know /xray, /machine, /feed, /rip, /link, /me and /alerts.",
  "bot.secretGuard":
    "<b>Deleted.</b> That looked like the words or numbers that unlock a wallet. I kept nothing.\nNobody at Onepercent will ever ask for them.\nIf it was real, move your funds to a new wallet now.",
  "bot.button.xray": "X-ray a wallet",
  "bot.button.how": "How it works",
  "bot.button.share": "Share X-ray",
  "bot.button.feed.phantom": "Feed in Phantom",
  "bot.button.feed.solflare": "Feed in Solflare",
  "bot.button.feed.backpack": "Feed in Backpack",
  "bot.button.rip.phantom": "Rip in Phantom",
  "bot.button.rip.solflare": "Rip in Solflare",
  "bot.button.rip.backpack": "Rip in Backpack",
  "bot.button.link.phantom": "Link in Phantom",
  "bot.button.link.solflare": "Link in Solflare",
  "bot.button.link.backpack": "Link in Backpack",
  "bot.button.cards.phantom": "My cards in Phantom",
  "bot.button.cards.solflare": "My cards in Solflare",
  "bot.button.cards.backpack": "My cards in Backpack",
  "bot.button.feedMenu": "Feed my bags",
  "bot.button.ripMenu": "Rip a pack",
  "bot.button.samePack": "Rip the same pack",
  "bot.alerts.fromOnAir": "Alerts aren’t live yet.",
  "bot.shortDescription":
    "X-ray any Solana wallet. Feed bags, rip packs. You sign in your own wallet. No keys, ever.",
  "bot.command.start": "Meet the machine",
  "bot.command.xray": "X-ray a wallet",
  "bot.command.machine": "See the machine",
  "bot.command.feed": "Feed the machine",
  "bot.command.rip": "Rip a pack",
  "bot.command.link": "Link a wallet",
  "bot.command.unlink": "Unlink your wallet",
  "bot.command.me": "Show my wallet",
  "bot.command.alerts": "Switch royalty alerts",
  "bot.command.hits": "Switch group hit posts",
} as const;
export function botText(
  key: keyof typeof COPY_KEYS,
  vars: Record<string, string> = {},
): string {
  return COPY_KEYS[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    e(vars[name] ?? ""),
  );
}
export const COPY = {
  START: botText("bot.start"),
  START_GROUP: botText("bot.startGroup"),
  XRAY_USAGE: botText("bot.xray.usage"),
  SOLANA_ONLY: botText("xray.error.evm_not_supported"),
  XRAY_BUSY: botText("bot.xray.busy"),
  FOOTER: botText("bot.footer"),
  LINK_OFF: botText("bot.linkOff"),
  ME_NONE: botText("bot.me.none"),
  ALERTS_OFF: botText("bot.alerts.off"),
  ALERTS_NEED_LINK: botText("bot.alerts.needLink"),
  HITS_ON: botText("bot.hits.on"),
  HITS_OFF: botText("bot.hits.off"),
  HITS_NOT_ADMIN: botText("bot.hits.notAdmin"),
  HITS_PRIVATE: botText("bot.hits.private"),
  PRIVATE_ONLY: botText("bot.privateOnly"),
  UNKNOWN: botText("bot.unknown"),
  SECRET_GUARD: botText("bot.secretGuard"),
  BUTTON_XRAY: botText("bot.button.xray"),
  BUTTON_HOW: botText("bot.button.how"),
  BUTTON_SHARE: botText("bot.button.share"),
  BUTTON_FEED_PHANTOM: botText("bot.button.feed.phantom"),
  BUTTON_FEED_SOLFLARE: botText("bot.button.feed.solflare"),
  BUTTON_FEED_BACKPACK: botText("bot.button.feed.backpack"),
  BUTTON_RIP_PHANTOM: botText("bot.button.rip.phantom"),
  BUTTON_RIP_SOLFLARE: botText("bot.button.rip.solflare"),
  BUTTON_RIP_BACKPACK: botText("bot.button.rip.backpack"),
  BUTTON_LINK_PHANTOM: botText("bot.button.link.phantom"),
  BUTTON_LINK_SOLFLARE: botText("bot.button.link.solflare"),
  BUTTON_LINK_BACKPACK: botText("bot.button.link.backpack"),
  BUTTON_SAME_PACK: botText("bot.button.samePack"),
  BUTTON_FEED_MENU: botText("bot.button.feedMenu"),
  BUTTON_RIP_MENU: botText("bot.button.ripMenu"),
  BUTTON_CARDS_PHANTOM: botText("bot.button.cards.phantom"),
  BUTTON_CARDS_SOLFLARE: botText("bot.button.cards.solflare"),
  BUTTON_CARDS_BACKPACK: botText("bot.button.cards.backpack"),
  ALERTS_FROM_ON_AIR: botText("bot.alerts.fromOnAir"),
  SHORT_DESCRIPTION: botText("bot.shortDescription"),
  RIP_USAGE: botText("bot.rip.usage", {
    maxPacks: String(Math.max(...PACK_EDITIONS.map((p) => p.maxPerRip))),
    maxPacksAh: String(PACK_EDITIONS[3].maxPerRip),
  }),
  COMMANDS: {
    start: botText("bot.command.start"),
    xray: botText("bot.command.xray"),
    machine: botText("bot.command.machine"),
    feed: botText("bot.command.feed"),
    rip: botText("bot.command.rip"),
    link: botText("bot.command.link"),
    unlink: botText("bot.command.unlink"),
    me: botText("bot.command.me"),
    alerts: botText("bot.command.alerts"),
    hits: botText("bot.command.hits"),
  },
};
const count = (value: number) => value.toLocaleString("en-US");
export function xrayCopy(result: XrayResult, _input?: string): string {
  void _input;
  const who = shortAddress(result.address);
  const title = `<b>${botText("xray.linePrefix", { who })}</b>`;
  const c = result.counts;
  if (!c.bags && !c.empty) return botText("bot.xray.clean", { who });
  const segments = [
    c.bags &&
      botText(c.bags === 1 ? "xray.seg.bags.one" : "xray.seg.bags.other", {
        n: count(c.bags),
      }),
    c.feedable && botText("xray.seg.feedable", { n: count(c.feedable) }),
    c.checkAtFeed &&
      botText("xray.seg.checkAtFeed", { n: count(c.checkAtFeed) }),
    c.sellable &&
      botText(c.sellable === 1 ? "xray.seg.bid.one" : "xray.seg.bid.other", {
        n: count(c.sellable),
        sol: formatSolDisplay(result.totals.sellValueSol),
      }),
  ].filter(Boolean);
  return [
    title,
    segments.length && segments.join(" ✳ "),
    c.empty &&
      botText(c.empty === 1 ? "xray.seg.empty.one" : "xray.seg.empty.other", {
        n: count(c.empty),
        sol: formatSolDisplay(result.totals.rentBackSol),
      }),
    result.worst &&
      botText("xray.worst", {
        ticker: `$${sanitizeTicker(result.worst.symbol)}`,
        pct: `−${result.worst.drawdownPct.toFixed(1)}%`,
      }),
    // The card's title (its badge), on its own: no condition grade (declutter).
    e(result.card.title.replace(/[\r\n]+/g, " ")),
    COPY.FOOTER,
  ]
    .filter(Boolean)
    .join("\n");
}
export function feedCopy(): string {
  const royalties = PACK_EDITIONS.map(
    (p) =>
      (p.priceLamports * BigInt(PACK_SPLIT_BPS.royaltyPerDustCard)) / 10_000n,
  );
  const min = royalties.reduce((a, b) => (a < b ? a : b)),
    max = royalties.reduce((a, b) => (a > b ? a : b));
  return botText("bot.feed", {
    min: formatSol(min),
    max: formatSol(max),
    footer: COPY.FOOTER,
  });
}
export function ripCopy(edition?: PackEdition, n = 1): string {
  if (edition)
    return botText(n === 1 ? "bot.rip.one.one" : "bot.rip.one.other", {
      edition: edition.name,
      price: formatSol(edition.priceLamports),
      n: count(n),
      footer: COPY.FOOTER,
    });
  return botText("bot.rip.all", {
    editions: PACK_EDITIONS.map((p) =>
      botText("bot.rip.editionPrice", {
        edition: p.name,
        price: formatSol(p.priceLamports),
      }),
    ).join(" ✳ "),
    dust: count(CARDS_PER_PACK.dust),
    hit: count(CARDS_PER_PACK.hit),
    footer: COPY.FOOTER,
  });
}
export function linkCopy(webUrl: string): string {
  return botText("bot.link", {
    host: new URL(webUrl).host,
    minutes: count(BOT.sessionTtlSeconds / 60),
  });
}
export function meCopy(wallet: string, alerts: AlertMode): string {
  return botText("bot.me.placeholder", {
    short: shortAddress(wallet),
    mode: botText(`bot.alerts.mode.${alerts}`),
  });
}
export function alertsCopy(wallet: string, mode: AlertMode): string {
  return mode === "live"
    ? botText("bot.alerts.on", { short: shortAddress(wallet) })
    : COPY.ALERTS_OFF;
}
export function rateLimitedCopy(seconds: number): string {
  return botText("bot.rateLimited", { s: count(seconds) });
}
export function royaltyCopy(
  sol: string,
  ticker: string,
  address: string,
): string {
  return botText("bot.royalty.one", {
    sol,
    ticker: `$${ticker}`,
    short: address,
  });
}
export function hitCopy(
  label: string,
  multiplier: string,
  buyer: string,
  article: string,
  edition: string,
  sol: string,
): string {
  return botText("bot.hit.stock", {
    tier: label,
    mult: `${multiplier}×`,
    buyer,
    anEdition: `${article ? `${article} ` : ""}${edition}`,
    sol,
  });
}
export function jackpotCopy(
  buyer: string,
  amount: string,
  article: string,
  edition: string,
): string {
  return botText("bot.hit.jackpot", {
    buyer,
    amount,
    anEdition: `${article ? `${article} ` : ""}${edition}`,
  });
}
export function onePctCopy(
  buyer: string,
  amount: string,
  article: string,
  edition: string,
): string {
  return botText("bot.hit.onePct", {
    buyer,
    amount,
    anEdition: `${article ? `${article} ` : ""}${edition}`,
  });
}
export function unlinkCopy(wallet: string): string {
  return botText("bot.unlink.done", { short: shortAddress(wallet) });
}
export function descriptionCopy(host: string): string {
  return botText("bot.description", { host });
}
export const MACHINE_COPY = {
  "common.networkError": "The machine didn’t answer. Try again.",
  "feed.phase.paused": "Feed is paused for now ✳ take-back still works",
  "errors.seasonOver": "Season over ✳ Redeem and take-back stay open forever",
  "errors.paused": "Paused for now. Every exit still works.",
  "errors.busy": "Machine busy ✳ try again in a few seconds.",
  "errors.hungry": "Machine hungry ✳ Feed bags or feed back your dust",
  "bot.machine.setup":
    "<b>The machine is warming up.</b>\nSend /xray and a wallet address to see what you could feed.",
  "bot.machine.stockUpSoon":
    "<b>Feed opens at Stock-Up.</b>\n{date} {time} ✳ in {countdown}.\nSend /xray to see what you could feed.",
  "bot.machine.stockUp":
    "<b>Stock-Up ✳ Feed is open.</b>\n{deck} cards in the Deck ✳ packs open at On Air.",
  "bot.machine.feedClosed": "<b>Stock-Up.</b> Feed is not open yet.",
  "bot.machine.poweredOn":
    "<b>Powered on ✳ On Air at {time}.</b>\nIn {countdown} ✳ {deck} cards in the Deck.",
  "bot.machine.onAir": "<b>On Air ✳ {deck} cards in the Deck</b>",
  "bot.machine.packsClosed": "Packs are not open yet.",
  "bot.machine.ripUpTo": "Rip up to: {editions}",
  "bot.machine.edition": "{edition} {n}",
  "bot.machine.refilling": "{edition} refilling",
  "bot.machine.jackpot": "Jackpot {amount} $1PCT ✳ live in {editions}",
  "bot.machine.jackpotValue":
    "Jackpot {amount} $1PCT ≈{sol} SOL if sold now ✳ live in {editions}",
  "bot.machine.jackpotNotLive": "Jackpot {amount} $1PCT ✳ not live yet",
  "bot.machine.jackpotNotLiveValue":
    "Jackpot {amount} $1PCT ≈{sol} SOL if sold now ✳ not live yet",
  "bot.machine.onePct.live": "The 1% ✳ card {k} of {of} live",
  "bot.machine.onePct.next": "The 1% ✳ card {k} of {of} from {date} {time}",
  "bot.machine.onePct.done": "The 1% ✳ all {of} pulled",
  "bot.machine.lastCall": "Last Call ✳ buys close in {countdown}",
  "bot.machine.finalPull":
    "The Final Pull is open ✳ openers claim their share in My cards.",
} as const;
export function machineText(
  key: keyof typeof MACHINE_COPY,
  vars: Record<string, string> = {},
): string {
  return MACHINE_COPY[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    e(vars[name] ?? ""),
  );
}
