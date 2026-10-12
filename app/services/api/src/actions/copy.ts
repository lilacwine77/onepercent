// TODO(packages/copy): use these canonical keys when the Bot/Blinks issue ships.
export const COPY_KEYS = {
  "blink.off": "This Blink is off right now.",
  "blink.badRequest": "That request isn’t valid.",
  "common.notFound": "Nothing here. The machine is this way.",
  "common.networkError": "The machine didn’t answer. Try again.",
  "xray.error.invalid_address": "That’s not a Solana wallet address.",
  "xray.error.name_not_found": "No wallet uses that name. Paste the address.",
  "errors.rateLimited": (s: number) =>
    `Too many requests from here. Try again in ${s} s.`,
  "blink.xray.genericTitle": "X-ray any wallet",
  "blink.xray.genericDescription":
    "Bags, bids and rent back for any Solana wallet. No connection, no keys.",
  "bot.xray.busy": "The X-ray is busy. Try again in a minute.",
  "xray.cta.yours": "X-ray your wallet",
} as const;
// X3 adapters preserve its public helper interface and SIWS bytes.
export const COPY = {
  off: COPY_KEYS["blink.off"],
  badRequest: COPY_KEYS["blink.badRequest"],
  actionNotFound: COPY_KEYS["common.notFound"],
  networkError: COPY_KEYS["common.networkError"],
  actionInvalidAddress: COPY_KEYS["xray.error.invalid_address"],
  nameNotFound: COPY_KEYS["xray.error.name_not_found"],
  actionRateLimited: COPY_KEYS["errors.rateLimited"],
  xrayTitle: COPY_KEYS["blink.xray.genericTitle"],
  xrayDescription: COPY_KEYS["blink.xray.genericDescription"],
  xrayClean: "That wallet’s clean. Nothing to X-ray. Mint condition.",
  emptyAccounts: (count: number, sol: string) =>
    `${count} empty ${count === 1 ? "account" : "accounts"} ≈${sol} SOL rent back`,
  xrayLabel: COPY_KEYS["xray.cta.yours"],
  xrayBusy: COPY_KEYS["bot.xray.busy"],
  notFound: "Not found.",
  invalidRequest: "Invalid request.",
  unavailable: "The machine didn't answer. Try again.",
  unauthorized: "Unauthorized.",
  linkDisabled: "Linking is off right now.",
  linkExpired: "This link expired or was already used.",
  mismatch: "That signature didn't match.",
  rateLimited: "Too many requests. Try again later.",
  linkStatement:
    "Link this wallet to the 1% Machine Telegram bot. Read-only. No transaction, no fees.",
  signIn: (host: string) =>
    `${host} wants you to sign in with your Solana account:`,
  xrayFor: (who: string) => `X-ray: ${who}`,
  bags: (count: number) => `${count} ${count === 1 ? "bag" : "bags"}`,
  checkAtFeed: (count: number) => `${count} to check at Feed`,
  feedable: (count: number) => `${count} feedable`,
  bids: (count: number, sol: string) =>
    `${count} ${count === 1 ? "has" : "have"} a bid ≈${sol} SOL est.`,
} as const;
