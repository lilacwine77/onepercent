import { warnCause } from "@onepercent/service-kit/safe-cause";
import {
  XrayResultSchema,
  type XrayResult,
} from "@onepercent/eligibility/xray-result";
import { BOT_OPS } from "@onepercent/config";
export interface XrayClient {
  get(input: string, ref?: string): Promise<XrayResult>;
}
export class XrayError extends Error {
  constructor(readonly kind: "usage" | "busy" | "schema") {
    super(kind);
  }
}
export function createXrayClient(apiUrl: string, bearer?: string): XrayClient {
  return {
    async get(input, ref) {
      try {
        const url = new URL(`/api/xray/${encodeURIComponent(input)}`, apiUrl);
        if (ref) url.searchParams.set("ref", ref);
        const response = await fetch(url, {
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
          signal: AbortSignal.timeout(BOT_OPS.apiTimeoutMs),
          redirect: "error",
        });
        if (!response.ok)
          throw new XrayError(
            response.status === 400 || response.status === 404
              ? "usage"
              : "busy",
          );
        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          warnCause("bot_xray_response_invalid", error);
          throw new XrayError("schema");
        }
        const parsed = XrayResultSchema.safeParse(body);
        if (!parsed.success) throw new XrayError("schema");
        return parsed.data;
      } catch (error) {
        if (error instanceof XrayError) throw error;
        warnCause("bot_xray_unavailable", error);
        throw new XrayError("busy");
      }
    },
  };
}
