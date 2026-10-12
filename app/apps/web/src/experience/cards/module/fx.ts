/* eslint-disable */
// Synced from experience/cards-lab/src/cards/fx.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Moments layer: one fixed overlay with a lazily created canvas (coins, tokens, dust, sparkles)
 * and DOM clones for card flights and shards. Transform/opacity only on DOM; the canvas runs on
 * GSAP's ticker only while something moves, then it is cleared and hidden.
 * Particle budget per DA §8.2 (60 desktop / 24 phones), coins first.
 */
import { gsap, animateWhile } from "./motion";
import { h } from "./dom";

type Pt = { x: number; y: number };
type Target = () => Pt;

interface Coin {
  t: "coin";
  sprite: HTMLCanvasElement;
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  delay: number;
  pop: number;
  fly: number;
  rot: number;
  spin: number;
  p0?: Pt;
  c1?: Pt;
  target: Target;
  onArrive?: () => void;
  trail: boolean;
  started: boolean;
  onStart?: () => void;
}
interface Speck {
  t: "speck";
  sprite: HTMLCanvasElement;
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  g: number;
  drag: number;
  swirl?: Target;
  spin?: number;
  rot?: number;
  star?: boolean;
}
type Particle = Coin | Speck;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const center = (r: DOMRect): Pt => ({
  x: r.left + r.width / 2,
  y: r.top + r.height / 2,
});

export interface FxHost {
  reduced(): boolean;
  budget(): number;
  mobile(): boolean;
}

export class Fx {
  readonly layer: HTMLDivElement;
  private canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private parts: Particle[] = [];
  private running = false;
  private sprites = new Map<string, HTMLCanvasElement>();
  private onResize = () => this.size();

  constructor(
    parent: HTMLElement,
    private host: FxHost,
  ) {
    this.layer = h("div", { cls: "mc-fx", attrs: { "aria-hidden": "true" } });
    parent.append(this.layer);
  }

  // ------------------------------------------------------------------ canvas
  private ensure() {
    if (this.canvas) {
      this.canvas.hidden = false;
      return;
    }
    this.canvas = h("canvas", "mc-fx-canvas");
    this.layer.prepend(this.canvas);
    this.g = this.canvas.getContext("2d");
    this.size();
    window.addEventListener("resize", this.onResize);
  }
  private size() {
    if (!this.canvas) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }
  private alive(kind?: Particle["t"]) {
    return kind
      ? this.parts.filter((p) => p.t === kind).length
      : this.parts.length;
  }
  private room() {
    return Math.max(0, this.host.budget() - this.parts.length);
  }

  private run() {
    if (this.running) return;
    this.running = true;
    this.ensure();
    animateWhile((dt) => this.frame(dt));
  }

  private frame(dt: number): boolean {
    const g = this.g!;
    const c = this.canvas!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const keep: Particle[] = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.t === "coin" ? this.stepCoin(p, dt) : this.stepSpeck(p, dt))
        keep.push(p);
    }
    this.parts = keep;
    for (const p of this.parts)
      p.t === "coin" ? this.drawCoin(p) : this.drawSpeck(p);
    if (!this.parts.length) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      c.hidden = true;
      this.running = false;
      return false;
    }
    return true;
  }

  private stepCoin(p: Coin, dt: number): boolean {
    const a = p.age - p.delay;
    if (a < 0) return true;
    if (!p.started) {
      p.started = true;
      p.onStart?.();
    }
    p.rot += p.spin * dt;
    if (a < p.pop) {
      p.vy += 1500 * dt;
      p.vx *= 1 - 3.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return true;
    }
    if (!p.p0) {
      p.p0 = { x: p.x, y: p.y };
      // The path leaves along the burst velocity, then curves into the target (no snap in direction).
      const k = 0.2;
      p.c1 = { x: p.x + p.vx * k, y: p.y + p.vy * k - 30 };
    }
    const u = Math.min(1, (a - p.pop) / p.fly);
    const e = u * u * (2.2 - 1.2 * u);
    const T = p.target();
    const ix =
      (1 - e) * (1 - e) * p.p0.x + 2 * (1 - e) * e * p.c1!.x + e * e * T.x;
    const iy =
      (1 - e) * (1 - e) * p.p0.y + 2 * (1 - e) * e * p.c1!.y + e * e * T.y;
    if (
      p.trail &&
      Math.random() < 0.35 &&
      this.alive("speck") < 30 &&
      this.room() > 0
    ) {
      this.parts.push(
        this.speck(ix, iy, "gold", {
          life: rand(0.25, 0.45),
          vx: rand(-20, 20),
          vy: rand(-20, 20),
          g: 0,
          size: rand(2, 3.4),
        }),
      );
    }
    p.x = ix;
    p.y = iy;
    if (u >= 1) {
      p.onArrive?.();
      return false;
    }
    return true;
  }

  private stepSpeck(p: Speck, dt: number): boolean {
    if (p.age >= p.life) return false;
    if (p.swirl) {
      const T = p.swirl();
      const dx = T.x - p.x,
        dy = T.y - p.y,
        d = Math.hypot(dx, dy) || 1;
      if (d < 7) return false;
      const pull = 2600 + 30000 / d;
      const tang = 520;
      p.vx += ((dx / d) * pull + (-dy / d) * tang) * dt;
      p.vy += ((dy / d) * pull + (dx / d) * tang) * dt;
      p.vx *= 1 - 5.5 * dt;
      p.vy *= 1 - 5.5 * dt;
    } else {
      p.vy += p.g * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
    }
    if (p.spin) p.rot = (p.rot ?? 0) + p.spin * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return true;
  }

  private drawCoin(p: Coin) {
    if (p.age < p.delay) return;
    const g = this.g!;
    const a = p.age - p.delay;
    const u = p.p0 ? Math.min(1, (a - p.pop) / p.fly) : 0;
    const s = p.size * (1 - 0.45 * u * u) * Math.min(1, a / 0.08);
    const sx = Math.max(0.16, Math.abs(Math.cos(p.rot)));
    g.save();
    g.translate(p.x, p.y);
    g.scale(sx, 1);
    g.drawImage(p.sprite, -s / 2, -s / 2, s, s);
    g.restore();
  }

  private drawSpeck(p: Speck) {
    const g = this.g!;
    const k = p.age / p.life;
    g.globalAlpha = Math.max(0, 1 - k * k);
    const s = p.size * (p.star ? 1 - 0.4 * k : 1);
    if (p.rot) {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.drawImage(p.sprite, -s, -s, s * 2, s * 2);
      g.restore();
    } else g.drawImage(p.sprite, p.x - s, p.y - s, s * 2, s * 2);
    g.globalAlpha = 1;
  }

  /** Idle-time warm-up of the canvas and the sprites every moment uses. */
  prewarm() {
    this.ensure();
    if (this.canvas) this.canvas.hidden = true;
    this.solCoin();
    this.star();
    for (const c of ["#e8b54e", "#c58ee6", "#fff6ea", "#6b2f7d"]) this.dot(c);
  }

  // ------------------------------------------------------------------ sprites
  private sprite(
    key: string,
    size: number,
    paint: (g: CanvasRenderingContext2D, s: number) => void,
  ) {
    const hit = this.sprites.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    paint(g, size);
    this.sprites.set(key, c);
    return c;
  }

  /** The SOL coin: a gold coin (value, DA §4.2) with a plum hairline and embossed "SOL". */
  solCoin() {
    return this.sprite("sol", 112, (g, s) => {
      const r = s / 2;
      g.translate(r, r);
      g.fillStyle = "#3a2208";
      g.beginPath();
      g.arc(0, 1.5, r - 1, 0, Math.PI * 2);
      g.fill();
      const rim = g.createLinearGradient(-r, -r, r, r);
      rim.addColorStop(0, "#fff6d6");
      rim.addColorStop(0.28, "#f6d272");
      rim.addColorStop(0.55, "#c08a32");
      rim.addColorStop(0.78, "#f6d272");
      rim.addColorStop(1, "#a8701f");
      g.fillStyle = rim;
      g.beginPath();
      g.arc(0, 0, r - 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(58,34,8,.32)";
      g.lineWidth = 1.4;
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
        g.lineTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
        g.stroke();
      }
      g.strokeStyle = "#4c2459";
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      g.stroke();
      const face = g.createRadialGradient(-r * 0.3, -r * 0.4, 2, 0, 0, r * 0.8);
      face.addColorStop(0, "#fff3c4");
      face.addColorStop(0.55, "#f6d272");
      face.addColorStop(1, "#d9a441");
      g.fillStyle = face;
      g.beginPath();
      g.arc(0, 0, r * 0.76, 0, Math.PI * 2);
      g.fill();
      g.font = `700 ${Math.round(r * 0.5)}px "DM Sans", system-ui, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(255,246,214,.9)";
      g.fillText("SOL", 0, r * 0.08);
      g.fillStyle = "#3a2208";
      g.fillText("SOL", 0, r * 0.03);
      g.strokeStyle = "rgba(255,255,255,.95)";
      g.lineWidth = 3;
      g.lineCap = "round";
      g.beginPath();
      g.arc(0, 0, r * 0.9, Math.PI * 1.12, Math.PI * 1.5);
      g.stroke();
    });
  }

  /** A token coin in gold mode with the card's logo (or monogram): Redeem and take-back streams. */
  tokenCoin(key: string, logo: HTMLImageElement | null, mono: string) {
    return this.sprite(`tok:${key}`, 96, (g, s) => {
      const r = s / 2;
      g.translate(r, r);
      const rim = g.createLinearGradient(-r, -r, r, r);
      rim.addColorStop(0, "#fff3c4");
      rim.addColorStop(0.35, "#f6d272");
      rim.addColorStop(0.6, "#a8701f");
      rim.addColorStop(1, "#f6d272");
      g.fillStyle = rim;
      g.beginPath();
      g.arc(0, 0, r - 1, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = "#2c1235";
      g.fillRect(-r, -r, s, s);
      if (logo && logo.complete && logo.naturalWidth) {
        try {
          g.drawImage(logo, -r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
        } catch {
          /* cross-origin: monogram */
        }
      } else {
        g.fillStyle = "#f6d272";
        g.font = `700 ${Math.round(r * (mono.length > 1 ? 0.62 : 0.9))}px "Fraunces", Georgia, serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(mono, 0, r * 0.06);
      }
      const dome = g.createLinearGradient(0, -r, 0, r * 0.2);
      dome.addColorStop(0, "rgba(255,255,255,.3)");
      dome.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = dome;
      g.fillRect(-r, -r, s, s);
      g.restore();
      g.strokeStyle = "#3a2208";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      g.stroke();
    });
  }

  private dot(color: string) {
    return this.sprite(`dot:${color}`, 32, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, color);
      gr.addColorStop(0.45, color);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
  }
  /** Pepe's gold four-point sparkle (DA hit glyph). */
  private star(color = "#f6d272") {
    return this.sprite(`star:${color}`, 48, (g, s) => {
      const r = s / 2;
      g.translate(r, r);
      g.fillStyle = color;
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.quadraticCurveTo(
          Math.cos(a + Math.PI / 4) * r * 0.16,
          Math.sin(a + Math.PI / 4) * r * 0.16,
          Math.cos(a + Math.PI / 2) * r * 0.96,
          Math.sin(a + Math.PI / 2) * r * 0.96,
        );
      }
      g.closePath();
      g.fill();
    });
  }

  private speck(
    x: number,
    y: number,
    tone: "gold" | "lilac" | "cream" | "plum" | "ink",
    o: Partial<Speck> = {},
  ): Speck {
    const color = {
      gold: "#e8b54e",
      lilac: "#c58ee6",
      cream: "#fff6ea",
      plum: "#6b2f7d",
      ink: "#26062e",
    }[tone];
    return {
      t: "speck",
      sprite: this.dot(color),
      size: rand(1.6, 3.2),
      x,
      y,
      vx: rand(-80, 80),
      vy: rand(-140, -20),
      age: 0,
      life: rand(0.5, 0.9),
      g: -60,
      drag: 2.2,
      ...o,
    };
  }

  // ------------------------------------------------------------------ primitives
  /** Coins that pop out of `from` points, then fly into `target`. `onArrive(i)` fires as each lands. */
  coins(o: {
    from: Pt[];
    target: Target;
    sprite: HTMLCanvasElement;
    size?: number;
    stagger?: number;
    pop?: [number, number];
    fly?: [number, number];
    burst?: number;
    onArrive?: (i: number, n: number) => void;
    onStart?: (i: number) => void;
    trail?: boolean;
  }): Promise<void> {
    const n = Math.min(
      o.from.length,
      Math.max(1, this.host.budget() - this.alive("coin")),
    );
    if (this.host.reduced() || !n) {
      for (let i = 0; i < o.from.length; i++) o.onArrive?.(i, o.from.length);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let landed = 0;
      for (let i = 0; i < n; i++) {
        const f = o.from[i];
        const ang = rand(-Math.PI * 0.95, -Math.PI * 0.05);
        const sp = rand(0.4, 1) * (o.burst ?? 260);
        this.parts.push({
          t: "coin",
          sprite: o.sprite,
          size: (o.size ?? 30) * rand(0.86, 1.08),
          x: f.x,
          y: f.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          age: 0,
          delay: i * (o.stagger ?? 0.035),
          pop: rand(...(o.pop ?? [0.16, 0.26])),
          fly: rand(...(o.fly ?? [0.52, 0.72])),
          rot: rand(0, Math.PI),
          spin: rand(9, 16) * (Math.random() < 0.5 ? -1 : 1),
          target: o.target,
          trail: o.trail ?? true,
          started: false,
          onStart: () => o.onStart?.(i),
          onArrive: () => {
            o.onArrive?.(i, n);
            if (++landed === n) resolve();
          },
        });
      }
      this.run();
    });
  }

  /** A puff of specks (gold dust, lilac dust) from a rect. */
  dust(
    rect: DOMRect,
    count: number,
    tones: ("gold" | "lilac" | "cream" | "plum")[],
    o: Partial<Speck> = {},
  ) {
    if (this.host.reduced()) return;
    const n = Math.min(count, this.room());
    for (let i = 0; i < n; i++) {
      this.parts.push(
        this.speck(
          rand(rect.left, rect.right),
          rand(rect.top, rect.bottom),
          tones[i % tones.length],
          o,
        ),
      );
    }
    if (n) this.run();
  }

  /** Sparkles (four-point stars) around a point. */
  sparkle(at: Pt, count: number, spread = 40) {
    if (this.host.reduced()) return;
    const n = Math.min(count, this.room());
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2),
        d = rand(spread * 0.3, spread);
      this.parts.push({
        t: "speck",
        sprite: this.star(),
        star: true,
        size: rand(4, 8),
        x: at.x + Math.cos(a) * d * 0.3,
        y: at.y + Math.sin(a) * d * 0.3,
        vx: Math.cos(a) * d * 2.2,
        vy: Math.sin(a) * d * 2.2,
        age: 0,
        life: rand(0.45, 0.75),
        g: 0,
        drag: 5,
        rot: rand(0, 1),
        spin: rand(-3, 3),
      });
    }
    if (n) this.run();
  }

  /** Specks that orbit and fall into `target` (Feed back swirl). */
  swirl(from: DOMRect, count: number, target: Target) {
    if (this.host.reduced()) return;
    const n = Math.min(count, this.room());
    const T = target();
    for (let i = 0; i < n; i++) {
      const x = rand(from.left, from.right),
        y = rand(from.top, from.bottom);
      const dx = T.x - x,
        dy = T.y - y,
        d = Math.hypot(dx, dy) || 1;
      this.parts.push(
        this.speck(x, y, (["lilac", "gold", "plum", "lilac"] as const)[i % 4], {
          swirl: target,
          life: rand(0.9, 1.3),
          size: rand(2.4, 4.4),
          vx: (-dy / d) * rand(120, 240),
          vy: (dx / d) * rand(120, 240),
        }),
      );
    }
    if (n) this.run();
  }

  // ------------------------------------------------------------------ DOM moments
  /** A fixed clone of a card face at `rect` (for flights), sized so its cqw layout matches. */
  cloneCard(cardEl: HTMLElement, rect: DOMRect): HTMLElement {
    const c = cardEl.cloneNode(true) as HTMLElement;
    c.classList.remove("is-live");
    c.style.transform = "";
    c.style.visibility = "";
    c.classList.add("mc-fly");
    c.style.width = `${rect.width}px`;
    c.style.left = `${rect.left}px`;
    c.style.top = `${rect.top}px`;
    this.layer.append(c);
    return c;
  }

  /**
   * Builds the shards of a card off screen, a few per frame (so no single frame pays for all the clones),
   * while the card is still visible. `run()` then breaks them free.
   */
  prepareShatter(
    cardEl: HTMLElement,
    rect: DOMRect,
    many = false,
  ): {
    ready: Promise<void>;
    run: (
      onShard: (p: Pt, i: number, n: number) => void,
      under?: HTMLElement,
    ) => Promise<void>;
  } {
    const mobile = this.host.mobile();
    // Several cards at once (bulk) get coarser shards: the same read, a fraction of the layers.
    const [cols, rows] = mobile
      ? many
        ? [2, 3]
        : [3, 4]
      : many
        ? [4, 5]
        : [5, 7];
    const wrap = h("div", "mc-shards");
    wrap.style.left = `${rect.left}px`;
    wrap.style.top = `${rect.top}px`;
    wrap.style.width = `${rect.width}px`;
    wrap.style.height = `${rect.height}px`;
    wrap.style.visibility = "hidden";
    const proto = cardEl.cloneNode(true) as HTMLElement;
    proto.classList.remove("is-live");
    proto
      .querySelectorAll(".mc-glare, .mc-shine, .mc-glitter")
      .forEach((e) => e.remove());
    proto.style.transform = "";
    proto.style.visibility = "";
    proto.style.width = `${rect.width}px`;
    const w = rect.width / cols,
      hh = rect.height / rows;
    const origin = { x: rect.width * 0.5, y: rect.height * 0.42 };
    const maxD = Math.hypot(rect.width, rect.height) / 2;
    const shards: { el: HTMLElement; cx: number; cy: number; d: number }[] = [];
    this.layer.append(wrap);
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) cells.push([r, c]);
    const perFrame = mobile ? 4 : 9;
    const ready = new Promise<void>((resolve) => {
      const step = () => {
        for (const [r, c] of cells.splice(0, perFrame)) {
          const el = h("div", "mc-shard");
          el.style.left = `${c * w}px`;
          el.style.top = `${r * hh}px`;
          el.style.width = `${w + 1}px`;
          el.style.height = `${hh + 1}px`;
          const inner = proto.cloneNode(true) as HTMLElement;
          inner.style.left = `${-c * w}px`;
          inner.style.top = `${-r * hh}px`;
          el.append(inner);
          wrap.append(el);
          const cx = c * w + w / 2,
            cy = r * hh + hh / 2;
          shards.push({
            el,
            cx,
            cy,
            d: Math.hypot(cx - origin.x, cy - origin.y) / maxD,
          });
        }
        if (cells.length) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    const run = (
      onShard: (p: Pt, i: number, n: number) => void,
      under?: HTMLElement,
    ) => {
      wrap.style.visibility = "";
      const n = shards.length;
      const tl = gsap.timeline();
      if (under)
        tl.to(
          under,
          {
            opacity: 0,
            duration: 0.12,
            ease: "power1.in",
            onComplete: () => under.remove(),
          },
          0.05,
        );
      shards.forEach((s, i) => {
        const dx = (s.cx - origin.x) / rect.width,
          dy = (s.cy - origin.y) / rect.height;
        tl.to(
          s.el,
          {
            x: dx * rect.width * rand(0.5, 0.9) + rand(-14, 14),
            y: dy * rect.height * rand(0.3, 0.6) - rand(40, 110),
            rotation: rand(-70, 70),
            scale: rand(0.25, 0.5),
            opacity: 0,
            duration: rand(0.55, 0.78),
            ease: "power2.out",
            onStart: () =>
              onShard({ x: rect.left + s.cx, y: rect.top + s.cy }, i, n),
          },
          s.d * 0.2 + rand(0, 0.07),
        );
      });
      return new Promise<void>((res) =>
        tl.eventCallback("onComplete", () => {
          wrap.remove();
          res();
        }),
      );
    };
    return { ready, run };
  }

  /** A soft gold glow behind a card (Sell back charge), animated by the caller. */
  glow(rect: DOMRect): HTMLElement {
    const g = h("span", "mc-glow");
    g.style.left = `${rect.left - rect.width * 0.25}px`;
    g.style.top = `${rect.top - rect.height * 0.2}px`;
    g.style.width = `${rect.width * 1.5}px`;
    g.style.height = `${rect.height * 1.4}px`;
    this.layer.append(g);
    if (!this.host.reduced())
      gsap.fromTo(
        g,
        { opacity: 0, scale: 0.8 },
        { opacity: 1, scale: 1, duration: 0.17, ease: "power2.out" },
      );
    return g;
  }

  /** A ring that pulses out of a point (the machine taking a card, the wallet taking coins). */
  ring(at: Pt, color = "#d5a2f1", size = 54) {
    if (this.host.reduced()) return;
    const r = h("span", "mc-ring");
    r.style.left = `${at.x - size / 2}px`;
    r.style.top = `${at.y - size / 2}px`;
    r.style.width = r.style.height = `${size}px`;
    r.style.setProperty("--ring", color);
    this.layer.append(r);
    gsap.fromTo(
      r,
      { scale: 0.4, opacity: 0.95 },
      {
        scale: 1.7,
        opacity: 0,
        duration: 0.6,
        ease: "power2.out",
        onComplete: () => r.remove(),
      },
    );
  }

  destroy() {
    window.removeEventListener("resize", this.onResize);
    this.parts = [];
    this.layer.remove();
  }
}

export { center };
