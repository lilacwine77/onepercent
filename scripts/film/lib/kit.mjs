// Capture kit: a Chromium page under virtual time, frame-exact screenshots.
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, "../../..");
const require = createRequire(join(repo, "app/apps/web/package.json"));

/** playwright-core from the app workspace (pnpm store), no extra install. */
export function playwright() {
  const pnpmDir = join(repo, "app/node_modules/.pnpm");
  try {
    return require("playwright-core");
  } catch {
    return createRequire(join(pnpmDir, "playwright-core@1.63.0/node_modules/playwright-core/package.json"))(
      join(pnpmDir, "playwright-core@1.63.0/node_modules/playwright-core"),
    );
  }
}

export const PROFILES = {
  // 16:9 master: 1440×810 CSS px at 2× (2880×1620 captures).
  desktop: { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 },
  // Taller desktop for the Rip actions: labels fit ("Redeem to wallet", "Sell back ≈ …").
  "desktop-tall": { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  // 9:16 cut: a 432×768 phone at 2.5× (1080×1920 captures).
  mobile: {
    viewport: { width: 432, height: 768 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
  },
};

export async function launch(profile, { init = [] } = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch({
    args: [
      "--use-angle=metal",
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--force-color-profile=srgb",
      "--hide-scrollbars",
      "--font-render-hinting=none",
    ],
  });
  const context = await browser.newContext({ ...PROFILES[profile] });
  const vt = await readFile(join(here, "../virtual-time.js"), "utf8");
  await context.addInitScript({ content: vt });
  for (const script of init) await context.addInitScript(script);
  const page = await context.newPage();
  page.__dpr = PROFILES[profile].deviceScaleFactor;
  page.on("pageerror", (error) => console.log("pageerror:", error.message.slice(0, 200)));
  const cdp = await context.newCDPSession(page);
  return { browser, context, page, cdp };
}

/** Hide preview-only chrome (the Demo/Live/Preview badge) and scrollbars. */
export const CLEAN_CSS = `
  [data-demo-badge], .demo-badge, .preview-badge, [class*="demo-badge"] { visibility: hidden !important; }
  ::-webkit-scrollbar { display: none !important; }
  * { caret-color: transparent !important; }
`;

export class Recorder {
  constructor(page, cdp, dir, { fps = 60, quality = 90, format = "webp" } = {}) {
    Object.assign(this, { page, cdp, dir, fps, quality, format });
    this.viewport = page.viewportSize();
    this.scale = page.__dpr ?? 1;
    this.index = 0;
    this.events = [];
    this.t0 = null;
  }
  async start() {
    await mkdir(this.dir, { recursive: true });
    const [t0, sx, sy] = await this.page.evaluate(async () => [await window.__vt.freeze(), scrollX, scrollY]);
    this.t0 = t0;
    this.now = t0;
    this.scroll = { x: sx, y: sy };
    return this;
  }
  /** Virtual ms since start. */
  get elapsed() {
    return this.now - this.t0;
  }
  async step() {
    const target = this.t0 + ((this.index + 1) * 1000) / this.fps;
    const [now, sx, sy] = await this.page.evaluate(async (t) => [await window.__vt.stepTo(t), scrollX, scrollY], target);
    this.now = now;
    this.scroll = { x: sx, y: sy };
  }
  async shot(name = null) {
    const { data } = await this.cdp.send("Page.captureScreenshot", {
      format: this.format,
      quality: this.format === "png" ? undefined : this.quality,
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: false,
      // CDP returns CSS-size images unless the clip asks for device pixels.
      // Clip coordinates are document coordinates: follow the page's scroll.
      clip: { x: this.scroll.x, y: this.scroll.y, width: this.viewport.width, height: this.viewport.height, scale: this.scale },
    });
    const file = join(this.dir, name ?? `${String(this.index).padStart(5, "0")}.${this.format}`);
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  }
  /** Capture the current frame, then advance one frame. */
  async frame() {
    await this.shot();
    this.index += 1;
    await this.step();
  }
  async frames(count, each) {
    for (let i = 0; i < count; i++) {
      if (each) await each(i, this);
      await this.frame();
    }
  }
  /** Advance without capturing (virtual time only). */
  async skip(ms) {
    const steps = Math.round((ms * this.fps) / 1000);
    for (let i = 0; i < steps; i++) {
      this.index += 1;
      await this.step();
    }
  }
  mark(label, extra = {}) {
    this.events.push({ frame: this.index, ms: Math.round(this.elapsed * 10) / 10, label, ...extra });
  }
  async save(meta = {}) {
    await writeFile(
      join(this.dir, "clip.json"),
      JSON.stringify(
        { fps: this.fps, frames: this.index, viewport: this.viewport, scale: this.scale, events: this.events, ...meta },
        null,
        2,
      ),
    );
  }
}

/** Center of the first visible element matching a locator. */
export async function center(locator) {
  const box = await locator.first().boundingBox();
  if (!box) throw new Error("no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Hover, press and release over `holdFrames`, capturing every frame. */
export async function pressFrames(rec, locator, { approach = 10, hold = 5, after = 0 } = {}) {
  const { x, y } = await center(locator);
  rec.mark("pointer", { x, y });
  const mouse = rec.page.mouse;
  await mouse.move(x - 40, y + 26);
  for (let i = 0; i < approach; i++) {
    const k = (i + 1) / approach;
    const e = 1 - Math.pow(1 - k, 3);
    await mouse.move(x - 40 * (1 - e), y + 26 * (1 - e));
    await rec.frame();
  }
  await mouse.down();
  for (let i = 0; i < hold; i++) await rec.frame();
  await mouse.up();
  for (let i = 0; i < after; i++) await rec.frame();
}

export async function tapFrames(rec, locator, { hold = 4 } = {}) {
  const { x, y } = await center(locator);
  rec.mark("tap", { x, y });
  await rec.page.touchscreen.tap(x, y);
  for (let i = 0; i < hold; i++) await rec.frame();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
