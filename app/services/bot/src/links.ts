import type { PackEdition } from "@onepercent/config";
import type { ReferralCode } from "./referral.js";

export function walletLinks(target: string, webUrl: string) {
  const ref = encodeURIComponent(new URL(webUrl).origin);
  return {
    phantom: `https://phantom.com/ul/browse/${encodeURIComponent(target)}?ref=${ref}`,
    solflare: `https://solflare.com/ul/v1/browse/${encodeURIComponent(target)}?ref=${ref}`,
    backpack: `https://backpack.app/ul/v1/browse/${encodeURIComponent(target)}?ref=${ref}`,
  };
}
export function feedTarget(webUrl: string, ref?: ReferralCode | null): string {
  const url = new URL("/feed", webUrl);
  if (ref) url.searchParams.set("ref", ref);
  return url.href;
}
export function packsTarget(
  webUrl: string,
  edition?: PackEdition["id"],
  n?: number,
  ref?: ReferralCode | null,
): string {
  const url = new URL("/rip", webUrl);
  if (edition) url.searchParams.set("edition", edition);
  if (n !== undefined) url.searchParams.set("n", String(n));
  if (ref) url.searchParams.set("ref", ref);
  return url.href;
}
export function linkTarget(webUrl: string, nonce: string): string {
  return new URL(`/link/${nonce}`, webUrl).href;
}
