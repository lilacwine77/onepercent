// TODO(packages/copy): move when M3 ships packages/copy.
export const COPY = {
  TITLE: "Link your wallet to Telegram",
  SUB: "One signed message. No transaction, no fees. Read-only.",
  LOADING: "Checking the link…",
  SIGNING: "Waiting for your wallet…",
  REJECTED: "Wallet said no. Nothing was sent.",
  MISMATCH: "That signature didn't match. Send /link to the bot again.",
  EXPIRED:
    "This link expired or was already used. Send /link to the bot again.",
  OFFLINE: "The machine didn't answer. Try again.",
  NO_WALLET: "Open this page in your wallet app.",
  SUCCESS: "Linked. Back to Telegram.",
  OPEN_PHANTOM: "Open in Phantom",
  OPEN_SOLFLARE: "Open in Solflare",
  OPEN_BACKPACK: "Open in Backpack",
  SIGN: "Sign to link",
  BACK: "Back to Telegram",
  RETRY: "Try again",
  connect: (name: string) => `Connect ${name}`,
} as const;
