import { useEffect, useRef } from "react";
import { t } from "@onepercent/copy/initial";
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback(token: string): void;
      "error-callback"(): void;
      "expired-callback"(): void;
    },
  ): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let loading: Promise<TurnstileApi> | undefined;
function load(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () =>
        window.turnstile
          ? resolve(window.turnstile)
          : reject(new Error("Turnstile unavailable"));
      script.onerror = () => {
        script.remove();
        reject(new Error("Turnstile unavailable"));
      };
      document.head.append(script);
    }).catch((error) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}
export function Turnstile({
  onToken,
  onError,
}: {
  onToken(token: string): void;
  onError(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };
  useEffect(() => {
    let active = true;
    let id: string | undefined;
    let api: TurnstileApi | undefined;
    let used = false;
    const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!sitekey) {
      callbacks.current.onError();
      return;
    }
    void load()
      .then((value) => {
        if (!active || !element.current) return;
        api = value;
        id = api.render(element.current, {
          sitekey,
          callback(token) {
            if (active && !used) {
              used = true;
              callbacks.current.onToken(token);
            }
          },
          "error-callback"() {
            if (active) callbacks.current.onError();
          },
          "expired-callback"() {
            if (active && !used) callbacks.current.onError();
          },
        });
      })
      .catch(() => {
        if (active) callbacks.current.onError();
      });
    return () => {
      active = false;
      if (id !== undefined) api?.remove(id);
    };
  }, []);
  return (
    <section aria-label={t("xray.check")}>
      <p>{t("xray.check")}</p>
      <div ref={element} />
    </section>
  );
}
