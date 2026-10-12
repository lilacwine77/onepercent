// Scenes of the vertical cut (9:16, 1080×1920 for X, Telegram and TikTok), on
// the timeline of scenes.js: the 25 s score's grid is 120 BPM (a beat every
// 0.5 s): groove 2, riser 8, drop 10, hit accent 14, driving 16, lift 20,
// final hit 22. Every visual event lands on the 16:9 master's time, so the
// shared soundtrack (sfx.json) fits both cuts.
//
// The phone captures (432×768 CSS px at 2.5×, so 1080×1920 device px) play
// full-bleed at their native size. Text and key action stay inside the social
// safe area: out of the top 8%, the bottom 22% and the right 12% of the frame
// (x ≤ 950, 154 ≤ y ≤ 1498). App text kept on screen reads at about 40 px or
// more; small print is covered.
import { E, clamp, css, el, headline, keys, lerp, playHeadline, remap, rng, seg, setSrc, show, spring } from "./engine.js";

const AST = "✳︎"; // ✳ as text, never the emoji
const DPR = 2.5; // device px per CSS px of the mobile captures
const PAGE_W = 432; // CSS width of the phone viewport
const HL = 150; // headline size (Fraunces 700)
const SUB = 46; // subline size (DM Sans 500)
const PANEL_RADIUS = "26px 26px 70px 26px"; // the brand's 1% corner at this scale

/**
 * A capture seen through a camera: { cx, cy } in capture CSS px and `zoom` in
 * film px per CSS px. `patch()` adds a cover in capture CSS px that moves
 * with the picture (small print, demo values).
 */
function screen(parent, { shadow = true, bg = null } = {}) {
  const box = el("div", "screen", parent);
  if (!shadow) box.style.boxShadow = "none";
  if (bg) box.style.background = bg;
  const cam = el("div", "", box);
  css(cam, { position: "absolute", left: "0", top: "0", transformOrigin: "0 0" });
  const img = el("img", "", cam);
  css(img, { position: "absolute", left: "0", top: "0" });
  const api = {
    box,
    cam,
    img,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    view: { cx: 0, cy: 0, zoom: 1 },
    /** Place the box in film px; `corner` 1 is the brand corner, 0 a square edge. */
    rect(x, y, w, h, corner = 0) {
      Object.assign(api, { x, y, w, h });
      const r = (v) => `${(v * corner).toFixed(2)}px`;
      css(box, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${r(26)} ${r(26)} ${r(70)} ${r(26)}` });
    },
    /** Show `src` (device px) under the camera; the image only ever shrinks or stays 1:1. */
    show(src, view, { cssW = PAGE_W, cssH = 768 } = {}) {
      api.view = view;
      setSrc(img, src);
      css(img, { width: `${cssW * DPR}px`, height: `${cssH * DPR}px` });
      css(cam, {
        width: `${cssW * DPR}px`,
        height: `${cssH * DPR}px`,
        transform: `translate3d(${api.w / 2 - view.cx * view.zoom}px, ${api.h / 2 - view.cy * view.zoom}px, 0) scale(${view.zoom / DPR})`,
      });
    },
    /** A cover in capture CSS px. */
    patch(x, y, w, h, styles = {}) {
      const p = el("div", "", cam);
      css(p, { position: "absolute", left: `${x * DPR}px`, top: `${y * DPR}px`, width: `${w * DPR}px`, height: `${h * DPR}px`, ...styles });
      return p;
    },
    /** Film position of a capture point (CSS px), before the box's own transform. */
    at(px, py) {
      const v = api.view;
      return { x: api.x + api.w / 2 + (px - v.cx) * v.zoom, y: api.y + api.h / 2 + (py - v.cy) * v.zoom };
    },
  };
  return api;
}

/** Canvas particles, drawn as a pure function of time. */
function particles(parent, W, H) {
  const canvas = el("canvas", "fx", parent);
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext("2d");
  return {
    canvas,
    clear() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(scale, 0, 0, scale, 0, 0);
    },
    g,
  };
}

/**
 * A finger tap: a soft disc lands, presses and lifts, and a ring ripples out
 * from the press (the phone's answer to the 16:9 cursor).
 */
function tapLayer(parent) {
  const size = 96;
  // Two-tone ring: reads on the app's dark buttons and on its light floors.
  const ring = el("div", "abs", parent);
  css(ring, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    border: "6px solid #9d62c7",
    boxShadow: "0 0 0 2px rgba(255,249,238,.85), 0 0 22px 4px rgba(213,162,241,.75), inset 0 0 0 2px rgba(255,249,238,.6)",
  });
  const dot = el("div", "abs", parent);
  css(dot, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    background: "radial-gradient(circle at 50% 45%, rgba(255,249,238,.8), rgba(255,241,231,.45) 62%, rgba(255,241,231,.2))",
    border: "3px solid rgba(255,249,238,.95)",
    boxShadow: "0 10px 26px -6px rgba(20,4,30,.55), 0 0 0 1.5px rgba(38,6,46,.35)",
  });
  return (t, x, y, at, { lead = 0.22, disc = true } = {}) => {
    const inU = seg(t, at - lead, at - 0.05, E.snap);
    const press = seg(t, at - 0.06, at, E.cubicOut) * (1 - seg(t, at + 0.05, at + 0.16, E.cubicOut));
    const out = seg(t, at + 0.1, at + 0.3, E.cubicIn);
    const on = disc && t > at - lead && t < at + 0.3;
    show(dot, on);
    if (on)
      css(dot, {
        transform: `translate3d(${x - size / 2}px, ${y - size / 2}px, 0) scale(${(1.4 - 0.4 * inU) * (1 - 0.16 * press) * (1 + 0.1 * out)})`,
        opacity: String(inU * (1 - out)),
      });
    const rp = seg(t, at - 0.02, at + 0.48, E.cubicOut);
    show(ring, rp > 0 && rp < 1);
    if (rp > 0 && rp < 1)
      css(ring, { transform: `translate3d(${x - size / 2}px, ${y - size / 2}px, 0) scale(${0.55 + 1.6 * rp})`, opacity: String(clamp(1.25 * (1 - rp))) });
  };
}

/** Where a still sits in its PNG (stills are clipped to the page, so an edge can be cut). */
function stillBox(s, pageW = PAGE_W) {
  const x0 = Math.max(0, s.x - s.pad), y0 = Math.max(0, s.y - s.pad);
  const x1 = Math.min(pageW, s.x + s.width + s.pad), y1 = s.y + s.height + s.pad;
  return { offX: s.x - x0, offY: s.y - y0, w: x1 - x0, h: y1 - y0 };
}

/** A still cropped to its element box (corner radii in CSS px), `w` film px wide. */
function stillCard(parent, src, s, w, { radius = [12, 12, 22, 12], shadow = "0 30px 60px -24px rgba(0,0,0,.7)" } = {}) {
  const b = stillBox(s);
  const k = w / s.width; // film px per CSS px
  const box = el("div", "", parent);
  css(box, {
    position: "absolute",
    width: `${w}px`,
    height: `${s.height * k}px`,
    borderRadius: radius.map((r) => `${r * k}px`).join(" "),
    overflow: "hidden",
    boxShadow: shadow,
  });
  const img = el("img", "", box);
  setSrc(img, src);
  css(img, { position: "absolute", width: `${b.w * k}px`, height: `${b.h * k}px`, left: `${-b.offX * k}px`, top: `${-b.offY * k}px` });
  return { box, img, w, h: s.height * k, k };
}

/** Frame of the nth event with this label in a clip's events (or a fallback). */
function evFrame(meta, label, nth = 0, fallback = null) {
  const list = (meta?.events ?? []).filter((e) => e.label === label);
  return list[nth]?.frame ?? fallback;
}
/** The press of a clip (a tap on mobile, a pointer on desktop). */
function pressOf(meta, fallback) {
  return (meta?.events ?? []).find((e) => e.label === "tap" || e.label === "pointer") ?? fallback;
}

/** A gold SOL coin, drawn on a 2D context (spinning: `phase`). */
function coin(g, x, y, r, phase, alpha) {
  const sx = Math.max(0.12, Math.abs(Math.cos(phase)));
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.scale(sx, 1);
  const grad = g.createLinearGradient(0, -r, 0, r);
  grad.addColorStop(0, "#fff3c4");
  grad.addColorStop(0.35, "#f6d272");
  grad.addColorStop(0.7, "#d9a441");
  grad.addColorStop(1, "#a8701f");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = r * 0.12;
  g.strokeStyle = "#a8701f";
  g.beginPath();
  g.arc(0, 0, r * 0.74, 0, Math.PI * 2);
  g.stroke();
  if (sx > 0.45) {
    g.fillStyle = "#3a2208";
    g.font = `700 ${r * 0.62}px "DM Sans"`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("SOL", 0, r * 0.04);
  }
  g.restore();
}

/** An ink panel with the brand corner, for type layered in front of a picture. */
function inkPanel(parent, x, y, w, h) {
  const panel = el("div", "abs", parent);
  css(panel, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`,
    background: "rgba(38, 6, 46, 0.95)",
    borderRadius: PANEL_RADIUS,
    boxShadow: "0 34px 80px -26px rgba(10, 2, 20, 0.75)",
  });
  return panel;
}

export function buildScenes(world, ctx) {
  const { W, H } = ctx;
  const list = [];
  // Move scenes (from index `first` on) by dt seconds; `until` sets their end.
  const shift = (first, dt, until) => {
    for (let i = first; i < list.length; i++) {
      const sc = list[i];
      const render = sc.render, blur = sc.blur;
      sc.from += dt;
      sc.to = until ?? sc.to + dt;
      sc.render = (t, c) => render(t - dt, c);
      if (blur) sc.blur = (t) => blur(t - dt);
    }
  };

  // ── 1 · X-ray: "Your bags are dust." (0 → 3.5 s) ────────────────────────
  {
    const from = 0, to = 3.62;
    const root = el("div", "scene", world);
    css(root, {
      background: "radial-gradient(140% 80% at 56% 64%, #2d4c8c 0%, #243969 26%, #1a1d4f 54%, #120d30 80%, #0b0820 100%)",
    });
    const lines = el("div", "layer", root);
    css(lines, {
      background: "repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 2px, rgba(0,0,0,0) 2px 5px)",
      mixBlendMode: "screen",
    });
    const glow = el("div", "layer", root);
    css(glow, { background: "radial-gradient(62% 32% at 48% 62%, rgba(148,245,237,.16), rgba(148,245,237,0) 70%)" });

    const kicker = el("div", "kicker", root);
    // A real trencher wallet's X-ray (its address is left out on purpose).
    kicker.textContent = `X-ray ${AST} ${ctx.dust?.walletBags ?? 207} pump.fun bags`;
    css(kicker, { color: "var(--xray-cyan)", fontSize: "42px", left: "82px", top: "222px" });
    const title = headline(root, [["Your", "bags"], ["are", { t: "dust.", cls: "accent" }]]);
    css(title.root, { fontSize: `${HL}px`, left: "76px", top: "282px", color: "var(--cream)" });
    const dustWord = title.words[3].inner;
    dustWord.style.color = "var(--xray-cyan)";

    // The real rows of the X-rayed wallet as the phone's Feed lists them, each
    // cropped to coin, ticker and quote (326×76 capture px from the row's
    // corner, so the coin sits whole with the row's own padding) and enlarged
    // so the quote reads at about 40 px; the "Final check" line is covered.
    const CROP = { w: 326, h: 76 };
    const k = 2.62; // film px per CSS px
    const rowW = CROP.w * k, rowH = CROP.h * k;
    const gap = 20;
    const total = 4 * rowH + 3 * gap;
    const rowsWrap = el("div", "abs", root);
    css(rowsWrap, { width: `${rowW}px`, height: `${total}px`, left: "70px", top: "632px", transformStyle: "preserve-3d" });
    const rows = [];
    const stillsRows = ctx.stills.rows ?? [];
    // Where each row's quote ("≈… SOL if sold now") sits, in row CSS px,
    // measured on the stills (its line spans y 36.4-49.2).
    const VALUE = [[122.0, 302.8], [126.4, 293.6], [118.8, 304.0], [117.6, 297.2]];
    for (let i = 0; i < Math.min(4, stillsRows.length); i++) {
      const s = stillsRows[i];
      const b = stillBox(s);
      const row = el("div", "abs", rowsWrap);
      css(row, {
        width: `${rowW}px`,
        height: `${rowH}px`,
        top: `${i * (rowH + gap)}px`,
        borderRadius: `${18 * k}px ${18 * k}px ${30 * k}px ${18 * k}px`,
        overflow: "hidden",
        background: "#fff1e7",
        boxShadow: "0 22px 46px -20px rgba(0,0,0,.6)",
      });
      // Two layers: the X-ray (filtered) and the real row the scan develops.
      // Each carries its own cover for "Final check when you Feed" (small
      // print) so the cover takes the layer's look.
      const layer = (filter) => {
        const wrap = el("div", "", row);
        css(wrap, { position: "absolute", left: "0", top: "0", width: `${rowW}px`, height: `${rowH}px`, ...(filter ? { filter } : {}) });
        const img = el("img", "", wrap);
        setSrc(img, `${ctx.CAP}/${ctx.PROFILE}/rows/rows/${String(i).padStart(2, "0")}.png`);
        css(img, { position: "absolute", width: `${b.w * k}px`, height: `${b.h * k}px`, left: `${-b.offX * k}px`, top: `${-b.offY * k}px` });
        const fine = el("div", "", wrap);
        css(fine, { position: "absolute", left: `${60 * k}px`, top: `${55.5 * k}px`, width: `${(CROP.w - 60) * k}px`, height: `${(CROP.h - 55.5) * k}px`, background: "#fff1e7" });
        return wrap;
      };
      const xray = layer("grayscale(1) invert(1) brightness(.9) sepia(1) hue-rotate(130deg) saturate(3.2) contrast(1.15)");
      const real = layer(null);
      const [qx0, qx1] = VALUE[i] ?? VALUE[0];
      const qy = 42.8;
      const ring = el("div", "abs", row);
      css(ring, {
        left: `${(qx0 - 6) * k}px`,
        top: `${(qy - 12) * k}px`,
        width: `${(qx1 - qx0 + 12) * k}px`,
        height: `${24 * k}px`,
        borderRadius: "999px",
        border: "3px solid var(--xray-cyan)",
        boxShadow: "0 0 16px rgba(148,245,237,.65)",
        opacity: "0",
      });
      rows.push({ row, xray, real, ring });
    }
    const scan = el("div", "abs", rowsWrap);
    css(scan, {
      width: `${rowW + 120}px`,
      left: "-60px",
      height: "4px",
      background: "linear-gradient(90deg, rgba(179,251,255,0), #b3fbff 20%, #ffffff 50%, #b3fbff 80%, rgba(179,251,255,0))",
      boxShadow: "0 0 26px 7px rgba(148,245,237,.55)",
    });
    const fx = particles(root, W, H);
    const rand = rng(77);
    const dust = Array.from({ length: 1100 }, () => ({
      row: Math.floor(rand() * 4),
      u: rand() < 0.5 ? rand() * 0.18 : 0.22 + rand() * 0.6,
      v: 0.12 + rand() * 0.76,
      t0: 2.0 + Math.pow(rand(), 1.6) * 0.9,
      vx: 60 + rand() * 300,
      vy: -(40 + rand() * 150),
      life: 0.8 + rand() * 1.4,
      r: 0.8 + rand() * 2.8,
      c: rand() < 0.55 ? "255,241,231" : rand() < 0.7 ? "148,245,237" : "213,162,241",
      w: rand() * Math.PI * 2,
    }));

    list.push({
      root,
      from,
      to,
      blur: (t) => ((t > 0.28 && t < 0.8) || (t > 3.28 && t < 3.62) ? 4 : 1),
      render(t) {
        // Rows slide in, then the scan line develops them from X-ray to real.
        const scanY = keys([[0.5, -12], [1.32, total + 12, E.sineInOut]])(t);
        rows.forEach((r, i) => {
          const tin = 0.28 + i * 0.07;
          const u = seg(t, tin, tin + 0.6, E.snap);
          const out = seg(t, 3.28 + i * 0.03, 3.6, E.expoIn);
          const dim = seg(t, 2.0, 2.7, E.cubicOut);
          const y0 = i * (rowH + gap);
          const reveal = clamp((scanY - y0) / rowH);
          r.real.style.clipPath = `inset(0 0 ${(1 - reveal) * 100}% 0)`;
          r.row.style.transform = `translate3d(${(1 - u) * 300 - out * 1150}px, 0, ${-i * 24}px) rotateY(${-7 + 3.5 * u}deg) rotateX(3deg)`;
          r.row.style.opacity = String(u);
          r.row.style.filter = `saturate(${1 - 0.6 * dim}) brightness(${1 - 0.12 * dim})`;
          const ringIn = seg(t, 1.38 + i * 0.07, 1.62 + i * 0.07, E.snap);
          const ringOut = seg(t, 2.05, 2.35, E.cubicIn);
          r.ring.style.opacity = String(ringIn * (1 - ringOut));
          r.ring.style.transform = `scale(${1.06 - 0.06 * ringIn})`;
        });
        const scanOn = t > 0.45 && t < 1.42;
        show(scan, scanOn);
        if (scanOn) css(scan, { top: `${scanY}px`, opacity: String(seg(t, 0.45, 0.55) * (1 - seg(t, 1.25, 1.42))) });
        const push = seg(t, 1.9, 3.6, E.sineInOut);
        rowsWrap.style.transform = `perspective(1700px) scale(${1 + 0.03 * push})`;
        const kickU = seg(t, 0.32, 0.8, E.snap);
        kicker.style.transform = `translateY(${(1 - kickU) * 24}px)`;
        kicker.style.opacity = String(kickU * (1 - seg(t, 3.25, 3.45)));
        playHeadline(title, t, { tin: 0.95, tout: 3.3, stagger: 0.07 });
        // "dust." lands on the drop of beat 4 with a spring and a glow.
        const pop = spring(t, 2.0, { freq: 2.6, damping: 0.42 });
        const o = seg(t, 3.39, 3.71, E.expoIn);
        dustWord.style.transform = `translate3d(0, ${(1 - clamp(pop * 1.6)) * 100 - o * 140}%, 0) scale(${0.7 + 0.3 * pop})`;
        dustWord.style.opacity = t < 2.0 ? "0" : String(1 - clamp((o - 0.6) / 0.4));
        dustWord.style.textShadow = `0 0 ${20 + 34 * (1 - seg(t, 2.0, 3.0))}px rgba(148,245,237,${0.55 * (1 - seg(t, 2.0, 3.2)) + 0.25})`;
        // Dust drifts off the bags.
        fx.clear();
        const rect = rowsWrap.getBoundingClientRect();
        for (const p of dust) {
          const age = t - p.t0;
          if (age < 0 || age > p.life) continue;
          const q = age / p.life;
          const x0 = rect.left + rect.width * (0.06 + p.u);
          const y0 = rect.top + (p.row * (rowH + gap) + p.v * rowH) * (rect.height / total);
          const x = x0 + p.vx * age * (1 - 0.25 * q) + Math.sin(p.w + age * 3) * 7;
          const y = y0 + p.vy * age + 12 * q * q;
          fx.g.globalAlpha = Math.pow(1 - q, 1.3) * 0.95;
          fx.g.strokeStyle = fx.g.fillStyle = `rgb(${p.c})`;
          const speed = 1 - 0.7 * q;
          if (p.r > 1.9) {
            fx.g.lineWidth = p.r * (1 - 0.4 * q);
            fx.g.lineCap = "round";
            fx.g.beginPath();
            fx.g.moveTo(x, y);
            fx.g.lineTo(x - p.vx * 0.03 * speed, y - p.vy * 0.03 * speed);
            fx.g.stroke();
          } else {
            fx.g.beginPath();
            fx.g.arc(x, y, p.r * (1 - 0.4 * q), 0, Math.PI * 2);
            fx.g.fill();
          }
        }
        fx.g.globalAlpha = 1;
      },
    });
  }

  // ── 2 · Feed + ROI: "Feed the machine." (3.42 → 8.0 s) ──────────────────
  // The X-rayed bags drop into the machine on the beats and come back out as
  // Dust Cards. Then one card shows what feeding is worth: its bag sells for
  // about 0.0003 SOL now; the card pays 2% of the pack price when a pack pulls
  // it (0.002 SOL for a 0.10 pack, up to 0.02 SOL for a 1.00 pack). Always
  // "when pulled": never a guaranteed or immediate payout. Hard cut at 8.0.
  {
    const from = 3.42, to = 8.0;
    const root = el("div", "scene", world);
    // The frame drifts left at the hand-off: its box (and its gradient, in px)
    // reaches 240 px past the right edge so no black shows behind it.
    css(root, { right: "-240px", background: `radial-gradient(${1.2 * W}px ${0.8 * H}px at ${0.62 * W}px ${0.62 * H}px, #5a2a6a 0%, #3a1846 38%, #2c1235 66%, #1a0920 100%)` });
    const title = headline(root, [["Feed", "the"], ["machine."]]);
    css(title.root, { fontSize: `${HL}px`, left: "76px", top: "190px", color: "var(--cream)" });
    const sub = el("div", "sub", root);
    sub.innerHTML = "Each card pays you<br>when a pack pulls it.";
    css(sub, { fontSize: `${SUB}px`, left: "80px", top: "508px", color: "rgba(255,241,231,.94)", whiteSpace: "nowrap" });

    // The machine (the app's own render of it), on the right.
    const MW = 440, MH = MW * (1189 / 717);
    const MX = 950 - MW, MY = 1488 - MH;
    const machine = el("img", "abs", root);
    setSrc(machine, "/repo/app/apps/web/public/experience/rip/machine-poster.webp");
    css(machine, { width: `${MW}px`, height: `${MH}px`, left: `${MX}px`, top: `${MY}px`, transformOrigin: "50% 100%" });
    const SLOT = { x: MX + (305 / 717) * MW, y: MY + (775 / 1189) * MH };
    const TRAY = { x: MX + (305 / 717) * MW, y: MY + (1000 / 1189) * MH };
    const glow = el("div", "abs", root);
    css(glow, { width: "560px", height: "560px", left: `${SLOT.x - 280}px`, top: `${SLOT.y - 280}px`, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(246,210,114,.55), rgba(246,210,114,0))", mixBlendMode: "screen" });

    // The bags as the X-ray listed them: coin + ticker (the coin stills are
    // the Feed's own: a 44 CSS px coin with 10 px of padding round it).
    const bags = (ctx.dust?.bags ?? []).slice(0, 4);
    const COIN = { size: 44, pad: 10 };
    const PH = 96;
    const pills = bags.map((bag, i) => {
      // show() toggles the outer box; the inner one keeps its flex layout.
      const outer = el("div", "abs", root);
      const pill = el("div", "", outer);
      css(pill, {
        display: "inline-flex",
        alignItems: "center",
        height: `${PH}px`,
        gap: `${PH * 0.22}px`,
        padding: `0 ${PH * 0.42}px 0 ${PH * 0.13}px`,
        borderRadius: `${PH / 2}px`,
        background: "#fff1e7",
        boxShadow: "0 18px 36px -16px rgba(0,0,0,.55)",
        color: "var(--ink)",
        font: `700 ${PH * 0.46}px/1 "Fraunces"`,
        letterSpacing: "-0.04em",
        whiteSpace: "nowrap",
      });
      const coinBox = el("div", "", pill);
      const cs = PH * 0.76;
      css(coinBox, { width: `${cs}px`, height: `${cs}px`, position: "relative", flex: "none", borderRadius: "50%", overflow: "hidden" });
      const img = el("img", "abs", coinBox);
      const kc = cs / COIN.size;
      setSrc(img, `${ctx.CAP}/${ctx.PROFILE}/rows/coins/${String(i).padStart(2, "0")}.png`);
      css(img, { width: `${(COIN.size + 2 * COIN.pad) * kc}px`, height: `${(COIN.size + 2 * COIN.pad) * kc}px`, left: `${-COIN.pad * kc}px`, top: `${-COIN.pad * kc}px` });
      const label = el("span", "", pill);
      label.textContent = `$${bag.symbol}`;
      return { outer, pill };
    });
    const PX = 56, PY0 = 690;
    const LAND = [4.0, 4.25, 4.5, 4.75];

    // Dust Cards: a holo back that flips to the real Dust Card face.
    const cardStills = (ctx.stills.cards ?? []).slice(0, 4);
    const CW = 240;
    const CH = CW * ((cardStills[0]?.height ?? 270.9) / (cardStills[0]?.width ?? 193.5));
    const cards = cardStills.map((st, i) => {
      // The outer box takes the 2D motion, opacity and blur; the inner card
      // only turns (opacity or a filter on a 3D box would flatten its faces).
      const outer = el("div", "abs", root);
      css(outer, { width: `${CW}px`, height: `${CH}px`, left: `${-CW / 2}px`, top: `${-CH / 2}px` });
      const card = el("div", "abs", outer);
      css(card, { width: `${CW}px`, height: `${CH}px`, transformStyle: "preserve-3d" });
      const back = el("div", "abs", card);
      css(back, {
        width: `${CW}px`,
        height: `${CH}px`,
        borderRadius: `${CW * 0.06}px ${CW * 0.06}px ${CW * 0.11}px ${CW * 0.06}px`,
        background: "url(/repo/app/apps/web/public/experience/home/card-holo-240.webp) center / cover",
        boxShadow: "0 24px 50px -20px rgba(0,0,0,.6), inset 0 0 0 2px rgba(255,255,255,.25)",
        backfaceVisibility: "hidden",
        display: "grid",
        placeItems: "center",
      });
      back.innerHTML = `<div style="background:rgba(20,8,24,.82);border-radius:${CW * 0.05}px;padding:${CW * 0.05}px ${CW * 0.08}px;text-align:center;color:#f6d272;font:700 ${CW * 0.2}px/1 Fraunces;letter-spacing:-.06em">1%<div style="font:700 ${CW * 0.045}px/1.2 'DM Sans';letter-spacing:.12em;margin-top:${CW * 0.03}px">RIP. REVEAL. OWN.</div></div>`;
      const face = el("div", "abs", card);
      css(face, { width: `${CW}px`, height: `${CH}px`, transform: "rotateY(180deg)", backfaceVisibility: "hidden" });
      const f = stillCard(face, `${ctx.CAP}/${ctx.PROFILE}/dustcards/cards/${String(i).padStart(2, "0")}.png`, st, CW, { shadow: "0 24px 50px -20px rgba(0,0,0,.6)" });
      css(f.box, { left: "0", top: "0" });
      return { outer, card, text: (st.text ?? "").toUpperCase() };
    });

    // The ROI card: the film's cheapest bag (the first of the fixture).
    const roiBag = bags[0] ?? { symbol: "HAHA", valueSol: "0.000301638" };
    const roiIndex = Math.max(0, cards.findIndex((c) => c.text.startsWith(`$${roiBag.symbol.toUpperCase()}SOL`)));
    const value = Number(roiBag.valueSol);
    const PAY_MIN = 0.002, PAY_MAX = 0.02; // 2% of 0.10 and of 1.00 SOL
    const times = Math.floor(PAY_MAX / value);
    const valueText = `≈${Number(value.toPrecision(1)).toString()} SOL`;
    const ROI = { x: 290, y: 968, s: 380 / CW }; // the card, forward, left of the multiple

    // The value now, then what the card pays when a pack pulls it (under the
    // card), the multiple (right of it) and the rule (under all).
    const chipFont = 46;
    const nowChip = el("div", "abs", root);
    nowChip.innerHTML = `<span style="font-weight:700">${valueText}</span><span style="opacity:.75"> if sold now</span>`;
    css(nowChip, { left: "80px", top: "1272px", padding: "0.32em 0.8em 0.38em", borderRadius: "999px", background: "#fff1e7", color: "var(--ink)", font: `500 ${chipFont}px/1 "DM Sans"`, whiteSpace: "nowrap", boxShadow: "0 18px 36px -16px rgba(0,0,0,.55)" });
    const payChip = el("div", "abs", root);
    payChip.innerHTML = `<span>pays up to </span><b style="font-weight:700">${PAY_MAX} SOL</b><span> when pulled</span>`;
    css(payChip, { left: "80px", top: "1272px", padding: "0.32em 0.8em 0.38em", borderRadius: "14px 14px 34px 14px", background: "linear-gradient(180deg, #f6d272, #d9a441)", color: "var(--ink)", font: `500 ${chipFont}px/1 "DM Sans"`, whiteSpace: "nowrap", boxShadow: "0 22px 44px -16px rgba(0,0,0,.6)", transformOrigin: "0% 50%" });
    const badge = el("div", "abs", root);
    badge.innerHTML = `<div style="font:500 42px/1 'DM Sans';color:rgba(255,241,231,.9);margin:0 0 14px 6px">up to</div><div style="font:700 240px/0.86 Fraunces;letter-spacing:-0.05em;color:var(--gold-hi);text-shadow:0 7px 0 rgba(58,34,8,.6), 0 20px 44px rgba(0,0,0,.45)">${times}×</div>`;
    css(badge, { left: "534px", top: "780px", transformOrigin: "10% 80%" });
    const fine = el("div", "abs", root);
    fine.textContent = `2% of the pack price: ${PAY_MIN} to ${PAY_MAX} SOL`;
    css(fine, { left: "82px", top: "1388px", font: '500 42px/1.2 "DM Sans"', color: "rgba(255,241,231,.88)", whiteSpace: "nowrap" });

    list.push({
      root,
      from,
      to,
      blur: (t) => ((t > 3.42 && t < 3.66) || (t > 5.98 && t < 6.3) || t > 7.5 ? 4 : 1),
      render(t) {
        // A wipe in from the right edge, on the whoosh.
        const wipe = seg(t, 3.42, 3.62, E.expoOut);
        const edge = (1 - wipe) * (W + 300);
        root.style.clipPath = wipe >= 1 ? "" : `polygon(${edge}px 0, ${W + 400}px 0, ${W + 400}px ${H}px, ${edge - 300}px ${H}px)`;
        // Hand-off to the Rip on the beat: from 7.5 the whole frame drifts left
        // while the Rip wipes in from the right, complete on 8.0.
        const hand = seg(t, 7.5, 8.0, E.cubicIn);
        root.style.transform = hand > 0 ? `translate3d(${-hand * 220}px, 0, 0)` : "";
        playHeadline(title, t, { tin: 3.56, stagger: 0.07 });
        const s1 = seg(t, 3.85, 4.2, E.snap);
        sub.style.opacity = String(s1);
        sub.style.transform = `translateY(${(1 - s1) * 18}px)`;
        // Machine: slides in, bumps as each bag lands, dims for the cards, then
        // steps aside for the ROI.
        const min = spring(t, 3.5, { freq: 1.8, damping: 0.7 });
        let bump = 0;
        for (const l of LAND) bump += Math.exp(-Math.max(0, t - l) * 14) * (t >= l ? 1 : 0);
        const back = seg(t, 5.0, 5.4, E.cubicOut);
        const mOut = seg(t, 5.9, 6.25, E.expoIn);
        show(machine, mOut < 1);
        machine.style.transform = `translate3d(${(1 - clamp(min)) * 300 + mOut * 520}px, 0, 0) scale(${(1 + 0.035 * bump) * (1 - 0.04 * back)}, ${(1 - 0.03 * bump) * (1 - 0.04 * back)})`;
        machine.style.opacity = String(clamp(min * 2) * (1 - mOut));
        machine.style.filter = `drop-shadow(0 40px 50px rgba(10,2,20,.55)) brightness(${1 - 0.28 * back})`;
        const gl = seg(t, 4.85, 5.05) * (1 - seg(t, 5.3, 5.9));
        show(glow, gl > 0);
        glow.style.opacity = String(gl);
        // Bags: pop in, then each drops into the slot on its beat.
        pills.forEach(({ outer, pill }, i) => {
          const t0 = 3.6 + i * 0.06;
          const pin = spring(t, t0, { freq: 2.4, damping: 0.62 });
          const land = LAND[i], go = land - 0.42;
          const u = seg(t, go, land, E.cubicIn);
          const pw = pill.offsetWidth || 400;
          const x0 = PX, y0 = PY0 + i * (PH + 22);
          const x = lerp(x0, SLOT.x - pw / 2, E.cubicInOut(u));
          const y = lerp(y0, SLOT.y - PH / 2, E.cubicIn(u)) - Math.sin(Math.PI * u) * 170;
          const sc = (0.6 + 0.4 * clamp(pin)) * (1 - 0.86 * E.cubicIn(u));
          show(outer, t >= t0 && t < land);
          outer.style.transformOrigin = `${pw / 2}px ${PH / 2}px`;
          outer.style.transform = `translate3d(${x - (1 - clamp(pin)) * 60}px, ${y}px, 0) rotate(${-14 * E.cubicIn(u)}deg) scale(${sc})`;
          outer.style.opacity = String(clamp(pin * 1.5) * (1 - seg(t, land - 0.08, land)));
        });
        // Dust Cards: out of the tray, into a fan, face up; then the ROI card
        // comes forward and the others leave downward.
        const focus = seg(t, 6.0, 6.42, E.snap);
        // The others fall back into the depth (no crossing of the chips' place).
        const leave = seg(t, 5.98, 6.22, E.cubicIn);
        cards.forEach(({ outer, card }, i) => {
          const t0 = 5.0 + i * 0.07;
          const u = seg(t, t0, t0 + 0.42, E.snap);
          const fanX = 505 + (i - 1.5) * 196;
          const fanY = 1080;
          let x = lerp(TRAY.x, fanX, u);
          let y = lerp(TRAY.y, fanY, u) - Math.sin(Math.PI * u) * 220 + Math.abs(i - 1.5) * 28 * u;
          let rot = (i - 1.5) * 7 * u, sc = 0.2 + 0.8 * u;
          const flip = seg(t, 5.2 + i * 0.08, 5.52 + i * 0.08, E.cubicInOut);
          let alpha = 1;
          if (i === roiIndex) {
            x = lerp(x, ROI.x, focus);
            y = lerp(y, ROI.y, focus);
            rot = lerp(rot, -3, focus);
            sc = lerp(sc, ROI.s, focus);
          } else {
            y += leave * 40;
            sc *= 1 - 0.3 * leave;
            alpha = 1 - leave;
          }
          show(outer, t >= t0 && alpha > 0.001);
          outer.style.opacity = String(alpha);
          outer.style.zIndex = i === roiIndex ? "3" : "1";
          outer.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg) scale(${sc})`;
          card.style.transform = `rotateY(${180 * flip}deg)`;
          const bl = i === roiIndex ? 0 : 8 * leave;
          outer.style.filter = bl > 0 ? `blur(${bl}px)` : "";
        });
        // ROI: "≈0.0003 SOL if sold now" turns into "pays up to 0.02 SOL when
        // pulled" on 6.5, and the multiple lands on 7.0.
        const nin = seg(t, 6.12, 6.36, E.snap), nout = seg(t, 6.5, 6.66, E.cubicIn);
        show(nowChip, t >= 6.12 && t < 6.7);
        nowChip.style.opacity = String(nin * (1 - nout));
        nowChip.style.transform = `translate3d(${(1 - nin) * 40}px, ${nout * -24}px, 0) scale(${1 - 0.08 * nout})`;
        const pin2 = spring(t, 6.5, { freq: 2.3, damping: 0.6 });
        show(payChip, t >= 6.5);
        payChip.style.opacity = String(clamp(pin2 * 2));
        payChip.style.transform = `translate3d(0, ${(1 - clamp(pin2)) * 30}px, 0) scale(${0.86 + 0.14 * pin2})`;
        const b = spring(t, 7.0, { freq: 2.0, damping: 0.5 });
        show(badge, t >= 7.0);
        badge.style.opacity = String(clamp(b * 2));
        badge.style.transform = `scale(${0.4 + 0.6 * b}) rotate(${(1 - clamp(b)) * -6}deg)`;
        const f = seg(t, 7.2, 7.45, E.snap);
        fine.style.opacity = String(f);
        fine.style.transform = `translateY(${(1 - f) * 14}px)`;
      },
    });
  }

  // Scenes written on the 22 s timeline move one bar (2 s) later on the 25 s
  // score: the extra groove bar goes to the Feed and its ROI.
  const firstShifted = list.length;
  // ── 3 · Rip: "Rip a pack." (7.55 → 16 s; written at 5.55 → 14, shifted) ──
  {
    const from = 5.55, to = 14.0;
    const CLIP = `${ctx.PROFILE}/rip-tap`;
    const meta = ctx.clips[CLIP] ?? { frames: 1, viewport: { width: PAGE_W, height: 768 }, events: [] };
    const vp = meta.viewport;
    const ev = (label, nth = 0) => evFrame(meta, label, nth);
    const press = pressOf(meta, { x: vp.width / 2, y: 642, frame: 30 });
    const P = press.frame ?? 30;
    const tear = ev("beat:tear") ?? 143;
    const flip = [0, 1, 2, 3].map((i) => ev("cue:card.flip", i) ?? tear + 68 + 29 * i);
    const burst = ev("cue:hit.burst") ?? flip[3] + 109;
    // The reveal's end state (title, quote chip, Dust Cards) is held until just
    // before the app clears the table for its action sheet ("beat:end").
    const END = Math.min(burst + 88, (ev("beat:end") ?? burst + 92) - 3);
    const SNAP = 2;
    // Between the tap and the tear the app dispenses the pack, flies it up and
    // cranks; that stretch plays about 1.3x faster.
    const crank = ev("beat:cranking") ?? tear - 60;
    const crankStop = ev("cue:crank.loop.stop") ?? tear - 28;
    // The tap lands on 6.3. The app's dock fades for ~11 frames after the press
    // and shows its small print while it does: the source jumps to P + 6 at the
    // tap (the machine has barely moved yet) and a clean copy of the dock
    // dissolves on top (dockFade).
    const GONE = P + 6;
    const srcAt = remap([
      [5.55, Math.max(0, P - 27)],
      [6.3 - 1 / 60, P - 1],
      [6.3, GONE],
      [7.25, crank],
      [7.62, crankStop],
      [8.0, tear],
      [9.0, flip[0] + SNAP],
      [9.5, flip[1] + SNAP],
      [10.0, flip[2] + SNAP],
      [10.5, flip[3] + SNAP],
      [12.0, burst],
      [13.2, burst + 66],
      [14.0, END, E.cubicOut],
    ]);
    const root = el("div", "scene", world);
    css(root, { background: "#f3e2e6" });
    const scr = screen(root, { shadow: false, bg: "#ecdbd9" });
    const FULLZ = W / vp.width;
    // The opening frames the real dock higher, so the Rip button (and the tap)
    // sit inside the safe area; the camera tilts back to the machine as the
    // app dives in.
    const LIFT = 110; // capture CSS px
    const camAt = (t) => {
      const zk = keys([
        [7.56, 1.0],
        [7.98, 1.09, E.cubicIn],
        [8.12, 1.0, E.expoOut],
        [10.5, 1.0],
        [11.96, 1.07, E.cubicInOut],
        [12.05, 1.13, E.expoOut],
        [12.6, 1.02, E.cubicOut],
        [14.0, 1.0, E.sineInOut],
      ])(t);
      const cyFull = keys([
        [6.0, vp.height / 2 + LIFT + 6],
        [6.4, vp.height / 2 + LIFT],
        [6.8, vp.height / 2, E.whip],
        [7.56, vp.height / 2],
        [7.98, vp.height / 2 - 18, E.cubicIn],
        [8.12, vp.height / 2, E.expoOut],
        [10.5, vp.height / 2],
        [11.96, vp.height / 2 - 24, E.cubicInOut],
        [14.0, vp.height / 2, E.sineInOut],
      ])(t);
      // A short shake on the tear and on the hit.
      const shake = (t0, amp) => {
        const q = seg(t, t0, t0 + 0.32);
        return q > 0 && q < 1 ? amp * (1 - q) * Math.sin(q * 60) : 0;
      };
      const zoom = FULLZ * zk;
      const hx = W / 2 / zoom, hy = H / 2 / zoom;
      const cx = clamp(vp.width / 2 + shake(8.0, 4) + shake(12.0, 5), hx, vp.width - hx);
      // Above 1×, keep the view inside the capture; the opening lift shows the
      // box colour under the dock (bottom 22%, under the social UI).
      let cy = cyFull + shake(8.0, 3) * 0.6 + shake(12.0, 4) * 0.7;
      if (zk > 1.0001) cy = clamp(cy, hy, vp.height - hy);
      return { cx, cy, zoom };
    };
    // The dock's small print (reveal toggles, "Every draw can be verified", the
    // balance) is covered: the dock is redrawn to end just under the Rip
    // button (capture CSS px, measured on the frames), on the page's colour.
    const fine = scr.patch(0, 669, PAGE_W, 231);
    fine.innerHTML = `<svg width="100%" height="100%" viewBox="0 669 ${PAGE_W} 231" preserveAspectRatio="none">
      <rect x="0" y="669" width="${PAGE_W}" height="231" fill="#ecdbd9"/>
      <path d="M12 669 L12 678 A22 22 0 0 0 34 700 L389 700 A31 31 0 0 0 420 669 Z" fill="#fdefe6"/>
      <path d="M12 669 L12 678 A22 22 0 0 0 34 700 L389 700 A31 31 0 0 0 420 669" fill="none" stroke="#26062e" stroke-width="1.5"/>
    </svg>`;

    // On the tap, the dock (as it was before the press, its bottom redrawn as
    // in `fine`, the app's own lower dock and small print covered down to
    // y 800) dissolves out over five frames.
    const DOCKY = 526, DOCKB = 800;
    const dockFade = scr.patch(0, DOCKY, PAGE_W, DOCKB - DOCKY, { overflow: "hidden" });
    const dockImg = el("img", "", dockFade);
    setSrc(dockImg, ctx.frameUrl(CLIP, P - 1));
    css(dockImg, { position: "absolute", left: "0px", top: `${-DOCKY * DPR}px`, width: `${vp.width * DPR}px`, height: `${vp.height * DPR}px` });
    const dockFoot = el("div", "", dockFade);
    css(dockFoot, { position: "absolute", left: "0px", top: `${(669 - DOCKY) * DPR}px`, width: `${PAGE_W * DPR}px`, height: `${(DOCKB - 669) * DPR}px` });
    dockFoot.innerHTML = `<svg width="100%" height="100%" viewBox="0 669 ${PAGE_W} ${DOCKB - 669}" preserveAspectRatio="none">
      <rect x="0" y="669" width="${PAGE_W}" height="${DOCKB - 669}" fill="#ecdbd9"/>
      <path d="M12 669 L12 678 A22 22 0 0 0 34 700 L389 700 A31 31 0 0 0 420 669 Z" fill="#fdefe6"/>
      <path d="M12 669 L12 678 A22 22 0 0 0 34 700 L389 700 A31 31 0 0 0 420 669" fill="none" stroke="#26062e" stroke-width="1.5"/>
    </svg>`;

    // The result's quote chip counts "≈ 0.0 → 0.4 SOL if sold now" while it
    // fades in. Those source frames are read from mobile/rip-fix instead: the
    // same frames with the chip's whole text redrawn as the settled chip's
    // ("≈ 0.4 SOL if sold now"), at the chip's measured offset and opacity
    // (made by scripts/film/vertical/pillfix.py).
    const FIXCLIP = `${ctx.PROFILE}/rip-fix`;
    // rip-fix also holds the frames after the tap without the app's gold focus
    // ring (scripts/film/vertical/ringfix.py), which lingers round the vanished button.
    const FIX = [[GONE, P + 28], [burst + 27, burst + 57]];
    const fixed = (n) => FIX.some(([a, b]) => n >= a && n <= b);

    // "Rip a pack." on an ink panel, deliberately in front of the machine.
    const tpanel = inkPanel(root, 60, 172, 830, 218);
    css(tpanel, { transformOrigin: "0% 0%" });
    const title = headline(tpanel, [["Rip", "a", "pack."]]);
    css(title.root, { fontSize: `${HL}px`, left: "48px", top: "34px", color: "var(--cream)" });
    const pill = el("div", "chip ink", root);
    pill.textContent = "4 Dust Cards + 1 hit";
    css(pill, { fontSize: "44px", left: "76px", top: "226px", boxShadow: "0 14px 30px -12px rgba(20,4,30,.5)" });
    const tap = tapLayer(root);
    const flash = el("div", "layer", root);
    css(flash, { background: "radial-gradient(60% 45% at 50% 45%, rgba(255,250,240,.9), rgba(255,250,240,0) 70%)", mixBlendMode: "screen" });
    const taps = (meta.events ?? []).filter((e) => e.label === "tap:dust");

    list.push({
      root,
      from,
      to,
      blur: (t) => ((t > 6.42 && t < 6.8) || (t > 5.55 && t < 6.0) ? 4 : 1),
      render(t) {
        // Wipe in from the right over the last beat of the Feed (on the grid).
        const wipe = seg(t, 5.55, 6.0, E.cubicInOut);
        const edge = (1 - wipe) * (W + 300);
        root.style.clipPath = wipe >= 1 ? "" : `polygon(${edge}px 0, ${W + 400}px 0, ${W + 400}px ${H}px, ${edge - 300}px ${H}px)`;
        const n = clamp(Math.round(srcAt(t)), 0, meta.frames - 1);
        const cam = camAt(t);
        scr.rect(0, 0, W, H, 0);
        scr.show(ctx.frameUrl(fixed(n) ? FIXCLIP : CLIP, n), cam, { cssW: vp.width, cssH: vp.height });
        show(fine, n < P);
        const dz = seg(t, 6.3 + 1 / 60, 6.3 + 6 / 60);
        show(dockFade, t >= 6.3 && dz < 1);
        dockFade.style.opacity = String(1 - dz);
        dockFade.style.transform = `translateY(${12 * DPR * E.cubicIn(dz)}px)`;
        const tp = seg(t, 6.0, 6.2, E.snap), tq = seg(t, 7.06, 7.26, E.expoIn);
        tpanel.style.transform = `translate3d(${(1 - tp) * -60 - tq * 120}px, 0, 0) scale(${0.94 + 0.06 * tp})`;
        tpanel.style.opacity = String(clamp(tp * 1.6) * (1 - tq));
        playHeadline(title, t, { tin: 6.04, stagger: 0.08 });
        const p = scr.at(press.x, press.y);
        tap(t, p.x, p.y, 6.3, { lead: 0.2 });
        // The dust taps, each on its card just before its flip lands.
        taps.slice(0, 4).forEach((e, i) => {
          const at = 9.0 + 0.5 * i - (flip[i] + SNAP - e.frame) / 60;
          if (Math.abs(t - at) < 0.6) {
            const q = scr.at(e.x, e.y);
            tap(t, q.x, q.y, at, { lead: 0.14, disc: false });
          }
        });
        const pi = seg(t, 8.95, 9.25, E.snap) * (1 - seg(t, 10.45, 10.7, E.cubicIn));
        show(pill, pi > 0);
        pill.style.opacity = String(pi);
        pill.style.transform = `translateY(${(1 - pi) * 18}px)`;
        const fl = Math.max(seg(t, 7.99, 8.03) * (1 - seg(t, 8.03, 8.3)), seg(t, 11.99, 12.03) * (1 - seg(t, 12.03, 12.4)));
        show(flash, fl > 0);
        flash.style.opacity = String(0.55 * fl);
      },
    });
  }

  // ── 4 · "Sell it instantly. Or keep it in My cards." (16 → 19.72 s; written at 14) ─
  // The hit, large, with the two choices the app offers after a pull: Sell (the
  // machine buys it now, 87% of its 0.40 SOL value: +0.348 SOL) and My cards.
  // On 16.0 the card goes into the Sell chip and SOL bursts out of it.
  {
    const from = 13.99, to = 18.0;
    const root = el("div", "scene", world);
    css(root, { background: "radial-gradient(120% 90% at 50% 52%, #ecc9fb 0%, #d5a2f1 46%, #b77fd8 100%)" });
    const light = el("div", "layer", root);
    css(light, { background: "radial-gradient(48% 30% at 50% 47%, rgba(255,250,240,.55), rgba(255,250,240,0) 70%)" });
    const HS = 124;
    const line1 = headline(root, [["Sell", "it", "instantly."]]);
    const line2 = headline(root, [["Or", "keep", "it", "in"], ["My", "cards."]]);
    css(line1.root, { fontSize: `${HS}px`, left: "72px", top: "166px", color: "var(--ink)" });
    css(line2.root, { fontSize: `${HS}px`, left: "72px", top: "306px", color: "var(--ink)" });

    // The hit card (My cards' own render), floating with a foil sheen.
    const st = (ctx.stills.hit ?? [{ x: 16, y: 400, width: 193.5, height: 270.9, pad: 40 }])[0];
    const CH = 590, CW = CH * (st.width / st.height);
    const CX = W / 2, CY = 900;
    const cardWrap = el("div", "abs", root);
    css(cardWrap, { left: `${CX - CW / 2}px`, top: `${CY - CH / 2}px`, width: `${CW}px`, height: `${CH}px` });
    const card = stillCard(cardWrap, `${ctx.CAP}/${ctx.PROFILE}/hitcard/card/00.png`, st, CW, {
      radius: [11, 11, 11, 11],
      shadow: "0 50px 90px -30px rgba(38,6,46,.65), 0 16px 34px -14px rgba(38,6,46,.5)",
    });
    css(card.box, { left: "0", top: "0" });
    const sheen = el("div", "abs", card.box);
    css(sheen, { width: `${CW * 0.7}px`, height: `${CH * 1.6}px`, top: `${-CH * 0.3}px`, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.42) 50%, rgba(255,255,255,0))", mixBlendMode: "overlay" });

    // The two actions, stacked and centred under the card.
    const chipFont = 46;
    const mkChip = (html, styles) => {
      const outer = el("div", "abs", root);
      const chip = el("div", "", outer);
      chip.innerHTML = html;
      css(chip, {
        display: "inline-flex",
        alignItems: "center",
        gap: `${chipFont * 0.4}px`,
        height: `${chipFont * 2.2}px`,
        padding: `0 ${chipFont * 0.7}px`,
        borderRadius: `${chipFont * 0.3}px ${chipFont * 0.3}px ${chipFont * 0.85}px ${chipFont * 0.3}px`,
        font: `500 ${chipFont}px/1 "DM Sans"`,
        whiteSpace: "nowrap",
        boxShadow: "0 22px 40px -18px rgba(38,6,46,.6)",
        transformOrigin: "50% 50%",
        ...styles,
      });
      return { outer, chip };
    };
    const sell = mkChip(
      `<b style="font-weight:700">Sell</b><span style="opacity:.55">·</span><span style="font-variant-numeric:tabular-nums">+0.348 SOL</span><span style="font-size:.8em;opacity:.85">instant</span>`,
      { background: "linear-gradient(180deg, #f6d272, #d9a441)", color: "var(--ink)" },
    );
    const ic = chipFont * 0.95;
    const mine = mkChip(
      `<svg width="${ic}" height="${ic}" viewBox="0 0 24 24" fill="none" stroke="#d5a2f1" stroke-width="1.8" stroke-linejoin="round"><rect x="7.5" y="3.5" width="12" height="16" rx="2.2" transform="rotate(8 13.5 11.5)"/><rect x="4" y="5" width="12" height="16" rx="2.2" fill="#26062e"/></svg><b style="font-weight:700">My cards</b>`,
      { background: "var(--ink)", color: "var(--cream)" },
    );
    const SY = 1228, MY2 = 1350;

    // The SOL received, big, where the card was.
    const paid = el("div", "abs", root);
    const paidInner = el("div", "", paid);
    css(paidInner, {
      display: "inline-flex",
      alignItems: "baseline",
      gap: "0.25em",
      padding: "32px 56px",
      borderRadius: PANEL_RADIUS,
      background: "linear-gradient(180deg, #f6d272, #d9a441)",
      color: "var(--ink)",
      font: '700 136px/1 "Fraunces"',
      letterSpacing: "-0.04em",
      fontVariantNumeric: "tabular-nums",
      boxShadow: "0 40px 80px -30px rgba(38,6,46,.65)",
      whiteSpace: "nowrap",
    });
    const paidNum = el("span", "", paidInner);
    const paidUnit = el("span", "", paidInner);
    paidUnit.textContent = "SOL";
    css(paidUnit, { fontSize: "0.55em", letterSpacing: "-0.02em" });

    // SOL coins out of the Sell chip.
    const fx = particles(root, W, H);
    const rand = rng(16);
    const coins = Array.from({ length: 36 }, () => ({
      a: -Math.PI / 2 + (rand() - 0.5) * 1.5,
      v: 980 * (0.55 + rand() * 0.6),
      r: 26 * (0.7 + rand() * 0.6),
      spin: (rand() - 0.5) * 16,
      d: rand() * 0.08,
    }));

    list.push({
      root,
      from,
      to,
      blur: (t) => (t < 14.28 || (t > 15.78 && t < 16.06) ? 4 : 1),
      render(t) {
        // Chips: shown first, then measured and centred (a pure function of t).
        show(sell.outer, t >= 14.18);
        show(mine.outer, t >= 15.12);
        const sw = sell.chip.offsetWidth || 560, mw = mine.chip.offsetWidth || 300;
        css(sell.outer, { left: `${(W - sw) / 2}px`, top: `${SY}px` });
        css(mine.outer, { left: `${(W - mw) / 2}px`, top: `${MY2}px` });
        // Card: flies in on the cut, floats, then goes into the Sell chip.
        const cin = seg(t, 13.99, 14.36, E.snap);
        const into = seg(t, 15.76, 16.0, E.cubicIn);
        const float = Math.sin((t - 14) * 2.4) * 7;
        const tx = W / 2 - sw * 0.2 - CX, ty = SY + chipFont * 1.1 - CY;
        show(cardWrap, t < 16.0);
        cardWrap.style.transform = `translate3d(${(1 - cin) * 620 + into * tx}px, ${float * (1 - into) + into * ty}px, 0) rotate(${(1 - cin) * 9 - into * 12}deg) scale(${(0.82 + 0.18 * cin) * (1 - 0.88 * into)})`;
        cardWrap.style.opacity = String(1 - seg(t, 15.9, 16.0));
        card.box.style.transform = `perspective(1400px) rotateY(${Math.sin((t - 14) * 1.7) * 7}deg) rotateX(${Math.cos((t - 14) * 1.3) * 3}deg)`;
        const shU = seg(t, 14.25, 15.1, E.cubicInOut);
        sheen.style.transform = `translate3d(${-CW * 0.8 + shU * CW * 1.9}px, 0, 0) rotate(16deg)`;
        playHeadline(line1, t, { tin: 14.0, stagger: 0.07, d: 0.5 });
        playHeadline(line2, t, { tin: 15.0, stagger: 0.07, d: 0.5 });
        // Sell chip: pops in, is pressed on 16.0, glows as it pays.
        const sp = spring(t, 14.18, { freq: 2.3, damping: 0.55 });
        const press = seg(t, 15.88, 15.96) * (1 - seg(t, 16.0, 16.12));
        const pulse = Math.exp(-Math.max(0, t - 16.0) * 6) * (t >= 16.0 ? 1 : 0);
        sell.chip.style.transform = `scale(${(0.6 + 0.4 * sp) * (1 - 0.06 * press + 0.08 * pulse)})`;
        sell.chip.style.opacity = String(clamp(sp * 2));
        sell.chip.style.boxShadow = `0 22px 40px -18px rgba(38,6,46,.6), 0 0 ${40 * pulse}px ${12 * pulse}px rgba(246,210,114,${0.8 * pulse})`;
        const rp = spring(t, 15.12, { freq: 2.3, damping: 0.55 });
        mine.chip.style.transform = `scale(${0.6 + 0.4 * rp})`;
        mine.chip.style.opacity = String(clamp(rp * 2));
        // +0.348 SOL lands where the card was, counting up.
        const pp = spring(t, 16.08, { freq: 2.2, damping: 0.6 });
        show(paid, t >= 16.08);
        const count = seg(t, 16.08, 16.62, E.cubicOut) * 0.348;
        paidNum.textContent = `+${count.toFixed(3)}`;
        const pw = paid.offsetWidth, ph = paid.offsetHeight;
        paid.style.transformOrigin = "50% 50%";
        paid.style.transform = `translate3d(${(W - pw) / 2}px, ${CY - ph / 2 + (1 - clamp(pp)) * 60}px, 0) scale(${0.7 + 0.3 * pp})`;
        paid.style.opacity = String(clamp(pp * 2));
        // Coins burst out of the chip on 16.0.
        fx.clear();
        const ox = W / 2 + sw * 0.32, oy = SY + chipFont * 1.1;
        for (const c of coins) {
          const age = t - 16.0 - c.d;
          if (age < 0 || age > 1.6) continue;
          const x = ox + Math.cos(c.a) * c.v * age;
          const y = oy + Math.sin(c.a) * c.v * age + 0.5 * 2600 * age * age;
          coin(fx.g, x, y, c.r, c.spin * age, 1 - seg(age, 1.1, 1.6));
        }
      },
    });
  }

  shift(firstShifted, 2);
  list[list.length - 1].to = 19.72; // the Sell beat dissolves into The 1% from 19.5

  // ── 5 · "Go for the 1%." (19.5 → 21.94 s) ──────────────────────────────
  // One slow reveal: the 1% card alone, big and centred, on a calm plum stage
  // with a soft glow, slow rays, sparkles and a light foil sheen.
  {
    const from = 19.5, to = 21.94;
    const root = el("div", "scene", world);
    css(root, { background: "radial-gradient(90% 70% at 50% 48%, #4a1f5c 0%, #2c1235 45%, #160818 100%)" });
    const CX = W / 2, CY = 868;
    const rays = el("div", "abs", root);
    const R = H * 1.5;
    css(rays, {
      width: `${R}px`,
      height: `${R}px`,
      left: `${CX - R / 2}px`,
      top: `${CY - R / 2}px`,
      background: "repeating-conic-gradient(from 0deg, rgba(246,210,114,.07) 0deg 6deg, rgba(246,210,114,0) 6deg 18deg)",
      WebkitMaskImage: "radial-gradient(closest-side, #000 0%, rgba(0,0,0,.6) 35%, transparent 70%)",
      maskImage: "radial-gradient(closest-side, #000 0%, rgba(0,0,0,.6) 35%, transparent 70%)",
    });
    const glow = el("div", "abs", root);
    const G = 1100;
    css(glow, { width: `${G}px`, height: `${G}px`, left: `${CX - G / 2}px`, top: `${CY - G / 2}px`, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,214,140,.45), rgba(213,162,241,.22) 45%, rgba(213,162,241,0) 72%)" });

    // The card, as My cards draws it; its demo value chip is covered.
    const st = (ctx.stills.onepct ?? [{ x: 16, y: 400, width: 193.5, height: 270.9, pad: 40 }])[0];
    const CH = 820;
    const CW = CH * (st.width / st.height);
    const cardWrap = el("div", "abs", root);
    css(cardWrap, { left: `${CX - CW / 2}px`, top: `${CY - CH / 2}px`, width: `${CW}px`, height: `${CH}px` });
    const card = stillCard(cardWrap, `${ctx.CAP}/${ctx.PROFILE}/onepctcard/card/00.png`, st, CW, {
      radius: [11, 11, 11, 11],
      shadow: "0 50px 110px -30px rgba(0,0,0,.75), 0 0 80px 10px rgba(246,210,114,.18)",
    });
    css(card.box, { left: "0", top: "0" });
    // Cover the demo "≈0.00 SOL est." chip with the panel's own cream (card CSS
    // px, measured on the still: chip 22-102 × 223-249, "est." to 127).
    const ONE = { x: 19, y: 220, w: 112, h: 32, color: "#fef8ed" };
    const cover = el("div", "abs", card.box);
    css(cover, { left: `${ONE.x * card.k}px`, top: `${ONE.y * card.k}px`, width: `${ONE.w * card.k}px`, height: `${ONE.h * card.k}px`, background: ONE.color, borderRadius: `${4 * card.k}px`, boxShadow: `0 0 ${3 * card.k}px ${2 * card.k}px ${ONE.color}` });
    const sheen = el("div", "abs", card.box);
    css(sheen, { width: `${CW * 0.6}px`, height: `${CH * 1.8}px`, top: `${-CH * 0.4}px`, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.5) 50%, rgba(255,255,255,0))", mixBlendMode: "overlay" });

    const title = headline(root, [["Go", "for", "the", { t: "1%.", cls: "pct" }]]);
    title.words[3].inner.style.color = "var(--gold-hi)";
    css(title.root, { fontSize: "132px", left: "0px", width: `${W}px`, textAlign: "center", top: "196px", color: "var(--cream)" });
    const sub = el("div", "sub", root);
    sub.innerHTML = `<b style="font-weight:700;color:var(--gold-hi)">10,000,000 $1PCT</b> · 1% of the supply`;
    css(sub, { left: "0px", width: `${W}px`, textAlign: "center", top: "1340px", fontSize: "44px", color: "rgba(255,241,231,.94)" });

    const fx = particles(root, W, H);
    const rand = rng(1);
    const sparks = Array.from({ length: 9 }, (_, i) => ({
      a: (i / 9) * Math.PI * 2 + rand() * 0.4,
      d: 470 * (0.8 + rand() * 0.3),
      r: 16 * (0.7 + rand() * 0.7),
      p: rand() * Math.PI * 2,
    }));
    function sparkle(g, x, y, r, alpha) {
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = "#f6d272";
      g.beginPath();
      g.moveTo(x, y - r);
      g.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
      g.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
      g.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
      g.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
      g.fill();
      g.restore();
    }

    list.push({
      root,
      from,
      to,
      render(t) {
        root.style.opacity = String(seg(t, 19.5, 19.72, E.cubicOut));
        const rise = seg(t, 19.55, 20.35, E.arrive);
        const push = seg(t, 20.35, 21.94, E.sineInOut);
        cardWrap.style.transform = `translate3d(0, ${(1 - rise) * 80}px, 0) scale(${(0.84 + 0.16 * rise) * (1 + 0.04 * push)})`;
        cardWrap.style.opacity = String(clamp(rise * 1.4));
        card.box.style.transform = `perspective(1600px) rotateY(${(1 - rise) * -14 + Math.sin((t - 20) * 1.3) * 3}deg) rotateX(${Math.cos((t - 20) * 1.1) * 2}deg)`;
        const sw = seg(t, 20.15, 21.25, E.cubicInOut);
        sheen.style.transform = `translate3d(${-CW * 0.7 + sw * CW * 2.1}px, 0, 0) rotate(18deg)`;
        const breathe = 0.85 + 0.15 * Math.sin((t - 19.5) * 2.2);
        glow.style.opacity = String(seg(t, 19.55, 20.4, E.cubicOut) * breathe);
        glow.style.transform = `scale(${0.8 + 0.2 * rise + 0.04 * push})`;
        rays.style.opacity = String(seg(t, 19.8, 20.6));
        rays.style.transform = `rotate(${(t - 19.5) * 6}deg)`;
        playHeadline(title, t, { tin: 20.0, stagger: 0.08, d: 0.55 });
        const s1 = seg(t, 20.45, 20.85, E.snap);
        sub.style.opacity = String(s1);
        sub.style.transform = `translateY(${(1 - s1) * 16}px)`;
        fx.clear();
        const on = seg(t, 20.1, 20.6);
        for (const s of sparks) {
          const tw = 0.5 + 0.5 * Math.sin((t - 20) * 3.1 + s.p);
          // Round the card, clear of the subline below and the right edge zone.
          const x = CX + Math.cos(s.a) * s.d * 0.8;
          const y = CY + Math.sin(s.a) * s.d * (Math.sin(s.a) > 0 ? 0.8 : 0.98);
          sparkle(fx.g, x, y, s.r * (0.6 + 0.6 * tw), on * (0.35 + 0.65 * tw));
        }
      },
    });
  }

  const endCard = list.length;
  // ── 6 · End card: "Dust in, Packs out." + onepercent.fun (22 → 25 s; written at 20) ─
  {
    const from = 19.99, to = 22.01;
    const root = el("div", "scene", world);
    css(root, { background: "#2c1235" });
    const bgWrap = el("div", "layer", root);
    const bg = el("img", "abs", bgWrap);
    setSrc(bg, "/repo/app/apps/web/public/experience/home/studio-1672.webp");
    const bgH = H, bgW = (H / 941) * 1672;
    css(bg, { width: `${bgW}px`, height: `${bgH}px`, left: `${-bgW * 0.5}px`, top: "0px" });
    const shade = el("div", "layer", root);
    css(shade, {
      background: "linear-gradient(180deg, rgba(38,6,46,.66) 0%, rgba(38,6,46,.3) 34%, rgba(38,6,46,.08) 58%, rgba(38,6,46,.5) 100%)",
    });
    const mark = el("div", "abs", root);
    mark.innerHTML = '1<span style="font-size:.8em">%</span>';
    css(mark, {
      fontFamily: "Fraunces",
      fontWeight: "700",
      letterSpacing: "-0.11em",
      lineHeight: "1",
      color: "var(--cream)",
      fontSize: "104px",
      left: `${W / 2 - 60}px`,
      top: "196px",
    });
    const title = headline(root, [["Dust", "in,"], ["Packs", "out."]]);
    css(title.root, { fontSize: "168px", color: "var(--cream)", left: "0px", top: "350px", width: `${W}px`, textAlign: "center" });
    const oval = el("div", "abs", root);
    css(oval, {
      height: "112px",
      display: "flex",
      alignItems: "center",
      gap: "34px",
      padding: "0 12px 0 40px",
      background: "var(--ink)",
      color: "var(--cream)",
      borderRadius: "14px 14px 40px 14px",
      font: '500 52px "DM Sans"',
      letterSpacing: "-0.01em",
      boxShadow: "0 22px 50px -20px rgba(0,0,0,.6)",
      left: `${W / 2}px`,
      top: "1322px",
    });
    oval.innerHTML =
      '<span>onepercent.fun</span><b style="display:grid;place-items:center;width:88px;height:88px;border-radius:9px 9px 28px 9px;background:var(--lilac);color:var(--ink);font-weight:700;font-size:44px">→</b>';
    const packFiles = ["pack-silver.webp", "pack-first-light.webp", "pack-closed.webp", "pack-anthracite.webp"];
    const fan = el("div", "abs", root);
    const pw = 400;
    css(fan, { left: `${W / 2}px`, top: "1000px" });
    const packs = packFiles.map((f) => {
      const img = el("img", "abs", fan);
      setSrc(img, `/repo/public/assets/${f}`);
      css(img, { width: `${pw}px`, height: `${pw}px`, left: `${-pw / 2}px`, top: `${-pw / 2}px`, transformOrigin: "50% 165%", filter: "drop-shadow(0 30px 34px rgba(20,4,30,.5))" });
      return img;
    });
    const sweep = el("div", "abs", root);
    css(sweep, {
      width: "520px",
      height: "2600px",
      background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,250,240,.38) 45%, rgba(255,255,255,.55) 50%, rgba(255,250,240,.38) 55%, rgba(255,255,255,0))",
      mixBlendMode: "overlay",
      top: "-300px",
    });

    list.push({
      root,
      from,
      to,
      blur: (t) => (t < 20.32 ? 4 : 1),
      render(t) {
        const hit = seg(t, 20.0, 20.45, E.cubicOut);
        root.style.filter = `brightness(${1.35 - 0.35 * hit})`;
        bgWrap.style.transform = `scale(${1.06 - 0.06 * seg(t, 20.0, 22.0, E.cubicOut)})`;
        const m = spring(t, 20.06, { freq: 2.2, damping: 0.6 });
        mark.style.transform = `translateY(${(1 - m) * 30}px) rotate(-6deg) scale(${0.85 + 0.15 * m})`;
        mark.style.opacity = String(clamp(m * 1.4));
        playHeadline(title, t, { tin: 20.0, stagger: 0.11, d: 0.55 });
        const o = spring(t, 20.5, { freq: 2.4, damping: 0.62 });
        oval.style.transform = `translate3d(${-oval.offsetWidth / 2}px, ${(1 - o) * 40}px, 0) scale(${0.9 + 0.1 * o})`;
        oval.style.opacity = String(clamp(o * 1.5));
        packs.forEach((img, i) => {
          const k = i - 1.5;
          const sp = spring(t, 20.02 + i * 0.05, { freq: 2.0, damping: 0.55 });
          const bob = Math.sin((t - 20) * ((2 * Math.PI) / 4.2) + i * 0.9) * 8;
          const x = k * 64;
          const y = bob + (1 - sp) * 900;
          img.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${k * 11 * sp}deg) scale(${0.7 + 0.3 * clamp(sp)})`;
        });
        const sw = seg(t, 20.85, 21.55, E.cubicInOut);
        show(sweep, sw > 0 && sw < 1);
        sweep.style.transform = `translate3d(${-600 + sw * 2300}px, 0, 0) rotate(18deg)`;
      },
    });
  }

  shift(endCard, 2, 25.01);
  return list;
}
