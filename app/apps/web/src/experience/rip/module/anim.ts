/* eslint-disable */
// Synced from experience/lab/src/rip/anim.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/** Easing curves from the art direction (§4.1) and a tiny promise-based tween engine. */

export type Ease = (t: number) => number;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** CSS cubic-bezier(x1, y1, x2, y2) evaluated with Newton + bisection fallback. */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Ease {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-5) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0,
      hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const ease = {
  linear: (t: number) => t,
  /** --ease-spring: pops (overshoots to ~1.1). */
  spring: cubicBezier(0.175, 0.885, 0.32, 1.6),
  /** A softer spring for heavy objects. */
  springSoft: cubicBezier(0.2, 0.9, 0.3, 1.25),
  /** --ease-arrive: arrivals. */
  arrive: cubicBezier(0.22, 1, 0.36, 1),
  /** --ease-compose: big moves. */
  compose: cubicBezier(0.625, 0.05, 0, 1),
  /** --ease-mask: copy reveals. */
  mask: cubicBezier(0.455, 0.03, 0.515, 0.955),
  inQuad: (t: number) => t * t,
  inCubic: (t: number) => t * t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  outBack: (t: number) => {
    const c1 = 1.70158,
      c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/** Damped bounce for drops: 0→1 with two diminishing bounces. */
export function bounce(t: number): number {
  const n1 = 7.5625,
    d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export class AbortRip extends Error {
  constructor() {
    super("The Rip sequence was interrupted.");
    this.name = "AbortError";
  }
}

interface ActiveTween {
  start: number;
  duration: number;
  update: (t: number, raw: number) => void;
  ease: Ease;
  resolve: () => void;
}

/** Frame-driven tweens. `tick(now)` is called by the render loop. */
export class Animator {
  private tweens = new Set<ActiveTween>();
  private loops = new Set<(now: number, dt: number) => void>();
  now = 0;
  /** Global multiplier on durations (reduced motion collapses them). */
  speed = 1;

  tick(now: number, dt: number) {
    this.now = now;
    for (const tw of [...this.tweens]) {
      const raw =
        tw.duration <= 0 ? 1 : clamp01((now - tw.start) / tw.duration);
      tw.update(tw.ease(raw), raw);
      if (raw >= 1) {
        this.tweens.delete(tw);
        tw.resolve();
      }
    }
    for (const loop of [...this.loops]) loop(now, dt);
  }

  tween(
    duration: number,
    update: (t: number, raw: number) => void,
    easing: Ease = ease.linear,
  ): Promise<void> {
    return new Promise((resolve) => {
      const tw: ActiveTween = {
        start: this.now,
        duration: duration * this.speed,
        update,
        ease: easing,
        resolve,
      };
      update(easing(0), 0);
      this.tweens.add(tw);
    });
  }

  wait(duration: number): Promise<void> {
    return this.tween(duration, () => {});
  }

  /** Runs `fn` every frame until the returned stop function is called. */
  loop(fn: (now: number, dt: number) => void): () => void {
    this.loops.add(fn);
    return () => this.loops.delete(fn);
  }

  /** Jumps every running tween to its end state (update at t = 1), then resolves it. */
  finishAll() {
    for (const tw of [...this.tweens]) {
      this.tweens.delete(tw);
      tw.update(tw.ease(1), 1);
      tw.resolve();
    }
  }

  /** Completes every running tween immediately (their promises resolve). */
  flush() {
    for (const tw of [...this.tweens]) {
      this.tweens.delete(tw);
      tw.resolve();
    }
    this.loops.clear();
  }
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
