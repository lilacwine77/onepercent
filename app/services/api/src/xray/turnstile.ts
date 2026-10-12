import { warnCause } from "@onepercent/service-kit";
import { WEB } from "@onepercent/config";
import { isIP } from "node:net";
import { API_LOGS } from "@onepercent/eligibility/copy";
export interface TurnstileVerifier {
  verify(token: string | undefined, ip: string): Promise<boolean>;
}
export interface XrayLogger {
  debug(data: Record<string, unknown>, message: string): void;
  info(data: Record<string, unknown>, message: string): void;
}
export class NoopTurnstileVerifier implements TurnstileVerifier {
  constructor(private readonly logger?: XrayLogger) {}
  async verify(): Promise<boolean> {
    this.logger?.debug({}, API_LOGS.noopTurnstile);
    return true;
  }
}

/** Real verifier; only fixtures use NoopTurnstileVerifier. */
export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  private readonly hostname: string;
  constructor(
    private readonly secret: string,
    webOrigin: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.hostname = new URL(webOrigin).hostname.toLowerCase();
  }
  async verify(token: string | undefined, ip: string): Promise<boolean> {
    if (!token || token.length > WEB.turnstileTokenMaxLength) return false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.fetcher(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                secret: this.secret,
                response: token,
                ...(isIP(ip) ? { remoteip: ip } : {}),
              }),
              signal: controller.signal,
            },
          );
          const result: unknown = await response.json();
          return (
            response.ok &&
            typeof result === "object" &&
            result !== null &&
            "success" in result &&
            result.success === true &&
            "hostname" in result &&
            typeof result.hostname === "string" &&
            result.hostname.toLowerCase() === this.hostname
          );
        })(),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(false);
          }, WEB.turnstileTimeoutMs);
        }),
      ]);
    } catch (error) {
      warnCause("turnstile_unavailable", error);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
