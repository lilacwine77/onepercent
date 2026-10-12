/* eslint-disable */
// Synced from experience/lab/src/rip/index.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * The Rip: pack-opening experience component for The 1% Machine.
 *
 *   const rip = mountRip(el, { assetsBase: '/assets/' });
 *   const done = rip.play({ edition: 'signature', pullId });
 *   rip.setResult(result);            // whenever the VRF answers
 *   rip.on('cardAction', (i, a) => …); // Sell · Go to My cards (a hit); Dust Cards land in My cards
 *   await done;
 */
import { RipStage } from "./controller";
import type { MountRipOptions, RipController } from "./types";

/** Thrown by mountRip when the device has no WebGL2 (render a semantic fallback instead). */
export class RipUnsupportedError extends Error {
  constructor() {
    super("WebGL2 is not available.");
    this.name = "RipUnsupportedError";
  }
}

export function mountRip(
  container: HTMLElement,
  opts: MountRipOptions,
): RipController {
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) throw new RipUnsupportedError();
  probe.getExtension("WEBGL_lose_context")?.loseContext();
  return new RipStage(container, opts);
}

/**
 * Jackpot meter mapping (visual, the architect's): pot size → globe fill 0..1.
 * `fullAt` is a display scale (the pot that shows a full globe), not economics. A square-root
 * curve keeps small pots visible; an empty pot keeps a token layer.
 */
export function jackpotLevel(input: {
  tokens: bigint | number;
  fullAt: bigint | number;
}): number {
  const t = Number(input.tokens),
    f = Number(input.fullAt);
  if (!(f > 0) || !(t > 0)) return 0.04;
  return Math.min(1, 0.06 + 0.94 * Math.sqrt(Math.min(1, t / f)));
}

/** Static files the module loads from `assetsBase` (copy them to the app's public folder). */
export const RIP_ASSET_FILES = [
  "pack-silver-hq.webp",
  "pack-first-light-hq.webp",
  "pack-closed-hq.webp",
  "pack-anthracite-hq.webp",
  "pack-back-hq.webp",
  "pepe-mascot-white-hq.webp",
  "pepe-all-white-hq.webp",
  "hero-studio-clean.webp",
  "machine-poster.webp",
  "machine-poster-portrait.webp",
] as const;

/** Default asset locations for the web app (`apps/web/public/experience/`). */
export function ripAssets(base = "/experience/"): {
  assetsBase: string;
  machineUrl: string;
} {
  const b = base.endsWith("/") ? base : `${base}/`;
  return { assetsBase: b, machineUrl: `${b}onepercent-machine.glb` };
}

export { RipFailedError } from "./controller";
export { END_COPY, endActions } from "./end";

export type {
  ActionState,
  CardAction,
  Edition,
  HitTier,
  MountRipOptions,
  RipBeat,
  RipController,
  RipDustCard,
  RipEventMap,
  RipHitCard,
  RipInput,
  RipQuotes,
  RipResult,
  SolQuote,
  SoundCue,
  SoundEvent,
} from "./types";
export { EDITIONS, TIERS } from "./brand";
