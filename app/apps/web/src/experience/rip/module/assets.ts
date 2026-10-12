/* eslint-disable */
// Synced from experience/lab/src/rip/assets.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Image loading, font readiness and canvas helpers. Everything here also runs inside the
 * card-painting Worker (OffscreenCanvas + ImageBitmap + WorkerGlobalScope.fonts).
 */

export type Ctx2D =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Img = HTMLImageElement | ImageBitmap;

const inWorker = typeof document === "undefined";
const imageCache = new Map<string, Promise<Img | null>>();

/** Loads an image (CORS-anonymous). Resolves `null` on failure so a card never blocks on a bad logo. */
export function loadImage(url: string): Promise<Img | null> {
  if (!url) return Promise.resolve(null);
  let p = imageCache.get(url);
  if (!p) {
    p = inWorker
      ? fetch(url, { mode: "cors" })
          .then((r) =>
            r.ok ? r.blob() : Promise.reject(new Error(String(r.status))),
          )
          .then((b) => createImageBitmap(b))
          .catch(() => null)
      : new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.decoding = "async";
          // Decode off the main thread before the first draw (no decode hitch mid-animation).
          img.onload = () => {
            img
              .decode()
              .catch(() => {})
              .then(() => resolve(img));
          };
          img.onerror = () => resolve(null);
          img.src = url;
        });
    imageCache.set(url, p);
  }
  return p;
}

/** Font files for the Worker (it has no access to the page's @font-face rules). */
export interface FontFiles {
  family: string;
  weight: string;
  style: string;
  url: string;
}

let fontsReady: Promise<void> | null = null;
/** Fraunces and DM Sans must be ready before any card face is painted (crisp, on-brand text). */
export function ensureFonts(files?: FontFiles[]): Promise<void> {
  if (!fontsReady) {
    if (inWorker) {
      const set = (self as unknown as { fonts: FontFaceSet }).fonts;
      fontsReady = Promise.all(
        (files ?? []).map(async (f) => {
          const face = new FontFace(f.family, `url(${f.url})`, {
            weight: f.weight,
            style: f.style,
          });
          set.add(await face.load());
        }),
      ).then(() => undefined);
    } else {
      const specs = [
        '700 64px "Fraunces"',
        '600 64px "Fraunces"',
        'italic 600 64px "Fraunces"',
        '500 32px "DM Sans"',
        '700 32px "DM Sans"',
      ];
      fontsReady = Promise.all(
        specs.map((s) => document.fonts.load(s).catch(() => [])),
      ).then(() => undefined);
    }
  }
  return fontsReady;
}

export function makeCanvas(w: number, h: number): [AnyCanvas, Ctx2D] {
  if (inWorker) {
    const c = new OffscreenCanvas(w, h);
    return [c, c.getContext("2d")!];
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: false })!;
  return [c, ctx];
}

export type Radii = number | [number, number, number, number];

/** Rounded rectangle path; radii order: top-left, top-right, bottom-right, bottom-left. */
export function rrect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: Radii,
) {
  const [tl, tr, br, bl] = typeof r === "number" ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

/** Picks the largest font size ≤ `max` that keeps `text` within `maxWidth`. */
export function fitFont(
  ctx: Ctx2D,
  text: string,
  maxWidth: number,
  max: number,
  min: number,
  font: (px: number) => string,
): number {
  let size = max;
  while (size > min) {
    ctx.font = font(size);
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  ctx.font = font(size);
  return size;
}

export function setSpacing(ctx: Ctx2D, px: number) {
  // letterSpacing is widely supported (Chromium 99+, Safari 17+, Firefox 115+).
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Maps the luminance of an image region onto a gold ramp (used for the Jackpot face). */
export function goldify(
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  w: number,
  h: number,
): AnyCanvas {
  const [c, ctx] = makeCanvas(w, h);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  const ramp = [
    [0.0, [58, 34, 8]],
    [0.22, [122, 78, 22]],
    [0.45, [190, 135, 50]],
    [0.68, [228, 182, 88]],
    [0.86, [246, 214, 128]],
    [1.0, [255, 246, 214]],
  ] as const;
  for (let i = 0; i < d.length; i += 4) {
    let l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    l = Math.min(1, Math.pow(l, 0.72) * 1.1 + 0.08);
    let k = 1;
    while (k < ramp.length - 1 && ramp[k][0] < l) k++;
    const [t0, c0] = ramp[k - 1];
    const [t1, c1] = ramp[k];
    const t = Math.max(0, Math.min(1, (l - t0) / (t1 - t0)));
    d[i] = c0[0] + (c1[0] - c0[0]) * t;
    d[i + 1] = c0[1] + (c1[1] - c0[1]) * t;
    d[i + 2] = c0[2] + (c1[2] - c0[2]) * t;
    d[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}
