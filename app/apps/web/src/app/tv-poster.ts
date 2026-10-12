/** The home's TV poster (its LCP image): widths, sizes and srcset, shared by the
 * poster (experience/home/HomePoster.tsx) and its early preload (poster-preload.ts). */
export const TV_ASSETS = "/experience/home/";
export const TV_WIDTHS = [640, 768, 960, 1440];
export const TV_SIZES = "(max-width: 899px) 92vw, 56vw";
export const tvSet = (ext: "avif" | "webp") =>
  TV_WIDTHS.map((w) => `${TV_ASSETS}tv-${w}.${ext} ${w}w`).join(", ");
