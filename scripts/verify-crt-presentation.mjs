import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
const url = process.env.QA_URL || "http://127.0.0.1:4173";
const out =
  process.env.QA_OUT ||
  `artifacts/quality-v4/${process.env.QA_PHASE || "tv-final"}`;
await mkdir(out, { recursive: true });
const report = {
  url,
  scope:
    "Poster/live neutral alpha silhouette comparison at DPR1; complete projected model envelope at all hover extremes. Software Chrome rendering, no hardware performance claim.",
  failures: [],
  errors: [],
  runs: [],
};
const check = (c, m) => {
  if (!c) report.failures.push(m);
};
function mask(data, width, height) {
  const edges = [];
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 32) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        data[i - 1] < 32 ||
        data[i + 7] < 32 ||
        data[i - width * 4 + 3] < 32 ||
        data[i + width * 4 + 3] < 32
      )
        edges.push([x, y]);
    }
  return {
    edges,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
  };
}
function contourDistance(a, b) {
  const key = new Set(b.map(([x, y]) => `${x},${y}`));
  const distances = a
    .map(([x, y]) => {
      let best = 9;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++)
          if (key.has(`${x + dx},${y + dy}`))
            best = Math.min(best, Math.hypot(dx, dy));
      return best;
    })
    .sort((x, y) => x - y);
  return {
    p95: distances[Math.floor(distances.length * 0.95)],
    max: distances.at(-1),
    over2: distances.filter((v) => v > 2).length / distances.length,
  };
}
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
});
for (const [width, height] of process.env.QA_SIZES
  ? JSON.parse(process.env.QA_SIZES)
  : [
      [1190, 820],
      [1440, 900],
      [910, 773],
      [390, 844],
    ]) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() =>
    sessionStorage.setItem("onepercent-v2-seen", "1"),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(`${width}: ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .locator('#crt-stage[data-ready="true"]')
    .waitFor({ timeout: 60000 });
  await page.waitForTimeout(350);
  const captured = await page.evaluate(() => {
    const t = window.crtTelevision;
    t.setReducedMotion(true);
    t.stop();
    t.draw(0);
    const c = t.renderer.domElement,
      r = c.getBoundingClientRect();
    return {
      data: c.toDataURL(),
      width: c.width,
      height: c.height,
      stage: { x: r.x, y: r.y, width: r.width, height: r.height },
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  const bytes = Buffer.from(captured.data.split(",")[1], "base64");
  await writeFile(`${out}/live-alpha-${width}.png`, bytes);
  const live = await sharp(bytes).ensureAlpha().raw().toBuffer();
  const poster = await sharp(await readFile("public/assets/crt-poster.webp"))
    .resize(captured.width, captured.height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const a = mask(live, captured.width, captured.height),
    b = mask(poster, captured.width, captured.height);
  const run = {
    width,
    height,
    stage: captured.stage,
    overflow: captured.overflow,
    liveBounds: a.bounds,
    posterBounds: b.bounds,
    posterToLive: contourDistance(b.edges, a.edges),
    liveToPoster: contourDistance(a.edges, b.edges),
  };
  report.runs.push(run);
  check(captured.overflow <= 1, `${width}: horizontal overflow`);
  check(
    run.posterToLive.max <= 2 && run.liveToPoster.max <= 2,
    `${width}: poster/live contour differs by >2px`,
  );
  await page.screenshot({ path: `${out}/neutral-${width}.png` });
  run.hover = await page.evaluate(() => {
    const t = window.crtTelevision;
    t.reducedMotion = false;
    t.stop();
    const r = t.container.getBoundingClientRect();
    const samples = [];
    for (const x of [-1.05, 1.05])
      for (const y of [-1.05, 1.05])
        for (const time of [0, Math.PI / 3.8]) {
          t.current.set(x, y);
          t.target.set(x, y);
          t.velocity.set(0, 0);
          t.hoverWeight = 1;
          t.pointerInside = true;
          t.time = time;
          t.draw(0);
          t.scene.updateMatrixWorld(true);
          t.camera.updateMatrixWorld(true);
          let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;
          t.model.traverse((o) => {
            if (!o.isMesh) return;
            const p = o.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) {
              const v = o.position
                .clone()
                .fromBufferAttribute(p, i)
                .applyMatrix4(o.matrixWorld)
                .project(t.camera);
              const px = ((v.x + 1) * r.width) / 2,
                py = ((1 - v.y) * r.height) / 2;
              minX = Math.min(minX, px);
              maxX = Math.max(maxX, px);
              minY = Math.min(minY, py);
              maxY = Math.max(maxY, py);
            }
          });
          samples.push({
            x,
            y,
            time,
            minX,
            maxX,
            minY,
            maxY,
            margin: Math.min(minX, r.width - maxX, minY, r.height - maxY),
          });
        }
    return samples;
  });
  check(
    run.hover.every((h) => h.margin >= 0),
    `${width}: TV clips at extreme hover (${Math.min(...run.hover.map((h) => h.margin)).toFixed(2)}px)`,
  );
  const worst = run.hover.slice().sort((a, b) => a.margin - b.margin)[0];
  await page.evaluate((h) => {
    const t = window.crtTelevision;
    t.current.set(h.x, h.y);
    t.target.set(h.x, h.y);
    t.velocity.set(0, 0);
    t.hoverWeight = 1;
    t.pointerInside = true;
    t.time = h.time;
    t.draw(0);
  }, worst);
  await page.screenshot({ path: `${out}/hover-extreme-${width}.png` });
  await context.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
await browser.close();
report.passed = !report.failures.length && !report.errors.length;
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (!report.passed) process.exitCode = 1;
