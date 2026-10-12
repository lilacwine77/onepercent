/* eslint-disable */
// Synced from experience/cards-lab/src/cards/motion.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Motion toolkit: physically based springs (as GSAP eases with their natural duration),
 * an interactive spring integrator for pointer-driven values, press feedback and count-ups.
 * Transform and opacity only; one shared ticker (GSAP's), idle when nothing moves.
 */
import { gsap } from "gsap";

export { gsap };

/**
 * FLIP for same-size items (grid reflow): measures, mutates, then springs each moved item from its old
 * place. New items get `onEnter`. Transform only; the plugin-free version of GSAP Flip for this case.
 */
export function flip(
  items: HTMLElement[],
  mutate: () => void,
  o: { spring: Spring; onEnter?: (els: HTMLElement[]) => void; max?: number },
) {
  const vh = window.innerHeight;
  const first = new Map<HTMLElement, DOMRect>();
  for (const el of items.slice(0, o.max ?? 120))
    if (el.isConnected) first.set(el, el.getBoundingClientRect());
  mutate();
  const entered: HTMLElement[] = [];
  for (const el of items) {
    if (!el.isConnected) continue;
    const f = first.get(el);
    const l = el.getBoundingClientRect();
    if (!f) {
      if (l.bottom > 0 && l.top < vh) entered.push(el);
      continue;
    }
    const dx = f.left - l.left,
      dy = f.top - l.top;
    if (
      (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) &&
      Math.max(f.bottom, l.bottom) > 0 &&
      Math.min(f.top, l.top) < vh
    ) {
      gsap.fromTo(
        el,
        { x: dx, y: dy },
        {
          x: 0,
          y: 0,
          duration: o.spring.duration,
          ease: o.spring.ease,
          overwrite: "auto",
          clearProps: "transform",
        },
      );
    }
  }
  if (entered.length) o.onEnter?.(entered);
}

export interface Spring {
  ease: (p: number) => number;
  duration: number;
}
const cache = new Map<string, Spring>();

/**
 * A damped spring x'' = (−k(x − 1) − c·x′) / m from rest at 0 to 1, sampled at 600 Hz until it settles.
 * Returned as a GSAP ease plus the time it takes to settle, so tweens keep the physics' own timing.
 */
export function spring(
  stiffness: number,
  damping: number,
  mass = 1,
  velocity = 0,
): Spring {
  const key = `${stiffness}|${damping}|${mass}|${velocity}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dt = 1 / 600;
  const xs: number[] = [0];
  let x = 0,
    v = velocity,
    t = 0,
    calm = 0;
  while (t < 3) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    xs.push(x);
    if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02) {
      if (++calm > 24) break;
    } else calm = 0;
  }
  const n = xs.length - 1;
  const s: Spring = {
    duration: t,
    ease: (p: number) => {
      if (p <= 0) return 0;
      if (p >= 1) return 1;
      const f = p * n,
        i = Math.floor(f);
      return xs[i] + (xs[Math.min(n, i + 1)] - xs[i]) * (f - i);
    },
  };
  cache.set(key, s);
  return s;
}

/** Tuned presets (stiffness, damping). */
export const SPRINGS = {
  /** Buttons, chips, badges: quick with a small overshoot. */
  snappy: () => spring(520, 30),
  /** Sheets and panels: no visible overshoot. */
  sheet: () => spring(300, 34),
  /** Cards travelling between places: a soft landing with a hint of overshoot. */
  travel: () => spring(210, 23),
  /** Grid reflow (FLIP). */
  layout: () => spring(260, 30),
  /** A card settling into its slot: a short wobble. */
  settle: () => spring(380, 16),
  /** Pops (check marks, counters). */
  pop: () => spring(600, 18),
};

// ---------------------------------------------------------------------------
// Interactive springs (pointer tilt, foil light): integrated on GSAP's ticker
// ---------------------------------------------------------------------------

export class SpringValue {
  x: number;
  v = 0;
  target: number;
  constructor(
    public value0: number,
    public k = 170,
    public c = 19,
  ) {
    this.x = value0;
    this.target = value0;
  }
  step(dt: number) {
    const a = -this.k * (this.x - this.target) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
  get resting() {
    return Math.abs(this.x - this.target) < 0.002 && Math.abs(this.v) < 0.01;
  }
  snap(v: number) {
    this.x = this.target = v;
    this.v = 0;
  }
}

type Stepper = (dt: number) => boolean; // returns true while still moving
const steppers = new Set<Stepper>();
let ticking = false;
let timeScale = 1;
/** Lab only: slows every tween and spring (frame-by-frame review of the moments). */
export function setTimeScale(k: number) {
  timeScale = k;
  gsap.globalTimeline.timeScale(k);
}
function tick(_time: number, deltaMs: number) {
  const dt = Math.min(0.034, Math.max(0.001, deltaMs / 1000)) * timeScale;
  for (const s of [...steppers]) if (!s(dt)) steppers.delete(s);
  if (!steppers.size && ticking) {
    gsap.ticker.remove(tick);
    ticking = false;
  }
}
/** Runs `s` every frame until it returns false. */
export function animateWhile(s: Stepper) {
  steppers.add(s);
  if (!ticking) {
    gsap.ticker.add(tick);
    ticking = true;
  }
}
export function stopAnimating(s: Stepper) {
  steppers.delete(s);
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

const rmQuery =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
export const prefersReducedMotion = () => rmQuery?.matches ?? false;

// ---------------------------------------------------------------------------
// Press feedback (instant on pointerdown, spring release)
// ---------------------------------------------------------------------------

export function pressable(
  el: HTMLElement,
  isReduced: () => boolean,
  scale = 0.965,
): () => void {
  let down = false;
  const press = () => {
    if (down || (el as HTMLButtonElement).disabled) return;
    down = true;
    el.dataset.pressed = "";
    if (!isReduced())
      gsap.to(el, {
        scale,
        duration: 0.07,
        ease: "power2.out",
        overwrite: "auto",
      });
  };
  const release = () => {
    if (!down) return;
    down = false;
    delete el.dataset.pressed;
    if (isReduced()) {
      gsap.set(el, { scale: 1 });
      return;
    }
    const s = SPRINGS.snappy();
    gsap.to(el, {
      scale: 1,
      duration: s.duration,
      ease: s.ease,
      overwrite: "auto",
    });
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.type === "keydown" && !e.repeat) press();
    else if (e.type === "keyup") release();
  };
  el.addEventListener("pointerdown", press);
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("pointerleave", release);
  el.addEventListener("keydown", key);
  el.addEventListener("keyup", key);
  el.addEventListener("blur", release);
  return () => {
    el.removeEventListener("pointerdown", press);
    el.removeEventListener("pointerup", release);
    el.removeEventListener("pointercancel", release);
    el.removeEventListener("pointerleave", release);
    el.removeEventListener("keydown", key);
    el.removeEventListener("keyup", key);
    el.removeEventListener("blur", release);
  };
}

/** A one-shot spring "pop" (scale up, settle back). */
export function pop(el: Element, amount = 0.12, isReduced = false) {
  if (isReduced) return;
  const s = SPRINGS.pop();
  gsap.fromTo(
    el,
    { scale: 1 + amount },
    { scale: 1, duration: s.duration, ease: s.ease, overwrite: "auto" },
  );
}
