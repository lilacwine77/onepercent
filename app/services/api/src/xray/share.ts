import { referralCode } from "@onepercent/eligibility/format";
import { SHARE_COPY } from "@onepercent/eligibility/copy";
import type { XrayResult } from "@onepercent/eligibility/xray-result";
export interface ShareOptions {
  ref?: string;
  publicWebUrl: string;
  publicApiUrl: string;
  scannedAt: string;
  bags: number;
  title: string;
}
export function sharePageUrl(
  address: string,
  publicWebUrl: string,
  ref?: string,
): string {
  const url = new URL(`/x/${address}`, publicWebUrl);
  url.searchParams.set("ref", referralCode(ref) ?? address);
  return url.href;
}
export function buildShareLinks(
  address: string,
  options: ShareOptions,
): XrayResult["share"] {
  const image = (format: string) => {
    const url = new URL(`/api/xray/${address}/card.png`, options.publicApiUrl);
    url.searchParams.set("format", format);
    url.searchParams.set(
      "v",
      String(Math.floor(Date.parse(options.scannedAt) / 1000)),
    );
    url.searchParams.set("ref", referralCode(options.ref) ?? address);
    return url.href;
  };
  const intent = new URL("https://x.com/intent/post");
  intent.searchParams.set(
    "text",
    SHARE_COPY.intent(options.bags, options.title),
  );
  intent.searchParams.set(
    "url",
    sharePageUrl(address, options.publicWebUrl, options.ref),
  );
  return {
    landscapeUrl: image("landscape"),
    squareUrl: image("square"),
    xIntentUrl: intent.href,
  };
}
