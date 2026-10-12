import { WEB } from "@onepercent/config/web";
import type { z } from "zod";
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
  ) {
    super(code);
  }
}
// Same origin is required by the CSP. Vite proxies to the local API in development.
export async function api<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const stop = (error: Error) => {
    // Settle our reason first: a transport may replace it with AbortError.
    rejectAbort(error);
    controller.abort(error);
  };
  const abort = () => stop(new DOMException("Aborted", "AbortError"));
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error("Network request timed out");
    error.name = "TimeoutError";
    stop(error);
  }, WEB.httpTimeoutMs);
  if (options.signal?.aborted) abort();
  try {
    return await Promise.race([
      cancelled,
      (async () => {
        if (controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok)
          throw new ApiError(
            typeof body === "object" &&
              body !== null &&
              "error" in body &&
              typeof body.error === "string"
              ? body.error
              : typeof body === "object" &&
                  body !== null &&
                  "reason" in body &&
                  typeof body.reason === "string"
                ? body.reason
                : "unavailable",
            response.status,
          );
        const parsed = schema.safeParse(body);
        if (!parsed.success) throw new ApiError("invalid_response");
        return parsed.data;
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
