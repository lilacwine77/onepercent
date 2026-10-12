/* eslint-disable */
// Synced from experience/lab/src/rip/pack-geometry.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Pack geometry, buildable in a Worker (OffscreenCanvas height field, typed arrays out):
 * two connected sheets (body and the strip above the serrated tear line), front and back.
 */
import * as THREE from "three";
import type { EditionInfo } from "./brand";

/** World size of the square pack artwork (1254 px). */
export const PACK_SIZE = 2.6;
const SRC = 1254;

/** Deterministic serration knots: unequal tongues, not a row of identical teeth (pack-asset.js). */
function makeKnots(seed: number): [number, number][] {
  const rnd = (n: number) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const knots: [number, number][] = [[0, 0]];
  // Torn by hand: uneven tongues, a few deep bites, never a row of identical teeth.
  for (let u = 0, i = 1; u < 1; i++) {
    u = Math.min(1, u + 0.008 + 0.026 * rnd(i));
    const sign = i % 2 ? 1 : -1;
    const bite = rnd(i + 31) > 0.82 ? 2.2 : 1;
    knots.push([u, sign * (0.003 + 0.0065 * rnd(i + 97)) * bite]);
  }
  return knots;
}

export interface Tear {
  tearV: (u: number) => number;
  span: [number, number];
  knots: [number, number][];
}

export function makeTear(tear: EditionInfo["tear"]): Tear {
  const [x0, y0, x1, y1] = tear;
  const seed = x0 + y1;
  const knots = makeKnots(seed);
  const noise = (u: number) => {
    let i = 1;
    while (i < knots.length - 1 && knots[i][0] < u) i++;
    const a = knots[i - 1],
      b = knots[i];
    return THREE.MathUtils.lerp(
      a[1],
      b[1],
      Math.max(0, Math.min(1, (u - a[0]) / (b[0] - a[0]))),
    );
  };
  // The tear runs just under the crimped seal (the strip carries the whole crimp and a band of
  // foil), with a slow wander so it reads as torn by hand.
  const below = 24;
  const tearV = (u: number) => {
    const t = (u * SRC - x0) / (x1 - x0);
    return (
      (THREE.MathUtils.lerp(y0, y1, t) + below) / SRC +
      noise(u) +
      0.004 * Math.sin(u * 17 + seed * 0.01) +
      0.002 * Math.sin(u * 41)
    );
  };
  return { tearV, span: [x0 / SRC, x1 / SRC], knots };
}

function canvas(n: number) {
  const c = new OffscreenCanvas(n, n);
  return [c, c.getContext("2d", { willReadFrequently: true })!] as const;
}

/** Pillow height field (0..1) from the artwork alpha: flat seals, puffed body. */
function heightField(
  image: CanvasImageSource,
  tearV: number,
): (u: number, v: number) => number {
  const N = 128;
  const [, actx] = canvas(N);
  actx.drawImage(image, 0, 0, N, N);
  const src = actx.getImageData(0, 0, N, N).data;
  const [m, mctx] = canvas(N);
  const mask = mctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const on = src[i * 4 + 3] > 128 ? 255 : 0;
    mask.data[i * 4] = mask.data[i * 4 + 1] = mask.data[i * 4 + 2] = on;
    mask.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(mask, 0, 0);
  const [, bctx] = canvas(N);
  bctx.fillStyle = "#000";
  bctx.fillRect(0, 0, N, N);
  bctx.filter = "blur(7px)";
  bctx.drawImage(m, 0, 0);
  const blurred = bctx.getImageData(0, 0, N, N).data;
  const H = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const x = blurred[i * 4] / 255;
    const t = Math.max(0, Math.min(1, (x - 0.5) / 0.45));
    H[i] = t * t * (3 - 2 * t);
  }
  const sealTop = tearV + 0.035,
    sealBottom = 0.875;
  return (u: number, v: number) => {
    const fx = Math.max(0, Math.min(N - 1.001, u * N - 0.5));
    const fy = Math.max(0, Math.min(N - 1.001, v * N - 0.5));
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const tx = fx - x0,
      ty = fy - y0;
    const h00 = H[y0 * N + x0],
      h10 = H[y0 * N + x0 + 1],
      h01 = H[(y0 + 1) * N + x0],
      h11 = H[(y0 + 1) * N + x0 + 1];
    const h =
      (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
    const s1 = Math.max(0, Math.min(1, (v - sealTop) / 0.09));
    const s2 = Math.max(0, Math.min(1, (sealBottom - v) / 0.09));
    const seal = s1 * s1 * (3 - 2 * s1) * (s2 * s2 * (3 - 2 * s2));
    return h * (0.08 + 0.92 * seal);
  };
}

export interface SheetArrays {
  position: Float32Array;
  normal: Float32Array;
  aImg: Float32Array;
  aSide: Float32Array;
  aTear: Float32Array;
  index: Uint32Array;
}
export interface PackGeometryData {
  body: SheetArrays;
  strip: SheetArrays;
}

export function buildPackGeometry(
  image: CanvasImageSource,
  edition: Pick<EditionInfo, "tear">,
): PackGeometryData {
  const { tearV, knots } = makeTear(edition.tear);
  const h = heightField(image, tearV(0.5));
  const columns = [
    ...new Set([
      ...Array.from({ length: 161 }, (_, i) => i / 160),
      ...knots.map((k) => k[0]).filter((u) => u > 0 && u < 1),
    ]),
  ].sort((a, b) => a - b);
  const depth = 0.17;
  const build = (
    top: (u: number) => number,
    bottom: (u: number) => number,
    rows: number,
    curve: (t: number) => number,
  ): SheetArrays => {
    const cols = columns.length;
    const n = 2 * (rows + 1) * cols;
    const P = new Float32Array(n * 3),
      IMG = new Float32Array(n * 2),
      SIDE = new Float32Array(n),
      TEAR = new Float32Array(n);
    const I = new Uint32Array(2 * rows * (cols - 1) * 6);
    let v3 = 0,
      v2 = 0,
      v1 = 0,
      ii = 0;
    for (const side of [1, -1]) {
      const base = v1;
      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i < cols; i++) {
          const u = columns[i];
          const vt = top(u),
            vb = bottom(u);
          const v = vt + (vb - vt) * curve(j / rows);
          P[v3++] = (u - 0.5) * PACK_SIZE;
          P[v3++] = (0.5 - v) * PACK_SIZE;
          P[v3++] = side * depth * h(u, v);
          IMG[v2++] = u;
          IMG[v2++] = v;
          SIDE[v1] = side;
          TEAR[v1++] = tearV(u);
        }
      }
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = base + j * cols + i,
            b = a + 1,
            c = a + cols,
            d = c + 1;
          if (side > 0) {
            I[ii++] = a;
            I[ii++] = c;
            I[ii++] = b;
            I[ii++] = b;
            I[ii++] = c;
            I[ii++] = d;
          } else {
            I[ii++] = a;
            I[ii++] = b;
            I[ii++] = c;
            I[ii++] = b;
            I[ii++] = d;
            I[ii++] = c;
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeVertexNormals();
    return {
      position: P,
      normal: g.getAttribute("normal").array as Float32Array,
      aImg: IMG,
      aSide: SIDE,
      aTear: TEAR,
      index: I,
    };
  };
  return {
    body: build(
      (u) => tearV(u),
      () => 1,
      64,
      (t) => Math.pow(t, 1.7),
    ),
    strip: build(
      () => 0,
      (u) => tearV(u),
      10,
      (t) => t,
    ),
  };
}

export function packGeometryTransfer(d: PackGeometryData): Transferable[] {
  return [d.body, d.strip].flatMap((s) => [
    s.position.buffer,
    s.normal.buffer,
    s.aImg.buffer,
    s.aSide.buffer,
    s.aTear.buffer,
    s.index.buffer,
  ]) as Transferable[];
}
