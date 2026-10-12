/** Visible frame gaps, before dt is capped by the animation engine. */
export class FrameBudget {
  private previous: number;
  private slow: number[] = [];
  constructor(now: number) {
    this.previous = now;
  }
  sample(now: number, visible = true): boolean {
    const elapsed = now - this.previous;
    this.previous = now;
    if (!visible) {
      this.slow = [];
      return false;
    }
    this.slow = this.slow.filter((time) => now - time <= 2_000);
    if (elapsed > 150) this.slow.push(now);
    // A single full second also trips the guard: three such frames would
    // already exceed the sampling window and leave controls unresponsive.
    return elapsed >= 1_000 || this.slow.length >= 3;
  }
}

/** Register before mounting the scene, so startup cost counts too. */
export function watchFrameBudget(fallback: () => void): () => void {
  const budget = new FrameBudget(performance.now());
  let stopped = false;
  let frame = 0;
  const reset = () => budget.sample(performance.now(), false);
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", reset);
  };
  const tick = (now: number) => {
    if (stopped) return;
    if (budget.sample(now, document.visibilityState !== "hidden")) {
      stop();
      fallback();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", reset);
  frame = requestAnimationFrame(tick);
  return stop;
}
