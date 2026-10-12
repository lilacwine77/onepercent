import type { XrayResult } from "@onepercent/eligibility/xray-result";
export interface XrayPort {
  get(address: string, options?: { ref?: string }): Promise<XrayResult>;
}
