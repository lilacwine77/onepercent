import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { matchXrayPath } from "../xray/route";
import { routes, type RouteMatch } from "./table";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Validate canonical 32-byte base58 without loading the transaction stack. */
export function isAddress(input: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) return false;
  let value = 0n;
  for (const char of input)
    value = value * 58n + BigInt(alphabet.indexOf(char));
  let bytes = 0;
  while (value > 0n) {
    bytes++;
    value >>= 8n;
  }
  return bytes + (input.match(/^1*/)?.[0].length ?? 0) === 32;
}
export function matchRoute(pathname: string): RouteMatch {
  const none: RouteMatch = { route: "notFound", params: {} };
  if (pathname === "/packs") return { route: "rip", params: {}, alias: "/rip" };
  if (pathname === "/me")
    return { route: "cards", params: {}, alias: "/cards" };
  if (import.meta.env.DEV && pathname === "/dev/experience")
    return { route: "experience", params: {} };
  const xray = matchXrayPath(pathname);
  if (
    xray &&
    (!xray.input || isAddress(xray.input) || /\.sns$/i.test(xray.input))
  )
    return { route: "xray", params: { address: xray.input } };
  const segments = pathname.split("/");
  if (segments.length === 3) {
    let input: string;
    try {
      input = decodeURIComponent(segments[2]!);
    } catch {
      return none;
    }
    if (
      segments[1] === "verify" &&
      (/^(0|[1-9]\d{0,19})$/.test(input) || isAddress(input))
    ) {
      if (/^\d+$/.test(input) && BigInt(input) > 18446744073709551615n)
        return none;
      return { route: "verify", params: { pull: input } };
    }
    if (segments[1] === "link" && /^[a-f0-9]{32}$/.test(input))
      return { route: "link", params: { nonce: input } };
    return none;
  }
  for (const [route, item] of Object.entries(routes)) {
    if (
      item.path === pathname &&
      !["verify", "go", "link", "notFound"].includes(route)
    )
      return { route: route as keyof typeof routes, params: {} };
  }
  return none;
}
export function canonicalize(url: URL): URL {
  const match = matchRoute(url.pathname);
  if (match.alias) url.pathname = match.alias;
  return url;
}
let preload: ((pathname: string) => unknown) | undefined;
/** The shell registers its route chunks so a transition never captures a loading state. */
export function setRoutePreloader(load: (pathname: string) => unknown) {
  preload = load;
}
/**
 * The 1% transition: the lilac mark covers the page, the next route renders under
 * it, and it lifts (styles.css `html.is-brand`). Kept for the journey's turns:
 * entering the machine from home or from an X-ray, Feed → Rip, Rip ⇄ My cards.
 */
const BRAND = new Set([
  "home>feed",
  "home>rip",
  "home>cards",
  "xray>feed",
  "feed>rip",
  "rip>cards",
  "cards>rip",
]);
let brandRun = 0;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function brand(apply: () => void, ready: Promise<unknown>) {
  const run = ++brandRun;
  const root = document.documentElement;
  root.classList.remove("is-brand-out");
  root.classList.add("is-brand");
  try {
    await Promise.all([ready, wait(230)]);
    // A newer navigation took over; it applies itself.
    if (run !== brandRun) return;
    flushSync(apply);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    if (run !== brandRun) return;
    root.classList.add("is-brand-out");
    await wait(320);
  } finally {
    // Whatever happened (even a throw while the route rendered), the cover of
    // the current run never stays over the page.
    if (run === brandRun) root.classList.remove("is-brand", "is-brand-out");
  }
}
export function navigate(target: string, replace = false) {
  const url = canonicalize(new URL(target, window.location.href));
  if (url.origin !== window.location.origin) return;
  const apply = () => {
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const from = matchRoute(window.location.pathname).route;
  const to = matchRoute(url.pathname).route;
  // A newer navigation interrupts a running 1% transition.
  brandRun++;
  document.documentElement.classList.remove("is-brand", "is-brand-out");
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => unknown;
  };
  // Same route, or a browser without View Transitions: swap at once.
  if (from === to || !doc.startViewTransition) return apply();
  const ready = Promise.race([
    Promise.resolve(preload?.(url.pathname)).catch(() => undefined),
    wait(800),
  ]);
  // Reduced motion (system or in-app): a plain crossfade, never the 1% wipe.
  if (
    BRAND.has(`${from}>${to}`) &&
    document.documentElement.dataset.motion !== "reduced"
  )
    return void brand(apply, ready);
  void ready.then(() => doc.startViewTransition!(() => flushSync(apply)));
}
function subscribe(notify: () => void) {
  const pop = () => {
    const url = canonicalize(new URL(window.location.href));
    if (url.href !== window.location.href)
      window.history.replaceState(null, "", url);
    notify();
  };
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element ? event.target.closest("a") : null;
    if (
      !link ||
      link.hasAttribute("download") ||
      (link.target && link.target !== "_self") ||
      link.rel.includes("external")
    )
      return;
    const url = new URL(link.href, window.location.href);
    if (
      url.origin !== window.location.origin ||
      !/^https?:$/.test(url.protocol)
    )
      return;
    event.preventDefault();
    navigate(url.href);
  };
  window.addEventListener("popstate", pop);
  document.addEventListener("click", click);
  pop();
  return () => {
    window.removeEventListener("popstate", pop);
    document.removeEventListener("click", click);
  };
}
export function useLocation() {
  return useSyncExternalStore(subscribe, () => window.location.href);
}
