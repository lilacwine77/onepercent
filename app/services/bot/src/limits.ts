import { BOT_OPS } from "@onepercent/config";
export {
  BOT,
  UI,
  PACK_EDITIONS,
  COVERAGE,
  JACKPOT,
  SEASON,
} from "@onepercent/config";
export const RATE_RULES = {
  update: {
    name: "update",
    limit: BOT_OPS.userLimits.updatesPer60s,
    windowMs: 60_000,
  },
  xray: {
    name: "xray",
    limit: BOT_OPS.userLimits.xraysPer60s,
    windowMs: 60_000,
  },
  link: {
    name: "link",
    limit: BOT_OPS.userLimits.linksPer600s,
    windowMs: 600_000,
  },
  deepLink: {
    name: "deep_link",
    limit: BOT_OPS.userLimits.deepLinkRepliesPer600s,
    windowMs: 600_000,
  },
  group: {
    name: "group",
    limit: BOT_OPS.groupLimits.repliesPer60s,
    windowMs: 60_000,
  },
} as const;
