import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const output = "artifacts/v2";
const base = process.env.PACK_PREVIEW_URL || "http://127.0.0.1:5173";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "no-preference",
});
const report = { url: base, checks: [], issues: [], pageErrors: [], consoleErrors: [] };
const pass = (name, detail) => report.checks.push({ name, detail, passed: true });
page.on("pageerror", (error) => report.pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") report.consoleErrors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400) {
    report.badResponses ??= [];
    report.badResponses.push({ status: response.status(), url: response.url() });
  }
});
await page.addInitScript(() => {
  window.__entranceTrace = [];
  window.__scribbleSamples = [];
  const sample = () => {
    const path = document.querySelector(".onepercent-loader__scribble path");
    if (path) {
      const offset = Number.parseFloat(path.style.strokeDashoffset);
      if (Number.isFinite(offset))
        window.__scribbleSamples.push([
          performance.now(),
          offset,
          Number.parseFloat(path.style.strokeWidth),
          path.getTotalLength(),
        ]);
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  document.addEventListener("DOMContentLoaded", () =>
    window.__entranceTrace.push(["dom", performance.now()]),
  );
  document.addEventListener("onepercent:entrance-reveal", () =>
    window.__entranceTrace.push(["reveal", performance.now()]),
  );
  document.addEventListener("onepercent:entrance-complete", () =>
    window.__entranceTrace.push(["complete", performance.now()]),
  );
});

const screenshot = async (name) =>
  page.screenshot({ path: `${output}/${name}.png` });
const waitForTitle = async (selector) => {
  await page.waitForFunction(
    (selector) => [...document.querySelectorAll(`${selector} [data-title] .char`)]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      })
      .every((el) => getComputedStyle(el).transform === 'matrix(1, 0, 0, 1, 0, 0)'),
    selector,
    { timeout: 5500 },
  );
  await page.waitForTimeout(160);
};
const scrollTo = async (selector, offset = 95) => {
  await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-smooth'), null, { timeout: 5000 });
  await page.evaluate(
    ({ selector, offset }) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing section ${selector}`);
      window.scrollTo({
        top: window.scrollY + element.getBoundingClientRect().top - offset,
        behavior: "instant",
      });
    },
    { selector, offset },
  );
  await waitForTitle(selector);
};
const section = async (selector, name, offset = 95) => {
  await scrollTo(selector, offset);
  await screenshot(name);
};
const dimensions = () =>
  page.evaluate(() => ({
    viewport: innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    cardWidth: document.querySelector(".product-card")?.getBoundingClientRect().width,
    howCopyTop: document.querySelector(".how-copy")?.getBoundingClientRect().top,
    gachaTop: document.querySelector(".gacha-frame")?.getBoundingClientRect().top,
  }));

async function run() {
  await page.goto(base, { waitUntil: "commit", timeout: 30000 });
  report.initial = await page.evaluate(() => ({
    classes: document.documentElement.className,
    loader: Boolean(document.querySelector(".onepercent-loader")),
    seen: sessionStorage.getItem("onepercent-v2-seen"),
    trace: window.__entranceTrace,
  }));
  await page.waitForFunction(() => window.__scribbleSamples.length > 2, { timeout: 5000 });
  await page.waitForFunction(
    () => window.__entranceTrace.some(([event]) => event === "complete"),
    { timeout: 6000 },
  );
  const trace = await page.evaluate(() => window.__entranceTrace);
  const samples = await page.evaluate(() => window.__scribbleSamples);
  const first = samples[0];
  const last = samples.at(-1);
  report.loaderSamples = { count: samples.length, first, last, trace };
  const scribbleAnimated =
    samples.length > 15 &&
    first[1] >= -1 &&
    last[1] < -last[3] * 0.95 &&
    last[2] < first[2] * 0.35 &&
    last[0] - first[0] > 1600 &&
    last[0] - first[0] < 3500;
  const stamp = (name) => trace.find(([event]) => event === name)?.[1];
  assert.ok(stamp("reveal") && stamp("complete"), "Loader reveal and complete events fire");
  const revealStaggered =
    stamp("complete") - stamp("reveal") > 450 &&
    stamp("complete") - stamp("reveal") < 1200;
  if (!scribbleAnimated || !revealStaggered)
    report.issues.push({
      name: "first-visit loader frame starvation",
      samples: samples.length,
      first,
      last,
      trace,
    });
  await page.waitForFunction(() => !document.documentElement.classList.contains("is-loading"));
  assert.equal(await page.locator(".onepercent-loader").count(), 0);
  pass("first-visit loader observability", {
    trace,
    sampleCount: samples.length,
    first,
    last,
    scribbleAnimated,
    revealStaggered,
  });

  await page.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await waitForTitle('.hero');
  await screenshot("desktop-hero");
  assert.equal(await page.locator(".product-card").count(), 4);
  assert.equal(await page.locator(".accordion details").count(), 4);
  assert.ok((await dimensions()).pageWidth <= 1440, "Desktop has no horizontal overflow");
  pass("page structure and 3D readiness");

  // The opening responds in both directions before the replay button is used.
  await page.evaluate(() =>
    window.scrollTo({ top: document.querySelector(".hero").offsetHeight * 0.45, behavior: "instant" }),
  );
  await page.waitForTimeout(600);
  const openProgress = await page.evaluate(() => window.packReveal.progress);
  assert.ok(openProgress > 0.65, `Opening progresses on scroll: ${openProgress}`);
  await screenshot("desktop-hero-open");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(600);
  const resetProgress = await page.evaluate(() => window.packReveal.progress);
  assert.ok(resetProgress < 0.12, `Opening reverses on scroll: ${resetProgress}`);
  pass("scroll opens and closes pack", { openProgress, resetProgress });

  await section("#packs", "desktop-products");
  const hoverSources = [];
  for (let index = 0; index < 4; index += 1) {
    const card = page.locator(".product-card").nth(index);
    await card.scrollIntoViewIfNeeded();
    const media = card.locator(".product-media");
    await media.hover({ position: { x: 80, y: 120 } });
    await page.waitForTimeout(780);
    const hover = await card.evaluate((element) => {
      const image = element.querySelector(".product-hover");
      const media = element.querySelector(".product-media");
      const rect = media.getBoundingClientRect();
      return {
        source: image.currentSrc || image.src,
        opacity: Number.parseFloat(getComputedStyle(image).opacity),
        drift: media.style.getPropertyValue("--dx"),
        hovered: element.matches(':hover'),
        mediaRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pointerTarget: document.elementFromPoint(rect.x + 80, rect.y + 120)?.className,
      };
    });
    report.hoverDebug ??= [];
    report.hoverDebug.push(hover);
    await screenshot(`desktop-hover-${index + 1}`);
    assert.ok(hover.opacity > 0.95, `Pack ${index + 1} swaps to token scene`);
    assert.ok(hover.source.includes("hover-"), `Pack ${index + 1} has alternate art`);
    hoverSources.push(hover.source);
    await page.mouse.move(0, 0);
  }
  assert.equal(new Set(hoverSources).size, 4, "Four distinct token hover scenes");
  pass("four gold token hover states", hoverSources);

  // The transition must occupy the browser top layer above the modal dialog.
  await page.locator(".product-card").first().click();
  await page.locator(".onepercent-wave--exit:popover-open").waitFor({ state: "visible" });
  await screenshot("detail-wave-exit");
  await page.locator("#pack-detail[open]").waitFor({ state: "visible", timeout: 5000 });
  const covered = await page.evaluate(() => ({
    openWaves: document.querySelectorAll(".onepercent-wave:popover-open").length,
    dialogOpen: document.querySelector("#pack-detail").open,
  }));
  assert.ok(covered.dialogOpen && covered.openWaves >= 1, "Wave remains above modal after showModal");
  await screenshot("detail-wave-covered");
  await page.waitForFunction(() => !document.querySelector(".onepercent-wave"), { timeout: 5000 });
  assert.match(await page.locator("#detail-title").innerText(), /Original/);
  await screenshot("desktop-detail");
  await page.locator(".detail-close").click();
  await page.locator(".onepercent-wave--exit:popover-open").waitFor({ state: "visible" });
  await screenshot("detail-wave-close");
  await page.waitForFunction(
    () => !document.querySelector("#pack-detail").open && !document.querySelector(".onepercent-wave"),
    { timeout: 5000 },
  );
  pass("dialog open and close with wave top layer", covered);

  await page.locator(".accordion details").nth(1).locator("summary").click();
  assert.equal(await page.locator(".accordion details[open]").count(), 2);
  await section("#how", "desktop-how");
  const previousQuote = await page.locator("#quote-title").innerText();
  await page.locator(".next").click();
  await page.waitForTimeout(250);
  assert.notEqual(await page.locator("#quote-title").innerText(), previousQuote);
  await section(".manifesto", "desktop-manifesto");
  await section(".mantra", "desktop-mantra");
  pass("accordion and brand statement interactions");

  const turntable = [];
  await scrollTo(".turntable");
  await page.locator('#spin-stage[data-ready="true"]').waitFor({ timeout: 30000 });
  const targetScroll = (fraction) =>
    page.evaluate((fraction) => {
      const el = document.querySelector(".turntable");
      const rect = el.getBoundingClientRect();
      const start = scrollY + rect.top;
      const clipDistance = rect.height - innerHeight + innerHeight * 0.15;
      const top = start + fraction * clipDistance;
      window.scrollTo({ top, behavior: "instant" });
    }, fraction);
  for (const [index, fraction] of [0, 0.25, 0.5, 0.75, 1].entries()) {
    await targetScroll(fraction);
    await page.waitForFunction((target) => Math.abs(window.spinPack?.progress - target) < 0.035,
      fraction, { timeout: 4000 });
    turntable.push(await page.evaluate(() => window.spinPack.progress));
    await screenshot(`desktop-turntable-${index}`);
  }
  assert.ok(turntable[0] < 0.08 && turntable[2] > 0.42 && turntable[2] < 0.58 && turntable[4] > 0.92);
  assert.equal(await page.locator("#spin-stage canvas").count(), 1);
  pass("3D turntable full cycle", turntable);

  for (const [selector, name] of [
    [".campaign", "desktop-campaign"],
    [".story", "desktop-story"],
    [".ways", "desktop-ways"],
    [".gallery", "desktop-gallery"],
    [".footer", "desktop-footer"],
  ]) await section(selector, name);

  await page.locator(".site-header .replay").click();
  await page.waitForFunction(() => window.packReveal?.progress > 0.92, { timeout: 5000 });
  const whitePepe = await page.evaluate(() =>
    window.packReveal.textures.some((texture) =>
      (texture.image.currentSrc || texture.image.src || "").includes("pepe-all-white.png"),
    ),
  );
  assert.equal(whitePepe, true, "Opening animation uses white Pepe texture");
  await screenshot("desktop-replay-white-pepe");
  pass("white Pepe replay");

  // Same content order and two-up product rail at both mobile widths.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 390) {
      await page.evaluate(() => window.scrollTo({
        top: document.querySelector('.hero').offsetHeight * 0.45,
        behavior: 'instant',
      }));
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await waitForTitle('.hero');
    await page.waitForTimeout(250);
    const layout = await dimensions();
    assert.ok(layout.pageWidth <= width, `No horizontal overflow at ${width}px`);
    assert.ok(
      Math.abs(layout.cardWidth - width / 2) < 3,
      `Two pack cards fit at ${width}px: ${layout.cardWidth}px`,
    );
    await screenshot(`mobile-${width}-hero`);
    await page.locator(".menu-toggle").click();
    assert.equal(await page.locator(".menu-toggle").getAttribute("aria-expanded"), "true");
    await screenshot(`mobile-${width}-menu`);
    await page.locator('#mobile-menu a[href="#packs"]').click();
    assert.equal(await page.locator("#mobile-menu").isVisible(), false);
    await section("#packs", `mobile-${width}-products`);
    const rail = page.locator("#product-grid");
    await rail.evaluate((element) => element.scrollTo({ left: element.clientWidth, behavior: "instant" }));
    await page.waitForTimeout(180);
    assert.equal(await page.locator(".product-dots button.active").count(), 1);
    await screenshot(`mobile-${width}-products-page-2`);
    await scrollTo("#how");
    const order = await dimensions();
    assert.ok(order.howCopyTop < order.gachaTop, "Accordion appears before gacha image on mobile");
    assert.ok(order.howCopyTop >= 0 && order.howCopyTop < 350, 'Mobile how section is in view');
    await screenshot(`mobile-${width}-how`);
    for (const [selector, name] of [
      [".manifesto", "manifesto"],
      [".turntable", "turntable"],
      [".campaign", "campaign"],
      [".story", "story"],
      [".ways", "ways"],
      [".gallery", "gallery"],
      [".footer", "footer"],
    ]) await section(selector, `mobile-${width}-${name}`);
    pass(`mobile ${width}px layout, menu, swipe, sections`, layout);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollTo('#packs');
  await page.locator('.product-card').first().focus();
  await page.keyboard.press('Tab');
  const keyboardFocus = await page.locator('.product-card').nth(1).evaluate((card) => ({
    focused: document.activeElement === card,
    focusVisible: card.matches(':focus-visible'),
    hoverOpacity: Number.parseFloat(getComputedStyle(card.querySelector('.product-hover')).opacity),
  }));
  await page.waitForTimeout(250);
  keyboardFocus.hoverOpacity = await page.locator('.product-card').nth(1).evaluate((card) =>
    Number.parseFloat(getComputedStyle(card.querySelector('.product-hover')).opacity),
  );
  assert.ok(keyboardFocus.focused && keyboardFocus.focusVisible && keyboardFocus.hoverOpacity > 0.95);
  await screenshot('desktop-keyboard-focus');
  pass('keyboard focus reaches packs and exposes alternate art', keyboardFocus);

  const reducedContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(base, { waitUntil: 'domcontentloaded' });
  await reducedPage.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
  assert.equal(await reducedPage.locator('.onepercent-loader').count(), 0);
  assert.equal(await reducedPage.locator('.onepercent-wave').count(), 0);
  await reducedPage.screenshot({ path: `${output}/mobile-reduced-motion.png` });
  await reducedPage.mouse.wheel(0, 500);
  await reducedPage.waitForTimeout(120);
  const reducedScroll = await reducedPage.evaluate(() => ({
    y: scrollY,
    smooth: document.documentElement.classList.contains('lenis-smooth'),
  }));
  assert.ok(reducedScroll.y > 300 && !reducedScroll.smooth, 'Reduced motion uses native wheel scrolling');
  pass('reduced motion skips loader and smooth wheel movement', reducedScroll);
  await reducedContext.close();

  const freshMobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  });
  const freshMobilePage = await freshMobileContext.newPage();
  report.mobileReplayErrors = [];
  freshMobilePage.on('pageerror', (error) => report.mobileReplayErrors.push(error.message));
  await freshMobilePage.goto(`${base}/#home`, { waitUntil: 'domcontentloaded' });
  await freshMobilePage.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 });
  await freshMobilePage.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
  assert.ok((await freshMobilePage.evaluate(() => window.packReveal?.progress)) < 0.05);
  await freshMobilePage.locator('.site-header .replay').click();
  await freshMobilePage.waitForFunction(() => window.packReveal?.progress > 0.95, null, { timeout: 6000 });
  assert.equal(report.mobileReplayErrors.length, 0);
  await freshMobilePage.screenshot({ path: `${output}/mobile-390-fresh-replay-white-pepe.png` });
  pass('fresh mobile header replay opens the white Pepe pack');
  await freshMobileContext.close();

  await page.locator("#replay-intro").click();
  await page.locator(".onepercent-loader").waitFor({ state: "visible", timeout: 5000 });
  await screenshot("desktop-replayed-loader");
  pass("explicit intro replay starts first-visit loader");
}

try {
  await run();
} catch (error) {
  report.failed = error.stack || String(error);
  process.exitCode = 1;
} finally {
  if (report.issues.length || report.pageErrors.length || report.failed)
    process.exitCode = 1;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
