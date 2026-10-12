import "./entrance.css";

const ROOT = document.documentElement;
const SEEN_KEY = "onepercent-v2-seen";
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
const invoke = (callback) => {
  try {
    callback?.();
  } catch (error) {
    console.error("Entrance callback failed:", error);
  }
};

// Vibe's first-visit scribble path, retained so the reveal follows the same route.
const SCRIBBLE_PATH =
  "M299.654 453.865C505.574 319.225 711.494 184.585 836.054 109.945C960.614 35.3048 997.574 24.7448 944.014 110.385C890.454 196.025 745.254 378.185 571.454 634.385C397.654 890.585 199.654 1215.3 110.854 1382.58C22.0544 1549.86 48.4544 1549.86 77.8944 1540.62C107.334 1531.38 139.014 1512.9 367.854 1319.9C596.694 1126.9 1021.73 759.945 1255.21 555.065C1488.69 350.185 1517.73 318.505 1527.41 306.145C1537.09 293.785 1526.53 301.705 1346.85 618.625C1167.17 935.545 818.694 1561.22 635.214 1896.74C451.734 2232.26 443.814 2258.66 447.654 2268.3C451.494 2277.94 467.334 2270.02 511.134 2236.9C554.934 2203.78 626.214 2145.7 966.534 1817.46C1306.85 1489.22 1914.05 892.585 2263.81 557.505C2613.57 222.425 2687.49 166.985 2741.41 129.185C2795.33 91.3848 2827.01 72.9048 2843.33 67.3448C2859.65 61.7848 2859.65 69.7048 2849.09 96.2248C2838.53 122.745 2817.41 167.625 2584.77 544.505C2352.13 921.385 1370.37 2165.43 1139.25 2537.83C908.134 2910.23 902.854 2926.07 902.774 2939.51C902.694 2952.95 907.974 2963.51 1255.21 2613.87C1602.45 2264.23 2829.73 1017.54 2903.53 1071.46C2977.33 1125.38 2176.12 2817.04 2128 3037C2079.88 3256.96 2911.24 2018.56 3172 1793";

const WAVE_FROM =
  "M -44,-50 C -52.71,28.52 15.86,8.186 184,14.69 383.3,22.39 462.5,12.58 638,14 835.5,15.6 987,6.4 1194,13.86 1661,30.68 1652,-36.74 1582,-140.1 1512,-243.5 15.88,-589.5 -44,-50 Z";
const WAVE_TO =
  "M -44,-50 C -137.1,117.4 67.86,445.5 236,452 435.3,459.7 500.5,242.6 676,244 873.5,245.6 957,522.4 1154,594 1593,753.7 1793,226.3 1582,-126 1371,-478.3 219.8,-524.2 -44,-50 Z";

function cubicBezier(x1, y1, x2, y2) {
  const part = (t, a, b) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  return (x) => {
    let t = x;
    for (let i = 0; i < 5; i += 1) {
      const offset = part(t, x1, x2) - x;
      const slope =
        3 * (1 - t) ** 2 * x1 +
        6 * (1 - t) * t * (x2 - x1) +
        3 * t * t * (1 - x2);
      if (Math.abs(slope) < 1e-6) break;
      t = Math.max(0, Math.min(1, t - offset / slope));
    }
    return part(t, y1, y2);
  };
}

const power2InOut = cubicBezier(0.645, 0.045, 0.355, 1);
const scribbleEase = cubicBezier(0.75, 0.15, 0.15, 1);
const sineInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const quadOut = (t) => t * (2 - t);

function makeLoader() {
  const loader = document.createElement("div");
  loader.className = "onepercent-loader";
  loader.setAttribute("aria-hidden", "true");
  loader.innerHTML =
    '<div class="onepercent-loader__fill"></div>' +
    '<canvas class="onepercent-loader__scribble"></canvas>' +
    '<span class="onepercent-loader__glyph">1%</span>';
  document.body.append(loader);
  return loader;
}

/**
 * First-visit entry. The head should set html.is-loading before first paint
 * when this session has not seen the animation and motion is allowed.
 * Resolves after the scribble leaves and the nav/title entrance has settled.
 */
export async function startEntrance({ onReveal, onComplete } = {}) {
  let revealSent = false;
  let completeSent = false;
  const reveal = () => {
    if (revealSent) return;
    revealSent = true;
    invoke(onReveal);
    document.dispatchEvent(new CustomEvent("onepercent:entrance-reveal"));
  };
  const complete = () => {
    if (completeSent) return;
    completeSent = true;
    invoke(onComplete);
    document.dispatchEvent(new CustomEvent("onepercent:entrance-complete"));
  };

  let seen = true;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Storage-disabled browsers simply skip the loader on later invocations.
  }
  if (seen || reducedMotion()) {
    ROOT.classList.remove("is-loading", "is-loader-live", "is-composing");
    reveal();
    complete();
    return;
  }
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // The animation remains usable without session storage.
  }

  ROOT.classList.add("is-loading");
  const loader = makeLoader();
  ROOT.classList.add("is-loader-live");
  const canvas = loader.querySelector("canvas");
  const context = canvas.getContext("2d");
  const fill = loader.querySelector(".onepercent-loader__fill");
  const glyph = loader.querySelector(".onepercent-loader__glyph");
  if (!context || typeof Path2D === "undefined") {
    loader.remove();
    ROOT.classList.remove("is-loading", "is-loader-live", "is-composing");
    reveal();
    complete();
    return;
  }
  // Measure once off-DOM; preserve the original stroke route and timing while
  // rasterizing a bounded bitmap instead of repainting a full-DPR SVG stroke.
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", SCRIBBLE_PATH);
  const length = path.getTotalLength();
  const stroke = new Path2D(SCRIBBLE_PATH);
  const norm = Math.sqrt((3222 ** 2 + 3114 ** 2) / 2);
  const fullWidth = norm * 0.31;
  const endWidth = norm * 0.08;
  let progress = 0;
  function paintScribble() {
    context.clearRect(0, 0, 3222, 3114);
    context.lineDashOffset = -length * power2InOut(progress);
    context.lineWidth = fullWidth + (endWidth - fullWidth) * scribbleEase(progress);
    context.stroke(stroke);
  }
  function resizeScribble() {
    const scale = Math.min(1, Math.sqrt(900_000 / (innerWidth * innerHeight)));
    canvas.width = Math.max(1, Math.round(innerWidth * scale));
    canvas.height = Math.max(1, Math.round(innerHeight * scale));
    context.setTransform(canvas.width / 3222, 0, 0, canvas.height / 3114, 0, 0);
    context.strokeStyle = "#d5a2f1";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash([length, length]);
    paintScribble();
  }
  resizeScribble();
  window.addEventListener("resize", resizeScribble);

  let done = false;
  let composed = false;
  let composedAt = 0;
  let failsafeTimer;
  let animationFrame;
  let fillAnimation;
  let glyphAnimation;
  const finish = (onSettled) => {
    if (done) return;
    done = true;
    clearTimeout(failsafeTimer);
    cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", resizeScribble);
    fillAnimation?.cancel();
    glyphAnimation?.cancel();
    loader.remove();
    compose();
    reveal();
    // The CTA finishes last: reveal at +250 ms, then 450 ms delay + 500 ms
    // animation. Leave a frame of headroom before starting the GPU work.
    window.setTimeout(() => {
      ROOT.classList.remove("is-loading", "is-loader-live", "is-composing");
      complete();
      onSettled();
    }, Math.max(0, composedAt + 1250 - performance.now()));
  };
  const compose = () => {
    if (composed) return;
    composed = true;
    composedAt = performance.now();
    ROOT.classList.add("is-composing");
    window.setTimeout(reveal, 250);
  };

  await raf();
  const start = performance.now();
  fillAnimation = fill.animate([{ opacity: 1 }, { opacity: 0 }], { delay: 250, duration: 360, fill: "forwards" });
  glyphAnimation = glyph.animate([{ opacity: 1 }, { opacity: 0 }], { delay: 1150, duration: 100, fill: "forwards" });
  return new Promise((resolve) => {
    const finishAndResolve = () => {
      finish(resolve);
    };
    failsafeTimer = window.setTimeout(finishAndResolve, 4000);
    function frame(now) {
      if (done) return;
      const time = (now - start) / 1000 - 0.25;
      if (time < 0) {
        animationFrame = requestAnimationFrame(frame);
        return;
      }
      progress = Math.min(time / 2, 1);
      paintScribble();
      if (progress >= 0.5) compose();
      if (progress < 1) animationFrame = requestAnimationFrame(frame);
      else finishAndResolve();
    }
    animationFrame = requestAnimationFrame(frame);
  });
}

// Build evenly timed keyframes, like the reference, to keep the tail smooth.
const fromNumbers = WAVE_FROM.match(/-?\d*\.?\d+/g).map(Number);
const toNumbers = WAVE_TO.match(/-?\d*\.?\d+/g).map(Number);
const waveTemplate = WAVE_FROM.replace(/-?\d*\.?\d+/g, "@");
let waveFrames;
function getWaveFrames() {
  return waveFrames ??= Array.from({ length: 133 }, (_, index) => {
    const progress = quadOut(index / 132);
    let numberIndex = 0;
    return waveTemplate.replace(/@/g, () => {
      const value =
        fromNumbers[numberIndex] +
        (toNumbers[numberIndex] - fromNumbers[numberIndex]) * progress;
      numberIndex += 1;
      return value.toFixed(2);
    });
  });
}

function makeWave(exit) {
  const supportsPopover =
    typeof HTMLElement.prototype.showPopover === "function";
  const layer = document.createElement(supportsPopover ? "div" : "dialog");
  layer.className = `onepercent-wave is-active${exit ? " onepercent-wave--exit" : ""}`;
  layer.setAttribute("aria-hidden", "true");
  // A native dialog lives in the top layer; ordinary z-index cannot cover it.
  // Manual popovers share that top layer without stealing focus.
  if (supportsPopover) layer.setAttribute("popover", "manual");
  layer.innerHTML =
    '<div class="onepercent-wave__mover">' +
    '<div class="onepercent-wave__solid"></div>' +
    '<svg class="onepercent-wave__shape" viewBox="0 0 1440 800" preserveAspectRatio="none"><path d="' +
    WAVE_FROM +
    '"/></svg></div>';
  document.body.append(layer);
  if (supportsPopover) layer.showPopover();
  else layer.showModal();
  return layer;
}

function raiseWave(layer) {
  // showModal() can place the pack dialog above an existing top-layer entry.
  // Hide/show in the same task to bring the wave back above it before paint.
  if (!layer) return;
  if (layer.hasAttribute("popover")) {
    if (layer.matches(":popover-open")) layer.hidePopover();
    layer.showPopover();
  } else if (layer.open) {
    layer.close();
    layer.showModal();
  }
}

function removeWave(layer) {
  if (!layer) return;
  if (layer.hasAttribute("popover") && layer.matches(":popover-open"))
    layer.hidePopover();
  else if (layer.open) layer.close();
  layer.remove();
}

function playWave(layer, from, to) {
  const frames = getWaveFrames();
  return new Promise((resolve) => {
    const mover = layer.querySelector(".onepercent-wave__mover");
    const shape = layer.querySelector(".onepercent-wave__shape");
    const path = shape.querySelector("path");
    layer.classList.add("is-active");
    let settled = false;
    let lastStep = -1;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(failsafe);
      resolve();
    };
    const failsafe = window.setTimeout(done, 1800);
    const start = performance.now();
    function frame(now) {
      if (settled) return;
      const progress = Math.max(0, Math.min((now - start) / 1100, 1));
      const slide = from + (to - from) * sineInOut(progress);
      mover.style.transform = `translate3d(0,${-200 * slide}vh,0)`;
      const scale =
        progress < 0.5
          ? 0.8 + (1.8 - 0.8) * (progress / 0.5) ** 2
          : 1.8 + (1 - 1.8) * quadOut((progress - 0.5) / 0.5);
      shape.style.transform = `scaleY(${scale.toFixed(4)})`;
      const step = Math.round(progress * 132);
      if (step !== lastStep) {
        lastStep = step;
        path.setAttribute("d", frames[step]);
      }
      if (progress < 1) requestAnimationFrame(frame);
      else done();
    }
    requestAnimationFrame(frame);
  });
}

let activeWave = null;

/**
 * Run a lavender liquid-wave cover, change the view while covered, then
 * uncover it. The callback can be synchronous or async; its result is returned.
 */
export async function waveTransition(callback) {
  if (typeof callback !== "function") throw new TypeError("callback required");
  // A close requested during the opening wave still needs its callback.
  // Returning the active promise used to silently discard that state change.
  if (activeWave) {
    try {
      await activeWave;
    } catch {
      // The preceding transition cleans up its own layers. Run this request
      // even if that earlier view change failed.
    }
    return waveTransition(callback);
  }
  if (reducedMotion()) return callback();
  activeWave = (async () => {
    const exit = makeWave(true);
    let entry;
    let result;
    let error;
    try {
      await playWave(exit, 1, 0);
      try {
        const change = callback();
        // If the callback opened a modal, it is now above the exit wave.
        raiseWave(exit);
        result = await change;
      } catch (caught) {
        error = caught;
      }
      // The new layer enters above the updated modal. Keep the old cover in
      // place until this happens, so there is never a visible gap.
      entry = makeWave(false);
      removeWave(exit);
      await playWave(entry, 0, 1);
    } finally {
      removeWave(exit);
      removeWave(entry);
    }
    if (error) throw error;
    return result;
  })();
  try {
    return await activeWave;
  } finally {
    activeWave = null;
  }
}
