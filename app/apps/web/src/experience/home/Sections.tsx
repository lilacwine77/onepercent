import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { Arrowed } from "./Hero";
import { DustPays, Story } from "./Dust";
import { Picture } from "./Picture";
import { copy, editions, tiers } from "./copy";

const asset = (name: string) => `/experience/home/${name}`;
const vars = (value: Record<string, string | number>) => value as CSSProperties;

/** Adds `is-in` once the element scrolls into view (the reveal choreography). */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      element.classList.add("is-in");
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          element.classList.add("is-in");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -14% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/** Per-character spring, as the landing's titles; the real text stays for assistive tech. */
function Spring({ text, id }: { text: string; id?: string }) {
  let index = 0;
  return (
    <h2 className="spring" id={id}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split(" ").map((word, w) => (
          <span key={w}>
            {w > 0 && " "}
            <span className="word">
              {Array.from(word).map((char, c) => (
                <span className="char" style={vars({ "--i": index++ })} key={c}>
                  {char}
                </span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </h2>
  );
}

/** Cursor light on the foil (landing pack-foil): tilt, glare and iridescence. */
function foil(event: PointerEvent<HTMLElement>) {
  const card = event.currentTarget;
  if (
    event.pointerType !== "mouse" ||
    document.documentElement.dataset.motion === "reduced"
  )
    return;
  const box = card.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
  const y = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
  card.style.setProperty("--fx", `${x * 100}%`);
  card.style.setProperty("--fy", `${y * 100}%`);
  card.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
  card.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
  card.classList.add("is-lit");
}
function unlit(event: PointerEvent<HTMLElement>) {
  const card = event.currentTarget;
  card.classList.remove("is-lit");
  for (const name of ["--fx", "--fy", "--rx", "--ry"])
    card.style.removeProperty(name);
}

function Packs({ flowsLocked }: { flowsLocked?: boolean }) {
  const ref = useInView<HTMLElement>();
  return (
    <section
      ref={ref}
      id="packs"
      className="home-packs"
      aria-labelledby="packs-title"
      tabIndex={-1}
    >
      <Spring text={copy("home.packs.title")} id="packs-title" />
      <p className="home-sub reveal">{copy("home.packs.inside")}</p>
      <ul className="pack-row">
        {editions.map((edition, index) => (
          <li
            key={edition.id}
            className="pack-card reveal"
            style={vars({
              "--i": index,
              "--mask": `url(${asset(`pack-${edition.id}-440.webp`)})`,
            })}
            data-edition={edition.id}
            onPointerMove={foil}
            onPointerLeave={unlit}
          >
            <div className="pack-art">
              <div className="pack-float">
                <Picture
                  name={`pack-${edition.id}`}
                  widths={[440, 720]}
                  sizes="(max-width: 899px) 42vw, 22vw"
                />
                <span className="foil-light" aria-hidden="true" />
                <span className="foil-iris" aria-hidden="true" />
              </div>
            </div>
            <h3>{edition.name}</h3>
            <p className="pack-finish">{edition.finish}</p>
            <p className="pack-price">{edition.price}</p>
            {!flowsLocked && (
              <a className="pack-cta" href={`/rip?edition=${edition.id}`}>
                <Arrowed
                  text={copy("home.packs.rip", { edition: edition.name })}
                />
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="ladder reveal">
        <ul aria-label={copy("home.packs.inside")}>
          {tiers.map((tier) => (
            <li key={tier.id} data-tier={tier.id}>
              <span className="swatch" aria-hidden="true" />
              {tier.label} <b>{tier.mult}</b>
            </li>
          ))}
          <li data-tier="jackpot">
            <span className="swatch" aria-hidden="true" />
            {copy("home.packs.jackpot")}
          </li>
          <li data-tier="one_pct">
            <span className="swatch" aria-hidden="true" />
            {copy("home.packs.onePct")}
          </li>
        </ul>
        <a href="/fairness">{copy("home.packs.odds")}</a>
      </div>
    </section>
  );
}

/** Below the hero: the app's packs (the boosters), then the landing's "Got dust?
 * Feed the machine." and "How dust pays." (onepercent.fun, D19). */
export function Sections({
  reducedMotion,
  flowsLocked,
}: {
  reducedMotion: boolean;
  flowsLocked?: boolean;
}) {
  return (
    <>
      <Packs flowsLocked={flowsLocked} />
      <Story flowsLocked={flowsLocked} />
      <DustPays reducedMotion={reducedMotion} />
    </>
  );
}
