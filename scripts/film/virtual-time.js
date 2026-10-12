/*
 * Virtual time for deterministic frame capture (injected before any page script).
 *
 * Two modes:
 *  - "real": the page runs at wall-clock speed (loading, warm-up). Timers and
 *    requestAnimationFrame go through our queues but are pumped by real ones.
 *  - "virtual": time stands still until the capture script calls
 *    __vt.stepTo(ms). Timers fire in due order, rAF callbacks get the virtual
 *    timestamp, and every CSS / Web Animations animation is paused and seeked
 *    to the virtual clock, so each captured frame is exact.
 *
 * Math.random is seeded (mulberry32) so particles and demo draws repeat.
 * Workers, media elements and network keep real time.
 */
(() => {
  if (window.__vt) return;
  const realRAF = window.requestAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realPerfNow = performance.now.bind(performance);
  const RealDate = Date;
  const epoch = RealDate.now() - realPerfNow();

  let virtual = false;
  let offset = 0;
  let vnow = 0;
  const clock = () => (virtual ? vnow : realPerfNow() + offset);

  let seed = 0x1a2b3c4d;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  performance.now = () => clock();
  const dateNow = () => Math.floor(epoch + clock());
  function VDate(...args) {
    if (!new.target) return new RealDate(dateNow()).toString();
    return args.length ? new RealDate(...args) : new RealDate(dateNow());
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = dateNow;
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  window.Date = VDate;

  const report = (error) => {
    try {
      console.error(error);
    } catch {
      /* ignore */
    }
  };

  // Timers --------------------------------------------------------------
  const timers = new Map();
  let nextTimer = 1;
  function armReal(timer) {
    if (timer.real) realClearTimeout(timer.real);
    timer.real = realSetTimeout(
      () => {
        timer.real = null;
        if (virtual || !timers.has(timer.id)) return;
        fire(timer);
      },
      Math.max(0, timer.due - clock()),
    );
  }
  function fire(timer) {
    if (timer.every) {
      timer.due += timer.every;
      if (!virtual) armReal(timer);
    } else timers.delete(timer.id);
    try {
      if (typeof timer.cb === "function") timer.cb(...timer.args);
      else (0, eval)(String(timer.cb));
    } catch (error) {
      report(error);
    }
  }
  function addTimer(cb, delay, args, repeat) {
    const id = nextTimer++;
    const ms = Math.max(0, Number(delay) || 0);
    const timer = {
      id,
      cb,
      args,
      due: clock() + ms,
      every: repeat ? Math.max(1, ms) : 0,
      real: null,
    };
    timers.set(id, timer);
    if (!virtual) armReal(timer);
    return id;
  }
  window.setTimeout = (cb, delay, ...args) => addTimer(cb, delay, args, false);
  window.setInterval = (cb, delay, ...args) => addTimer(cb, delay, args, true);
  window.clearTimeout = window.clearInterval = (id) => {
    const timer = timers.get(id);
    if (!timer) return;
    if (timer.real) realClearTimeout(timer.real);
    timers.delete(id);
  };
  window.requestIdleCallback = (cb) =>
    addTimer(() => cb({ didTimeout: false, timeRemaining: () => 40 }), 1, [], false);
  window.cancelIdleCallback = window.clearTimeout;

  // requestAnimationFrame ----------------------------------------------
  const frames = new Map();
  let nextFrame = 1;
  let pumping = false;
  function flushFrames(timestamp) {
    const due = [...frames.values()];
    frames.clear();
    for (const cb of due) {
      try {
        cb(timestamp);
      } catch (error) {
        report(error);
      }
    }
  }
  function pump() {
    if (pumping || virtual) return;
    pumping = true;
    realRAF(function loop() {
      if (virtual) {
        pumping = false;
        return;
      }
      flushFrames(clock());
      if (frames.size) realRAF(loop);
      else pumping = false;
    });
  }
  window.requestAnimationFrame = (cb) => {
    const id = nextFrame++;
    frames.set(id, cb);
    pump();
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };

  // Animations ----------------------------------------------------------
  let control = new WeakMap();
  let freshFromNowOn = false;
  function syncAnimations() {
    for (const animation of document.getAnimations()) {
      let state = control.get(animation);
      if (!state) {
        if (animation.playState === "paused" || animation.playState === "idle")
          continue;
        state = {
          t0: vnow,
          base: freshFromNowOn ? 0 : animation.currentTime ?? 0,
        };
        control.set(animation, state);
        animation.pause();
      }
      if (state.done) continue;
      const rate = animation.playbackRate || 1;
      const time = state.base + (vnow - state.t0) * rate;
      const timing = animation.effect && animation.effect.getComputedTiming
        ? animation.effect.getComputedTiming()
        : null;
      const end = timing ? timing.endTime : Infinity;
      if (Number.isFinite(end) && time >= end) {
        state.done = true;
        try {
          animation.currentTime = end;
          animation.finish();
        } catch (error) {
          report(error);
        }
      } else animation.currentTime = time;
    }
  }

  const realYield = () => new Promise((resolve) => realSetTimeout(resolve, 0));

  window.__vt = {
    get virtual() {
      return virtual;
    },
    now: () => clock(),
    seed(value) {
      seed = value >>> 0;
    },
    /** Stop the clock; from now on only stepTo() advances it. */
    async freeze() {
      if (virtual) return clock();
      vnow = clock();
      virtual = true;
      for (const timer of timers.values())
        if (timer.real) {
          realClearTimeout(timer.real);
          timer.real = null;
        }
      control = new WeakMap();
      freshFromNowOn = false;
      syncAnimations();
      freshFromNowOn = true;
      await realYield();
      return vnow;
    },
    /** Back to wall-clock time, continuing from the virtual clock. */
    thaw() {
      if (!virtual) return;
      offset = vnow - realPerfNow();
      virtual = false;
      for (const animation of document.getAnimations()) {
        const state = control.get(animation);
        if (state && !state.done) animation.play();
      }
      control = new WeakMap();
      for (const timer of timers.values()) armReal(timer);
      if (frames.size) pump();
    },
    /** Advance the virtual clock to `target` ms (performance.now scale). */
    async stepTo(target) {
      if (!virtual) throw new Error("freeze() first");
      for (let guard = 0; guard < 4000; guard++) {
        let next = null;
        for (const timer of timers.values())
          if (
            timer.due <= target &&
            (!next ||
              timer.due < next.due ||
              (timer.due === next.due && timer.id < next.id))
          )
            next = timer;
        if (!next) break;
        vnow = Math.max(vnow, next.due);
        fire(next);
        await realYield();
      }
      vnow = Math.max(vnow, target);
      flushFrames(vnow);
      await realYield();
      await realYield();
      syncAnimations();
      return vnow;
    },
    pending: () => ({ timers: timers.size, frames: frames.size }),
  };
})();
