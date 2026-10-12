import { referralCode } from "@onepercent/eligibility/format";

// TODO(config): import PACK_EDITIONS when M3 adds web's workspace dependency.
// M5 §6.2 only needs the edition identifiers, never prices or transaction limits.
export const GO_EDITION_IDS = [
  "original",
  "blue_shift",
  "signature",
  "after_hours",
] as const;

export function resolveGoTarget(target: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(target, origin);
  } catch {
    return null;
  }
  if (
    url.origin !== origin ||
    !["/feed", "/rip", "/cards"].includes(url.pathname)
  ) {
    return null;
  }
  for (const [key, value] of url.searchParams) {
    if (key === "ref" && referralCode(value)) continue;
    if (key === "edition" && GO_EDITION_IDS.some((id) => id === value))
      continue;
    if (key === "n" && /^(?:[1-9]|10)$/.test(value)) continue;
    return null;
  }
  return url.href;
}
