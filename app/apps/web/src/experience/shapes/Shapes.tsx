/**
 * What an experience looks like while its chunk is on its way: the same blocks
 * at the same sizes (no layout shift), a soft sheen (styles.css .sk), no text,
 * no spinner. Hosts pass them to ExperienceSlot as `poster` and `placeholder`.
 */
// Their styles live in styles.css: a pure module, tree-shaken where unused.
const repeat = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Feed panel: title, line, five bag rows. */
export function FeedShape() {
  return (
    <div className="xp-sk feed-sk" aria-hidden="true">
      <span className="sk feed-sk-title" />
      <span className="sk feed-sk-title is-short" />
      <span className="sk feed-sk-line" />
      <div className="feed-sk-panel">
        <span className="sk feed-sk-head" />
        {repeat(5).map((i) => (
          <div className="feed-sk-row" key={i}>
            <span className="sk feed-sk-coin" />
            <span className="sk feed-sk-text" />
            <span className="sk feed-sk-seg" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * My cards: the cover (the total and its bulk bar), the toolbar and a row of cards;
 * an empty binder gets the module's slim cover and its empty slot instead. `bulk`
 * is how many bulk bar buttons apply (1 to 3): phones stack them in the cover.
 */
export function CardsShape({
  empty = false,
  bulk = 3,
}: {
  empty?: boolean;
  bulk?: number;
}) {
  if (empty)
    return (
      <div className="xp-sk cards-sk is-bare" aria-hidden="true">
        <span className="sk cards-sk-hero" />
        <div className="cards-sk-empty">
          <span className="sk cards-sk-slot" />
          <span className="sk cards-sk-line" />
          <span className="sk cards-sk-line is-short" />
          <span className="sk cards-sk-btn" />
        </div>
      </div>
    );
  return (
    <div className="xp-sk cards-sk" data-bulk={bulk} aria-hidden="true">
      <span className="sk cards-sk-hero" />
      <div className="cards-sk-tools">
        <span className="sk cards-sk-tabs" />
        <span className="sk cards-sk-tool" />
      </div>
      <div className="cards-sk-grid">
        {repeat(5).map((i) => (
          <span className="sk cards-sk-card" key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * The machine poster the Rip stage shows first (rip/module/poster.ts POSTERS): the
 * portrait one under 85/100, as the module and RipShape's <source> choose.
 */
export const machinePoster = (assets: string) =>
  `${assets}${window.innerWidth / window.innerHeight < 0.85 ? "machine-poster-portrait.webp" : "machine-poster.webp"}`;

/** The Rip stage: the idle machine's poster (as the module shows it) and the dock. */
export function RipShape({
  assets,
  dock = true,
}: {
  assets: string;
  dock?: boolean;
}) {
  return (
    <div className="xp-sk rip-sk" aria-hidden="true">
      <picture>
        <source
          media="(max-aspect-ratio: 85/100)"
          srcSet={`${assets}machine-poster-portrait.webp`}
        />
        <img
          src={`${assets}machine-poster.webp`}
          alt=""
          decoding="async"
          data-fade=""
        />
      </picture>
      {dock && <span className="sk rip-sk-dock" />}
    </div>
  );
}
