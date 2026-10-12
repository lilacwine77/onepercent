import { BLINKS } from "@onepercent/config";
import type { MiddlewareHandler } from "hono";
import type { Clock } from "../link/store.js";
const ttlSeconds = BLINKS.liveNumbersMaxAgeSeconds;
function cacheKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  const query = new URLSearchParams();
  const names = url.pathname.startsWith("/api/actions/xray")
    ? ["address", "addr", "ref"]
    : url.pathname.startsWith("/api/actions/rip")
      ? ["edition", "n", "lf", "ref"]
      : [];
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value !== null) query.set(name, value);
  }
  return `${url.pathname}?${query}`;
}
export function responseCache(clock: Clock): MiddlewareHandler {
  const cached = new Map<
    string,
    { createdAt: number; expiresAt: number; response: Response }
  >();
  const pending = new Map<string, Promise<Response | undefined>>();
  return async (context, next) => {
    if (context.req.method !== "GET" && context.req.method !== "HEAD")
      return next();
    const key = cacheKey(context.req.url);
    const now = clock();
    for (const [url, value] of cached)
      if (value.expiresAt <= now) cached.delete(url);
    const hit = cached.get(key);
    if (hit) {
      context.res = hit.response.clone();
      context.header(
        "Age",
        String(Math.max(0, Math.ceil((now - hit.createdAt) / 1_000))),
      );
      return;
    }
    for (
      let underway = pending.get(key);
      underway;
      underway = pending.get(key)
    ) {
      const response = await underway;
      if (response) {
        context.res = response.clone();
        return;
      }
    }
    let finish!: (response: Response | undefined) => void;
    pending.set(
      key,
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    try {
      await next();
      if (
        context.res.status === 200 &&
        context.res.headers.get("Cache-Control") !== "no-store"
      ) {
        context.header("Cache-Control", `public, max-age=${ttlSeconds}`);
        const response = context.res.clone();
        // A bounded local cache keeps arbitrary query strings from growing memory.
        if (cached.size >= 10_000) cached.delete(cached.keys().next().value!);
        const createdAt = clock();
        cached.set(key, {
          createdAt,
          expiresAt: createdAt + ttlSeconds * 1_000,
          response,
        });
        finish(response);
      } else {
        context.header("Cache-Control", "no-store");
        // Share transient responses with current waiters only. A quota denial
        // belongs to its client, so every waiting client still checks its quota.
        finish(context.res.status === 429 ? undefined : context.res.clone());
      }
    } finally {
      finish(undefined);
      pending.delete(key);
    }
  };
}
