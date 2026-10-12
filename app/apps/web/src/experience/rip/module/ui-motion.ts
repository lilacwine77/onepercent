/* eslint-disable */
// Synced from experience/lab/src/rip/ui-motion.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Micro-interactions shared by the component's overlay and the host page (GSAP).
 * Transform/opacity only, spring release, instant feedback on pointerdown, 120 Hz friendly.
 */
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(SplitText, CustomEase);

/** --ease-spring from the art direction: cubic-bezier(.175, .885, .32, 1.6). */
export const SPRING = CustomEase.create(
  "rip-spring",
  "M0,0 C0.175,0.885 0.32,1.6 1,1",
);
/** --ease-arrive: cubic-bezier(.22, 1, .36, 1). */
export const ARRIVE = CustomEase.create(
  "rip-arrive",
  "M0,0 C0.22,1 0.36,1 1,1",
);

const reducedQuery =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
let reducedOverride: boolean | null = null;
export function setReducedUI(v: boolean | null) {
  reducedOverride = v;
}
export const reducedUI = () =>
  reducedOverride ?? reducedQuery?.matches ?? false;

export interface PressOptions {
  /** Pull towards the pointer on hover (fine pointers only). */
  magnetic?: number;
  /** Pressed scale (default 0.97). */
  scale?: number;
  /** Child element nudged in the hover direction (e.g. the arrow chip). */
  nudge?: HTMLElement | null;
}

/** Spring press + optional magnetic hover. Returns a cleanup function. */
export function pressable(
  el: HTMLElement,
  opts: PressOptions = {},
): () => void {
  const scale = opts.scale ?? 0.97;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  gsap.set(el, { transformOrigin: "50% 50%", force3D: true });
  const xTo = gsap.quickTo(el, "x", { duration: 0.45, ease: "power3.out" });
  const yTo = gsap.quickTo(el, "y", { duration: 0.45, ease: "power3.out" });
  const nx = opts.nudge
    ? gsap.quickTo(opts.nudge, "x", { duration: 0.35, ease: "power3.out" })
    : null;
  let pressed = false;
  const down = () => {
    if (pressed) return;
    pressed = true;
    el.dataset.pressed = "true";
    if (reducedUI()) return;
    gsap.to(el, {
      scale,
      duration: 0.08,
      ease: "power2.out",
      overwrite: "auto",
    });
    if (opts.nudge)
      gsap.to(opts.nudge, {
        scale: 0.9,
        duration: 0.08,
        ease: "power2.out",
        overwrite: "auto",
      });
  };
  const up = () => {
    if (!pressed) return;
    pressed = false;
    delete el.dataset.pressed;
    if (reducedUI()) return;
    gsap.to(el, {
      scale: 1,
      duration: 0.5,
      ease: "back.out(3.2)",
      overwrite: "auto",
    });
    if (opts.nudge)
      gsap.to(opts.nudge, {
        scale: 1,
        duration: 0.5,
        ease: "back.out(3.2)",
        overwrite: "auto",
      });
  };
  const move = (e: PointerEvent) => {
    if (
      !opts.magnetic ||
      !fine.matches ||
      reducedUI() ||
      e.pointerType !== "mouse"
    )
      return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2),
      dy = e.clientY - (r.top + r.height / 2);
    xTo(Math.max(-1, Math.min(1, dx / (r.width / 2))) * opts.magnetic);
    yTo(Math.max(-1, Math.min(1, dy / (r.height / 2))) * opts.magnetic * 0.6);
    nx?.(Math.max(0, dx / (r.width / 2)) * 3);
  };
  // Hover lift (fine pointers): the control rises 2 px on a spring and settles back on leave.
  const enter = (e: PointerEvent) => {
    if (
      opts.magnetic ||
      e.pointerType !== "mouse" ||
      !fine.matches ||
      reducedUI() ||
      (el as HTMLButtonElement).disabled
    )
      return;
    gsap.to(el, {
      y: -2,
      duration: 0.35,
      ease: "power3.out",
      overwrite: "auto",
    });
  };
  const leave = () => {
    up();
    if (!opts.magnetic) {
      if (!reducedUI())
        gsap.to(el, {
          y: 0,
          duration: 0.45,
          ease: "back.out(2.4)",
          overwrite: "auto",
        });
      return;
    }
    gsap.to(el, {
      x: 0,
      y: 0,
      duration: 0.7,
      ease: "elastic.out(1, 0.45)",
      overwrite: "auto",
    });
    nx?.(0);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.type === "keydown" && !e.repeat) down();
    if (e.type === "keyup") up();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerenter", enter);
  el.addEventListener("pointerleave", leave);
  el.addEventListener("pointermove", move);
  el.addEventListener("keydown", key);
  el.addEventListener("keyup", key);
  el.addEventListener("blur", up);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("pointerenter", enter);
    el.removeEventListener("pointerleave", leave);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("keydown", key);
    el.removeEventListener("keyup", key);
    el.removeEventListener("blur", up);
    gsap.killTweensOf(el);
  };
}

/** Confirmation pulse: a ring that expands from the element (opacity/transform only). */
export function pulse(el: HTMLElement, color = "#d5a2f1") {
  if (reducedUI()) return;
  const r = el.getBoundingClientRect();
  const ring = document.createElement("span");
  ring.setAttribute("aria-hidden", "true");
  Object.assign(ring.style, {
    position: "fixed",
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderRadius: getComputedStyle(el).borderRadius,
    boxShadow: `0 0 0 2px ${color}`,
    pointerEvents: "none",
    zIndex: "50",
  });
  document.body.appendChild(ring);
  gsap.fromTo(
    ring,
    { opacity: 0.9, scale: 1 },
    {
      opacity: 0,
      scale: 1.18,
      duration: 0.55,
      ease: "power2.out",
      onComplete: () => ring.remove(),
    },
  );
}

/**
 * Masked rise, word by word (60 ms stagger, about 0.8 s for a title). Words land whole, so a
 * still frame never shows half-risen characters on different baselines (e.g. "4×.").
 */
const splits = new WeakMap<HTMLElement, SplitText>();
export function revealTitle(el: HTMLElement, text: string) {
  const prev = splits.get(el);
  if (prev) {
    gsap.killTweensOf(prev.words);
    prev.revert();
    splits.delete(el);
  }
  el.textContent = text;
  el.setAttribute("aria-label", text);
  if (reducedUI()) return;
  const split = SplitText.create(el, {
    type: "words",
    mask: "words",
    aria: "none",
  });
  splits.set(el, split);
  // No overshoot (DA §15: springs are for pops, copy uses --ease-arrive).
  gsap.from(split.words, {
    yPercent: 105,
    duration: 0.5,
    ease: ARRIVE,
    stagger: 0.06,
  });
}

/** Counts a number up inside a string ("≈ 0.40 SOL", "+1,204,000"), keeping its format. */
export function countUp(el: HTMLElement, text: string, duration = 0.8) {
  const m = text.match(/(\d[\d,]*)(\.\d+)?/);
  if (!m || reducedUI()) {
    el.textContent = text;
    return;
  }
  const decimals = m[2] ? m[2].length - 1 : 0;
  const target = Number((m[1] + (m[2] ?? "")).replace(/,/g, ""));
  const grouped = m[1].includes(",");
  const fmt = (v: number) =>
    grouped
      ? v.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : v.toFixed(decimals);
  const o = { v: 0 };
  const prev = (el as unknown as { __count?: gsap.core.Tween }).__count;
  prev?.kill();
  (el as unknown as { __count?: gsap.core.Tween }).__count = gsap.to(o, {
    v: target,
    duration,
    ease: "power2.out",
    onUpdate: () => {
      el.textContent = text.replace(m[0], fmt(o.v));
    },
    onComplete: () => {
      el.textContent = text;
    },
  });
}

export { gsap };
