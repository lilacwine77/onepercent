// Motion toolkit for the film compositor. Everything is a pure function of time.

export const FPS = 60;
export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5 s
export const beat = (n) => n * BEAT;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const mix = lerp;

/** CSS cubic-bezier as a function of progress (Newton + bisection). */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const E = {
  linear: (u) => u,
  // The brand's own curves (src/styles.css, da-direction §4.1).
  arrive: cubicBezier(0.22, 1, 0.36, 1),
  spring: cubicBezier(0.175, 0.885, 0.32, 1.6),
  compose: cubicBezier(0.625, 0.05, 0, 1),
  mask: cubicBezier(0.455, 0.03, 0.515, 0.955),
  expoOut: (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  expoIn: (u) => (u <= 0 ? 0 : Math.pow(2, 10 * u - 10)),
  expoInOut: (u) =>
    u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2,
  quintOut: (u) => 1 - Math.pow(1 - u, 5),
  quartOut: (u) => 1 - Math.pow(1 - u, 4),
  cubicOut: (u) => 1 - Math.pow(1 - u, 3),
  cubicIn: (u) => u * u * u,
  quartIn: (u) => u * u * u * u,
  sineInOut: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  cubicInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  quartInOut: (u) => (u < 0.5 ? 8 * u * u * u * u : 1 - Math.pow(-2 * u + 2, 4) / 2),
  backOut: (u, s = 1.70158) => 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2),
  // Film easing: a fast, confident arrival (cubic-bezier(.16,1,.3,1)).
  snap: cubicBezier(0.16, 1, 0.3, 1),
  whip: cubicBezier(0.7, 0, 0.2, 1),
};

/** Eased progress of t through [t0, t1]. */
export const seg = (t, t0, t1, ease = E.linear) => ease(clamp((t - t0) / (t1 - t0)));

/**
 * A damped spring from 0 to 1 started at t0 (seconds), analytic.
 * freq in Hz, damping ratio < 1 overshoots.
 */
export function spring(t, t0, { freq = 2.2, damping = 0.55 } = {}) {
  const x = t - t0;
  if (x <= 0) return 0;
  const w = 2 * Math.PI * freq;
  if (damping >= 1) return 1 - Math.exp(-w * x) * (1 + w * x);
  const wd = w * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w * x) * (Math.cos(wd * x) + ((damping * w) / wd) * Math.sin(wd * x));
}

/** Keyframes: [[t, value, easeIntoThisKey], ...] → value at t. */
export function keys(list) {
  return (t) => {
    if (t <= list[0][0]) return list[0][1];
    for (let i = 1; i < list.length; i++) {
      const [t1, v1, ease = E.cubicInOut] = list[i];
      const [t0, v0] = list[i - 1];
      if (t <= t1) {
        const u = ease(clamp((t - t0) / (t1 - t0 || 1)));
        if (Array.isArray(v0)) return v0.map((a, k) => lerp(a, v1[k], u));
        return lerp(v0, v1, u);
      }
    }
    return list[list.length - 1][1];
  };
}

/** Piecewise-linear time remap with eased speed changes: [[tFilm, srcFrame], ...]. */
export function remap(points) {
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [t1, f1, ease = E.linear] = points[i];
      const [t0, f0] = points[i - 1];
      if (t <= t1) return lerp(f0, f1, ease(clamp((t - t0) / (t1 - t0 || 1))));
    }
    return points[points.length - 1][1];
  };
}

/** Deterministic pseudo-random numbers. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// DOM helpers ------------------------------------------------------------

export function el(tag, cls, parent, attrs = {}) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}

export function css(node, styles) {
  for (const [k, v] of Object.entries(styles)) {
    if (k.startsWith("--")) node.style.setProperty(k, v);
    else node.style[k] = v;
  }
}

export function show(node, on) {
  const value = on ? "" : "none";
  if (node.style.display !== value) node.style.display = value;
  return on;
}

export const px = (v) => `${v}px`;

/** transform string from a plain object. */
export function tf({ x = 0, y = 0, z = 0, s = 1, sx = 1, sy = 1, r = 0, rx = 0, ry = 0, persp = 0 } = {}) {
  let out = persp ? `perspective(${persp}px) ` : "";
  out += `translate3d(${x}px, ${y}px, ${z}px)`;
  if (rx) out += ` rotateX(${rx}deg)`;
  if (ry) out += ` rotateY(${ry}deg)`;
  if (r) out += ` rotate(${r}deg)`;
  if (s !== 1 || sx !== 1 || sy !== 1) out += ` scale(${s * sx}, ${s * sy})`;
  return out;
}

// Images -------------------------------------------------------------------

const pendingDecodes = new Set();
const decoded = new Map();

/** Set an <img> source and track its decode, so a frame is shot only when ready. */
export function setSrc(img, src) {
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  img.src = src;
  const p = img.decode().catch(() => {
    console.warn("decode failed", src);
  });
  pendingDecodes.add(p);
  p.finally(() => pendingDecodes.delete(p));
}

export async function settled() {
  while (pendingDecodes.size) await Promise.all([...pendingDecodes]);
}

export async function preload(urls) {
  await Promise.all(
    urls.map(async (u) => {
      if (decoded.has(u)) return;
      const img = new Image();
      img.src = u;
      await img.decode().catch(() => console.warn("preload failed", u));
      decoded.set(u, img);
    }),
  );
}

// Type ---------------------------------------------------------------------

/**
 * A headline whose words rise out of masks. `lines` is an array of arrays of
 * words; a word can be { t: "dust.", cls: "accent" }.
 */
export function headline(parent, lines, cls = "") {
  const root = el("div", `hl ${cls}`, parent);
  const words = [];
  for (const line of lines) {
    const row = el("div", "hl-line", root);
    for (const [i, raw] of line.entries()) {
      const word = typeof raw === "string" ? { t: raw } : raw;
      const mask = el("span", `hl-mask ${word.cls ?? ""}`, row);
      const inner = el("span", "hl-word", mask);
      inner.textContent = word.t;
      if (i < line.length - 1) row.append(document.createTextNode(" "));
      words.push({ mask, inner, ...word });
    }
  }
  return { root, words };
}

/**
 * Animate a headline: words rise in from `tin` (stagger s per word, duration d)
 * and leave upward from `tout`.
 */
export function playHeadline(h, t, { tin, tout = Infinity, stagger = 0.045, d = 0.62, outStagger = 0.03, outD = 0.32, from = 1.32, tilt = 4, pops = {} }) {
  h.words.forEach((w, i) => {
    const t0 = (w.at ?? tin + i * stagger);
    const u = seg(t, t0, t0 + d, E.snap);
    const pop = pops[i] ? spring(t, t0, pops[i]) : u;
    const o = Number.isFinite(tout) ? seg(t, tout + i * outStagger, tout + i * outStagger + outD, E.expoIn) : 0;
    const y = (1 - u) * from * 100 - o * 140;
    const r = (1 - u) * tilt;
    const s = pops[i] ? 0.6 + 0.4 * pop : 1;
    w.inner.style.transform = `translate3d(0, ${y}%, 0) rotate(${r}deg) scale(${s})`;
    w.inner.style.opacity = t < t0 ? "0" : String(1 - clamp((o - 0.6) / 0.4));
  });
}
