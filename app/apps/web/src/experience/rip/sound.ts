/* eslint-disable */
// Synced from experience/lab/src/sound.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Lab sound design for the Rip's sound hooks (DA §14): synthesized with WebAudio, no samples,
 * off by default, one master bus with a limiter (peaks ≤ −3 dBFS). The app will ship a sprite;
 * these show the timing and character the hooks are meant for.
 */
import type { SoundCue } from "./module";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master = ctx.createGain();
    master.gain.value = 0.7; // ≈ −3 dBFS
    master.connect(limiter).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = seed / 1073741823.5 - 1;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function unlockAudio() {
  audio();
}

const env = (
  g: GainNode,
  t: number,
  peak: number,
  attack: number,
  decay: number,
) => {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
};

function tone(
  f: number,
  at: number,
  decay: number,
  type: OscillatorType = "sine",
  peak = 0.12,
) {
  const a = audio();
  const t = a.currentTime + at;
  const o = a.createOscillator(),
    g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  env(g, t, peak, 0.004, decay);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + decay + 0.05);
}

/** FM bell: a sine carrier modulated at a non-integer ratio, decaying index. */
function bell(f: number, at: number, decay = 0.9, peak = 0.1, ratio = 3.5) {
  const a = audio();
  const t = a.currentTime + at;
  const car = a.createOscillator(),
    mod = a.createOscillator(),
    mg = a.createGain(),
    g = a.createGain();
  car.frequency.value = f;
  mod.frequency.value = f * ratio;
  mg.gain.setValueAtTime(f * 2.2, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, t + decay);
  mod.connect(mg).connect(car.frequency);
  env(g, t, peak, 0.003, decay);
  car.connect(g).connect(master!);
  car.start(t);
  mod.start(t);
  car.stop(t + decay + 0.05);
  mod.stop(t + decay + 0.05);
}

/** Filtered noise burst (crinkle, flick, tear). */
function noise(
  at: number,
  dur: number,
  freq: number,
  q: number,
  peak: number,
  sweepTo?: number,
) {
  const a = audio();
  const t = a.currentTime + at;
  const src = a.createBufferSource(),
    f = a.createBiquadFilter(),
    g = a.createGain();
  src.buffer = noiseBuf;
  src.loop = true;
  f.type = "bandpass";
  f.frequency.setValueAtTime(freq, t);
  f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  env(g, t, peak, 0.004, dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

const click = (at: number, f = 2400, peak = 0.12) =>
  noise(at, 0.025, f, 6, peak);

let loopTimer = 0;
export function playCue(cue: SoundCue, index = 0) {
  switch (cue) {
    case "crank.turn":
      [0, 0.11, 0.22, 0.33, 0.44].forEach((t, i) =>
        click(t, 1700 + i * 120, 0.16),
      );
      break;
    case "slot.drop":
      tone(180, 0, 0.18, "triangle", 0.14);
      click(0.02, 900, 0.12);
      break;
    case "crank.loop":
      clearInterval(loopTimer);
      loopTimer = window.setInterval(() => click(0, 2000, 0.05), 469); // 128 BPM
      break;
    case "crank.loop.stop":
      clearInterval(loopTimer);
      break;
    case "lock":
      click(0, 3200, 0.16);
      tone(1046, 0, 0.08, "sine", 0.05);
      break;
    case "pack.rip":
      noise(0, 0.12, 3000, 1.2, 0.2);
      noise(0.08, 0.32, 5200, 0.8, 0.22, 1400);
      break;
    case "card.slide":
      noise(0, 0.28, 1800, 0.9, 0.08, 4200);
      break;
    case "card.flip":
      noise(0, 0.07, 4200, 1.4, 0.16);
      break;
    case "dust.tick":
      bell(1318 * Math.pow(1.122, index), 0, 0.22, 0.07, 2);
      break;
    case "card.rise":
      noise(0, 0.6, 600, 0.7, 0.05, 2400);
      break;
    case "tier.silver":
      bell(1318, 0, 0.9, 0.11);
      break;
    case "tier.blue":
      bell(988, 0, 0.5, 0.1);
      bell(1480, 0.12, 0.8, 0.1);
      break;
    case "tier.holo":
      [0, 1, 2, 3, 4, 5].forEach((i) =>
        bell([1046, 1318, 1568, 2093, 1568, 2637][i], i * 0.075, 0.7, 0.07, 3),
      );
      break;
    case "tier.black":
      tone(55, 0, 1.2, "sine", 0.22);
      tone(220, 0, 0.9, "triangle", 0.08);
      bell(659, 0.02, 1.2, 0.08, 1.5);
      break;
    case "tier.jackpot":
      [0, 0.12, 0.24, 0.36, 0.6].forEach((t, i) =>
        bell([523, 659, 784, 1046, 1318][i], t, 0.6, 0.09, 2),
      );
      for (let i = 0; i < 14; i++)
        click(
          0.3 + i * 0.09 + Math.random() * 0.04,
          3000 + Math.random() * 1500,
          0.07,
        );
      break;
    case "tier.onepct":
      [0, 0.22, 0.44, 0.8].forEach((t, i) =>
        bell([392, 523, 784, 1046][i], t, 1.2, 0.09, 2.5),
      );
      break;
    case "coin.pop":
      bell(1568, 0, 0.3, 0.1, 2);
      bell(2093, 0.07, 0.5, 0.08, 2);
      break;
    case "sellback.slide":
      noise(0, 0.4, 1200, 0.8, 0.08, 400);
      break;
    case "pack.burst":
      noise(0, 0.5, 900, 0.6, 0.16, 6000);
      bell(784 * Math.pow(1.122, index), 0.04, 0.7, 0.06 + 0.012 * index, 2);
      break;
    case "hit.charge": {
      // A rising shimmer: longer and higher for rarer tiers.
      const n = 4 + index * 2;
      for (let i = 0; i < n; i++)
        bell(
          440 * Math.pow(1.0595, i * (2 + index * 0.4)),
          i * (0.09 + index * 0.02),
          0.25,
          0.03 + 0.005 * i,
          2.5,
        );
      break;
    }
    case "hit.burst":
      tone(110 - index * 8, 0, 0.5 + index * 0.1, "sine", 0.18);
      noise(0, 0.35, 2600, 0.7, 0.14, 9000);
      bell(1046 * Math.pow(1.122, index), 0.03, 0.9, 0.09, 2);
      break;
    case "card.feed":
      noise(0, 0.5, 700, 0.8, 0.08, 2600);
      [0.42, 0.5, 0.58].forEach((t) => click(t, 2600, 0.06));
      break;
    case "card.keep":
      noise(0, 0.25, 3000, 1.1, 0.07, 1200);
      bell(1568, 0.3, 0.3, 0.06, 2);
      break;
    case "tokens.flow":
      for (let i = 0; i < 10; i++)
        bell(1318 + i * 60, i * 0.045, 0.18, 0.04, 2);
      break;
  }
}

/** UI: a soft tick on press, a brighter one on release. */
export function uiTick(kind: "down" | "up") {
  if (kind === "down") click(0, 1500, 0.06);
  else click(0, 2600, 0.05);
}
