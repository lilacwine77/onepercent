/* eslint-disable */
// Synced from experience/lab/src/rip/card-art.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Card faces painted on high-resolution canvases (1024 × 1434, 5:7), plus a material
 * mask (R = foil / metal, G = holo, B = gold gloss) at half resolution.
 * Layouts follow da-direction.md §7 (sizes are the 250 px web spec × 4.096).
 */
import {
  C,
  EDITIONS,
  TIERS,
  fmtAmount,
  fmtSol,
  quotePending,
  shortAddress,
  ticker,
} from "./brand";
import {
  ensureFonts,
  fitFont,
  goldify,
  loadImage,
  makeCanvas,
  rrect,
  setSpacing,
  type AnyCanvas,
  type Ctx2D,
  type Radii,
} from "./assets";
import type { Edition, HitTier, RipDustCard, RipHitCard } from "./types";

/** Logical layout size (all coordinates below). */
export const ART_W = 1024;
export const ART_H = 1434;
/** The hits the machine buys back (Sell): their faces show no market value (D30). */
const STOCK_TIERS: string[] = ["silver", "blue", "holo", "black"];
/** Physical resolution factor: faces are 1280 × 1792 px, ≥ 2× the hero card's on-screen size at 2× DPR. */
export const ART_RES = 1.25;

/** A face canvas at physical resolution, drawn in logical coordinates. */
function makeArtCanvas(): [AnyCanvas, Ctx2D] {
  const [c, ctx] = makeCanvas(
    Math.round(ART_W * ART_RES),
    Math.round(ART_H * ART_RES),
  );
  ctx.scale(ART_RES, ART_RES);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [c, ctx];
}

/**
 * Unsharp mask on the whole physical canvas (run on the photographic foil before anything is
 * drawn over it): upscaled foil crops keep crisp crease lines instead of looking soft.
 */
function sharpen(ctx: Ctx2D, amount = 0.6) {
  const { width: w, height: h } = ctx.canvas;
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1) * w,
      y0 = y * w,
      yp = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1),
        xp = Math.min(w - 1, x + 1);
      const i = (y0 + x) * 4;
      for (let k = 0; k < 3; k++) {
        const blur =
          (src[(ym + x) * 4 + k] +
            src[(yp + x) * 4 + k] +
            src[(y0 + xm) * 4 + k] +
            src[(y0 + xp) * 4 + k] +
            4 * src[i + k]) /
          8;
        out[i + k] = src[i + k] + (src[i + k] - blur) * amount * 2;
      }
      out[i + 3] = src[i + 3];
    }
  }
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}
const S = ART_W / 250; // DA spec pixel → canvas pixel
const MASK_SCALE = 0.5;

export interface CardArt {
  art: AnyCanvas;
  mask: AnyCanvas;
}

/**
 * One RGB mask canvas; each channel is set independently without any pixel readback:
 * multiply clears the channel inside the shape, lighter adds the new level.
 */
class MaskPainter {
  ctx: Ctx2D;
  constructor() {
    const w = Math.round(ART_W * MASK_SCALE),
      h = Math.round(ART_H * MASK_SCALE);
    const [, ctx] = makeCanvas(w, h);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.scale(MASK_SCALE, MASK_SCALE);
    this.ctx = ctx;
  }
  /** Paints into one channel (0 foil, 1 holo, 2 gloss) with a grey level 0..1. */
  paint(channel: 0 | 1 | 2, level: number, draw: (ctx: Ctx2D) => void) {
    const ctx = this.ctx;
    const keep = [255, 255, 255];
    keep[channel] = 0;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = ctx.strokeStyle = `rgb(${keep.join(",")})`;
    draw(ctx);
    ctx.restore();
    if (level <= 0) return;
    const add = [0, 0, 0];
    add[channel] = Math.round(level * 255);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = ctx.strokeStyle = `rgb(${add.join(",")})`;
    draw(ctx);
    ctx.restore();
  }
  merge(): AnyCanvas {
    return this.ctx.canvas;
  }
}

const fraunces = (px: number, w = 700) =>
  `${w} ${px}px "Fraunces", Georgia, serif`;
const dmSans = (px: number, w = 500) =>
  `${w} ${px}px "DM Sans", system-ui, sans-serif`;

function goldGradient(ctx: Ctx2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#fff3c4");
  g.addColorStop(0.32, C.goldHi);
  g.addColorStop(0.62, C.gold);
  g.addColorStop(1, C.goldLo);
  return g;
}

/** The DA gold emboss (.emboss) reproduced on canvas. */
function goldEmboss(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  px: number,
  align: CanvasTextAlign = "center",
  mask?: MaskPainter,
) {
  ctx.save();
  ctx.font = fraunces(px);
  setSpacing(ctx, -px * 0.06);
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,.42)";
  ctx.shadowBlur = px * 0.12;
  ctx.shadowOffsetY = px * 0.08;
  ctx.fillStyle = C.goldInk;
  ctx.fillText(text, x, y + px * 0.02);
  ctx.shadowColor = "transparent";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(4, px * 0.045);
  ctx.strokeStyle = C.goldInk;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = goldGradient(ctx, y - px * 0.78, y + px * 0.05);
  ctx.fillText(text, x, y);
  // Top bevel highlight.
  ctx.globalCompositeOperation = "source-atop";
  ctx.restore();
  mask?.paint(2, 1, (m) => {
    m.font = fraunces(px);
    setSpacing(m, -px * 0.06);
    m.textAlign = align;
    m.lineWidth = Math.max(4, px * 0.045);
    m.fillText(text, x, y);
    m.strokeText(text, x, y);
  });
}

/** Ink text on a gold chip (money on any surface, DA §4.2). */
function goldChip(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  h: number,
  align: "left" | "center" = "left",
  mask?: MaskPainter,
): number {
  ctx.save();
  ctx.font = dmSans(h * 0.5, 700);
  setSpacing(ctx, 0);
  const tw = ctx.measureText(text).width;
  const w = tw + h * 0.9;
  const x0 = align === "center" ? x - w / 2 : x;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, C.goldHi);
  g.addColorStop(1, C.gold);
  ctx.shadowColor = "rgba(58,34,8,.35)";
  ctx.shadowBlur = h * 0.18;
  ctx.shadowOffsetY = h * 0.06;
  rrect(ctx, x0, y, w, h, [h * 0.22, h * 0.22, h * 0.5, h * 0.22]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(58,34,8,.55)";
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, x0 + h * 0.45, y + h * 0.53);
  ctx.restore();
  mask?.paint(2, 0.85, (m) => {
    rrect(m, x0, y, w, h, [h * 0.22, h * 0.22, h * 0.5, h * 0.22]);
    m.fill();
  });
  return w;
}

/** Dark label strip with gold DM Sans 700 capitals, echoing "RIP. REVEAL. OWN.". */
function labelStrip(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  h: number,
  opts: { fill?: string; maxW?: number; align?: "left" | "center" } = {},
  mask?: MaskPainter,
): number {
  ctx.save();
  const px = h * 0.46;
  ctx.font = dmSans(px, 700);
  setSpacing(ctx, px * 0.12);
  const tw = ctx.measureText(text).width;
  const w = Math.min(opts.maxW ?? Infinity, tw + h * 0.9);
  const x0 = opts.align === "center" ? x - w / 2 : x;
  rrect(ctx, x0, y, w, h, h * 0.18);
  ctx.fillStyle = opts.fill ?? "rgba(14,10,16,.9)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(246,210,114,.35)";
  ctx.stroke();
  ctx.fillStyle = goldGradient(ctx, y + h * 0.25, y + h * 0.75);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, x0 + w / 2 + px * 0.06, y + h * 0.54);
  ctx.restore();
  mask?.paint(0, 0, (m) => {
    rrect(m, x0, y, w, h, h * 0.18);
    m.fill();
  });
  mask?.paint(1, 0, (m) => {
    rrect(m, x0, y, w, h, h * 0.18);
    m.fill();
  });
  mask?.paint(2, 0.6, (m) => {
    m.font = dmSans(px, 700);
    setSpacing(m, px * 0.12);
    m.textAlign = "center";
    m.textBaseline = "middle";
    m.fillText(text, x0 + w / 2, y + h * 0.54);
  });
  return w;
}

function paperGrain(ctx: Ctx2D, w: number, h: number, seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.save();
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * w,
      y = rnd() * h;
    ctx.fillStyle =
      rnd() > 0.5 ? "rgba(120,80,90,.05)" : "rgba(255,255,255,.35)";
    ctx.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 1.5);
  }
  // A few soft fibres.
  ctx.strokeStyle = "rgba(150,110,120,.05)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 160; i++) {
    const x = rnd() * w,
      y = rnd() * h,
      a = rnd() * Math.PI,
      l = 8 + rnd() * 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * l * 0.5 + 4,
      y + Math.sin(a) * l * 0.5,
      x + Math.cos(a) * l,
      y + Math.sin(a) * l,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** Gold-mode coin: reeded gold rim, plum face, full-colour logo (or a gold monogram). */
function drawGoldCoin(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  r: number,
  logo: CanvasImageSource | null,
  monogram: string,
  mask?: MaskPainter,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = "rgba(20,6,20,.5)";
  ctx.shadowBlur = r * 0.18;
  ctx.shadowOffsetY = r * 0.07;
  ctx.fillStyle = C.goldInk;
  ctx.beginPath();
  ctx.arc(0, r * 0.04, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  // Reeded rim
  const rim = ctx.createLinearGradient(-r, -r, r * 0.8, r);
  rim.addColorStop(0, "#fff3c4");
  rim.addColorStop(0.3, C.goldHi);
  rim.addColorStop(0.55, C.goldLo);
  rim.addColorStop(0.75, C.goldHi);
  rim.addColorStop(1, "#8a5a16");
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(58,34,8,.35)";
  ctx.lineWidth = r * 0.012;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    ctx.lineTo(Math.cos(a) * r * 0.995, Math.sin(a) * r * 0.995);
    ctx.stroke();
  }
  ctx.strokeStyle = C.goldInk;
  ctx.lineWidth = r * 0.03;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  const face = ctx.createRadialGradient(
    -r * 0.3,
    -r * 0.4,
    r * 0.1,
    0,
    0,
    r * 0.9,
  );
  face.addColorStop(0, "#4c2459");
  face.addColorStop(1, C.plum);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.clip();
  if (logo) {
    ctx.drawImage(logo, -r * 0.78, -r * 0.78, r * 1.56, r * 1.56);
  } else {
    ctx.fillStyle = goldGradient(ctx, -r * 0.4, r * 0.4);
    ctx.font = fraunces(r * 0.8);
    setSpacing(ctx, -r * 0.06);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(monogram, 0, r * 0.06);
  }
  // Glass dome highlight
  const dome = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.3);
  dome.addColorStop(0, "rgba(255,255,255,.28)");
  dome.addColorStop(0.5, "rgba(255,255,255,0)");
  ctx.fillStyle = dome;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,243,196,.9)";
  ctx.lineWidth = r * 0.02;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.95, Math.PI * 1.1, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
  mask?.paint(2, 1, (m) => {
    m.beginPath();
    m.arc(cx, cy, r, 0, Math.PI * 2);
    m.fill();
  });
  mask?.paint(2, 0, (m) => {
    m.beginPath();
    m.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
    m.fill();
  });
  mask?.paint(0, 0, (m) => {
    m.beginPath();
    m.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
    m.fill();
  });
  mask?.paint(1, 0, (m) => {
    m.beginPath();
    m.arc(cx, cy, r * 0.84, 0, Math.PI * 2);
    m.fill();
  });
}

/** Cuts text to fit `max` px with a trailing ellipsis (never overlaps its neighbour). */
function ellipsize(ctx: Ctx2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max)
    t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function monogramOf(symbol: string) {
  const s = symbol.replace(/^\$/, "");
  return (s[0] || "?").toUpperCase();
}

// ---------------------------------------------------------------------------
// Dust Card
// ---------------------------------------------------------------------------

export async function paintDustCard(
  card: RipDustCard | null,
  edition: Edition,
): Promise<CardArt> {
  await ensureFonts();
  const ed = EDITIONS[edition];
  const house = !card || !!card.house;
  if (house) card = null;
  const logo = card ? await loadImage(card.logoUrl) : null;
  const [art, ctx] = makeArtCanvas();
  const mask = new MaskPainter();
  const W = ART_W,
    H = ART_H;
  const frame = 4 * S;

  // Paper stock
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  const warm = ctx.createRadialGradient(
    W * 0.35,
    H * 0.3,
    50,
    W * 0.5,
    H * 0.5,
    H * 0.8,
  );
  warm.addColorStop(0, "rgba(255,255,255,.55)");
  warm.addColorStop(1, "rgba(241,223,213,.55)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, W, H);
  paperGrain(ctx, W, H, 11);

  // Lilac frame and edition hairline
  ctx.lineWidth = frame;
  ctx.strokeStyle = C.lilac;
  rrect(ctx, frame / 2, frame / 2, W - frame, H - frame, 46);
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.strokeStyle = ed.edge;
  rrect(
    ctx,
    frame + 10,
    frame + 10,
    W - 2 * frame - 20,
    H - 2 * frame - 20,
    30,
  );
  ctx.stroke();

  // Lilac strip: ticker + chain coin
  const stripH = 44 * S;
  const inner = frame + 22;
  ctx.save();
  rrect(ctx, inner, inner, W - 2 * inner, stripH, [26, 26, 10, 10]);
  ctx.fillStyle = C.lilac;
  ctx.fill();
  ctx.restore();
  const sym = house ? "1%" : ticker(card!.symbol);
  ctx.fillStyle = C.ink;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  setSpacing(ctx, -2);
  // Ticker centred on the strip: the chain is said once, on the provenance line below.
  ctx.textAlign = "center";
  fitFont(ctx, sym, W - 2 * inner - 120, 28 * S, 60, (px) => fraunces(px));
  ctx.fillText(sym, W / 2, inner + stripH * 0.54);
  mask.paint(2, 0.35, (m) => {
    rrect(m, inner, inner, W - 2 * inner, stripH, [26, 26, 10, 10]);
    m.fill();
  });

  // The token's own art, full colour, set in a brass ring (gold gloss varnish on the ring).
  const coinY = inner + stripH + 64 + 66 * S;
  const coinR = 66 * S;
  drawGoldCoin(ctx, W / 2, coinY, coinR, logo, monogramOf(sym), mask);

  // Amount and ticker
  const amount = house ? "House card" : fmtAmount(card!.amountUi);
  ctx.fillStyle = C.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  setSpacing(ctx, -4);
  const amountY = coinY + coinR + 64 + 34 * S;
  fitFont(ctx, amount, W - 2 * inner - 80, 40 * S, 60, (px) => fraunces(px));
  ctx.fillText(amount, W / 2, amountY);
  setSpacing(ctx, 0.5);
  ctx.font = dmSans(17 * S, 500);
  ctx.fillText(house ? "Still pays its dust." : sym, W / 2, amountY + 26 * S);
  ctx.fillStyle = C.orchid;
  ctx.font = dmSans(15.5 * S, 600);
  setSpacing(ctx, 0.6);
  ctx.fillText("pump.fun ✳ Solana", W / 2, amountY + 52 * S);

  // Plum strip: fed by + edition
  const footH = 36 * S;
  const footY = H - inner - footH;
  rrect(ctx, inner, footY, W - 2 * inner, footH, [10, 10, 30, 10]);
  ctx.fillStyle = C.plum;
  ctx.fill();
  // Value right, name left: the name gives way (ellipsis) before it can touch the value.
  const padX = 40,
    gap = 14 * S,
    midY = footY + footH * 0.53;
  ctx.textBaseline = "middle";
  setSpacing(ctx, 0);
  let right = 0;
  if (card && "valueSolUi" in card) {
    // A quote is value: gold on the dark strip (DA §4.2). Pending: an em dash, no unit.
    const pending = quotePending(card.valueSolUi);
    const text = pending ? "n/a" : `≈ ${fmtSol(card.valueSolUi)} SOL`;
    ctx.font = dmSans(12.5 * S, 700);
    ctx.textAlign = "right";
    ctx.fillStyle = pending ? C.lilac : C.goldHi;
    ctx.fillText(text, W - inner - padX, midY);
    right = ctx.measureText(text).width;
  } else {
    ctx.font = dmSans(13 * S, 500);
    ctx.textAlign = "right";
    ctx.fillStyle = C.lilac;
    ctx.fillText("Dust Card", W - inner - padX, midY);
    right = ctx.measureText("Dust Card").width;
  }
  const room = W - 2 * inner - 2 * padX - right - gap;
  ctx.font = dmSans(12.5 * S, 500);
  ctx.textAlign = "left";
  ctx.fillStyle = C.cream;
  const fed = ellipsize(
    ctx,
    house ? "House card" : `Fed by ${shortAddress(card!.fedBy)}`,
    room,
  );
  ctx.fillText(fed, inner + padX, midY);

  return { art, mask: mask.merge() };
}

// ---------------------------------------------------------------------------
// Hit cards
// ---------------------------------------------------------------------------

const FOIL_CROPS: Record<string, [number, number, number, number]> = {
  "pack-silver-hq.webp": [250, 380, 393, 550],
  "pack-first-light-hq.webp": [240, 420, 400, 560],
  "pack-closed-hq.webp": [240, 390, 393, 550],
  "pack-anthracite-hq.webp": [240, 440, 393, 550],
};

function innerFrame(
  ctx: Ctx2D,
  color: string | CanvasGradient,
  inset: number,
  width: number,
  mask?: MaskPainter,
) {
  const r: Radii = [36, 36, 96, 36];
  ctx.save();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  rrect(ctx, inset, inset, ART_W - 2 * inset, ART_H - 2 * inset, r);
  ctx.stroke();
  ctx.restore();
  mask?.paint(2, 1, (m) => {
    m.lineWidth = width;
    rrect(m, inset, inset, ART_W - 2 * inset, ART_H - 2 * inset, r);
    m.stroke();
  });
}

function vignette(ctx: Ctx2D, strength: number) {
  const g = ctx.createRadialGradient(
    ART_W / 2,
    ART_H * 0.42,
    ART_W * 0.3,
    ART_W / 2,
    ART_H / 2,
    ART_H * 0.75,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(10,4,14,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ART_W, ART_H);
}

/**
 * Bottom panel (dark, 1% corner) with amount, ticker and the SOL quote chip. `value: false` (stock hits,
 * which the machine buys back: D30, no market price next to Sell) paints the amount and ticker only, in a
 * panel that hugs them.
 */
function valuePanel(
  ctx: Ctx2D,
  mask: MaskPainter,
  amount: string,
  sym: string,
  sol: string,
  opts: { light?: boolean; top?: number; value?: boolean } = {},
) {
  const withValue = opts.value !== false;
  const x = 64,
    y = withValue ? (opts.top ?? 950) : ART_H - 70 - 274,
    w = ART_W - 128,
    h = ART_H - y - 70;
  const r: Radii = [28, 28, 72, 28];
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.3)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 8;
  rrect(ctx, x, y, w, h, r);
  ctx.fillStyle = opts.light ? "rgba(255,249,238,.92)" : "rgba(22,6,26,.88)";
  ctx.fill();
  ctx.restore();
  ctx.save();
  rrect(ctx, x, y, w, h, r);
  ctx.lineWidth = 3;
  ctx.strokeStyle = opts.light ? "rgba(38,6,46,.25)" : "rgba(246,210,114,.45)";
  ctx.stroke();
  ctx.restore();
  mask.paint(0, 0, (m) => {
    rrect(m, x, y, w, h, r);
    m.fill();
  });
  mask.paint(1, 0, (m) => {
    rrect(m, x, y, w, h, r);
    m.fill();
  });

  const pad = 56;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = opts.light ? C.ink : C.cream;
  setSpacing(ctx, -4);
  // Without the value row the panel hugs the amount and ticker, at the sizes of the full panel.
  const big = withValue ? Math.min(132, h * 0.33) : 112;
  fitFont(ctx, amount, w - 2 * pad, big, 60, (px) => fraunces(px));
  const amountY = y + 34 + big * 0.86;
  ctx.fillText(amount, x + pad, amountY);
  ctx.font = dmSans(withValue ? Math.min(60, h * 0.15) : 52, 700);
  setSpacing(ctx, 4);
  if (opts.light) ctx.fillStyle = C.ink;
  else ctx.fillStyle = goldGradient(ctx, amountY + 30, amountY + 80);
  ctx.fillText(
    sym.toUpperCase(),
    x + pad,
    amountY + (withValue ? Math.min(80, h * 0.2) : 66),
  );
  if (!withValue) return;
  const pending = sol === "n/a";
  if (pending) {
    // Quote pending: a quiet em dash, never "≈ n/a SOL if sold now".
    ctx.save();
    ctx.font = dmSans(56, 700);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = opts.light ? C.mauve : "rgba(255,241,231,.7)";
    ctx.fillText("n/a", x + pad, y + h - 84);
    ctx.restore();
    return;
  }
  // One unit: the quote and its condition read together ("≈ 0.40 SOL · if sold now").
  const chipW = goldChip(
    ctx,
    `≈ ${sol} SOL`,
    x + pad,
    y + h - 132,
    92,
    "left",
    mask,
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  setSpacing(ctx, 0);
  ctx.fillStyle = opts.light ? C.ink : C.cream;
  const label = "· if sold now";
  const room = w - 2 * pad - chipW - 22;
  fitFont(ctx, label, room, 44, 28, (px) => dmSans(px, 500));
  ctx.fillText(label, x + pad + chipW + 22, y + h - 84);
}

export async function paintHitCard(
  hit: RipHitCard,
  assetsBase: string,
): Promise<CardArt> {
  await ensureFonts();
  const tier = TIERS[hit.tier];
  if (hit.tier === "one_pct") return paintOnePctCard(hit, assetsBase, false);
  const [foilImg, logo] = await Promise.all([
    loadImage(assetsBase + tier.foil),
    loadImage(hit.logoUrl),
  ]);
  const [art, ctx] = makeArtCanvas();
  const mask = new MaskPainter();
  const sym = ticker(hit.symbol);
  const crop = FOIL_CROPS[tier.foil];

  // Foil ground
  if (foilImg) {
    if (hit.tier === "jackpot") {
      ctx.drawImage(
        goldify(
          foilImg,
          ...crop,
          Math.round(ART_W * ART_RES),
          Math.round(ART_H * ART_RES),
        ),
        0,
        0,
        ART_W,
        ART_H,
      );
    } else {
      ctx.drawImage(foilImg, ...crop, 0, 0, ART_W, ART_H);
    }
    sharpen(ctx, 0.55);
  } else {
    ctx.fillStyle = tier.edge;
    ctx.fillRect(0, 0, ART_W, ART_H);
  }
  if (hit.tier === "black") vignette(ctx, 0.5);
  else if (hit.tier === "jackpot") vignette(ctx, 0.25);
  else vignette(ctx, 0.28);
  mask.paint(0, 1, (m) => m.fillRect(0, 0, ART_W, ART_H));
  mask.paint(1, 1, (m) => m.fillRect(0, 0, ART_W, ART_H));

  innerFrame(ctx, goldGradient(ctx, 0, ART_H), 36, 7, mask);

  // Label strip + multiplier
  labelStrip(ctx, tier.label, 78, tier.mult ? 115 : 84, 100, {}, mask);
  if (tier.mult) {
    ctx.save();
    ctx.font = fraunces(170);
    setSpacing(ctx, -170 * 0.06);
    const mw = ctx.measureText(tier.mult).width;
    ctx.restore();
    const bx = ART_W - 78 - mw - 70,
      by = 70,
      bw = mw + 70,
      bh = 190;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    rrect(ctx, bx, by, bw, bh, [22, 22, 56, 22]);
    ctx.fillStyle = "rgba(14,10,16,.88)";
    ctx.fill();
    ctx.restore();
    rrect(ctx, bx, by, bw, bh, [22, 22, 56, 22]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(246,210,114,.45)";
    ctx.stroke();
    mask.paint(0, 0, (m) => {
      rrect(m, bx, by, bw, bh, [22, 22, 56, 22]);
      m.fill();
    });
    mask.paint(1, 0, (m) => {
      rrect(m, bx, by, bw, bh, [22, 22, 56, 22]);
      m.fill();
    });
    goldEmboss(ctx, tier.mult, bx + bw / 2 + 6, by + 150, 170, "center", mask);
  } else if (hit.tier === "jackpot") {
    ctx.save();
    ctx.font = fraunces(150);
    setSpacing(ctx, -8);
    ctx.textAlign = "center";
    ctx.fillStyle = C.ink;
    ctx.fillText("Jackpot", ART_W / 2, 360);
    ctx.restore();
  }

  // Coin
  const coinY = hit.tier === "jackpot" ? 640 : 560;
  const coinR = hit.tier === "jackpot" ? 220 : 250;
  drawGoldCoin(
    ctx,
    ART_W / 2,
    coinY,
    coinR,
    logo,
    hit.tier === "jackpot" && !logo ? "1%" : monogramOf(sym),
    mask,
  );

  // Stock hits show their amount only (D30); the Jackpot keeps its value.
  valuePanel(ctx, mask, fmtAmount(hit.amountUi), sym, fmtSol(hit.valueSolUi), {
    top: hit.tier === "jackpot" ? 940 : 900,
    value: !STOCK_TIERS.includes(hit.tier),
  });
  return { art, mask: mask.merge() };
}

/** White-holo face with the white Pepe and a gold "1%" (DA §7.2). `teaser` shows the sealed mini Signature pack instead. */
export async function paintOnePctCard(
  hit: RipHitCard,
  assetsBase: string,
  teaser: boolean,
): Promise<CardArt> {
  await ensureFonts();
  const [pepe, pack] = await Promise.all([
    teaser
      ? Promise.resolve(null)
      : loadImage(assetsBase + "pepe-mascot-white-hq.webp"),
    teaser
      ? loadImage(assetsBase + "pack-closed-hq.webp")
      : Promise.resolve(null),
  ]);
  const [art, ctx] = makeArtCanvas();
  const mask = new MaskPainter();
  // Pearl ground with soft pastel bands; the shader adds live iridescence on top.
  const g = ctx.createLinearGradient(0, 0, ART_W, ART_H);
  g.addColorStop(0, "#fffaff");
  g.addColorStop(0.25, "#f4ecff");
  g.addColorStop(0.5, "#fff6fb");
  g.addColorStop(0.75, "#effaff");
  g.addColorStop(1, "#fff8ec");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ART_W, ART_H);
  ctx.save();
  ctx.globalAlpha = 0.22;
  const colors = ["#a8e7ff", "#e4c3ff", "#ffbfd9", "#ffe5a4", "#c7ffe9"];
  for (let i = -6; i < 14; i++) {
    ctx.fillStyle = colors[(i + 20) % colors.length];
    ctx.beginPath();
    const x = i * 120;
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 90, 0);
    ctx.lineTo(x + 90 + 500, ART_H);
    ctx.lineTo(x + 500, ART_H);
    ctx.fill();
  }
  ctx.restore();
  paperGrain(ctx, ART_W, ART_H, 23);
  mask.paint(0, 0.55, (m) => m.fillRect(0, 0, ART_W, ART_H));
  mask.paint(1, 1, (m) => m.fillRect(0, 0, ART_W, ART_H));
  innerFrame(ctx, goldGradient(ctx, 0, ART_H), 36, 7, mask);

  if (teaser) {
    if (pack) {
      ctx.save();
      ctx.shadowColor = "rgba(38,6,46,.35)";
      ctx.shadowBlur = 50;
      ctx.shadowOffsetY = 24;
      ctx.drawImage(pack, 92, 230, 840, 840);
      ctx.restore();
    }
    labelStrip(
      ctx,
      "SEALED ✳ SIGNATURE",
      ART_W / 2,
      1180,
      96,
      { align: "center" },
      mask,
    );
    return { art, mask: mask.merge() };
  }

  goldEmboss(ctx, "1%", 92, 236, 200, "left", mask);
  labelStrip(ctx, "THE 1%", ART_W - 84 - 330, 104, 100, { maxW: 330 }, mask);
  if (pepe) {
    ctx.save();
    ctx.shadowColor = "rgba(38,6,46,.25)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.drawImage(pepe, 70, 250, 884, 884);
    ctx.restore();
    mask.paint(0, 0.2, (m) => m.fillRect(150, 320, 724, 700));
  }
  valuePanel(
    ctx,
    mask,
    fmtAmount(hit.amountUi),
    ticker(hit.symbol),
    fmtSol(hit.valueSolUi),
    { light: true, top: 960 },
  );
  return { art, mask: mask.merge() };
}

// ---------------------------------------------------------------------------
// Card back (identical for every card: no tells)
// ---------------------------------------------------------------------------

export async function paintCardBack(assetsBase: string): Promise<CardArt> {
  await ensureFonts();
  const img = await loadImage(assetsBase + "pack-back-hq.webp");
  const [art, ctx] = makeArtCanvas();
  const mask = new MaskPainter();
  if (img) {
    ctx.drawImage(img, 236, 100, 450, 475, 0, 0, ART_W, ART_H);
    sharpen(ctx, 0.45);
  } else {
    ctx.fillStyle = C.lilac;
    ctx.fillRect(0, 0, ART_W, ART_H);
  }
  vignette(ctx, 0.35);
  mask.paint(0, 1, (m) => m.fillRect(0, 0, ART_W, ART_H));
  mask.paint(1, 1, (m) => m.fillRect(0, 0, ART_W, ART_H));
  innerFrame(ctx, goldGradient(ctx, 0, ART_H), 40, 6, mask);
  // Brand lock-up, as printed on the pack back.
  const cy = ART_H / 2;
  ctx.save();
  rrect(ctx, 150, cy - 150, ART_W - 300, 300, [28, 28, 72, 28]);
  ctx.fillStyle = "rgba(14,8,18,.78)";
  ctx.fill();
  ctx.restore();
  mask.paint(0, 0, (m) => {
    rrect(m, 150, cy - 150, ART_W - 300, 300, [28, 28, 72, 28]);
    m.fill();
  });
  mask.paint(1, 0, (m) => {
    rrect(m, 150, cy - 150, ART_W - 300, 300, [28, 28, 72, 28]);
    m.fill();
  });
  goldEmboss(ctx, "1%", ART_W / 2, cy - 20, 150, "center", mask);
  ctx.save();
  ctx.font = dmSans(46, 700);
  setSpacing(ctx, 9);
  ctx.textAlign = "center";
  ctx.fillStyle = goldGradient(ctx, cy + 50, cy + 100);
  ctx.fillText("RIP. REVEAL. OWN.", ART_W / 2 + 4, cy + 96);
  ctx.restore();
  return { art, mask: mask.merge() };
}

export function tierAccent(tier: HitTier): string {
  return TIERS[tier].edge;
}
