/**
 * The first-visit entrance, ported from the landing's entrance.js: a lilac
 * cover and the "1%" glyph, then the scribble wipes the page into view. The
 * entry's CSS cover (html.is-intro) is replaced by this canvas on the same frame.
 * Canvas only: no inline style or script, so it runs under the production CSP.
 */
const SCRIBBLE =
  "M299.654 453.865C505.574 319.225 711.494 184.585 836.054 109.945C960.614 35.3048 997.574 24.7448 944.014 110.385C890.454 196.025 745.254 378.185 571.454 634.385C397.654 890.585 199.654 1215.3 110.854 1382.58C22.0544 1549.86 48.4544 1549.86 77.8944 1540.62C107.334 1531.38 139.014 1512.9 367.854 1319.9C596.694 1126.9 1021.73 759.945 1255.21 555.065C1488.69 350.185 1517.73 318.505 1527.41 306.145C1537.09 293.785 1526.53 301.705 1346.85 618.625C1167.17 935.545 818.694 1561.22 635.214 1896.74C451.734 2232.26 443.814 2258.66 447.654 2268.3C451.494 2277.94 467.334 2270.02 511.134 2236.9C554.934 2203.78 626.214 2145.7 966.534 1817.46C1306.85 1489.22 1914.05 892.585 2263.81 557.505C2613.57 222.425 2687.49 166.985 2741.41 129.185C2795.33 91.3848 2827.01 72.9048 2843.33 67.3448C2859.65 61.7848 2859.65 69.7048 2849.09 96.2248C2838.53 122.745 2817.41 167.625 2584.77 544.505C2352.13 921.385 1370.37 2165.43 1139.25 2537.83C908.134 2910.23 902.854 2926.07 902.774 2939.51C902.694 2952.95 907.974 2963.51 1255.21 2613.87C1602.45 2264.23 2829.73 1017.54 2903.53 1071.46C2977.33 1125.38 2176.12 2817.04 2128 3037C2079.88 3256.96 2911.24 2018.56 3172 1793";

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const part = (t: number, a: number, b: number) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  return (x: number) => {
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

/** Plays the reveal. `onCompose` fires halfway, when the hero should enter. */
export function playIntro(onCompose: () => void): Promise<void> {
  const root = document.documentElement;
  const done = () => {
    root.classList.remove("is-intro", "is-intro-hold");
    onCompose();
  };
  const loader = document.createElement("div");
  loader.className = "intro";
  loader.setAttribute("aria-hidden", "true");
  const fill = document.createElement("div");
  fill.className = "intro-fill";
  const canvas = document.createElement("canvas");
  const glyph = document.createElement("span");
  glyph.className = "intro-glyph";
  glyph.textContent = "1%";
  loader.append(fill, canvas, glyph);
  const context = canvas.getContext("2d");
  if (!context || typeof Path2D === "undefined") {
    done();
    return Promise.resolve();
  }
  document.body.append(loader);
  root.classList.remove("is-intro");
  clearTimeout(Number(root.dataset.intro));
  const svgPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  svgPath.setAttribute("d", SCRIBBLE);
  const length = svgPath.getTotalLength();
  const stroke = new Path2D(SCRIBBLE);
  const norm = Math.sqrt((3222 ** 2 + 3114 ** 2) / 2);
  const fullWidth = norm * 0.31;
  const endWidth = norm * 0.08;
  let progress = 0;
  const paint = () => {
    context.clearRect(0, 0, 3222, 3114);
    context.lineDashOffset = -length * power2InOut(progress);
    context.lineWidth =
      fullWidth + (endWidth - fullWidth) * scribbleEase(progress);
    context.stroke(stroke);
  };
  // A bounded bitmap (≤ 0.5 MP): the stroke is a soft lilac shape, so this
  // keeps every frame cheap on throttled phones.
  const resize = () => {
    const scale = Math.min(1, Math.sqrt(500_000 / (innerWidth * innerHeight)));
    canvas.width = Math.max(1, Math.round(innerWidth * scale));
    canvas.height = Math.max(1, Math.round(innerHeight * scale));
    context.setTransform(canvas.width / 3222, 0, 0, canvas.height / 3114, 0, 0);
    context.strokeStyle = "#d5a2f1";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash([length, length]);
    paint();
  };
  resize();
  addEventListener("resize", resize);
  const fade = fill.animate([{ opacity: 1 }, { opacity: 0 }], {
    delay: 250,
    duration: 360,
    fill: "forwards",
  });
  const glyphFade = glyph.animate([{ opacity: 1 }, { opacity: 0 }], {
    delay: 1150,
    duration: 120,
    fill: "forwards",
  });
  return new Promise((resolve) => {
    let composed = false;
    let frame = 0;
    const start = performance.now();
    const finish = () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
      fade.cancel();
      glyphFade.cancel();
      loader.remove();
      if (!composed) done();
      resolve();
    };
    const failsafe = setTimeout(finish, 4000);
    const step = (now: number) => {
      const time = (now - start) / 1000 - 0.25;
      if (time >= 0) {
        progress = Math.min(time / 2, 1);
        paint();
        if (progress >= 0.5 && !composed) {
          composed = true;
          setTimeout(done, 250);
        }
        if (progress >= 1) {
          clearTimeout(failsafe);
          finish();
          return;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  });
}

export const introPending = () =>
  document.documentElement.classList.contains("is-intro-hold");

/** "Replay the intro": the cover returns and the reveal plays again. */
export function replayIntro(onCompose: () => void) {
  const root = document.documentElement;
  root.classList.add("is-intro-hold");
  scrollTo({ top: 0 });
  return playIntro(onCompose);
}
