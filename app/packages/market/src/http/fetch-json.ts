import type { z } from "zod";
import { cancelClockSleep, defaultClock, type Clock } from "../clock.js";
import { MarketError, noopLogger, type MarketLogger } from "../errors.js";
import { MARKET } from "../params.js";
import { rateLimitDelayMs, retryDelayMs } from "./retry.js";
import { HTTP_STATUS } from "./status.js";

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpClient {
  fetchJson<T>(schema: z.ZodType<T>, request: HttpRequest): Promise<T>;
}

export interface CreateHttpClientOptions {
  fetch: typeof fetch;
  clock?: Clock;
  logger?: MarketLogger;
  limiter?: { acquire(): Promise<void> };
  provider: string;
  secrets?: readonly string[];
}

export function createHttpClient(options: CreateHttpClientOptions): HttpClient {
  const clock = options.clock ?? defaultClock;
  const logger = options.logger ?? noopLogger;

  return {
    async fetchJson<T>(schema: z.ZodType<T>, request: HttpRequest): Promise<T> {
      for (let attempt = 0; attempt < MARKET.http.maxAttempts; attempt += 1) {
        await options.limiter?.acquire();
        const controller = new AbortController();
        let active = true;
        let timedOut = false;
        let delay: number | undefined;
        const timeoutWait = clock.sleep(MARKET.http.timeoutMs);
        const timeout = timeoutWait.then(() => {
          if (active) {
            timedOut = true;
            controller.abort();
            throw new MarketError("PROVIDER_TIMEOUT", {
              provider: options.provider,
              retryable: true,
            });
          }
          return new Promise<never>(() => {});
        });
        try {
          const response = await Promise.race([
            options.fetch(request.url, {
              method: request.method ?? "GET",
              ...(request.headers === undefined
                ? {}
                : { headers: request.headers }),
              ...(request.body === undefined ? {} : { body: request.body }),
              signal: controller.signal,
            }),
            timeout,
          ]);
          if (!response.ok) {
            const unauthorized =
              response.status === HTTP_STATUS.unauthorized ||
              response.status === HTTP_STATUS.forbidden;
            const rateLimited = response.status === HTTP_STATUS.tooManyRequests;
            const serverError =
              response.status >= HTTP_STATUS.serverErrorMin &&
              response.status <= HTTP_STATUS.serverErrorMax;
            let routeUnavailable = false;
            if (response.status === HTTP_STATUS.badRequest) {
              const text = await Promise.race([response.text(), timeout]);
              routeUnavailable = /route|quote/i.test(text);
            }
            if (rateLimited) {
              delay = rateLimitDelayMs(
                response.headers.get("x-ratelimit-reset"),
                clock,
              );
            }
            throw new MarketError(
              unauthorized
                ? "PROVIDER_AUTH"
                : rateLimited
                  ? "PROVIDER_RATE_LIMITED"
                  : "PROVIDER_HTTP",
              {
                provider: options.provider,
                status: response.status,
                retryable: rateLimited || serverError,
                routeUnavailable,
              },
            );
          }
          let json: unknown;
          try {
            json = await Promise.race([response.json(), timeout]);
          } catch (error) {
            if (error instanceof MarketError) throw error;
            throw new MarketError("PROVIDER_SCHEMA", {
              provider: options.provider,
            });
          }
          const parsed = schema.safeParse(json);
          if (!parsed.success) {
            throw new MarketError("PROVIDER_SCHEMA", {
              provider: options.provider,
            });
          }
          return parsed.data;
        } catch (error) {
          const marketError = timedOut
            ? new MarketError("PROVIDER_TIMEOUT", {
                provider: options.provider,
                retryable: true,
              })
            : error instanceof MarketError
              ? new MarketError(error.code, {
                  provider: error.provider,
                  status: error.status,
                  retryable: error.retryable,
                  message: error.message,
                  secrets: options.secrets,
                  routeUnavailable: error.routeUnavailable,
                })
              : new MarketError("PROVIDER_HTTP", {
                  provider: options.provider,
                  retryable: true,
                });
          if (!marketError.retryable || attempt + 1 >= MARKET.http.maxAttempts)
            throw marketError;
          active = false;
          cancelClockSleep(timeoutWait);
          delay ??= retryDelayMs(attempt, clock);
          logger.debug(
            {
              provider: options.provider,
              code: marketError.code,
              attempt: attempt + 1,
              delayMs: delay,
            },
            "Retrying provider request",
          );
          await clock.sleep(delay);
        } finally {
          active = false;
          cancelClockSleep(timeoutWait);
        }
      }
      throw new MarketError("PROVIDER_HTTP", { provider: options.provider });
    },
  };
}
