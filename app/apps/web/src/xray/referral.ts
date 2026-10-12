import { referralCode } from "@onepercent/eligibility/format";

export const REFERRAL_SESSION_KEY = "onepercent.referral";

export function incomingReferral(search: string): string | undefined {
  return referralCode(new URLSearchParams(search).get("ref"));
}

export function rememberReferral(code: string | undefined): void {
  if (!code) return;
  try {
    if (!referralCode(window.sessionStorage.getItem(REFERRAL_SESSION_KEY))) {
      window.sessionStorage.setItem(REFERRAL_SESSION_KEY, code);
    }
  } catch {
    // A blocked session store must never prevent a read-only scan.
  }
}

export function xrayPageUrl(address: string, ref?: string): string {
  const page = new URL(
    `/x/${encodeURIComponent(address)}`,
    window.location.origin,
  );
  page.searchParams.set("ref", referralCode(ref) ?? address);
  return page.href;
}
