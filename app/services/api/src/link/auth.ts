import { createHash, timingSafeEqual } from "node:crypto";

export function isBotAuthorized(
  header: string | undefined,
  secret: string,
): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(supplied), digest(secret));
}
