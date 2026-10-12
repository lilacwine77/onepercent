import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const url = process.env.QA_URL || "http://127.0.0.1:4173";
const phase = process.env.QA_PHASE || "cold-final";
const out = `artifacts/quality-v4/${phase}`;
await mkdir(out, { recursive: true });
const report = {
  url,
  phase,
  capturedAt: new Date().toISOString(),
  scope:
    "Cold browser context with cache disabled; Chrome headless ANGLE SwiftShader. Timing diagnoses software-rendering contention and scheduling; does not measure physical GPU performance.",
  runs: [],
  errors: [],
  failures: [],
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
});

function instrument() {
  const q = (window.__quality = {
    events: [],
    longtasks: [],
    frames: [],
    renders: [],
    renderers: [],
    scenes: [],
    contexts: [],
  });
  const mark = (name, data = {}) =>
    q.events.push({ name, t: performance.now(), ...data });
  for (const event of [
    "onepercent:entrance-reveal",
    "onepercent:entrance-complete",
    "crt:ready",
  ])
    document.addEventListener(event, () => mark(event), true);
  document.addEventListener("DOMContentLoaded", () => {
    mark("domcontentloaded");
    const observer = new MutationObserver(() => {
      const current = {
        html: document.documentElement.className,
        posterHidden: document.querySelector(".crt-poster")?.hidden,
        crtReady: document.querySelector("#crt-stage")?.dataset.ready,
        loader: !!document.querySelector(".onepercent-loader"),
      };
      const json = JSON.stringify(current);
      if (json !== q.lastState) {
        q.lastState = json;
        mark("presentation", current);
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "data-ready"],
      childList: true,
    });
  });
  new PerformanceObserver((list) => {
    for (const p of list.getEntries())
      q.longtasks.push({ t: p.startTime, duration: p.duration, name: p.name });
  }).observe({ type: "longtask", buffered: true });
  let prev;
  const tick = (now) => {
    if (prev !== undefined) q.frames.push({ t: now, dt: now - prev });
    prev = now;
    if (now < 60000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    const t = performance.now();
    const result = getContext.call(this, type, ...args);
    if (type.startsWith("webgl"))
      q.contexts.push({
        t,
        type,
        class: this.className,
        duration: performance.now() - t,
      });
    return result;
  };
  window.__THREE_DEVTOOLS__ = new EventTarget();
  window.__THREE_DEVTOOLS__.addEventListener("observe", (e) => {
    const o = e.detail;
    if (o.isScene) q.scenes.push(o);
    if (o.isWebGLRenderer) {
      const id = q.renderers.length;
      q.renderers.push(o);
      mark("renderer", { id });
      const render = o.render.bind(o);
      o.render = function (scene, camera) {
        const t = performance.now();
        o.qaScene = scene;
        o.qaCamera = camera;
        const r = render(scene, camera);
        q.renders.push({
          t,
          duration: performance.now() - t,
          id,
          class: o.domElement.className,
          loading: document.documentElement.classList.contains("is-loading"),
          loader: !!document.querySelector(".onepercent-loader"),
          triangles: o.info.render.triangles,
          calls: o.info.render.calls,
        });
        return r;
      };
    }
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const q = window.__quality;
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      events: q.events,
      longtasks: q.longtasks,
      frames: q.frames,
      renders: q.renders,
      contexts: q.contexts,
      resources: performance
        .getEntriesByType("resource")
        .map((r) => ({
          name: r.name,
          start: r.startTime,
          duration: r.duration,
          transfer: r.transferSize,
        })),
      layout: {
        hero: rect(document.querySelector(".hero-art")),
        poster: rect(document.querySelector(".crt-poster")),
        stage: rect(document.querySelector("#crt-stage")),
        packs: rect(document.querySelector(".pack-display")),
        orbit: rect(document.querySelector(".pack-orbit")),
        overflow: document.documentElement.scrollWidth - innerWidth,
      },
      renderers: q.renderers.map((r) => ({
        class: r.domElement.className,
        pixelRatio: r.getPixelRatio(),
        width: r.domElement.width,
        height: r.domElement.height,
      })),
    };
  });
}

async function orbitMetrics(page) {
  return page.evaluate(() => {
    const r = window.__quality.renderers.find(
      (r) => r.domElement.className === "pack-volume-canvas",
    );
    if (!r?.qaScene) return null;
    const camera = r.qaCamera,
      scene = r.qaScene,
      rect = r.domElement.getBoundingClientRect();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const groups = scene.children.filter((o) => o.userData.index !== undefined);
    const items = groups.map((g) => {
      const points = [];
      g.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const v = o
            .localToWorld(o.position.clone().fromBufferAttribute(p, i))
            .project(camera);
          points.push({
            x: rect.x + ((v.x + 1) * rect.width) / 2,
            y: rect.y + ((1 - v.y) * rect.height) / 2,
          });
        }
      });
      return {
        index: g.userData.index,
        visible: g.visible,
        z: g.position.z,
        minX: Math.min(...points.map((p) => p.x)),
        maxX: Math.max(...points.map((p) => p.x)),
        minY: Math.min(...points.map((p) => p.y)),
        maxY: Math.max(...points.map((p) => p.y)),
      };
    });
    const visible = items
      .filter((i) => i.visible)
      .sort((a, b) => a.minX - b.minX);
    const pairs = [];
    for (let i = 0; i < visible.length; i++)
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i],
          b = visible[j],
          overlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        if (overlap > 0)
          pairs.push({
            a: a.index,
            b: b.index,
            pixels: overlap,
            ratio: overlap / Math.min(a.maxX - a.minX, b.maxX - b.minX),
            aDepth: a.z,
            bDepth: b.z,
          });
      }
    return {
      items,
      pairs,
      canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}

const sizes = process.env.QA_SIZES
  ? JSON.parse(process.env.QA_SIZES)
  : [
      [1190, 820],
      [1440, 900],
      [910, 773],
      [390, 844],
    ];
for (const [width, height] of sizes) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(instrument);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: `${out}/cold-${width}-first.png` });
  await page.waitForFunction(
    () =>
      window.__quality.events.some(
        (e) => e.name === "onepercent:entrance-complete",
      ),
    null,
    { timeout: 30000 },
  );
  await page.screenshot({ path: `${out}/cold-${width}-intro-complete.png` });
  await page
    .locator('#crt-stage[data-ready="true"]')
    .waitFor({ timeout: 60000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/cold-${width}-live.png` });
  const run = { width, height, cold: await measure(page), orbit: [] };
  report.runs.push(run);
  const introEnd = run.cold.events.find(
    (e) => e.name === "onepercent:entrance-complete",
  )?.t;
  run.summary = {
    introEnd,
    crtReady: run.cold.events.find((e) => e.name === "crt:ready")?.t,
    webGLDuringIntro: run.cold.contexts.filter((c) => c.t < introEnd).length,
    carouselBeforeScroll: run.cold.renderers.some(
      (r) => r.class === "pack-volume-canvas",
    ),
    introLongtasks: run.cold.longtasks.filter((t) => t.t < introEnd),
    introLargestGap: Math.max(
      0,
      ...run.cold.frames.filter((f) => f.t < introEnd).map((f) => f.dt),
    ),
    firstRendererAt: run.cold.events.find((e) => e.name === "renderer")?.t,
  };
  if (phase !== "baseline") {
    if (run.summary.webGLDuringIntro)
      report.failures.push(`${width}: WebGL initialized before intro settled`);
    if (run.summary.carouselBeforeScroll)
      report.failures.push(
        `${width}: offscreen carousel renderer started before scroll`,
      );
    if (run.cold.layout.overflow > 1)
      report.failures.push(`${width}: horizontal overflow`);
  }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await page.locator(".pack-orbit").scrollIntoViewIfNeeded();
  await page
    .locator('.pack-orbit[data-volume="ready"]')
    .waitFor({ timeout: 60000 });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(800);
  await page.locator(".pack-orbit").focus();
  for (let i = 0; i < (process.env.QA_COLD_ONLY !== "0" ? 1 : 8); i++) {
    if (i) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(750);
    }
    run.orbit.push(await orbitMetrics(page));
    if ([0, 1, 2, 3, 7].includes(i))
      await page.screenshot({ path: `${out}/carousel-${width}-slot${i}.png` });
  }
  for (const edition of process.env.QA_COLD_ONLY !== "0"
    ? []
    : ["original", "blue", "after-hours"]) {
    await page.locator(`#edition-${edition}`).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/carousel-${width}-${edition}.png` });
  }
  run.end = await measure(page);
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await context.close();
}

// Hold the model request solely to show the real fallback composition before
// the transition. This diagnostic view is excluded from performance metrics.
{
  const context = await browser.newContext({
    viewport: { width: 1190, height: 820 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() =>
    sessionStorage.setItem("onepercent-v2-seen", "1"),
  );
  const page = await context.newPage();
  await page.route("**/models/onepercent-crt.glb*", (r) => r.abort());
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${out}/poster-${1190}-fallback.png` });
  await context.close();
}
await browser.close();
report.passed = !report.failures.length && !report.errors.length;
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      out,
      errors: report.errors,
      runs: report.runs.map((r) => ({
        width: r.width,
        events: r.cold.events,
        contexts: r.cold.contexts,
        firstRenders: r.cold.renders.filter(
          (a, i, list) => i === list.findIndex((b) => b.id === a.id),
        ),
        longtasks: r.cold.longtasks,
        largestGaps: r.cold.frames.sort((a, b) => b.dt - a.dt).slice(0, 10),
        overlaps: r.orbit.map((o) => o?.pairs),
      })),
    },
    null,
    2,
  ),
);

if (!report.passed) process.exitCode = 1;
