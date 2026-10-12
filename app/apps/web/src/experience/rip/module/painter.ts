/* eslint-disable */
// Synced from experience/lab/src/rip/painter.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Paints card faces off the main thread: a module Worker with OffscreenCanvas returns
 * vertically flipped ImageBitmaps (ready for texImage2D with flipY = false). If Workers,
 * OffscreenCanvas or worker fonts are unavailable, it paints on the main thread instead.
 */
import * as THREE from "three";
import fraunces600 from "@fontsource/fraunces/files/fraunces-latin-600-normal.woff2?url";
import fraunces700 from "@fontsource/fraunces/files/fraunces-latin-700-normal.woff2?url";
import fraunces600i from "@fontsource/fraunces/files/fraunces-latin-600-italic.woff2?url";
import dmSans500 from "@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2?url";
import dmSans700 from "@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff2?url";
import type { FontFiles, AnyCanvas } from "./assets";
import { paintJob, type PaintJob } from "./painter-jobs";

export type { PaintJob };

export interface Painted {
  /** Colour image and, for faces, the material mask. */
  images: (ImageBitmap | AnyCanvas)[];
  /** True when the images are already flipped (worker ImageBitmaps). */
  flipped: boolean;
}

const abs = (u: string) => (u ? new URL(u, document.baseURI).href : u);

const FONTS: FontFiles[] = [
  { family: "Fraunces", weight: "600", style: "normal", url: fraunces600 },
  { family: "Fraunces", weight: "700", style: "normal", url: fraunces700 },
  { family: "Fraunces", weight: "600", style: "italic", url: fraunces600i },
  { family: "DM Sans", weight: "500", style: "normal", url: dmSans500 },
  { family: "DM Sans", weight: "700", style: "normal", url: dmSans700 },
].map((f) => ({ ...f, url: abs(f.url) }));

export class CardPainter {
  /** Two workers: the five faces of a pull paint in parallel. */
  private workers: Worker[] = [];
  private next = 0;
  private get worker(): Worker | null {
    return this.workers.length
      ? this.workers[this.next++ % this.workers.length]
      : null;
  }
  private pending = new Map<
    number,
    { resolve: (p: Painted) => void; reject: (e: unknown) => void }
  >();
  private seq = 0;
  private assetsBase: string;
  mode: "worker" | "main" = "main";

  constructor(assetsBase: string) {
    this.assetsBase = abs(assetsBase);
    const capable =
      typeof Worker !== "undefined" &&
      typeof OffscreenCanvas !== "undefined" &&
      typeof createImageBitmap !== "undefined";
    if (!capable) return;
    try {
      for (let i = 0; i < 2; i++) {
        const w = new Worker(new URL("./card-worker.ts", import.meta.url), {
          type: "module",
          name: `rip-card-painter-${i}`,
        });
        w.onmessage = (e: MessageEvent) => {
          const { id, ok, images, error } = e.data as {
            id: number;
            ok: boolean;
            images?: ImageBitmap[];
            error?: string;
          };
          const p = this.pending.get(id);
          if (!p) return;
          this.pending.delete(id);
          if (ok && images) p.resolve({ images, flipped: true });
          else p.reject(new Error(error ?? "paint failed"));
        };
        w.onerror = () => this.fallBack();
        this.workers.push(w);
      }
      this.mode = "worker";
    } catch {
      this.workers.forEach((w) => w.terminate());
      this.workers = [];
      this.mode = "main";
    }
  }

  private fallBack() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.mode = "main";
    // Anything still pending is repainted on the main thread by its caller (see paint()).
    for (const [, p] of this.pending) p.reject(new Error("worker unavailable"));
    this.pending.clear();
  }

  private normalise(job: PaintJob): PaintJob {
    if (job.kind === "dust" && job.card)
      return { ...job, card: { ...job.card, logoUrl: abs(job.card.logoUrl) } };
    if (job.kind === "hit" || job.kind === "teaser")
      return { ...job, hit: { ...job.hit, logoUrl: abs(job.hit.logoUrl) } };
    return job;
  }

  async paint(job: PaintJob): Promise<Painted> {
    const j = this.normalise(job);
    const worker = this.worker;
    if (worker) {
      try {
        return await new Promise<Painted>((resolve, reject) => {
          const id = ++this.seq;
          this.pending.set(id, { resolve, reject });
          worker.postMessage({
            id,
            job: j,
            fonts: FONTS,
            assetsBase: this.assetsBase,
          });
        });
      } catch (err) {
        console.warn(
          "[rip] worker paint failed, painting on the main thread",
          err,
        );
        this.fallBack();
      }
    }
    return { images: await paintJob(j, this.assetsBase), flipped: false };
  }

  dispose() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
  }
}

/** Wraps painted images as textures (colour first, sRGB; masks linear). */
export function texturesFrom(
  p: Painted,
  renderer: THREE.WebGLRenderer,
): THREE.Texture[] {
  return p.images.map((img, i) => {
    const t = new THREE.Texture(img as TexImageSource);
    t.flipY = !p.flipped;
    t.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  });
}
