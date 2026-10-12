import type { FetchFn } from "@solana/web3.js";
import { WEB } from "@onepercent/config/web";
import { withDeadline } from "./deadline";
import { HTTP } from "./http-status";

type Queue = { active: number; waiting: (() => void)[] };
const queues = new Map<string, Queue>();

/** All Connection instances for one origin share the same bounded queue. */
function acquire(
  origin: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<() => void> {
  signal.throwIfAborted();
  let queue = queues.get(origin);
  if (!queue) {
    queue = { active: 0, waiting: [] };
    queues.set(origin, queue);
  }
  const current = queue;
  const clean = () => {
    if (!current.active && !current.waiting.length) queues.delete(origin);
  };
  return new Promise((resolve, reject) => {
    const cancel = () => {
      const index = current.waiting.indexOf(start);
      if (index >= 0) current.waiting.splice(index, 1);
      signal.removeEventListener("abort", cancel);
      clean();
      reject(signal.reason);
    };
    const start = () => {
      if (signal.aborted) return cancel();
      signal.removeEventListener("abort", cancel);
      if (Date.now() >= deadlineAt) {
        const error = new Error("Network request timed out");
        error.name = "TimeoutError";
        reject(error);
        current.waiting.shift()?.();
        clean();
        return;
      }
      current.active += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        signal.removeEventListener("abort", release);
        current.active -= 1;
        current.waiting.shift()?.();
        clean();
      };
      signal.addEventListener("abort", release, { once: true });
      resolve(release);
    };
    if (current.active < WEB.rpcConcurrency) start();
    else {
      current.waiting.push(start);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
}

function retryAfterMs(value: string | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const milliseconds = Number(text) * WEB.millisecondsPerSecond;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (
    !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)
  )
    return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - Date.now())
    : null;
}

function retryableRead(body: unknown): boolean {
  if (typeof body !== "string") return false;
  try {
    const request: unknown = JSON.parse(body);
    if (!request || typeof request !== "object" || !("method" in request))
      return false;
    return (
      typeof request.method === "string" &&
      (request.method.startsWith("get") ||
        request.method === "simulateTransaction")
    );
  } catch {
    return false;
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

export function createRpcFetch(origin: string): FetchFn {
  const queueOrigin = new URL(origin).origin;
  return (url, options) => {
    const deadlineAt = Date.now() + WEB.httpTimeoutMs;
    return withDeadline(async (deadline) => {
      // A caller's cancel (for example a background read yielding to a
      // take-back) ends the request together with the overall deadline.
      const signal = options?.signal
        ? AbortSignal.any([options.signal, deadline])
        : deadline;
      const release = await acquire(queueOrigin, signal, deadlineAt);
      const retryable = retryableRead(options?.body);
      try {
        for (let attempt = 0; ; attempt += 1) {
          signal.throwIfAborted();
          const response = await fetch(url, { ...options, signal });
          // web3.js reads text after fetch returns; include the body in the same
          // deadline as queueing, all attempts and any server-requested delay.
          const body = await response.text();
          signal.throwIfAborted();
          const requested = retryAfterMs(response.headers.get("retry-after"));
          const backoff = Math.min(
            WEB.rpcCapacityBackoffMaxMs,
            WEB.rpcCapacityBackoffBaseMs * 2 ** attempt,
          );
          const jittered = Math.ceil((backoff * (1 + Math.random())) / 2);
          const delay = requested === null ? null : requested + jittered;
          if (
            response.status !== HTTP.unavailable ||
            !retryable ||
            requested === null ||
            attempt + 1 >= WEB.rpcCapacityMaxAttempts ||
            (delay !== null && delay >= deadlineAt - Date.now())
          )
            return new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          await wait(delay!, signal);
        }
      } finally {
        release();
      }
    }, options?.signal ?? undefined);
  };
}
