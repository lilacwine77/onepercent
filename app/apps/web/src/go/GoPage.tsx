import { useEffect, useRef, useState } from "react";
import { GoApiError, redeemGo } from "./api";
import { COPY, rateLimitedCopy } from "./copy";
import { replaceGoTarget } from "./navigation";
import { resolveGoTarget } from "./target";
import "../link/link.css";

type State =
  | { phase: "loading" | "expired" | "offline" }
  | { phase: "limited"; seconds: number };

export function GoPage({ id }: { id: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{
    id: string;
    attempt: number;
    result: Promise<string>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setState({ phase: "loading" });
    // Reuse this mount's POST during StrictMode's effect replay. Aborting it
    // could discard the one successful response after the server consumes it.
    if (request.current?.id !== id || request.current.attempt !== attempt) {
      request.current = { id, attempt, result: redeemGo(id) };
    }
    void request.current.result
      .then((target) => {
        if (!active) return;
        const url = resolveGoTarget(target, window.location.origin);
        if (!url) throw new GoApiError(502);
        replaceGoTarget(url);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof GoApiError) {
          if (error.status === 404 || error.status === 410) {
            setState({ phase: "expired" });
            return;
          }
          if (error.status === 429 && error.retryAfterSeconds !== null) {
            setState({ phase: "limited", seconds: error.retryAfterSeconds });
            return;
          }
        }
        setState({ phase: "offline" });
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const status =
    state.phase === "limited"
      ? rateLimitedCopy(state.seconds)
      : {
          loading: COPY["go.loading"],
          expired: COPY["go.expired"],
          offline: COPY["common.networkError"],
        }[state.phase];

  return (
    <main className="link-page">
      <section className="link-content">
        <p className="link-status" role="status" aria-live="polite">
          {status}
        </p>
        <div className="link-actions">
          {state.phase === "expired" && (
            <a className="link-button" href="/">
              {COPY["common.home"]}
            </a>
          )}
          {state.phase === "offline" && (
            <button
              className="link-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {COPY["common.retry"]}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
