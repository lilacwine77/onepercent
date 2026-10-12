import { createHash, timingSafeEqual } from "node:crypto";

/** Compare fixed-size digests so token length never affects timingSafeEqual. */
export function bearerMatches(
  header: string | undefined,
  token: string,
): boolean {
  const candidate = /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1] ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const matches = timingSafeEqual(digest(candidate), digest(token));
  return candidate.length > 0 && token.length >= 32 && matches;
}
