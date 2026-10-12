import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { t, short, count, countUngrouped } from "@onepercent/copy/initial";
import { soundPref, cardsCount, motionPref, useStore } from "./prefs";
import { loadHome } from "../experience/index";
import { preloadModule } from "./lazy-module";
import { useReducedMotion } from "./motion";
import { useLocation, matchRoute, setRoutePreloader } from "../routes/router";
import { routes } from "../routes/table";
import { incomingReferral, rememberReferral } from "../data/referral";
import { useFlag } from "../data/flags";
import { WalletButton } from "../wallet/WalletProvider";
import { beacon } from "../analytics/client";
import { Providers } from "./providers";
import { PageFocus } from "./PageFocus";
import { ErrorBoundary } from "./ErrorBoundary";
import { OfflineBanner, RescueLink } from "./OfflineBanner";
import NotFound from "./NotFound";
import Home from "../routes/pages/Home";
import Xray from "../routes/pages/Xray";

const X_URL = "https://x.com/1percentfun";

// A preloaded route renders without suspending (its module comes back as an
// already-resolved thenable), so a view transition never captures the loading
// state (router.setRoutePreloader). A page may name what it renders first
// (`ready`); the preload waits for that too.
function lazyRoute<P extends object>(
  load: () => Promise<{ default: ComponentType<P>; ready?: () => unknown }>,
) {
  type Module = { default: ComponentType<P> };
  let loaded: Module | undefined;
  const preload = () =>
    load().then(async (module) => {
      await Promise.resolve(module.ready?.()).catch(() => undefined);
      return (loaded = module);
    });
  // A first load renders as soon as the page's own chunk is in (its loading
  // shapes cover the rest); only a navigation waits for `ready`, under its
  // transition.
  return Object.assign(
    lazy(() =>
      loaded
        ? ({ then: (done: (module: Module) => void) => done(loaded!) } as never)
        : load().then((module) => (loaded = module)),
    ),
    { preload },
  );
}
const Feed = lazyRoute(() => import("../routes/pages/Feed"));
const Rip = lazyRoute(() => import("../routes/pages/Rip"));
const Cards = lazyRoute(() => import("../routes/pages/Cards"));
const Verify = lazyRoute(() => import("../routes/pages/Verify"));
const Fairness = lazyRoute(() => import("../routes/pages/Fairness"));
const Live = lazyRoute(() => import("../routes/pages/Live"));
const Token = lazyRoute(() => import("../routes/pages/Token"));
const preloaders: Partial<Record<string, () => Promise<unknown>>> = {
  home: () => preloadModule(loadHome),
  feed: Feed.preload,
  rip: Rip.preload,
  cards: Cards.preload,
  verify: Verify.preload,
  fairness: Fairness.preload,
  live: Live.preload,
  token: Token.preload,
};
setRoutePreloader((pathname) => preloaders[matchRoute(pathname).route]?.());
const DevExperience = import.meta.env.DEV
  ? lazy(() => import("../routes/pages/DevExperience"))
  : null;
function Content() {
  const href = useLocation();
  const url = new URL(href);
  const match = matchRoute(url.pathname);
  const [menu, setMenu] = useState(false);
  const { reduced, toggle: toggleMotion } = useReducedMotion();
  useEffect(() => motionPref.set(reduced), [reduced]);
  const soundAvailable = useFlag("SOUND");
  const sound = useStore(soundPref);
  const cards = useStore(cardsCount);
  useEffect(() => {
    rememberReferral(incomingReferral(url.search));
    setMenu(false);
    const route = match.route;
    if (route !== "experience" && route !== "go")
      beacon({ event: "page_view", route });
    document.title =
      route === "xray" && match.params.address
        ? t("title.xrayAddress", { who: short(match.params.address) })
        : route === "verify"
          ? t("title.verify", {
              seq: /^\d+$/.test(match.params.pull!)
                ? countUngrouped(BigInt(match.params.pull!))
                : short(match.params.pull!),
            })
          : t(
              route === "experience"
                ? "title.home"
                : (routes[route].title as "title.home"),
            );
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", t("meta.description"));
  }, [href]);
  let page: ReactNode;
  switch (match.route) {
    case "home":
      page = <Home />;
      break;
    case "xray":
      page = <Xray address={match.params.address ?? ""} search={url.search} />;
      break;
    case "feed":
      page = <Feed />;
      break;
    case "rip":
      page = <Rip />;
      break;
    case "cards":
      page = <Cards />;
      break;
    case "verify":
      page = <Verify pull={match.params.pull!} />;
      break;
    case "fairness":
      page = <Fairness />;
      break;
    case "live":
      page = <Live />;
      break;
    case "token":
      page = <Token />;
      break;
    case "experience":
      page = DevExperience ? <DevExperience /> : <NotFound />;
      break;
    default:
      page = <NotFound />;
  }
  const soundToggle = (
    <button
      className="round sound-toggle"
      aria-pressed={sound}
      aria-label={t(sound ? "common.soundOff" : "common.soundOn")}
      onClick={() => soundPref.set(!sound)}
    />
  );
  return (
    <>
      <header className="app-header">
        <button
          className="round menu-toggle"
          aria-expanded={menu}
          aria-controls="main-nav"
          aria-label={t(menu ? "nav.menuClose" : "nav.menuOpen")}
          onClick={() => setMenu(!menu)}
        />
        <nav
          id="main-nav"
          className={menu ? "nav-open" : ""}
          aria-label={t("nav.label")}
        >
          {(["xray", "feed", "rip"] as const).map((id) => (
            <a
              key={id}
              href={routes[id].path}
              aria-current={match.route === id ? "page" : undefined}
            >
              {t(`nav.${id}`)}
            </a>
          ))}
          {soundAvailable && soundToggle}
        </nav>
        {/* The 1% mark is drawn by CSS (styles.css .wordmark); its name is the label. */}
        <a href="/" className="wordmark" aria-label={t("brand.name")} />
        <div className="header-tools">
          {soundAvailable && soundToggle}
          <a
            href={routes.cards.path}
            className="cards-chip"
            aria-current={match.route === "cards" ? "page" : undefined}
          >
            {t("nav.cards")}
            {!!cards && (
              <b className="badge" aria-hidden="true">
                {count(cards)}
              </b>
            )}
          </a>
          <WalletButton />
        </div>
      </header>
      <OfflineBanner />
      {/* One <main> per route: a route's own page box (Feed is narrower) is a new
          element, never a shift of the previous page's. */}
      <main key={match.route} className={`shell-page page-${match.route}`}>
        <ErrorBoundary key={url.pathname}>
          <Suspense
            fallback={
              <div className="route-loading" role="status">
                <span className="sr-only">{t("common.loading")}</span>
              </div>
            }
          >
            <PageFocus href={href}>{page}</PageFocus>
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="app-footer">
        <div className="footer-top">
          <div>
            {/* "Find your" / "1%." on two lines, as the landing's footer. */}
            <h2>{t("footer.heading").replace(/ (\S+)$/, "\n$1")}</h2>
            <a className="oval" href={routes.rip.path}>
              {t("footer.cta").slice(0, -2)}
            </a>
          </div>
          <nav>
            {(["live", "token", "fairness"] as const).map((id) => (
              <a key={id} href={routes[id].path}>
                {t(`nav.${id}`)}
              </a>
            ))}
            <RescueLink />
            <a href={X_URL} rel="external noopener" target="_blank">
              {t("footer.x")}
            </a>
            <button
              className="text-button"
              aria-pressed={reduced}
              onClick={toggleMotion}
            >
              {t(reduced ? "common.motionFull" : "common.motionReduced")}
            </button>
          </nav>
          <FooterPepe />
        </div>
        <p
          className="footer-logo"
          aria-hidden="true"
          data-text={t("brand.name")}
        />
        <div className="footer-bottom">
          <p>{t("footer.line")}</p>
          <p>{t("footer.copyright")}</p>
        </div>
      </footer>
    </>
  );
}
/**
 * The footer's Pepe (the landing's), fetched once the page has loaded and its
 * fonts are in, and the footer is near the viewport: every route has the footer,
 * often in view while a page loads, and its art must not slow that first paint.
 */
function FooterPepe() {
  const [near, setNear] = useState(false);
  const [box, setBox] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!box || near) return;
    let observer: IntersectionObserver | undefined;
    let cancelled = false;
    const loaded =
      document.readyState === "complete"
        ? Promise.resolve()
        : new Promise((done) =>
            window.addEventListener("load", done, { once: true }),
          );
    void Promise.all([loaded, document.fonts?.ready]).then(() => {
      if (cancelled) return;
      if (typeof IntersectionObserver === "undefined") return setNear(true);
      observer = new IntersectionObserver(
        ([entry]) => entry?.isIntersecting && setNear(true),
        { rootMargin: "0px 0px 300px 0px" },
      );
      observer.observe(box);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [box, near]);
  return (
    <span ref={setBox} className="footer-pepe" aria-hidden="true">
      {near && (
        <img
          src="/experience/home/pepe-360.webp"
          srcSet="/experience/home/pepe-360.webp 360w, /experience/home/pepe-720.webp 720w"
          sizes="(max-width: 700px) 150px, (max-width: 1000px) 160px, 220px"
          alt=""
          width={720}
          height={720}
          decoding="async"
        />
      )}
    </span>
  );
}
export function AppShell() {
  return (
    <ErrorBoundary>
      <Providers>
        <Content />
      </Providers>
    </ErrorBoundary>
  );
}
