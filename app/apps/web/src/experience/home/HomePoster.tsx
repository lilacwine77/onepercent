import { useLayoutEffect, type ReactNode, type Ref } from "react";
import { t } from "@onepercent/copy/initial";
import { TV_ASSETS, TV_SIZES, tvSet } from "../../app/tv-poster";
import "./hero.css";
/**
 * The hero's first frame, in the entry chunk: the studio, the TV poster and the
 * title paint before the home chunk arrives (LCP). The home chunk renders the
 * same frame, so the swap is invisible. On a first visit it raises the intro
 * cover; if the home chunk is not there within 1.2 s, the page shows without it.
 */
/**
 * The studio backdrop (CSS, hero.css) and the TV poster: the LCP image, AVIF first,
 * with the srcset and sizes its early preload uses (app/poster-preload.ts).
 */
export function HeroFrame({
  stage,
  live = false,
}: {
  stage?: Ref<HTMLDivElement>;
  live?: boolean;
}) {
  return (
    <>
      <div className="hero-backdrop" />
      <div className={`hero-tv${live ? " is-live" : ""}`}>
        <picture className="hero-poster">
          <source type="image/avif" srcSet={tvSet("avif")} sizes={TV_SIZES} />
          <img
            src={`${TV_ASSETS}tv-768.webp`}
            srcSet={tvSet("webp")}
            sizes={TV_SIZES}
            alt=""
            width={1440}
            height={1440}
            fetchPriority="high"
            data-fade=""
          />
        </picture>
        <div ref={stage} className="hero-tv-stage" aria-hidden="true" />
      </div>
    </>
  );
}
export function HeroTitle() {
  // "Dust in, Packs out." → one line each (each rises on its own).
  const [first, second] = t("brand.lineIn")
    .replace(/([,.]) /, "$1\n")
    .split("\n");
  return (
    <h1 id="hero-title" tabIndex={-1}>
      <span className="line">{first}</span>{" "}
      <span className="line">{second}</span>
    </h1>
  );
}
// Only the document's first route can play the intro (not an in-app return home).
let initialRoute = window.location.pathname === "/";
function firstVisit() {
  const initial = initialRoute;
  initialRoute = false;
  try {
    if (
      !initial ||
      localStorage.getItem("onepercent.motion") === "reduced" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      sessionStorage.getItem("onepercent.intro")
    )
      return false;
    sessionStorage.setItem("onepercent.intro", "1");
    return true;
  } catch {
    return false;
  }
}
export function HomePoster({ launchNotice }: { launchNotice?: ReactNode }) {
  useLayoutEffect(() => {
    if (!firstVisit()) return;
    const root = document.documentElement;
    root.classList.add("is-intro", "is-intro-hold");
    // The home chunk's intro clears this failsafe when it starts (intro.ts).
    root.dataset.intro = String(
      setTimeout(
        () => root.classList.remove("is-intro", "is-intro-hold"),
        1200,
      ),
    );
  }, []);
  return (
    <section className="hero" aria-labelledby="hero-title">
      <HeroFrame />
      <div className="hero-copy">
        {launchNotice}
        <HeroTitle />
        <p className="hero-lede" />
        <p className="hero-deposit" />
      </div>
    </section>
  );
}
