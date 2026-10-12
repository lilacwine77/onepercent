import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { countdown } from "@onepercent/copy/initial";
import { HeroFrame, HeroTitle } from "./HomePoster";
import { copy, existing } from "./copy";
import { introPending, playIntro, replayIntro } from "./intro";
import { mountTv, type TvHandle } from "./tv/mount";
import type { HomeProps } from "./types";

type FilmModule = typeof import("./film/film");
type FilmPlayer = import("./film/film").FilmPlayer;
const idleCallback = (run: () => void, timeout: number) => {
  const idle = (
    window as Window & {
      requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }
  ).requestIdleCallback;
  if (idle) {
    const handle = idle(run, { timeout });
    return () =>
      (
        window as Window & { cancelIdleCallback?: (handle: number) => void }
      ).cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(run, timeout / 2);
  return () => clearTimeout(handle);
};

/** "Rip a pack →" → label and arrow chip; the arrow is decoration. */
export function Arrowed({ text }: { text: string }) {
  const arrow = /\s([→↗↓])$/.exec(text);
  return arrow ? (
    <>
      <span>{text.slice(0, arrow.index)}</span>
      <b aria-hidden="true">{arrow[1]}</b>
    </>
  ) : (
    <span>{text}</span>
  );
}

function useNow(now: () => number, active: boolean) {
  const [value, setValue] = useState(now);
  useEffect(() => {
    if (!active) return;
    const tick = () => setValue(now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [now, active]);
  return value;
}

/** What the hero shows for the machine's phase, and the next announced time. */
function machine(props: HomeProps) {
  const { phase } = props;
  const stage =
    phase === undefined
      ? "loading"
      : !phase
        ? "unknown"
        : phase === "OnAir"
          ? "live"
          : ["Setup", "StockUp", "PoweredOn"].includes(phase)
            ? "before"
            : "over";
  const now = props.now();
  const feedAt = (props.season?.stockUpTs ?? 0) * 1000;
  const airAt = (props.season?.onAirTs ?? 0) * 1000;
  const next =
    stage !== "before"
      ? null
      : !props.flags.feed && feedAt > now
        ? { to: "feed" as const, atMs: feedAt }
        : airAt > now
          ? { to: "onAir" as const, atMs: airAt }
          : null;
  return { stage, next };
}
type Next = ReturnType<typeof machine>["next"];

function Countdown({
  next,
  now: clock,
}: {
  next: NonNullable<Next>;
  now(): number;
}) {
  const now = useNow(clock, true);
  if (next.atMs <= now) return null;
  return (
    <p className="hero-chip">
      <span>
        {copy(
          next.to === "feed" ? "home.countdown.feed" : "home.countdown.onAir",
        )}
      </span>
      <b>{countdown((next.atMs - now) / 1000)}</b>
    </p>
  );
}

/**
 * The landing's call to action, "Pick a pack →", down to the packs (each one rips
 * in the app); once the season is over, My cards. The machine's status is a chip
 * beside it (Status; the first config read shows none, so nothing swaps).
 */
function Action({ props }: { props: HomeProps }) {
  if (machine(props).stage === "over")
    return (
      <a className="oval" href="/cards">
        <Arrowed text={`${copy("home.cta.cards")} →`} />
      </a>
    );
  // Down to the packs, as the landing scrolls to them (the hash stays a link).
  function toPacks(event: MouseEvent<HTMLAnchorElement>) {
    const packs = document.getElementById("packs");
    if (!packs) return;
    event.preventDefault();
    packs.focus({ preventScroll: true });
    packs.scrollIntoView({
      behavior: props.reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }
  return (
    <a className="oval" href="#packs" onClick={toPacks}>
      <Arrowed text={copy("home.cta.pick")} />
    </a>
  );
}
/** While the machine is not on air: when it will be, or that the season is over. */
function Status({ props }: { props: HomeProps }) {
  const { stage, next } = machine(props);
  if (stage === "over")
    return <p className="hero-chip">{existing.seasonOver()}</p>;
  if (stage === "live" || stage === "loading") return null;
  return next ? (
    <Countdown next={next} now={props.now} />
  ) : (
    <p className="hero-chip">{copy("home.soon")}</p>
  );
}

export function Hero({ props }: { props: HomeProps }) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  /** The TV's canvas host: the film moves it into its dialog and back. */
  const host = useRef<HTMLDivElement | null>(null);
  const tv = useRef<TvHandle | null>(null);
  const filmButton = useRef<HTMLButtonElement>(null);
  const film = useRef<FilmPlayer | null>(null);
  const filmModule = useRef<FilmModule | null>(null);
  const filmLoading = useRef<Promise<FilmModule> | null>(null);
  const reduced = useRef(props.reducedMotion);
  reduced.current = props.reducedMotion;
  const [entering, setEntering] = useState(0);
  const [live, setLive] = useState(false);
  const liveRef = useRef(live);
  liveRef.current = live;

  // The film (landing parity): its chunk is fetched on idle, nothing plays or
  // streams before the first open. Opening stays inside the click (autoplay).
  const loadFilm = useRef(() => {
    filmLoading.current ??= import("./film/film").then((module) => {
      filmModule.current = module;
      return module;
    });
    return filmLoading.current;
  }).current;
  const watch = useRef(() => {
    const player = (module: FilmModule) => {
      const home = stage.current;
      const art = home?.parentElement;
      if (!film.current && home && art && host.current)
        film.current = module.initFilm({
          stage: host.current,
          home,
          art,
          getTelevision: () => tv.current?.television ?? null,
          reducedMotion: () => reduced.current,
        });
      return film.current;
    };
    const opener = filmButton.current;
    if (filmModule.current) player(filmModule.current)?.open(opener);
    else
      void loadFilm().then(
        (module) => player(module)?.open(opener),
        () => undefined,
      );
  }).current;
  useLayoutEffect(() => {
    const container = stage.current;
    if (!container) return;
    const element = document.createElement("div");
    element.className = "crt-stage";
    container.appendChild(element);
    host.current = element;
    const activate = () => watch();
    element.addEventListener("crt:activate", activate);
    return () => {
      element.removeEventListener("crt:activate", activate);
      element.remove();
      host.current = null;
    };
  }, [watch]);
  useEffect(() => {
    let unbind: (() => void) | undefined;
    let cancelled = false;
    const cancelIdle = idleCallback(() => {
      void loadFilm().then(
        (module) => {
          const art = stage.current?.parentElement;
          const image =
            art?.querySelector<HTMLImageElement>(".hero-poster img");
          if (cancelled || !art || !image) return;
          unbind = module.bindTelevisionPoster({
            container: art,
            image,
            isActive: () => !liveRef.current && !film.current?.isOpen,
            onActivate: watch,
          });
        },
        () => undefined,
      );
    }, 3000);
    return () => {
      cancelled = true;
      cancelIdle();
      unbind?.();
      film.current?.destroy();
      film.current = null;
    };
  }, [loadFilm, watch]);

  // Focus continuity: the poster's heading had the route focus before this swap.
  useEffect(() => {
    if (document.activeElement === document.body)
      document.getElementById("hero-title")?.focus({ preventScroll: true });
  }, []);
  // First visit: the entry raised the cover; play the reveal now that the chunk is here.
  useEffect(() => {
    if (introPending()) void playIntro(() => setEntering((n) => n + 1));
  }, []);
  // The header is transparent over the hero until the title reaches it.
  useEffect(() => {
    const title = document.getElementById("hero-title");
    if (!title || typeof IntersectionObserver === "undefined") return;
    const root = document.documentElement;
    const header =
      parseFloat(getComputedStyle(root).getPropertyValue("--header-h")) || 72;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry)
          root.dataset.hero = entry.intersectionRatio > 0.98 ? "over" : "";
      },
      { rootMargin: `-${header}px 0px 0px 0px`, threshold: [0, 0.98, 1] },
    );
    observer.observe(title);
    return () => {
      observer.disconnect();
      delete root.dataset.hero;
    };
  }, []);
  // 1% TV in WebGL after LCP, when the device can afford it (03-M3 §15.1).
  useEffect(() => {
    const container = host.current;
    if (!container || props.reducedMotion) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      void mountTv(container).then((handle) => {
        if (cancelled || !handle) return handle?.destroy();
        tv.current = handle;
        void handle.ready.then(
          () => !cancelled && setLive(true),
          () => !cancelled && setLive(false),
        );
      });
    };
    const idle = (
      window as Window & {
        requestIdleCallback?: (
          fn: () => void,
          o?: { timeout: number },
        ) => number;
      }
    ).requestIdleCallback;
    const handle = idle
      ? idle(start, { timeout: 2500 })
      : window.setTimeout(start, 1200);
    return () => {
      cancelled = true;
      if (!idle) clearTimeout(handle);
      // The film gives the TV back first (its stage may be in the dialog).
      void film.current?.close({ immediate: true });
      tv.current?.destroy();
      tv.current = null;
      setLive(false);
    };
  }, [props.reducedMotion]);

  const entered = entering > 0;
  return (
    <section
      ref={section}
      className={`hero${entered ? " is-entering" : ""}`}
      data-pass={entering % 2}
      aria-labelledby="hero-title"
    >
      <HeroFrame stage={stage} live={live} />
      <div className="hero-copy">
        <HeroTitle />
        <p className="hero-lede hero-reveal">{copy("home.hero.lede")}</p>
        <p
          className="hero-deposit hero-reveal"
          style={{ "--i": 1 } as CSSProperties}
        >
          {props.flags.feed && (
            <a href="/feed">
              {copy("home.cta.feed")} <span aria-hidden="true">↗</span>
            </a>
          )}
        </p>
      </div>
      <div
        className="hero-actions hero-reveal"
        style={{ "--i": 3 } as CSSProperties}
      >
        <Action props={props} />
        <button
          ref={filmButton}
          type="button"
          className="pill-link hero-film"
          aria-haspopup="dialog"
          onClick={watch}
        >
          <Arrowed text={copy("home.film.watch")} />
        </button>
      </div>
      <div
        className="hero-status hero-reveal"
        style={{ "--i": 3 } as CSSProperties}
      >
        <Status props={props} />
      </div>
    </section>
  );
}

export { replayIntro };
