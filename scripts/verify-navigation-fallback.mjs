import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.QA_URL || "http://127.0.0.1:4173";
const out = "artifacts/quality-v4/final";
await mkdir(out, { recursive: true });
const report = {
  url,
  failures: [],
  errors: [],
  expectedBlockedErrors: [],
  navigation: [],
  fallback: [],
};
const check = (c, m) => {
  if (!c) report.failures.push(m);
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
});
for (const firstVisit of [true, false]) {
  const context = await browser.newContext({
    viewport: { width: 910, height: 773 },
    deviceScaleFactor: 1,
  });
  if (!firstVisit)
    await context.addInitScript(() =>
      sessionStorage.setItem("onepercent-v2-seen", "1"),
    );
  const page = await context.newPage();
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("/models/")) requests.push(r.url());
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  if (firstVisit)
    await page.route("**/models/onepercent-carousel.glb*", async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await r.continue();
    });
  await page.goto(`${url}/#packs`, { waitUntil: "domcontentloaded" });
  let race;
  if (firstVisit) {
    await page.locator(".pack-volume-canvas").waitFor({ timeout: 30000 });
    const readyBefore = await page
      .locator(".pack-orbit")
      .getAttribute("data-volume");
    await page.locator("#edition-blue").click();
    race = { readyBefore, selectedBeforeReady: readyBefore !== "ready" };
  }
  await page
    .locator('.pack-orbit[data-volume="ready"]')
    .waitFor({ timeout: 60000 });
  if (firstVisit) {
    await page.evaluate(async () => {
      const url = performance
          .getEntriesByType("resource")
          .find((r) => /pack-carousel-scene[^/]*\.js/.test(r.name)).name,
        mod = await import(url),
        type = Object.values(mod).find(
          (v) =>
            typeof v === "function" &&
            v.prototype?.render &&
            v.prototype?.setEdition,
        ),
        render = type.prototype.render;
      type.prototype.render = function (state) {
        window.__qaCarousel = this;
        type.prototype.render = render;
        return render.call(this, state);
      };
    });
    await page.waitForFunction(
      () => window.__qaCarousel && !window.__qaCarousel.compiling,
      { timeout: 30000 },
    );
    race.result = await page.evaluate(() => {
      const v = window.__qaCarousel;
      return {
        selected: document.querySelector(".pack-display").dataset.edition,
        actual:
          v.items[0].model.getObjectByName("Printed front").material.map.image
            .src,
        expected: document.querySelector("#edition-blue img").src,
        compiling: v.compiling,
      };
    });
    check(
      race.selectedBeforeReady,
      "Race test did not exercise selection during model loading",
    );
    check(
      race.result.selected === "blue" &&
        race.result.actual === race.result.expected &&
        !race.result.compiling,
      "Edition selected during loading did not reach the first rendered frame",
    );
  }
  await page.waitForTimeout(350);
  const initial = await page.evaluate(() => ({
    scrollY,
    crtCreated: !!window.crtTelevision,
    crtReady: document.querySelector("#crt-stage").dataset.ready,
    posterOpacity: getComputedStyle(document.querySelector(".crt-poster"))
      .opacity,
    posterComplete: document.querySelector(".crt-poster").complete,
    carouselActive: document.querySelector(".pack-orbit").dataset.active,
    loader: !!document.querySelector(".onepercent-loader"),
  }));
  check(
    !initial.crtCreated,
    `#packs ${firstVisit ? "first" : "return"} visit initializes offscreen CRT`,
  );
  check(
    !requests.some((u) => u.includes("onepercent-crt.glb")),
    `#packs ${firstVisit ? "first" : "return"} visit requests CRT model`,
  );
  check(
    initial.posterOpacity === "1" && initial.posterComplete,
    `#packs matching poster unavailable`,
  );
  await page.screenshot({
    path: `${out}/direct-packs-${firstVisit ? "first" : "return"}.png`,
  });
  await page.locator('.site-header a[href="#home"]').first().click();
  await page
    .locator('#crt-stage[data-ready="true"]')
    .waitFor({ timeout: 60000 });
  await page.waitForTimeout(400);
  const home = await page.evaluate(() => ({
    scrollY,
    crtCreated: !!window.crtTelevision,
    crtReady: document.querySelector("#crt-stage").dataset.ready,
    posterOpacity: getComputedStyle(document.querySelector(".crt-poster"))
      .opacity,
    carouselActive: document.querySelector(".pack-orbit").dataset.active,
    crtRenders: window.crtTelevision?.renderCount,
  }));
  check(
    home.crtReady === "true" && home.crtRenders > 0,
    `Home does not initialize CRT after direct #packs arrival`,
  );
  check(
    home.carouselActive === "false",
    `Home leaves offscreen carousel active`,
  );
  await page.screenshot({
    path: `${out}/home-after-packs-${firstVisit ? "first" : "return"}.png`,
  });
  report.navigation.push({ firstVisit, initial, home, requests, race });
  await context.close();
}
for (const width of [910, 390]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 773 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() =>
    sessionStorage.setItem("onepercent-v2-seen", "1"),
  );
  const page = await context.newPage();
  await page.route("**/models/*.glb*", (r) => r.abort());
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      report.expectedBlockedErrors.push(m.text());
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#crt-stage").hidden,
    { timeout: 20000 },
  );
  const poster = await page.evaluate(() => ({
    complete: document.querySelector(".crt-poster").complete,
    opacity: getComputedStyle(document.querySelector(".crt-poster")).opacity,
    hidden: document.querySelector(".crt-poster").hidden,
  }));
  check(
    poster.complete && poster.opacity === "1" && !poster.hidden,
    `${width}: model failure does not retain TV poster`,
  );
  await page.screenshot({ path: `${out}/fallback-hero-${width}.png` });
  await page.locator(".pack-orbit").scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.locator("#edition-blue").click();
  await page.waitForTimeout(400);
  const fallback = await page.evaluate(() => {
    const orbit = document.querySelector(".pack-orbit"),
      r = orbit.getBoundingClientRect();
    return {
      volume: orbit.dataset.volume,
      active: orbit.dataset.active,
      canvas: !!orbit.querySelector("canvas"),
      edition: document.querySelector(".pack-display").dataset.edition,
      overflow: document.documentElement.scrollWidth - innerWidth,
      items: [...document.querySelectorAll(".orbit-pack")].map((c) => ({
        opacity: +getComputedStyle(c).opacity,
        visibility: getComputedStyle(c).visibility,
        animation: getComputedStyle(c.querySelector(".orbit-float"))
          .animationName,
        loaded: c.querySelector("img").complete,
        src: c.querySelector("img").currentSrc,
      })),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  });
  check(
    !fallback.canvas && fallback.volume !== "ready",
    `${width}: blocked carousel retains unusable canvas`,
  );
  check(
    fallback.edition === "blue" &&
      fallback.items.some(
        (i) =>
          i.opacity > 0.5 && i.loaded && i.src.includes("pack-first-light"),
      ),
    `${width}: fallback edition selection fails`,
  );
  check(
    fallback.items.every((i) => i.animation === "none"),
    `${width}: fallback keeps an unconditional CSS bob loop`,
  );
  check(fallback.overflow <= 1, `${width}: fallback horizontal overflow`);
  await page.screenshot({ path: `${out}/fallback-carousel-${width}.png` });
  report.fallback.push({ width, poster, fallback });
  await context.close();
}
await browser.close();
report.passed = !report.errors.length && !report.failures.length;
await writeFile(
  `${out}/navigation-fallback-report.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

if (!report.passed) process.exitCode = 1;
