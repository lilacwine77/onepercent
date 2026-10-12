// The Onepercent film: six beats on the 120 BPM grid of the score (22 s).
import { E, FPS, clamp, css, el, headline, keys, lerp, playHeadline, preload, remap, rng, seg, setSrc, settled, show, spring, tf } from "./engine.js";

const params = new URLSearchParams(location.search);
const LAYOUT = params.get("layout") === "9x16" ? "9x16" : "16x9";
const V = LAYOUT === "9x16";
const W = V ? 1080 : 1280;
const H = V ? 1920 : 720;
const CAP = "/cap";
const PROFILE = V ? "mobile" : "desktop";
const DURATION = 25;
const FRAMES = Math.round(DURATION * FPS);

const stage = document.getElementById("stage");
stage.style.setProperty("--w", `${W}px`);
stage.style.setProperty("--h", `${H}px`);

async function json(url) {
  const res = await fetch(url);
  return res.ok ? res.json() : null;
}
const CLIPS = V ? ["mobile/rip-tap"] : ["desktop-tall/rip-tap"];
const clips = {};
for (const name of CLIPS) clips[name] = await json(`${CAP}/${name}/clip.json`);
const stills = {
  rows: await json(`${CAP}/${PROFILE}/rows/rows/stills.json`),
  cards: await json(`${CAP}/${PROFILE}/dustcards/cards/stills.json`),
  hit: await json(`${CAP}/${PROFILE}/hitcard/card/stills.json`),
  onepct: await json(`${CAP}/${PROFILE}/onepctcard/card/stills.json`),
};
// The film's bags: real pump.fun dust from a live X-ray (scripts/film/fixtures).
const dust = await json("/repo/scripts/film/fixtures/dust-bags.json");

const ctx = {
  W, H, V, CAP, PROFILE, FPS, FRAMES, clips, stills, dust, stage,
  frameUrl: (clip, n) => `${CAP}/${clip}/${String(Math.round(n)).padStart(5, "0")}.webp`,
  /** First frame of a Rip clip event ("beat:tear", "cue:hit.burst"…). */
  event(clip, label, nth = 0) {
    const list = (clips[clip]?.events ?? []).filter((e) => e.label === label);
    return list[nth]?.frame ?? null;
  },
};

// The world (everything but the CRT power-on) and its scenes.
const world = el("div", "layer", stage);
// The vertical cut has its own layouts (scenes-v.js) on the same timeline.
let buildScenes;
try {
  ({ buildScenes } = await import(V ? "./scenes-v.js" : "./scenes.js"));
} catch {
  ({ buildScenes } = await import("./scenes.js"));
}
const scenes = buildScenes(world, ctx);

// CRT power-on: the picture opens out of a bright horizontal line.
const flash = el("div", "layer", stage);
css(flash, { background: "#000", pointerEvents: "none" });
const beam = el("div", "abs", flash);
css(beam, {
  width: `${W}px`,
  height: "2px",
  top: `${H / 2 - 1}px`,
  background: "linear-gradient(90deg, rgba(255,248,236,0), #fff8ec 18%, #ffffff 50%, #fff8ec 82%, rgba(255,248,236,0))",
  boxShadow: "0 0 18px 4px rgba(213,162,241,.55), 0 0 60px 10px rgba(255,241,231,.35)",
});

function powerOn(t) {
  // 0–0.07 s: a dot stretches into a line; 0.07–0.27 s: the picture opens.
  const line = seg(t, 0.0, 0.07, E.expoOut);
  const open = seg(t, 0.07, 0.27, E.expoOut);
  const done = t >= 0.4;
  show(flash, !done);
  if (done) {
    world.style.transform = "";
    world.style.filter = "";
    return;
  }
  css(beam, {
    transform: `scaleX(${0.02 + 0.98 * line}) scaleY(${1 + 3 * (1 - open)})`,
    opacity: String(1 - seg(t, 0.12, 0.3)),
  });
  flash.style.background = `rgba(0,0,0,${1 - open})`;
  flash.style.mixBlendMode = "normal";
  const sy = Math.max(0.004, open);
  world.style.transformOrigin = "50% 50%";
  world.style.transform = `scale(${1 + 0.04 * (1 - open)}, ${sy})`;
  world.style.filter = `brightness(${1 + 1.6 * (1 - seg(t, 0.07, 0.36, E.cubicOut))}) saturate(${0.6 + 0.4 * open})`;
}

function render(frame) {
  const t = frame / FPS;
  for (const scene of scenes) {
    const on = t >= scene.from && t < scene.to;
    show(scene.root, on);
    if (on) scene.render(t, ctx);
  }
  powerOn(t);
}

// Motion-blur samples (frame offsets) for frames the scenes flag.
function samples(frame) {
  const t = frame / FPS;
  if (t > 0.05 && t < 0.3) return [-0.1875, -0.0625, 0.0625, 0.1875];
  for (const scene of scenes) {
    if (t < scene.from || t >= scene.to || !scene.blur) continue;
    const n = scene.blur(t);
    if (n > 1) return Array.from({ length: n }, (_, k) => ((k + 0.5) / n - 0.5) * 0.5);
  }
  return [0];
}

await document.fonts.load('700 100px "Fraunces"');
await document.fonts.load('600 100px "Fraunces"');
await document.fonts.load('italic 600 100px "Fraunces"');
await document.fonts.load('500 30px "DM Sans"');
await document.fonts.load('700 30px "DM Sans"');
await document.fonts.ready;
for (const scene of scenes) await scene.preload?.();

window.FILM = {
  ready: true,
  frames: FRAMES,
  layout: LAYOUT,
  async render(frame) {
    render(frame);
    await settled();
    // Two animation frames so layout, decode and paint are committed.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
  samples,
};
