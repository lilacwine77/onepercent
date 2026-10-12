/* eslint-disable */
// Synced from experience/cards-lab/src/cards/ctx.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import type { Translate } from "./copy";
import type { CardsEventMap, SoundCue } from "./types";

/** What every part of the component shares. */
export interface Ctx {
  t: Translate;
  assetsBase: string;
  reduced(): boolean;
  /** Phone layout (< 720 px). */
  mobile(): boolean;
  emit<E extends keyof CardsEventMap>(
    e: E,
    ...args: Parameters<CardsEventMap[E]>
  ): void;
  sound(cue: SoundCue, index?: number): void;
  /** Polite screen-reader announcement. */
  announce(text: string): void;
}
