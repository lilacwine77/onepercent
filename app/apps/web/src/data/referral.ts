import { referralCode } from "@onepercent/eligibility/format";
import { isAddress } from "../routes/router";
export {
  incomingReferral,
  rememberReferral,
  REFERRAL_SESSION_KEY,
} from "../xray/referral";
import { REFERRAL_SESSION_KEY } from "../xray/referral";
export function storedReferral(): string | undefined {
  try {
    return referralCode(sessionStorage.getItem(REFERRAL_SESSION_KEY));
  } catch {
    return undefined;
  }
}
export function ripReferral(buyer: string): string | undefined {
  const code = storedReferral();
  return code && code !== buyer && isAddress(code) ? code : undefined;
}
