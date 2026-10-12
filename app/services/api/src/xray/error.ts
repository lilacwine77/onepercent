import { API_MESSAGES } from "@onepercent/eligibility/copy";
import { t } from "@onepercent/copy";
export type XrayErrorCode = keyof typeof API_MESSAGES | "rate_limited";
export class XrayError extends Error {
  constructor(
    public readonly code: XrayErrorCode,
    public readonly status: 400 | 403 | 404 | 422 | 429 | 502 | 504,
    vars?: { s: string },
  ) {
    super(
      code === "rate_limited"
        ? vars
          ? t("xray.error.rate_limited", vars)
          : t("common.networkError")
        : API_MESSAGES[code],
    );
    this.name = "XrayError";
  }
}
