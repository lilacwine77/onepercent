import { useLayoutEffect, type ReactNode } from "react";

/** Nested lazy views may replace a loading heading after the route mounts. */
export function PageFocus({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const url = new URL(href);
  const focusLocation = `${url.origin}${url.pathname}${url.hash}`;
  useLayoutEffect(() => {
    let hash: string;
    try {
      hash = decodeURIComponent(new URL(focusLocation).hash.slice(1));
    } catch {
      hash = "";
    }
    const main = document.querySelector("main");
    let focused: HTMLElement | null = null;
    let interacted = false;
    const stop = () => {
      interacted = true;
    };
    const focus = () => {
      if (interacted) return;
      const hashTarget = hash ? document.getElementById(hash) : null;
      const target = hashTarget ?? main?.querySelector<HTMLElement>("h1");
      if (!target || target === focused) return;
      target.focus({ preventScroll: true });
      focused = target;
      if (hashTarget) target.scrollIntoView();
    };
    const onFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.matches("main h1") &&
        !(hash && event.target.id === hash)
      )
        stop();
    };
    focus();
    if (!hash || !document.getElementById(hash)) window.scrollTo({ top: 0 });
    const observer = new MutationObserver(focus);
    if (main) observer.observe(main, { childList: true, subtree: true });
    document.addEventListener("pointerdown", stop, true);
    document.addEventListener("keydown", stop, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", stop, true);
      document.removeEventListener("keydown", stop, true);
      document.removeEventListener("focusin", onFocus);
    };
  }, [focusLocation]);
  return children;
}
