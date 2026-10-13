import type { ReactNode } from "react";

/** Props of the home experience (wave 1 home, D19). Codex fills them from config. */
export interface HomeProps {
  /** Opening notice supplied by the app's launch gate. */
  launchNotice?: ReactNode;
  /** Hide flow entry points until the app opens. */
  flowsLocked?: boolean;
  /**
   * The machine's phase from `/api/config`; null when it is not live (404/503) or
   * unreachable, undefined while the first read is on its way (the hero shows the
   * actions' loading shape). Setup, Stock-Up and Power-On count down, On Air is live,
   * later phases are over (the hero derives this, so the entry stays small).
   */
  phase: string | null | undefined;
  /** Announced Stock-Up and On Air times, chain clock seconds (0: not set). */
  season: { stockUpTs?: number; onAirTs?: number } | null;
  flags: { feed: boolean; packs: boolean };
  /** Chain-clock now (ms) for the countdown. */
  now(): number;
  reducedMotion: boolean;
  soundOn: boolean;
}
