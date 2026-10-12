import { useCallback, useEffect, useRef, useState } from "react";
import {
  XrayResultSchema,
  type XrayResult,
} from "@onepercent/eligibility/xray-result";
import { API_MESSAGES } from "@onepercent/eligibility/copy";
import { referralCode } from "@onepercent/eligibility/format";
import { t, count, type CopyKey } from "@onepercent/copy/initial";
import { beacon } from "../analytics/client";
import { strings } from "./strings";
// X1's server deadline is 10 seconds; allow two seconds for transport and rendering.
export const XRAY_REQUEST_TIMEOUT_MS = 12_000;
export type XrayState =
  | { status: "idle" | "loading" | "challenge" }
  | { status: "error"; message: string }
  | { status: "done"; result: XrayResult };
const simpleErrors = new Set<CopyKey>([
  "xray.error.evm_not_supported",
  "xray.error.invalid_address",
  "xray.error.name_not_found",
  "xray.error.name_resolution_failed",
  "xray.error.scan_timeout",
  "xray.error.upstream_failed",
  "xray.error.prices_unavailable",
  "xray.error.turnstile_required",
  "xray.error.not_in_fixtures",
  "xray.error.invalid_format",
  "xray.error.invalid_response",
  "xray.error.unavailable",
]);
function message(body: unknown, response: Response) {
  const code =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : "unavailable";
  if (code === "wallet_too_large") return API_MESSAGES.wallet_too_large;
  if (code === "rate_limited") {
    const delay = Number(response.headers.get("Retry-After"));
    return t("xray.error.rate_limited", {
      s: count(Number.isFinite(delay) ? Math.max(0, Math.ceil(delay)) : 0),
    });
  }
  const key = `xray.error.${code}` as CopyKey;
  return simpleErrors.has(key)
    ? t(key as "xray.error.unavailable")
    : strings.error;
}
export function useXray(input: string, referral?: string) {
  const ref = referralCode(referral);
  const [state, setState] = useState<XrayState>({ status: "idle" });
  const retry = useRef<(token: string) => void>(() => {});
  useEffect(() => {
    if (!input) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    let retried = false;
    let disposed = false;
    async function scan(token?: string) {
      setState({ status: "loading" });
      const timeout = setTimeout(() => {
        if (!disposed) {
          setState({ status: "error", message: t("xray.error.scan_timeout") });
          controller.abort();
        }
      }, XRAY_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(
          `/api/xray/${encodeURIComponent(input)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
          {
            signal: controller.signal,
            ...(token ? { headers: { "cf-turnstile-response": token } } : {}),
          },
        );
        const body: unknown = await response.json().catch(() => undefined);
        if (controller.signal.aborted) return;
        if (
          response.status === 403 &&
          !retried &&
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          body.error === "turnstile_required"
        ) {
          setState({ status: "challenge" });
          return;
        }
        if (!response.ok) {
          setState({ status: "error", message: message(body, response) });
          return;
        }
        const parsed = XrayResultSchema.safeParse(body);
        setState(
          parsed.success
            ? { status: "done", result: parsed.data }
            : { status: "error", message: strings.error },
        );
        if (parsed.success)
          beacon({ event: "xray_submit", cached: parsed.data.cached });
      } catch {
        if (!controller.signal.aborted)
          setState({ status: "error", message: strings.error });
      } finally {
        clearTimeout(timeout);
      }
    }
    retry.current = (token) => {
      if (!retried && !controller.signal.aborted) {
        retried = true;
        void scan(token);
      }
    };
    void scan();
    return () => {
      disposed = true;
      controller.abort();
      retry.current = () => {};
    };
  }, [input, ref]);
  const submitToken = useCallback((token: string) => retry.current(token), []);
  const challengeError = useCallback(
    () =>
      setState({
        status: "error",
        message: t("xray.error.turnstile_required"),
      }),
    [],
  );
  return { state, submitToken, challengeError };
}
