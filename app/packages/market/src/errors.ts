import { redact } from "./http/redact.js";

export type MarketErrorCode =
  | "INVALID_INPUT"
  | "PROVIDER_HTTP"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_SCHEMA"
  | "STALE_PRICE"
  | "WIDE_CONFIDENCE"
  | "PRICE_UNAVAILABLE"
  | "NO_ROUTE"
  | "QUOTE_UNAVAILABLE"
  | "EXIT_CAP_UNAVAILABLE";

export interface MarketLogger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export const noopLogger: MarketLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
};

export interface MarketErrorOptions {
  provider?: string;
  status?: number;
  retryable?: boolean;
  message?: string;
  secrets?: readonly string[];
  routeUnavailable?: boolean;
}

export class MarketError extends Error {
  readonly code: MarketErrorCode;
  readonly provider: string | undefined;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly routeUnavailable: boolean;

  constructor(code: MarketErrorCode, options: MarketErrorOptions = {}) {
    super(redact(options.message ?? code, options.secrets));
    this.name = "MarketError";
    this.code = code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.routeUnavailable = options.routeUnavailable ?? false;
  }
}
