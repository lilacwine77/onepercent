// Scenes of the film. Times are film seconds; the score's grid is 120 BPM
// (a beat every 0.5 s): drop at 8 s, lift at 18 s, final hit at 20 s.
import { E, clamp, css, el, headline, keys, lerp, playHeadline, remap, rng, seg, setSrc, show, spring, tf } from "./engine.js";

const AST = "✳︎"; // ✳ as text, never the emoji
const WALLET = "J4aG…G31a";

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

export function buildScenes(world, ctx) {
  const { W, H, V } = ctx;
  const list = [];
  // Scenes written on the 22 s timeline move one bar (2 s) later on the 25 s
  // score: the extra groove bar goes to the Feed and its ROI.
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
      background:
        "radial-gradient(120% 95% at 72% 48%, #2d4c8c 0%, #243969 24%, #1a1d4f 52%, #120d30 78%, #0b0820 100%)",
    });
    const lines = el("div", "layer", root);
    css(lines, {
      background: "repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 2px, rgba(0,0,0,0) 2px 5px)",
      mixBlendMode: "screen",
    });
    const glow = el("div", "layer", root);
    css(glow, {
      background: "radial-gradient(40% 50% at 74% 50%, rgba(148,245,237,.16), rgba(148,245,237,0) 70%)",
    });

    const S = V ? 1.5 : 1; // type scale on the vertical cut
    const kicker = el("div", "kicker", root);
    // A real trencher wallet's X-ray (its address is left out on purpose).
    kicker.textContent = `X-ray ${AST} ${ctx.dust?.walletBags ?? 207} pump.fun bags`;
    css(kicker, { color: "var(--xray-cyan)", fontSize: `${28 * S}px`, left: `${V ? 84 : 70}px`, top: `${V ? 236 : 186}px` });
    const title = headline(root, [["Your", "bags"], ["are", { t: "dust.", cls: "accent" }]]);
    css(title.root, { fontSize: `${(V ? 150 : 96)}px`, left: `${V ? 78 : 64}px`, top: `${V ? 288 : 236}px`, color: "var(--cream)" });
    const dustWord = title.words[3].inner;
    dustWord.style.color = "var(--xray-cyan)";

    // The real rows of the X-rayed wallet (Feed lists them with their quote).
    const rowsWrap = el("div", "abs", root);
    // Each row shows its coin, ticker and quote (row x 0-322, y 6-74 capture
    // px, padded so the coin sits whole inside) at a scale where the quote
    // reads at TV size; the "Final check" line is small print, covered.
    const PADX = 16, CROP = { x: 0, y: 6, w: 322, h: 68 };
    const k = V ? 2.55 : 2.0; // film px per capture CSS px
    const rowW = (CROP.w + PADX) * k, rowH = CROP.h * k;
    const gap = V ? 30 : 12;
    css(rowsWrap, {
      width: `${rowW}px`,
      height: `${4 * rowH + 3 * gap}px`,
      left: `${V ? (W - rowW) / 2 : W - rowW - 36}px`,
      top: `${V ? 880 : (H - (4 * rowH + 3 * gap)) / 2}px`,
      transformStyle: "preserve-3d",
    });
    const rows = [];
    const stillsRows = ctx.stills.rows ?? [];
    for (let i = 0; i < Math.min(4, stillsRows.length); i++) {
      const row = el("div", "abs", rowsWrap);
      css(row, {
        width: `${rowW}px`,
        height: `${rowH}px`,
        top: `${i * (rowH + gap)}px`,
        borderRadius: `${14 * k}px`,
        overflow: "hidden",
        background: "#fff1e7",
        boxShadow: "0 18px 40px -18px rgba(0,0,0,.55)",
      });
      const st = stillsRows[i];
      const mk = () => {
        const img = el("img", "abs", row);
        setSrc(img, `${ctx.CAP}/${ctx.PROFILE}/rows/rows/${String(i).padStart(2, "0")}.png`);
        css(img, { width: `${(st.width + 2 * st.pad) * k}px`, height: `${(st.height + 2 * st.pad) * k}px`, left: `${(PADX - st.pad - CROP.x) * k}px`, top: `${(-st.pad - CROP.y) * k}px` });
        return img;
      };
      const xray = mk();
      css(xray, { filter: "grayscale(1) invert(1) brightness(.9) sepia(1) hue-rotate(130deg) saturate(3.2) contrast(1.15)" });
      const real = mk();
      const fine = el("div", "abs", row);
      css(fine, { left: `${(PADX + 58) * k}px`, top: `${(53 - CROP.y) * k}px`, width: `${270 * k}px`, height: `${21 * k}px`, background: "#fff1e7" });
      // Where each row's quote sits (row CSS px, measured in the stills).
      const VALUE = [[126, 306.5], [130.5, 297], [123, 307.5], [121.5, 300.5]][i] ?? [124, 306];
      const ring = el("div", "abs", row);
      css(ring, {
        left: `${(PADX + VALUE[0] - 7) * k}px`,
        top: `${(33.5 - CROP.y) * k}px`,
        width: `${(VALUE[1] - VALUE[0] + 14) * k}px`,
        height: `${16 * k}px`,
        borderRadius: "999px",
        border: `${2}px solid var(--xray-cyan)`,
        boxShadow: "0 0 14px rgba(148,245,237,.65)",
        opacity: "0",
      });
      rows.push({ row, xray, real, ring });
    }
    const scan = el("div", "abs", rowsWrap);
    css(scan, {
      width: `${rowW + 80}px`,
      left: "-40px",
      height: "3px",
      background: "linear-gradient(90deg, rgba(179,251,255,0), #b3fbff 20%, #ffffff 50%, #b3fbff 80%, rgba(179,251,255,0))",
      boxShadow: "0 0 22px 6px rgba(148,245,237,.55)",
    });
    const fx = particles(root, W, H);
    const total = 4 * rowH + 3 * gap;
    const rand = rng(77);
    const dust = Array.from({ length: 900 }, () => ({
      row: Math.floor(rand() * 4),
      u: rand() < 0.5 ? rand() * 0.16 : 0.2 + rand() * 0.55,
      v: 0.15 + rand() * 0.7,
      t0: 2.0 + Math.pow(rand(), 1.6) * 0.9,
      vx: 70 + rand() * 260,
      vy: -(20 + rand() * 110),
      life: 0.8 + rand() * 1.4,
      r: 0.7 + rand() * 2.4,
      c: rand() < 0.55 ? "255,241,231" : rand() < 0.7 ? "148,245,237" : "213,162,241",
      w: rand() * Math.PI * 2,
    }));

    list.push({
      root,
      from,
      to,
      blur: (t) => (t > 0.28 && t < 0.8) || (t > 3.28 && t < 3.62) ? 4 : 1,
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
          r.xray.style.opacity = String(1 - 0.0 * reveal);
          r.row.style.transform = tf({ x: (1 - u) * 260 - out * 900, z: -i * 30, ry: -14 + 4 * u, rx: 3 });
          r.row.style.opacity = String(u);
          r.row.style.filter = `saturate(${1 - 0.6 * dim}) brightness(${1 - 0.12 * dim})`;
          const ringIn = seg(t, 1.38 + i * 0.07, 1.62 + i * 0.07, E.snap);
          const ringOut = seg(t, 2.05, 2.35, E.cubicIn);
          r.ring.style.opacity = String(ringIn * (1 - ringOut));
          r.ring.style.transform = `scale(${1.15 - 0.15 * ringIn})`;
        });
        const scanOn = t > 0.45 && t < 1.42;
        show(scan, scanOn);
        if (scanOn) css(scan, { top: `${scanY}px`, opacity: String(seg(t, 0.45, 0.55) * (1 - seg(t, 1.25, 1.42))) });
        const push = seg(t, 1.9, 3.6, E.sineInOut);
        rowsWrap.style.transform = `perspective(1500px) scale(${1 + 0.05 * push + 0.03 * (spring(t, 2.0, { freq: 3, damping: 0.4 }) - 1) * 0})`;
        const kickU = seg(t, 0.32, 0.8, E.snap);
        kicker.style.transform = `translateY(${(1 - kickU) * 20}px)`;
        kicker.style.opacity = String(kickU * (1 - seg(t, 3.25, 3.45)));
        playHeadline(title, t, { tin: 0.95, tout: 3.3, stagger: 0.07, pops: {} });
        // "dust." lands on the drop of beat 4 with a spring and a glow.
        const pop = spring(t, 2.0, { freq: 2.6, damping: 0.42 });
        const o = seg(t, 3.39, 3.71, E.expoIn);
        dustWord.style.transform = `translate3d(0, ${(1 - clamp(pop * 1.6)) * 100 - o * 140}%, 0) scale(${0.7 + 0.3 * pop})`;
        dustWord.style.opacity = t < 2.0 ? "0" : String(1 - clamp((o - 0.6) / 0.4));
        dustWord.style.textShadow = `0 0 ${18 + 30 * (1 - seg(t, 2.0, 3.0))}px rgba(148,245,237,${0.55 * (1 - seg(t, 2.0, 3.2)) + 0.25})`;
        // Dust drifts off the bags.
        fx.clear();
        const rect = rowsWrap.getBoundingClientRect();
        for (const p of dust) {
          const age = t - p.t0;
          if (age < 0 || age > p.life) continue;
          const k = age / p.life;
          const x0 = rect.left + (rect.width * (0.08 + p.u));
          const y0 = rect.top + (p.row * (rowH + gap) + p.v * rowH) * (rect.height / total);
          const x = x0 + p.vx * age * (1 - 0.25 * k) + Math.sin(p.w + age * 3) * 6;
          const y = y0 + p.vy * age + 10 * k * k;
          const a = Math.pow(1 - k, 1.3) * 0.95;
          fx.g.globalAlpha = a;
          fx.g.strokeStyle = fx.g.fillStyle = `rgb(${p.c})`;
          const speed = 1 - 0.7 * k;
          if (p.r > 1.6) {
            fx.g.lineWidth = p.r * (1 - 0.4 * k);
            fx.g.lineCap = "round";
            fx.g.beginPath();
            fx.g.moveTo(x, y);
            fx.g.lineTo(x - p.vx * 0.03 * speed, y - p.vy * 0.03 * speed);
            fx.g.stroke();
          } else {
            fx.g.beginPath();
            fx.g.arc(x, y, p.r * (1 - 0.4 * k), 0, Math.PI * 2);
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
  // about 0.0003 SOL now, the card pays 2% of the pack price that pulls it
  // (0.002 SOL for a 0.10 pack, up to 0.02 SOL for a 1.00 pack).
  {
    const from = 3.42, to = 8.0;
    const root = el("div", "scene", world);
    // The frame reaches 240 px past the right edge, so the drift left during
    // the hand-off never uncovers the stage; the gradient is set in px so the
    // wider box looks the same.
    css(root, {
      right: "-240px",
      background: `radial-gradient(${1.2 * W}px ${H}px at ${0.7 * W}px ${0.4 * H}px, #5a2a6a 0%, #3a1846 35%, #2c1235 62%, #1a0920 100%)`,
    });
    const title = headline(root, V ? [["Feed", "the"], ["machine."]] : [["Feed", "the", "machine."]]);
    css(title.root, { fontSize: `${V ? 150 : 92}px`, left: "70px", top: `${V ? 230 : 52}px`, color: "var(--cream)" });
    const sub = el("div", "sub", root);
    sub.textContent = "Each card pays you when a pack pulls it.";
    css(sub, { fontSize: `${V ? 46 : 32}px`, left: "74px", top: `${V ? 600 : 160}px`, color: "rgba(255,241,231,.92)", whiteSpace: "nowrap" });

    // The machine (the app's own render of it).
    const MW = V ? 560 : 360;
    const MH = MW * (1189 / 717);
    const machine = el("img", "abs", root);
    setSrc(machine, "/repo/app/apps/web/public/experience/rip/machine-poster.webp");
    const MX = V ? (W - MW) / 2 + 40 : W - MW - 70, MY = V ? 820 : H - MH + 44;
    css(machine, { width: `${MW}px`, height: `${MH}px`, left: `${MX}px`, top: `${MY}px`, transformOrigin: "50% 100%", filter: "drop-shadow(0 40px 50px rgba(10,2,20,.55))" });
    const SLOT = { x: MX + (305 / 717) * MW, y: MY + (780 / 1189) * MH };
    const TRAY = { x: MX + (305 / 717) * MW, y: MY + (1000 / 1189) * MH };
    const glow = el("div", "abs", root);
    css(glow, { width: "420px", height: "420px", left: `${SLOT.x - 210}px`, top: `${SLOT.y - 210}px`, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(246,210,114,.55), rgba(246,210,114,0))", mixBlendMode: "screen" });

    // The bags as the X-ray listed them: coin + ticker.
    const bags = ctx.dust?.bags ?? [];
    const PH = V ? 104 : 80, PW = V ? 440 : 320;
    const pills = bags.slice(0, 4).map((bag, i) => {
      const outer = el("div", "abs", root);
      const pill = el("div", "", outer);
      css(pill, {
        width: `${PW}px`,
        height: `${PH}px`,
        borderRadius: `${PH / 2}px`,
        background: "#fff1e7",
        boxShadow: "0 18px 36px -16px rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        gap: `${PH * 0.22}px`,
        padding: `0 ${PH * 0.4}px 0 ${PH * 0.14}px`,
        color: "var(--ink)",
        font: `700 ${PH * 0.42}px/1 "Fraunces"`,
        letterSpacing: "-0.04em",
        whiteSpace: "nowrap",
      });
      const coinBox = el("div", "", pill);
      const cs = PH * 0.76;
      css(coinBox, { width: `${cs}px`, height: `${cs}px`, position: "relative", flex: "none" });
      const img = el("img", "abs", coinBox);
      const box = cs * (128 / 88);
      setSrc(img, `${ctx.CAP}/${ctx.PROFILE}/rows/coins/${String(i).padStart(2, "0")}.png`);
      css(img, { width: `${box}px`, height: `${box}px`, left: `${(cs - box) / 2}px`, top: `${(cs - box) / 2}px`, clipPath: "circle(33.6% at 50% 50%)" });
      const label = el("span", "", pill);
      label.textContent = `$${bag.symbol}`;
      return outer;
    });
    const PX = 76, PY0 = V ? 760 : 232;
    const LAND = [4.0, 4.25, 4.5, 4.75];

    // Dust Cards: a holo back that flips to the real Dust Card face.
    const CW = V ? 250 : 150, CH = CW * (295.7 / 211.2);
    const cards = (ctx.stills.cards ?? []).slice(0, 4).map((st, i) => {
      // The outer box moves, fades and blurs; the inner one only turns, so
      // backface-visibility keeps working (a filter or an opacity below 1 on a
      // preserve-3d element flattens it and shows the mirrored back).
      const outer = el("div", "abs", root);
      css(outer, { width: `${CW}px`, height: `${CH}px`, left: `${-CW / 2}px`, top: `${-CH / 2}px` });
      const card = el("div", "abs", outer);
      css(card, { width: `${CW}px`, height: `${CH}px`, left: "0px", top: "0px", transformStyle: "preserve-3d" });
      const back = el("div", "abs", card);
      css(back, {
        width: `${CW}px`,
        height: `${CH}px`,
        borderRadius: `${CW * 0.06}px`,
        background: "url(/repo/app/apps/web/public/experience/home/card-holo-240.webp) center / cover",
        boxShadow: "0 24px 50px -20px rgba(0,0,0,.6), inset 0 0 0 2px rgba(255,255,255,.25)",
        backfaceVisibility: "hidden",
        display: "grid",
        placeItems: "center",
      });
      back.innerHTML = `<div style="background:rgba(20,8,24,.82);border-radius:${CW * 0.05}px;padding:${CW * 0.05}px ${CW * 0.08}px;text-align:center;color:#f6d272;font:700 ${CW * 0.2}px/1 Fraunces;letter-spacing:-.06em">1%<div style="font:700 ${CW * 0.045}px/1.2 'DM Sans';letter-spacing:.12em;margin-top:${CW * 0.03}px">RIP. REVEAL. OWN.</div></div>`;
      const face = el("div", "abs", card);
      css(face, { width: `${CW}px`, height: `${CH}px`, borderRadius: `${CW * 0.06}px`, overflow: "hidden", transform: "rotateY(180deg)", backfaceVisibility: "hidden", boxShadow: "0 24px 50px -20px rgba(0,0,0,.6)" });
      const k = CW / st.width;
      const img = el("img", "abs", face);
      setSrc(img, `${ctx.CAP}/${ctx.PROFILE}/dustcards/cards/${String(i).padStart(2, "0")}.png`);
      css(img, { width: `${(st.width + 2 * st.pad) * k}px`, height: `${(st.height + 2 * st.pad) * k}px`, left: `${-st.pad * k}px`, top: `${-st.pad * k}px` });
      return { outer, card, text: st.text.toUpperCase() };
    });
    // The ROI card: the film's cheapest bag (the first of the fixture).
    const roiBag = bags[0] ?? { symbol: "HAHA", valueSol: "0.000301638" };
    const roiIndex = Math.max(0, cards.findIndex((c) => c.text.startsWith(`$${roiBag.symbol.toUpperCase()}SOL`)));
    const value = Number(roiBag.valueSol);
    const PAY_MIN = 0.002, PAY_MAX = 0.02; // 2% of 0.10 and of 1.00 SOL
    const times = Math.floor(PAY_MAX / value);
    const valueText = `≈${Number(value.toPrecision(1)).toString()} SOL`;

    // ROI layer: the value now, then what the card pays when pulled.
    const roi = el("div", "abs", root);
    css(roi, { left: `${V ? 90 : 560}px`, top: `${V ? 1250 : 300}px`, width: `${V ? 900 : 660}px` });
    const nowChip = el("div", "abs", roi);
    nowChip.innerHTML = `<span style="font-weight:700">${valueText}</span><span style="opacity:.75"> if sold now</span>`;
    css(nowChip, { padding: "0.32em 0.8em 0.38em", borderRadius: "999px", background: "#fff1e7", color: "var(--ink)", font: `500 ${V ? 46 : 34}px/1 "DM Sans"`, whiteSpace: "nowrap", boxShadow: "0 18px 36px -16px rgba(0,0,0,.55)" });
    const payChip = el("div", "abs", roi);
    payChip.innerHTML = `<span>pays up to </span><b style="font-weight:700">${PAY_MAX} SOL</b><span> when pulled</span>`;
    css(payChip, { padding: "0.32em 0.8em 0.38em", borderRadius: "14px 14px 34px 14px", background: "linear-gradient(180deg, #f6d272, #d9a441)", color: "var(--ink)", font: `500 ${V ? 46 : 34}px/1 "DM Sans"`, whiteSpace: "nowrap", boxShadow: "0 22px 44px -16px rgba(0,0,0,.6)" });
    const badge = el("div", "abs", roi);
    badge.innerHTML = `<div style="font:500 ${V ? 40 : 30}px/1 'DM Sans';color:rgba(255,241,231,.9);margin-bottom:${V ? 10 : 6}px">up to</div><div style="font:700 ${V ? 210 : 150}px/0.86 Fraunces;letter-spacing:-0.05em;color:var(--gold-hi);text-shadow:0 6px 0 rgba(58,34,8,.6), 0 18px 40px rgba(0,0,0,.45)">${times}×</div>`;
    css(badge, { top: `${V ? 150 : 96}px` });
    const fine = el("div", "abs", roi);
    fine.textContent = `2% of the pack price: ${PAY_MIN} to ${PAY_MAX} SOL`;
    css(fine, { top: `${V ? 470 : 300}px`, font: `500 ${V ? 34 : 24}px/1.25 "DM Sans"`, color: "rgba(255,241,231,.86)", whiteSpace: V ? "normal" : "nowrap", width: V ? "880px" : "auto" });

    list.push({
      root,
      from,
      to,
      blur: (t) => ((t > 3.42 && t < 3.66) || (t > 5.98 && t < 6.3) || t > 7.5 ? 4 : 1),
      render(t) {
        const wipe = seg(t, 3.42, 3.62, E.expoOut);
        const edge = (1 - wipe) * (W + 260);
        root.style.clipPath = wipe >= 1 ? "" : `polygon(${edge}px 0, ${W + 300}px 0, ${W + 300}px ${H}px, ${edge - 260}px ${H}px)`;
        // Hand-off to the Rip on the beat: from 7.5 the whole frame drifts left
        // while the Rip wipes in from the right, complete on 8.0.
        const hand = seg(t, 7.5, 8.0, E.cubicIn);
        root.style.transform = hand > 0 ? `translate3d(${-hand * 220}px, 0, 0)` : "";
        playHeadline(title, t, { tin: 3.56, stagger: 0.07 });
        const s1 = seg(t, 3.85, 4.2, E.snap);
        const so = 0;
        sub.style.opacity = String(s1 * (1 - so));
        sub.style.transform = `translateY(${(1 - s1) * 18 - so * 30}px)`;
        // Machine: slides in, bumps as each bag lands, glows as the cards come out,
        // then steps aside for the ROI.
        const min = spring(t, 3.5, { freq: 1.8, damping: 0.7 });
        let bump = 0;
        for (const l of LAND) bump += Math.exp(-Math.max(0, t - l) * 14) * (t >= l ? 1 : 0);
        const mOut = seg(t, 5.9, 6.25, E.expoIn);
        machine.style.transform = `translate3d(${(1 - clamp(min)) * 260 + mOut * 420}px, 0, 0) scale(${1 + 0.035 * bump}, ${1 - 0.03 * bump})`;
        machine.style.opacity = String(clamp(min * 2) * (1 - mOut));
        const gl = seg(t, 4.85, 5.05) * (1 - seg(t, 5.3, 5.9));
        show(glow, gl > 0);
        glow.style.opacity = String(gl);
        // Bags: pop in, then each drops into the slot on its beat.
        pills.forEach((pill, i) => {
          const t0 = 3.6 + i * 0.06;
          const pin = spring(t, t0, { freq: 2.4, damping: 0.62 });
          const land = LAND[i], go = land - 0.42;
          const u = seg(t, go, land, E.cubicIn);
          const x0 = PX, y0 = PY0 + i * (PH + 14);
          const x = lerp(x0, SLOT.x - PW / 2, E.cubicInOut(u));
          const y = lerp(y0, SLOT.y - PH / 2, E.cubicIn(u)) - Math.sin(Math.PI * u) * (V ? 160 : 120);
          const sc = (0.6 + 0.4 * clamp(pin)) * (1 - 0.86 * E.cubicIn(u));
          show(pill, t >= t0 && t < land);
          pill.style.transform = `translate3d(${x - (1 - clamp(pin)) * 60}px, ${y}px, 0) rotate(${-14 * E.cubicIn(u)}deg) scale(${sc})`;
          pill.style.opacity = String(clamp(pin * 1.5) * (1 - seg(t, land - 0.08, land)));
        });
        // Dust Cards: out of the tray, into a fan, face up; then the ROI card
        // comes forward and the others leave.
        const focus = seg(t, 6.0, 6.42, E.snap);
        const leave = seg(t, 5.98, 6.3, E.expoIn);
        cards.forEach(({ outer, card }, i) => {
          const t0 = 5.0 + i * 0.07;
          const u = seg(t, t0, t0 + 0.42, E.snap);
          const fanX = V ? W / 2 + (i - 1.5) * 220 : 470 + (i - 1.5) * 136;
          const fanY = V ? 1250 : 466;
          let x = lerp(TRAY.x, fanX, u);
          let y = lerp(TRAY.y, fanY, u) - Math.sin(Math.PI * u) * (V ? 200 : 120) + Math.abs(i - 1.5) * (V ? 26 : 16) * u;
          let rot = (i - 1.5) * 7 * u, sc = 0.2 + 0.8 * u;
          const flip = seg(t, 5.2 + i * 0.08, 5.52 + i * 0.08, E.cubicInOut);
          let alpha = 1;
          if (i === roiIndex) {
            x = lerp(x, V ? W / 2 : 330, focus);
            y = lerp(y, V ? 980 : 470, focus);
            rot = lerp(rot, -4, focus);
            sc = lerp(sc, V ? 1.7 : 2.05, focus);
          } else {
            y += leave * (V ? 900 : 520);
            alpha = 1 - seg(t, 6.1, 6.3);
          }
          show(outer, t >= t0 && alpha > 0.001);
          outer.style.opacity = String(alpha);
          outer.style.zIndex = i === roiIndex ? "3" : "1";
          outer.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg) scale(${sc})`;
          card.style.transform = `perspective(${CW * 8}px) rotateY(${180 * flip}deg)`;
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
        payChip.style.transformOrigin = "0% 50%";
        const b = spring(t, 7.0, { freq: 2.0, damping: 0.5 });
        show(badge, t >= 7.0);
        badge.style.opacity = String(clamp(b * 2));
        badge.style.transformOrigin = "10% 80%";
        badge.style.transform = `scale(${0.4 + 0.6 * b}) rotate(${(1 - clamp(b)) * -6}deg)`;
        const f = seg(t, 7.2, 7.45, E.snap);
        fine.style.opacity = String(f);
        fine.style.transform = `translateY(${(1 - f) * 14}px)`;

      },
    });
  }

  // A cursor that glides to a capture's pointer position and presses it.
  function cursorLayer(parent) {
    const cursor = el("div", "abs", parent);
    cursor.innerHTML =
      '<svg width="34" height="40" viewBox="0 0 34 40"><path d="M3 2 L3 31 L10.5 24.5 L15.5 36 L21 33.6 L16 22.4 L26 22 Z" fill="#26062e" stroke="#fff1e7" stroke-width="2.4" stroke-linejoin="round"/></svg>';
    const ripple = el("div", "abs", parent);
    css(ripple, { width: "70px", height: "70px", borderRadius: "50%", border: "3px solid var(--lilac)" });
    return (t, x, y, pressAt, { arriveFrom = 0.32, dx = 120, dy = 90, leaveIn = 0.3 } = {}) => {
      const arrive = seg(t, pressAt - arriveFrom, pressAt - 0.1, E.snap);
      const down = seg(t, pressAt - 0.1, pressAt - 0.05) * (1 - seg(t, pressAt, pressAt + 0.05));
      const leave = seg(t, pressAt + 0.08, pressAt + 0.08 + leaveIn, E.cubicIn);
      const on = t > pressAt - arriveFrom && t < pressAt + 0.08 + leaveIn;
      show(cursor, on);
      if (on)
        css(cursor, {
          transform: `translate3d(${x - 4 + (1 - arrive) * dx + leave * 50}px, ${y - 2 + (1 - arrive) * dy + leave * 110}px, 0) scale(${1 - 0.12 * down})`,
          opacity: String(arrive * (1 - leave)),
        });
      const rp = seg(t, pressAt - 0.05, pressAt + 0.38, E.cubicOut);
      show(ripple, rp > 0 && rp < 1);
      css(ripple, { transform: `translate3d(${x - 35}px, ${y - 35}px, 0) scale(${0.3 + 1.1 * rp})`, opacity: String(0.9 * (1 - rp)) });
    };
  }
  /** Where a capture point lands on the film frame for a camera (full-frame view). */
  const project = (cam, px, py) => ({ x: W / 2 + (px - cam.cx) * cam.zoom, y: H / 2 + (py - cam.cy) * cam.zoom });

  // ── 3 · Rip: "Rip a pack." (8 → 16 s; written at 6 → 14, shifted) ────────
  const firstShifted = list.length;
  {
    const from = 5.55, to = 14.0;
    const CLIP = V ? "mobile/rip-tap" : "desktop-tall/rip-tap";
    const meta = ctx.clips[CLIP] ?? { frames: 1, viewport: { width: 1440, height: 900 }, events: [] };
    const vp = meta.viewport;
    const ev = (label, nth = 0) => ctx.event(CLIP, label, nth);
    const pointer = (meta.events ?? []).find((e) => e.label === "pointer") ?? { x: vp.width / 2, y: vp.height - 120 };
    const R = ev("released") ?? 52;
    const tear = ev("beat:tear") ?? 165;
    const flip = [0, 1, 2, 3].map((i) => ev("cue:card.flip", i) ?? tear + 69 + 29 * i);
    const burst = ev("cue:hit.burst") ?? flip[3] + 103;
    const SNAP = 2;
    const srcAt = remap([
      [5.92, R - 24],
      [6.3, R],
      [7.55, R + 98],
      [7.551, tear - 26],
      [8.0, tear],
      [9.0, flip[0] + SNAP],
      [10.5, flip[3] + SNAP],
      [12.0, burst],
      [14.0, burst + 120],
    ]);
    const root = el("div", "scene", world);
    css(root, { background: "#f6e6ec" });
    const head = 0; // the clip hides the app header
    const baseZoom = V ? W / vp.width : W / vp.width;
    const base = { cx: vp.width / 2, cy: V ? vp.height / 2 : head + (vp.height - head) / 2, zoom: baseZoom };
    const camBox = el("div", "abs", root);
    css(camBox, { transformOrigin: "0 0" });
    const frame = el("img", "abs", camBox);
    // In the opening close-up, cover the dock's small print (reveal-mode
    // toggles, "Every draw can be verified", the balance) with its own cream.
    // The result's value pill counts up (≈0.1 -> ≈0.4 SOL): show its final
    // state from the start, cut out of a later frame of the same clip.
    const PILL = { x: 625, y: 153, w: 189, h: 37, from: 466, to: 512, src: 520 };
    const pillFix = el("div", "abs", camBox);
    css(pillFix, { left: `${PILL.x}px`, top: `${PILL.y}px`, width: `${PILL.w}px`, height: `${PILL.h}px`, overflow: "hidden", borderRadius: "9px 9px 19px 9px" });
    const pillImg = el("img", "abs", pillFix);
    css(pillImg, { width: `${vp.width}px`, height: `${vp.height}px`, left: `${-PILL.x}px`, top: `${-PILL.y}px` });
    const fine = el("div", "abs", camBox);
    css(fine, { left: "936px", top: "780px", width: "253px", height: "90px", background: "#fdefe6", borderRadius: "10px", boxShadow: "0 0 5px 4px #fdefe6" });
    const camAt = (t) => {
      const z = keys([
        [5.92, 1.0],
        [6.9, 1.04, E.sineInOut],
        [7.5, 1.07, E.cubicInOut],
        [7.98, 1.16, E.cubicIn],
        [8.12, 1.0, E.expoOut],
        [10.5, 1.03, E.sineInOut],
        [11.96, 1.24, E.cubicInOut],
        [12.05, 1.32, E.expoOut],
        [12.6, 1.1, E.cubicOut],
        [14.0, 1.0, E.sineInOut],
      ])(t);
      const cy = keys([
        [5.92, base.cy + 10],
        [7.5, base.cy - 14],
        [7.98, base.cy - 40, E.cubicIn],
        [8.12, base.cy, E.expoOut],
        [10.5, base.cy],
        [11.96, base.cy - 4],
        [14.0, base.cy, E.sineInOut],
      ])(t);
      // A short shake on the tear and on the hit.
      const shake = (t0, amp) => {
        const k = seg(t, t0, t0 + 0.32);
        return k > 0 && k < 1 ? amp * (1 - k) * Math.sin(k * 60) : 0;
      };
      // Opening close-up on the real "Rip 1 · 0.10 SOL" button and the
      // editions' prices, then a whip back to the machine on the click.
      const close = V ? 0 : 1 - seg(t, 6.4, 6.8, E.whip);
      const zoom = baseZoom * lerp(z, 2.25, close);
      const ccx = 905, ccy = 770;
      // Keep the view inside the capture (no empty edges).
      const hx = W / 2 / zoom, hy = H / 2 / zoom;
      const cx = clamp(lerp(base.cx, ccx, close) + shake(8.0, 5) + shake(12.0, 7), hx, vp.width - hx);
      const cyc = clamp(lerp(cy, ccy, close) + shake(8.0, 4) * 0.6 + shake(12.0, 5) * 0.7, (V ? 0 : head) + hy, vp.height - hy);
      return { cx, cy: cyc, zoom };
    };
    // Top right on an ink panel, deliberately in front of the machine.
    const tpanel = el("div", "abs", root);
    css(tpanel, V ? { left: "60px", top: "200px", width: "960px", height: "330px" } : { left: `${W - 48 - 470}px`, top: "34px", width: "470px", height: "124px" });
    css(tpanel, { background: "rgba(38, 6, 46, 0.93)", borderRadius: V ? "26px 26px 70px 26px" : "18px 18px 48px 18px", boxShadow: "0 30px 70px -24px rgba(10, 2, 20, 0.6)", transformOrigin: "100% 0%" });
    const title = headline(tpanel, V ? [["Rip"], ["a", "pack."]] : [["Rip", "a", "pack."]]);
    css(title.root, V ? { fontSize: "150px", left: "50px", top: "40px", color: "var(--cream)" } : { fontSize: "84px", left: "34px", top: "16px", color: "var(--cream)" });
    const pill = el("div", "chip ink", root);
    pill.textContent = "4 Dust Cards + 1 hit";
    css(pill, { fontSize: `${V ? 42 : 30}px`, left: `${V ? 76 : 72}px`, top: `${V ? 1640 : 606}px` });
    const press = cursorLayer(root);
    const flash = el("div", "layer", root);
    css(flash, { background: "radial-gradient(60% 60% at 50% 50%, rgba(255,250,240,.9), rgba(255,250,240,0) 70%)", mixBlendMode: "screen" });

    list.push({
      root,
      from,
      to,
      blur: (t) => ((t > 6.4 && t < 6.82) || (t > 5.55 && t < 6.0) ? 5 : 1),
      render(t) {
        // Wipe in from the right over the last beat of the Feed (on the grid).
        const wipe = seg(t, 5.55, 6.0, E.cubicInOut);
        const edge = (1 - wipe) * (W + 260);
        root.style.clipPath = wipe >= 1 ? "" : `polygon(${edge}px 0, ${W + 300}px 0, ${W + 300}px ${H}px, ${edge - 260}px ${H}px)`;
        const n = clamp(Math.round(srcAt(t)), 0, meta.frames - 1);
        const cam = camAt(t);
        setSrc(frame, ctx.frameUrl(CLIP, n));
        css(frame, { width: `${vp.width}px`, height: `${vp.height}px` });
        camBox.style.transform = `translate3d(${W / 2 - cam.cx * cam.zoom}px, ${H / 2 - cam.cy * cam.zoom}px, 0) scale(${cam.zoom})`;
        show(fine, !V && n <= R + 1);
        const pillOn = !V && n >= PILL.from && n <= PILL.to;
        show(pillFix, pillOn);
        if (pillOn) {
          setSrc(pillImg, ctx.frameUrl(CLIP, PILL.src));
          pillFix.style.opacity = String(clamp((n - 470) / 5));
          // Follow the real pill's spring into place (measured, capture CSS px).
          const dy = keys([[466, -14], [470, -14], [472, -8], [474, -5], [476, -3], [478, -1], [480, 1], [482, 2], [490, 2.5], [500, 1], [512, 0]].map(([f, v]) => [f, v, E.linear]))(n);
          pillFix.style.transform = `translateY(${dy}px)`;
        }
        const tp = seg(t, 6.0, 6.2, E.snap), tq = seg(t, 7.36, 7.56, E.expoIn);
        tpanel.style.transform = `translate3d(${(1 - tp) * 60 + tq * 80}px, 0, 0) scale(${0.94 + 0.06 * tp})`;
        tpanel.style.opacity = String(clamp(tp * 1.6) * (1 - tq));
        playHeadline(title, t, { tin: 6.04, stagger: 0.08 });
        const p = project(cam, pointer.x, pointer.y);
        press(t, p.x, p.y, 6.3, { leaveIn: 0.16 });
        const pi = seg(t, 8.95, 9.25, E.snap) * (1 - seg(t, 10.45, 10.7, E.cubicIn));
        pill.style.opacity = String(pi);
        pill.style.transform = `translateY(${(1 - pi) * 16}px)`;
        const fl = Math.max(seg(t, 7.99, 8.03) * (1 - seg(t, 8.03, 8.3)), seg(t, 11.99, 12.03) * (1 - seg(t, 12.03, 12.4)));
        show(flash, fl > 0);
        flash.style.opacity = String(0.55 * fl);
      },
    });
  }

  // ── 4 · "Sell it instantly. Or keep it in My cards." (14 → 18 s) ─────────
  // The hit, large, with the two choices the app offers after a pull: Sell (the
  // machine buys it now, 87% of its 0.40 SOL value: +0.348 SOL) and My cards.
  // On 16.0 the card goes into the Sell chip and SOL bursts out of it.
  {
    const from = 13.99, to = 18.0;
    const root = el("div", "scene", world);
    css(root, { background: "radial-gradient(110% 120% at 70% 40%, #ecc9fb 0%, #d5a2f1 46%, #b77fd8 100%)" });
    const light = el("div", "layer", root);
    css(light, { background: "radial-gradient(38% 52% at 72% 50%, rgba(255,250,240,.55), rgba(255,250,240,0) 70%)" });
    const line1 = headline(root, [["Sell", "it", "instantly."]]);
    const line2 = headline(root, V ? [["Or", "keep", "it", "in"], ["My", "cards."]] : [["Or", "keep", "it", "in", "My", "cards."]]);
    css(line1.root, { fontSize: `${V ? 116 : 70}px`, left: "72px", top: `${V ? 220 : 96}px`, color: "var(--ink)" });
    css(line2.root, { fontSize: `${V ? 116 : 70}px`, left: "72px", top: `${V ? 350 : 176}px`, color: "var(--ink)" });

    // The hit card (My cards' own render), floating with a foil sheen.
    const st = (ctx.stills.hit ?? [{ width: 211.19, height: 295.66, pad: 40 }])[0];
    const CH = V ? 760 : 448, CW = CH * (st.width / st.height);
    const CX = V ? W / 2 : 1034, CY = V ? 1110 : 380;
    const cardWrap = el("div", "abs", root);
    css(cardWrap, { left: `${CX - CW / 2}px`, top: `${CY - CH / 2}px`, width: `${CW}px`, height: `${CH}px` });
    const card = el("div", "abs", cardWrap);
    css(card, { width: `${CW}px`, height: `${CH}px`, borderRadius: `${CW * 0.045}px`, overflow: "hidden", boxShadow: "0 50px 90px -30px rgba(38,6,46,.65), 0 16px 34px -14px rgba(38,6,46,.5)" });
    const k = CW / st.width;
    const cardImg = el("img", "abs", card);
    setSrc(cardImg, `${ctx.CAP}/${ctx.PROFILE}/hitcard/card/00.png`);
    css(cardImg, { width: `${(st.width + 2 * st.pad) * k}px`, height: `${(st.height + 2 * st.pad) * k}px`, left: `${-st.pad * k}px`, top: `${-st.pad * k}px` });
    const sheen = el("div", "abs", card);
    css(sheen, { width: `${CW * 0.7}px`, height: `${CH * 1.6}px`, top: `${-CH * 0.3}px`, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.42) 50%, rgba(255,255,255,0))", mixBlendMode: "overlay" });

    // The two actions.
    const chipFont = V ? 50 : 36;
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
        transformOrigin: "0% 50%",
        ...styles,
      });
      return { outer, chip };
    };
    const sell = mkChip(
      `<b style="font-weight:700">Sell</b><span style="opacity:.55">·</span><span style="font-variant-numeric:tabular-nums">+0.348 SOL</span><span style="font-size:.8em;opacity:.85">instant</span>`,
      { background: "linear-gradient(180deg, #f6d272, #d9a441)", color: "var(--ink)" },
    );
    const ic = chipFont * 0.95;
    const redeem = mkChip(
      `<svg width="${ic}" height="${ic}" viewBox="0 0 24 24" fill="none" stroke="#d5a2f1" stroke-width="1.8" stroke-linejoin="round"><rect x="7.5" y="3.5" width="12" height="16" rx="2.2" transform="rotate(8 13.5 11.5)"/><rect x="4" y="5" width="12" height="16" rx="2.2" fill="#26062e"/></svg><b style="font-weight:700">My cards</b>`,
      { background: "var(--ink)", color: "var(--cream)" },
    );
    const SX = 76, SY = V ? 580 : 300, RY = V ? 720 : 400;
    css(sell.outer, { left: `${SX}px`, top: `${SY}px` });
    css(redeem.outer, { left: `${SX}px`, top: `${RY}px` });

    // The SOL received, big, where the card was.
    const paid = el("div", "abs", root);
    const paidInner = el("div", "", paid);
    css(paidInner, {
      display: "inline-flex",
      alignItems: "baseline",
      gap: "0.25em",
      padding: `${V ? 30 : 20}px ${V ? 54 : 38}px`,
      borderRadius: V ? "26px 26px 70px 26px" : "18px 18px 48px 18px",
      background: "linear-gradient(180deg, #f6d272, #d9a441)",
      color: "var(--ink)",
      font: `700 ${V ? 132 : 84}px/1 "Fraunces"`,
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
    const coins = Array.from({ length: 34 }, () => ({
      // Up and to the right, toward the amount (clear of the headlines).
      a: (V ? -Math.PI / 2 : -0.42) + (rand() - 0.5) * (V ? 1.6 : 0.9),
      v: (V ? 900 : 620) * (0.55 + rand() * 0.6),
      r: (V ? 24 : 16) * (0.7 + rand() * 0.6),
      spin: (rand() - 0.5) * 16,
      d: rand() * 0.08,
    }));
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

    list.push({
      root,
      from,
      to,
      blur: (t) => (t < 14.28 || (t > 15.78 && t < 16.06) ? 4 : 1),
      render(t) {
        // Card: flies in on the cut, floats, then goes into the Sell chip.
        const cin = seg(t, 13.99, 14.36, E.snap);
        const into = seg(t, 15.76, 16.0, E.cubicIn);
        const float = Math.sin((t - 14) * 2.4) * 6;
        const sellR = sell.chip.getBoundingClientRect();
        const tx = sellR.left + sellR.width * 0.3 - CX, ty = sellR.top + sellR.height / 2 - CY;
        show(cardWrap, t < 16.0);
        cardWrap.style.transform = `translate3d(${(1 - cin) * 520 + into * tx}px, ${float * (1 - into) + into * ty}px, 0) rotate(${(1 - cin) * 9 - into * 12}deg) scale(${(0.82 + 0.18 * cin) * (1 - 0.86 * into)})`;
        cardWrap.style.opacity = String(1 - seg(t, 15.9, 16.0));
        card.style.transform = `perspective(1200px) rotateY(${Math.sin((t - 14) * 1.7) * 7}deg) rotateX(${Math.cos((t - 14) * 1.3) * 3}deg)`;
        const sw = seg(t, 14.25, 15.1, E.cubicInOut);
        sheen.style.transform = `translate3d(${-CW * 0.8 + sw * CW * 1.9}px, 0, 0) rotate(16deg)`;
        playHeadline(line1, t, { tin: 14.0, stagger: 0.07, d: 0.5 });
        playHeadline(line2, t, { tin: 15.0, stagger: 0.07, d: 0.5 });
        // Sell chip: pops in, is pressed on 16.0, then reads "Sold".
        const sp = spring(t, 14.18, { freq: 2.3, damping: 0.55 });
        const press = seg(t, 15.88, 15.96) * (1 - seg(t, 16.0, 16.12));
        const pulse = Math.exp(-Math.max(0, t - 16.0) * 6) * (t >= 16.0 ? 1 : 0);
        show(sell.outer, t >= 14.18);
        sell.chip.style.transform = `scale(${(0.6 + 0.4 * sp) * (1 - 0.06 * press + 0.08 * pulse)})`;
        sell.chip.style.opacity = String(clamp(sp * 2));
        sell.chip.style.boxShadow = `0 22px 40px -18px rgba(38,6,46,.6), 0 0 ${40 * pulse}px ${12 * pulse}px rgba(246,210,114,${0.8 * pulse})`;
        const rp = spring(t, 15.12, { freq: 2.3, damping: 0.55 });
        show(redeem.outer, t >= 15.12);
        redeem.chip.style.transform = `scale(${0.6 + 0.4 * rp})`;
        redeem.chip.style.opacity = String(clamp(rp * 2));
        // +0.348 SOL lands where the card was, counting up.
        const pp = spring(t, 16.08, { freq: 2.2, damping: 0.6 });
        show(paid, t >= 16.08);
        const count = seg(t, 16.08, 16.62, E.cubicOut) * 0.348;
        paidNum.textContent = `+${count.toFixed(3)}`;
        const pw = paid.offsetWidth, ph = paid.offsetHeight;
        const px0 = Math.min(V ? (W - pw) / 2 : 1000 - pw / 2, W - 56 - pw);
        paid.style.transformOrigin = "50% 50%";
        paid.style.transform = `translate3d(${px0}px, ${CY - ph / 2 + (1 - clamp(pp)) * 60}px, 0) scale(${0.7 + 0.3 * pp})`;
        paid.style.opacity = String(clamp(pp * 2));
        // Coins burst out of the chip on 16.0.
        fx.clear();
        const ox = sellR.left + sellR.width * 0.9, oy = sellR.top + sellR.height * 0.5;
        for (const c of coins) {
          const age = t - 16.0 - c.d;
          if (age < 0 || age > 1.6) continue;
          const x = ox + Math.cos(c.a) * c.v * age;
          const y = oy + Math.sin(c.a) * c.v * age + 0.5 * (V ? 2600 : 1500) * age * age;
          coin(fx.g, x, y, c.r, c.spin * age, 1 - seg(age, 1.1, 1.6));
        }
      },
    });
  }

  shift(firstShifted, 2);
  list[list.length - 1].to = 19.72; // the Sell beat dissolves into The 1% from 19.5

  // ── 5 · "Go for the 1%." (19.5 → 21.94 s) ──────────────────────────────
  // One slow reveal: the 1% card alone, big and centred, on a calm stage with
  // a soft glow and a light foil sheen. No side cards, no pills.
  {
    const from = 19.5, to = 21.94;
    const root = el("div", "scene", world);
    css(root, { background: "radial-gradient(70% 85% at 50% 55%, #4a1f5c 0%, #2c1235 45%, #160818 100%)" });
    const rays = el("div", "abs", root);
    const R = Math.max(W, H) * 1.6;
    css(rays, {
      width: `${R}px`,
      height: `${R}px`,
      left: `${W / 2 - R / 2}px`,
      top: `${(V ? H * 0.5 : H * 0.55) - R / 2}px`,
      background: "repeating-conic-gradient(from 0deg, rgba(246,210,114,.07) 0deg 6deg, rgba(246,210,114,0) 6deg 18deg)",
      WebkitMaskImage: "radial-gradient(closest-side, #000 0%, rgba(0,0,0,.6) 35%, transparent 70%)",
      maskImage: "radial-gradient(closest-side, #000 0%, rgba(0,0,0,.6) 35%, transparent 70%)",
    });
    const glow = el("div", "abs", root);
    const G = V ? 1100 : 760;
    css(glow, { width: `${G}px`, height: `${G}px`, left: `${W / 2 - G / 2}px`, top: `${(V ? H * 0.5 : H * 0.55) - G / 2}px`, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,214,140,.45), rgba(213,162,241,.22) 45%, rgba(213,162,241,0) 72%)" });

    // The card, as My cards draws it; its demo value chip is covered.
    const st = (ctx.stills.onepct ?? [{ width: 211.19, height: 295.66, pad: 40 }])[0];
    const SCALE = 2; // device px per CSS px in the still
    const CH = V ? 900 : 490;
    const k = CH / st.height; // film px per CSS px
    const CW = st.width * k;
    const CX = W / 2, CY = V ? H * 0.5 : 392;
    const cardWrap = el("div", "abs", root);
    css(cardWrap, { left: `${CX - CW / 2}px`, top: `${CY - CH / 2}px`, width: `${CW}px`, height: `${CH}px` });
    const card = el("div", "abs", cardWrap);
    css(card, { width: `${CW}px`, height: `${CH}px`, borderRadius: `${CW * 0.045}px`, overflow: "hidden", boxShadow: "0 50px 110px -30px rgba(0,0,0,.75), 0 0 80px 10px rgba(246,210,114,.18)" });
    const img = el("img", "abs", card);
    setSrc(img, `${ctx.CAP}/${ctx.PROFILE}/onepctcard/card/00.png`);
    css(img, { width: `${(st.width + 2 * st.pad) * k}px`, height: `${(st.height + 2 * st.pad) * k}px`, left: `${-st.pad * k}px`, top: `${-st.pad * k}px` });
    // Cover "≈0.00 SOL est." (still px 118-350 x 562-632, i.e. CSS /2, minus the pad).
    const cover = el("div", "abs", card);
    css(cover, { left: `${(118 / SCALE - st.pad) * k}px`, top: `${(560 / SCALE - st.pad) * k}px`, width: `${(236 / SCALE) * k}px`, height: `${(74 / SCALE) * k}px`, background: "#fdf8ee", borderRadius: `${6 * k}px` });
    const sheen = el("div", "abs", card);
    css(sheen, { width: `${CW * 0.6}px`, height: `${CH * 1.8}px`, top: `${-CH * 0.4}px`, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.5) 50%, rgba(255,255,255,0))", mixBlendMode: "overlay" });

    const title = headline(root, [["Go", "for", "the", { t: "1%.", cls: "pct" }]]);
    title.words[3].inner.style.color = "var(--gold-hi)";
    css(title.root, { fontSize: `${V ? 140 : 80}px`, left: "0px", width: `${W}px`, textAlign: "center", top: `${V ? 210 : 34}px`, color: "var(--cream)" });
    const sub = el("div", "sub", root);
    sub.innerHTML = `<b style="font-weight:700;color:var(--gold-hi)">10,000,000 $1PCT</b> · 1% of the supply`;
    css(sub, { left: "0px", width: `${W}px`, textAlign: "center", top: `${V ? 1560 : 650}px`, fontSize: `${V ? 46 : 30}px`, color: "rgba(255,241,231,.92)" });

    const fx = particles(root, W, H);
    const rand = rng(1);
    const sparks = Array.from({ length: 9 }, (_, i) => ({
      a: (i / 9) * Math.PI * 2 + rand() * 0.4,
      d: (V ? 520 : 290) * (0.8 + rand() * 0.35),
      r: (V ? 16 : 10) * (0.7 + rand() * 0.7),
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
        cardWrap.style.transform = `translate3d(0, ${(1 - rise) * 70}px, 0) scale(${(0.84 + 0.16 * rise) * (1 + 0.045 * push)})`;
        cardWrap.style.opacity = String(clamp(rise * 1.4));
        card.style.transform = `perspective(1400px) rotateY(${(1 - rise) * -14 + Math.sin((t - 20) * 1.3) * 3}deg) rotateX(${Math.cos((t - 20) * 1.1) * 2}deg)`;
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
          const x = CX + Math.cos(s.a) * s.d * (CW / CH) * 1.35;
          const y = CY + Math.sin(s.a) * s.d * 0.95;
          sparkle(fx.g, x, y, s.r * (0.6 + 0.6 * tw), on * (0.35 + 0.65 * tw));
        }
      },
    });
  }

  const endCard = list.length;
  // ── 6 · End card: "Dust in, Packs out." + onepercent.fun (20 → 22 s) ──────
  {
    const from = 19.99, to = 22.01;
    const root = el("div", "scene", world);
    css(root, { background: "#2c1235" });
    const bgWrap = el("div", "layer", root);
    const bg = el("img", "abs", bgWrap);
    setSrc(bg, "/repo/app/apps/web/public/experience/home/studio-1672.webp");
    const bgW = V ? (1920 / 941) * 1672 : 1280 * 1.06, bgH = V ? 1920 : (1280 * 1.06 * 941) / 1672;
    css(bg, { width: `${bgW}px`, height: `${bgH}px`, left: `${V ? -bgW * 0.52 : -1280 * 0.03}px`, top: `${V ? 0 : -(bgH - 720) / 2}px` });
    const shade = el("div", "layer", root);
    css(shade, {
      background: V
        ? "linear-gradient(180deg, rgba(38,6,46,.62) 0%, rgba(38,6,46,.18) 38%, rgba(38,6,46,.05) 60%, rgba(38,6,46,.45) 100%)"
        : "linear-gradient(90deg, rgba(38,6,46,.66) 0%, rgba(38,6,46,.32) 42%, rgba(38,6,46,.02) 72%), linear-gradient(180deg, rgba(38,6,46,0) 60%, rgba(38,6,46,.35) 100%)",
    });
    const mark = el("div", "abs", root);
    mark.innerHTML = '1<span style="font-size:.8em">%</span>';
    css(mark, {
      fontFamily: "Fraunces",
      fontWeight: "700",
      letterSpacing: "-0.11em",
      lineHeight: "1",
      color: "var(--cream)",
      fontSize: `${V ? 96 : 64}px`,
      left: `${V ? W / 2 - 48 : 84}px`,
      top: `${V ? 210 : 92}px`,
    });
    const title = headline(root, [["Dust", "in,"], ["Packs", "out."]]);
    css(title.root, {
      fontSize: `${V ? 168 : 128}px`,
      color: "var(--cream)",
      left: `${V ? 0 : 76}px`,
      top: `${V ? 390 : 196}px`,
      ...(V ? { width: `${W}px`, textAlign: "center" } : {}),
    });
    const oval = el("div", "abs", root);
    const ovalH = V ? 112 : 80;
    css(oval, {
      height: `${ovalH}px`,
      display: "flex",
      alignItems: "center",
      gap: `${V ? 34 : 24}px`,
      padding: `0 ${V ? 12 : 9}px 0 ${V ? 40 : 28}px`,
      background: "var(--ink)",
      color: "var(--cream)",
      borderRadius: V ? "14px 14px 40px 14px" : "11px 11px 30px 11px",
      font: `500 ${V ? 50 : 36}px "DM Sans"`,
      letterSpacing: "-0.01em",
      boxShadow: "0 22px 50px -20px rgba(0,0,0,.6)",
      left: `${V ? W / 2 : 84}px`,
      top: `${V ? 1640 : 504}px`,
    });
    oval.innerHTML =
      `<span>onepercent.fun</span><b style="display:grid;place-items:center;width:${V ? 88 : 60}px;height:${V ? 88 : 60}px;border-radius:${V ? "9px 9px 28px 9px" : "7px 7px 20px 7px"};background:var(--lilac);color:var(--ink);font-weight:700;font-size:${V ? 44 : 30}px">→</b>`;
    const packFiles = ["pack-silver.webp", "pack-first-light.webp", "pack-closed.webp", "pack-anthracite.webp"];
    const fan = el("div", "abs", root);
    const pw = V ? 440 : 300;
    css(fan, { left: `${V ? W / 2 : 1012}px`, top: `${V ? 1160 : 376}px` });
    const packs = packFiles.map((f, i) => {
      const img = el("img", "abs", fan);
      setSrc(img, `/repo/public/assets/${f}`);
      css(img, { width: `${pw}px`, height: `${pw}px`, left: `${-pw / 2}px`, top: `${-pw / 2}px`, transformOrigin: "50% 165%", filter: "drop-shadow(0 30px 34px rgba(20,4,30,.5))" });
      return img;
    });
    const sweep = el("div", "abs", root);
    css(sweep, {
      width: `${V ? 520 : 360}px`,
      height: `${V ? 2600 : 1200}px`,
      background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,250,240,.38) 45%, rgba(255,255,255,.55) 50%, rgba(255,250,240,.38) 55%, rgba(255,255,255,0))",
      mixBlendMode: "overlay",
      top: `${V ? -300 : -240}px`,
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
        oval.style.transform = `translate3d(${V ? -oval.offsetWidth / 2 : 0}px, ${(1 - o) * 40}px, 0) scale(${0.9 + 0.1 * o})`;
        oval.style.opacity = String(clamp(o * 1.5));
        packs.forEach((img, i) => {
          const k = i - 1.5;
          const sp = spring(t, 20.02 + i * 0.05, { freq: 2.0, damping: 0.55 });
          const bob = Math.sin((t - 20) * (2 * Math.PI / 4.2) + i * 0.9) * (V ? 8 : 5);
          const x = k * (V ? 62 : 40);
          const y = bob + (1 - sp) * (V ? 900 : 520);
          img.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${k * 11 * sp}deg) scale(${0.7 + 0.3 * clamp(sp)})`;
        });
        const sw = seg(t, 20.85, 21.55, E.cubicInOut);
        show(sweep, sw > 0 && sw < 1);
        sweep.style.transform = `translate3d(${V ? -600 + sw * 2300 : 560 + sw * 900}px, 0, 0) rotate(18deg)`;
      },
    });
  }

  shift(endCard, 2, 25.01);
  return list;
}
