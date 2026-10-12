/**
 * The experience layer's public surface (03-M3 §6.1). Codex imports from here only.
 * Static exports stay tiny (they ship in the entry chunk); every experience is a
 * lazy loader for ExperienceSlot, and its props are type-only exports.
 *
 * Home (D19): `HomePoster` paints the first frame in the entry chunk; `loadHome`
 * is the home chunk (hero, showcase, how it works).
 */
export { HomePoster } from "./home/HomePoster";
export type { HomeProps } from "./home/types";
export const loadHome = () => import("./home/Home");

/** The Rip stage (synced lab module + dock). Loads three.js and GSAP. */
export const loadRip = () => import("./rip/RipView");
export type { RipViewProps } from "./rip/RipView";
export type {
  CardAction,
  RipResult,
  RipDustCard,
  RipHitCard,
} from "./rip/module/index";

/** My cards (synced cards-lab module). */
export const loadCards = () => import("./cards/CardsView");
/** Confirmed public data surfaces share the existing paper and foil controls. */
export const loadPublic = () => import("./public/PublicView");
export type { PublicViewProps } from "./public/types";
/** What the bulk bar offers (the module's rule), for the loading shape's size. */
export { bulkOptions } from "./cards/module/actions";
export type { CardsViewProps } from "./cards/CardsView";
export type {
  ActionPreview,
  CardRow,
  CardsAction,
  CardsData,
} from "./cards/module/index";

/** Feed panel and In the machine (wave 2 contract, 03-M3 §6.2). */
export const loadFeed = () => import("./feed/FeedView");
export type { FeedViewProps } from "./feed/FeedView";

/** Loading states of the experiences above (ExperienceSlot poster/placeholder). */
export {
  CardsShape,
  FeedShape,
  RipShape,
  machinePoster,
} from "./shapes/Shapes";
