import { WEB } from "@onepercent/config/web";

/** Bound the whole operation, even when a transport ignores AbortSignal. */
export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    cancelled = () => {
      const error = new Error("Network request aborted");
      error.name = "AbortError";
      reject(error);
      controller.abort(error);
    };
    if (parent?.aborted) {
      cancelled();
      return;
    }
    parent?.addEventListener("abort", cancelled, { once: true });
    timer = setTimeout(() => {
      // web3.js forwards transport failures only when they are Error instances.
      const error = new Error("Network request timed out");
      error.name = "TimeoutError";
      reject(error);
      controller.abort(error);
    }, WEB.httpTimeoutMs);
  });
  try {
    if (controller.signal.aborted) return await deadline;
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    if (cancelled) parent?.removeEventListener("abort", cancelled);
  }
}
