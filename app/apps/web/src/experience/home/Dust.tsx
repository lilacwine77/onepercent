import { Fragment, useEffect, useRef, type CSSProperties } from "react";
import { Arrowed } from "./Hero";
import { Picture } from "./Picture";
import { copy } from "./copy";
import "./dust.css";

/** The landing's own art, synced byte for byte (scripts/sync-landing-assets.mjs). */
const LANDING = "/landing/";
const vars = (value: Record<string, string | number>) => value as CSSProperties;
/** Runs once the page is idle (a timeout where idle callbacks are missing). */
function whenIdle(run: () => void) {
  const view = window as Window & {
    requestIdleCallback?: typeof requestIdleCallback;
    cancelIdleCallback?: typeof cancelIdleCallback;
  };
  if (view.requestIdleCallback) {
    const handle = view.requestIdleCallback(run, { timeout: 3000 });
    return () => view.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(run, 1500);
  return () => window.clearTimeout(handle);
}

/**
 * The landing's reveals (src/main.js): each title, line of copy and pop reveals
 * when it scrolls in, 12% above the bottom of the viewport.
 */
function useReveals<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = root.querySelectorAll("[data-title],[data-copy],[data-pop]");
    if (typeof IntersectionObserver === "undefined") {
      items.forEach((item) => item.classList.add("revealed"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }),
      { rootMargin: "0px 0px -12% 0px" },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  return ref;
}

/**
 * A spring title (the landing's [data-title]): each character pops in, 30 ms
 * apart; "\n" breaks the line where the landing does. The text stays whole for
 * assistive tech.
 */
function Title({ text, id }: { text: string; id: string }) {
  let index = 0;
  return (
    <h2 id={id} data-title="">
      <span className="sr-only">{text.replace("\n", " ")}</span>
      <span aria-hidden="true">
        {text.split("\n").map((line, l) => (
          <Fragment key={l}>
            {l > 0 && <br />}
            {line.split(" ").map((word, w) => (
              <Fragment key={w}>
                {w > 0 && " "}
                <span className="word">
                  {Array.from(word).map((char, c) => (
                    <span
                      key={c}
                      className="char"
                      style={vars({ "--i": index++ })}
                    >
                      {char}
                    </span>
                  ))}
                </span>
              </Fragment>
            ))}
          </Fragment>
        ))}
      </span>
    </h2>
  );
}

/** A line of copy that rises from its mask (the landing's [data-copy]). */
function Copy({
  as: Tag = "p",
  className,
  children,
}: {
  as?: "p" | "h3";
  className?: string;
  children: string;
}) {
  return (
    <Tag className={className} data-copy="">
      <span className="copy-inner">{children}</span>
    </Tag>
  );
}

/** "Got dust? Feed the machine.": the lilac machine beside the copy. */
export function Story({ flowsLocked }: { flowsLocked?: boolean }) {
  const ref = useReveals<HTMLElement>();
  return (
    <section ref={ref} className="home-story" aria-labelledby="story-title">
      <div className="story-machine" data-pop="">
        <img
          src={`${LANDING}onepercent-machine.webp`}
          alt={copy("home.story.machine")}
          width={718}
          height={1200}
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="story-copy">
        <Title text={copy("home.story.title")} id="story-title" />
        <Copy>{copy("home.story.body")}</Copy>
        {!flowsLocked && (
          <a className="oval" href="/feed">
            <Arrowed text={copy("home.story.cta")} />
          </a>
        )}
      </div>
    </section>
  );
}

function Coin({ alt = "" }: { alt?: string }) {
  return (
    <img
      src={`${LANDING}ansem.webp`}
      alt={alt}
      width={384}
      height={384}
      loading="lazy"
      decoding="async"
    />
  );
}

const steps = [
  {
    id: "xray",
    icon: (
      <svg viewBox="0 0 32 32">
        <path d="M5 11V7.5A2.5 2.5 0 0 1 7.5 5H11M21 5h3.5A2.5 2.5 0 0 1 27 7.5V11M27 21v3.5a2.5 2.5 0 0 1-2.5 2.5H21M11 27H7.5A2.5 2.5 0 0 1 5 24.5V21" />
        <circle cx="16" cy="16" r="6" />
        <path className="dust-step-accent" d="M3.5 16h25" />
      </svg>
    ),
  },
  {
    id: "feed",
    icon: (
      <svg viewBox="0 0 32 32">
        <rect x="8.5" y="11.5" width="15" height="17.5" rx="3" />
        <path d="M8.5 16.5h15" />
        <circle className="dust-step-accent" cx="16" cy="6.5" r="3.5" />
        <path d="M16 19.5v5M13.5 22.5 16 25l2.5-2.5" />
      </svg>
    ),
  },
  {
    id: "paid",
    icon: (
      <svg viewBox="0 0 32 32">
        <path d="M8 8l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2v16l-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2Z" />
        <circle className="dust-step-accent" cx="13" cy="13" r="1.7" />
        <circle className="dust-step-accent" cx="19" cy="19" r="1.7" />
        <path className="dust-step-accent" d="M19.5 12.5l-7 7" />
      </svg>
    ),
  },
] as const;

/**
 * "How dust pays.": a dark panel over the story. An ANSEM bag that sells for next
 * to nothing becomes a Dust Card that pays up to 75× when a pack pulls it
 * (dust-pays.ts plays it once, in view), then the three steps.
 */
export function DustPays({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useReveals<HTMLElement>();
  const stage = useRef<HTMLElement>(null);
  // The sequence (dust-pays.ts) is its own chunk, fetched once the page is idle:
  // the stage is far below the fold and shows the finished example until then.
  useEffect(() => {
    const root = stage.current;
    if (
      !root ||
      typeof IntersectionObserver === "undefined" ||
      typeof ResizeObserver === "undefined"
    )
      return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const load = () =>
      void import("./dust-pays").then(
        ({ initDustPays }) => {
          if (!cancelled) stop = initDustPays(root, reducedMotion);
        },
        () => undefined,
      );
    const cancelIdle = whenIdle(load);
    return () => {
      cancelled = true;
      cancelIdle();
      stop?.();
    };
  }, [reducedMotion]);
  return (
    <section
      ref={ref}
      className="dust-pays"
      id="how-dust-pays"
      aria-labelledby="dust-pays-title"
    >
      <div className="dust-pays-head">
        <Title text={copy("home.dust.title")} id="dust-pays-title" />
        <Copy>{copy("home.dust.lede")}</Copy>
      </div>
      <figure ref={stage} className="dust-demo">
        <div className="dust-demo-before">
          <span className="dust-coin" data-dust-from="">
            <Coin alt={copy("home.dust.logo")} />
          </span>
          <p className="dust-coin-name">{copy("home.dust.ticker")}</p>
          <p className="dust-sold">
            {copy("home.dust.sells")} <b>{copy("home.dust.sold")}</b>
          </p>
        </div>
        <div className="dust-demo-host" data-pop="" aria-hidden="true">
          <Picture
            name="pepe"
            widths={[360, 720]}
            sizes="(max-width: 699px) 196px, (max-width: 899px) 250px, 370px"
          />
        </div>
        <div className="dust-demo-after">
          <div className="dust-card" data-dust-to="">
            <span className="dust-card-strip">{copy("home.dust.ticker")}</span>
            <span className="dust-coin dust-coin--card">
              <Coin />
            </span>
            <span className="dust-card-amount">{copy("home.dust.amount")}</span>
            <span className="dust-card-ticker">{copy("home.dust.ticker")}</span>
            <span className="dust-card-chain">{copy("home.dust.chain")}</span>
            <span className="dust-card-foot">
              <span>{copy("home.dust.fedBy")}</span>
              <b>{copy("home.dust.card")}</b>
            </span>
            <span className="dust-card-foil" />
          </div>
        </div>
        <p className="dust-payoff" data-dust-payoff="">
          <span className="dust-payoff-upto">{copy("home.dust.upTo")}</span>
          <span className="dust-payoff-x">
            <span data-dust-count="">{copy("home.dust.times")}</span>×
          </span>
          <span className="dust-payoff-when">{copy("home.dust.when")}</span>
          <span className="dust-payoff-range">{copy("home.dust.range")}</span>
        </p>
        <svg className="dust-demo-path" aria-hidden="true">
          <defs>
            <marker
              id="dust-arc-head"
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="12"
              markerHeight="12"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M2 1.5 7 5 2 8.5" />
            </marker>
            <mask id="dust-arc-reveal" maskUnits="userSpaceOnUse">
              <path data-dust-trace="" />
            </mask>
          </defs>
          <path
            data-dust-path=""
            mask="url(#dust-arc-reveal)"
            markerEnd="url(#dust-arc-head)"
          />
        </svg>
        <span className="dust-demo-feed" aria-hidden="true">
          {copy("home.dust.feed")}
        </span>
        <span className="dust-coin dust-demo-flyer" aria-hidden="true">
          <Coin />
        </span>
        <figcaption className="sr-only">{copy("home.dust.caption")}</figcaption>
      </figure>
      <ol className="dust-steps">
        {steps.map((step) => (
          <li key={step.id}>
            <span className="dust-step-icon" data-pop="" aria-hidden="true">
              {step.icon}
            </span>
            <Copy as="h3">{copy(`home.dust.${step.id}.title`)}</Copy>
            <Copy>{copy(`home.dust.${step.id}.body`)}</Copy>
          </li>
        ))}
      </ol>
      <Copy className="dust-pays-back">{copy("home.dust.back")}</Copy>
      <p className="dust-pays-note">{copy("home.dust.note")}</p>
    </section>
  );
}
