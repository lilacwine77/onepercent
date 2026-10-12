/* eslint-disable */
// Synced from experience/lab/src/rip/painter-jobs.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/** Paint jobs, shared by the Worker and the main-thread fallback (no DOM access). */
import {
  paintCardBack,
  paintDustCard,
  paintHitCard,
  paintOnePctCard,
} from "./card-art";
import type { AnyCanvas } from "./assets";
import type { Edition, RipDustCard, RipHitCard } from "./types";

export type PaintJob =
  | { kind: "dust"; card: RipDustCard | null; edition: Edition }
  | { kind: "hit"; hit: RipHitCard }
  | { kind: "teaser"; hit: RipHitCard }
  | { kind: "back" };

export async function paintJob(
  job: PaintJob,
  assetsBase: string,
): Promise<AnyCanvas[]> {
  switch (job.kind) {
    case "dust": {
      const a = await paintDustCard(job.card, job.edition);
      return [a.art, a.mask];
    }
    case "hit": {
      const a = await paintHitCard(job.hit, assetsBase);
      return [a.art, a.mask];
    }
    case "teaser": {
      const a = await paintOnePctCard(job.hit, assetsBase, true);
      return [a.art, a.mask];
    }
    case "back": {
      const a = await paintCardBack(assetsBase);
      return [a.art, a.mask];
    }
  }
}
