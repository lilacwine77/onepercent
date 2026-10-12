import { COPY } from "../actions/copy.js";
import type { LinkSession } from "./store.js";

export function buildLinkMessage(
  webOrigin: string,
  session: LinkSession,
  address: string,
): string {
  return [
    COPY.signIn(new URL(webOrigin).host),
    address,
    "",
    COPY.linkStatement,
    "",
    `URI: ${webOrigin}/link/${session.nonce}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${session.nonce}`,
    `Issued At: ${session.issuedAt}`,
    `Expiration Time: ${session.expiresAt}`,
  ].join("\n");
}
