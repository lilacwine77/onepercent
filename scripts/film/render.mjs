#!/usr/bin/env node
/**
 * Renders the film's frames from the compositor (scripts/film/compose).
 *
 *   node scripts/film/render.mjs --layout 16x9 --cap <captures> --out <frames>
 *        [--frames 0-1319 | --frames 120,480,600] [--preview]
 *
 * The compositor draws frame N as a pure function of N. Final frames are drawn
 * at 2x and reduced with Lanczos (python3 + Pillow); frames the timeline marks
 * for motion blur are averaged over several sub-frame samples. --preview writes
 * 1x WebP frames straight from Chrome, for quick checks.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { playwright, repo } from "./lib/kit.mjs";
import { serve } from "./lib/serve.mjs";

const { values } = parseArgs({
  options: {
    layout: { type: "string", default: "16x9" },
    cap: { type: "string" },
    out: { type: "string" },
    frames: { type: "string" },
    preview: { type: "boolean", default: false },
    dpr: { type: "string", default: "2" },
  },
});
if (!values.cap || !values.out) throw new Error("--cap and --out are required");
const SIZES = { "16x9": [1280, 720], "9x16": [1080, 1920] };
const [width, height] = SIZES[values.layout];
const dpr = values.preview ? 1 : Number(values.dpr);
const out = resolve(values.out);
await mkdir(out, { recursive: true });

const { server, url } = await serve({ cap: values.cap });
const { chromium } = playwright();
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.log("page:", m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`${url}/compose/index.html?layout=${values.layout}`, { waitUntil: "load" });
await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 120000 });
const total = await page.evaluate(() => window.FILM.frames);
const cdp = await page.context().newCDPSession(page);

let list = [];
if (!values.frames) list = [...Array(total).keys()];
else
  for (const part of values.frames.split(",")) {
    const [a, b] = part.split("-").map(Number);
    if (b === undefined) list.push(a);
    else for (let i = a; i <= b; i++) list.push(i);
  }

let finisher = null;
const pending = new Map();
if (!values.preview) {
  finisher = spawn("python3", [join(repo, "scripts/film/lib/downscale.py")], { stdio: ["pipe", "pipe", "inherit"] });
  let buffer = "";
  finisher.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const done = line.replace(/^ok /, "");
      pending.get(done)?.();
      pending.delete(done);
    }
  });
}

async function shot(file, format) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format,
    ...(format === "webp" ? { quality: 92 } : {}),
    fromSurface: true,
    clip: { x: 0, y: 0, width, height, scale: dpr },
  });
  await writeFile(file, Buffer.from(data, "base64"));
}

const started = Date.now();
let inflight = [];
for (const [n, frame] of list.entries()) {
  const name = String(frame).padStart(5, "0");
  if (values.preview) {
    await page.evaluate((f) => window.FILM.render(f), frame);
    await shot(join(out, `${name}.webp`), "webp");
  } else {
    const samples = await page.evaluate((f) => window.FILM.samples(f), frame);
    const sources = [];
    for (const [k, offset] of samples.entries()) {
      await page.evaluate((f) => window.FILM.render(f), frame + offset);
      const file = join(out, `${name}.s${k}.png`);
      await shot(file, "png");
      sources.push(file);
    }
    const dst = join(out, `${name}.png`);
    inflight.push(new Promise((ok) => pending.set(dst, ok)));
    finisher.stdin.write(["frame", dst, width, height, ...sources].join("\t") + "\n");
    if (inflight.length > 6) inflight = inflight.slice(-6), await inflight[0];
  }
  if (n % 30 === 0) {
    const rate = (n + 1) / ((Date.now() - started) / 1000);
    console.log(`frame ${frame} (${n + 1}/${list.length}) ${rate.toFixed(1)} fps`);
  }
}
await Promise.all(inflight);
finisher?.stdin.end();
await browser.close();
server.close();
console.log(`rendered ${list.length} frames in ${Math.round((Date.now() - started) / 1000)} s`);
