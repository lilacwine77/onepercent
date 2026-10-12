/* eslint-disable */
// Synced from experience/cards-lab/src/cards/tilt.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Pointer tilt and foil light for one card (pokemon-cards-css technique, DA palette):
 * the card rotates toward the pointer on springs, and --px/--py/--fx drive the shine, glitter and
 * glare layers, which exist only while the card is live (`.is-live`). Idle cards cost nothing.
 */
import { SpringValue, animateWhile, stopAnimating } from "./motion";

export interface TiltOptions {
  /** Max rotation in degrees (x, y). */
  max?: [number, number];
  reduced: () => boolean;
  /** Sheet card: a slow automatic light drift when no pointer is on it (touch screens, keyboard). */
  drift?: boolean;
  /** Extra lift while active (px), on the card's own transform. */
  lift?: number;
}

export class Tilt {
  private rx = new SpringValue(0, 160, 17);
  private ry = new SpringValue(0, 160, 17);
  private px = new SpringValue(50, 120, 18);
  private py = new SpringValue(40, 120, 18);
  private fx = new SpringValue(0, 90, 16);
  private z = new SpringValue(0, 200, 22);
  private pointer = false;
  private running = false;
  private t0 = performance.now();
  private max: [number, number];
  private cleanup: (() => void)[] = [];
  private stepper = (dt: number) => this.step(dt);

  constructor(
    private host: HTMLElement,
    private card: HTMLElement,
    private o: TiltOptions,
  ) {
    this.max = o.max ?? [12, 15];
    const enter = (e: PointerEvent) => {
      if (this.o.reduced() || (e.pointerType === "touch" && !this.o.drift))
        return;
      this.pointer = true;
      this.activate();
      this.fx.target = 1;
      this.z.target = this.o.lift ?? 0;
    };
    const move = (e: PointerEvent) => {
      if (!this.pointer) return;
      const r = this.host.getBoundingClientRect();
      const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      this.ry.target = (nx - 0.5) * 2 * this.max[1];
      this.rx.target = (0.5 - ny) * 2 * this.max[0];
      this.px.target = 12 + nx * 76;
      this.py.target = 8 + ny * 84;
    };
    const leave = () => {
      if (!this.pointer) return;
      this.pointer = false;
      this.rx.target = this.ry.target = 0;
      this.px.target = 50;
      this.py.target = 40;
      this.fx.target = this.o.drift ? 0.6 : 0;
      this.z.target = 0;
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointercancel", leave);
    this.cleanup.push(() => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("pointercancel", leave);
    });
    if (o.drift && !o.reduced()) {
      this.fx.snap(0);
      this.fx.target = 0.6;
      this.activate();
    }
  }

  /** Keyboard focus lights the card a little (no pointer to follow). */
  focus(on: boolean) {
    if (this.o.reduced() || this.pointer) return;
    if (on) {
      this.activate();
      this.fx.target = 0.45;
      this.z.target = this.o.lift ?? 0;
    } else {
      this.fx.target = this.o.drift ? 0.6 : 0;
      this.z.target = 0;
    }
  }

  private activate() {
    if (!this.running) {
      this.running = true;
      this.card.classList.add("is-live");
      animateWhile(this.stepper);
    }
  }

  private step(dt: number): boolean {
    if (this.o.drift && !this.pointer && !this.o.reduced()) {
      const t = (performance.now() - this.t0) / 1000;
      this.px.target = 50 + Math.sin(t * 0.55) * 30;
      this.py.target = 42 + Math.cos(t * 0.41) * 24;
      this.ry.target = Math.sin(t * 0.55) * 5;
      this.rx.target = Math.cos(t * 0.41) * -3.5;
    }
    for (const s of [this.rx, this.ry, this.px, this.py, this.fx, this.z])
      s.step(dt);
    const st = this.card.style;
    st.transform = `perspective(900px) translateY(${(-this.z.x).toFixed(2)}px) rotateX(${this.rx.x.toFixed(2)}deg) rotateY(${this.ry.x.toFixed(2)}deg)`;
    st.setProperty("--px", `${this.px.x.toFixed(1)}%`);
    st.setProperty("--py", `${this.py.x.toFixed(1)}%`);
    st.setProperty("--fx", this.fx.x.toFixed(3));
    const still =
      !this.pointer &&
      !this.o.drift &&
      [this.rx, this.ry, this.fx, this.z].every((s) => s.resting) &&
      this.fx.x < 0.01;
    if (still) {
      this.running = false;
      this.card.classList.remove("is-live");
      st.transform = "";
      return false;
    }
    return true;
  }

  destroy() {
    stopAnimating(this.stepper);
    this.running = false;
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
  }
}
