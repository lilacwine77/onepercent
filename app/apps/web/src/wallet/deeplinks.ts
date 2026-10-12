import { referralCode } from "@onepercent/eligibility/format";
export function walletLinks(
  target: string,
  origin: string,
  storedRef?: string,
) {
  const page = new URL(target, origin);
  const referral = referralCode(storedRef);
  if (referral) page.searchParams.set("ref", referral);
  target = page.href;
  return {
    phantom: `https://phantom.com/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(origin)}`,
    solflare: `https://solflare.com/ul/v1/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(origin)}`,
  };
}

export function backpackLink(
  target: string,
  origin: string,
  storedRef?: string,
) {
  const page = new URL(target, origin);
  const referral = referralCode(storedRef);
  if (referral) page.searchParams.set("ref", referral);
  return `https://backpack.app/ul/v1/browse/${encodeURIComponent(page.href)}?ref=${encodeURIComponent(new URL(origin).origin)}`;
}
