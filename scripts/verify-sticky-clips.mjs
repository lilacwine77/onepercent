import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PACK_PREVIEW_URL || 'http://127.0.0.1:5173';
const output = process.env.QA_OUTPUT || 'artifacts/v3';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
const report = { base, samples: [], checkpoints: [], reversals: [], exits: [], interactions: [], errors: [], issues: [] };
const tolerance = 2;

async function openPage(width, height = 900, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  if (reducedMotion !== 'reduce') {
    await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
  }
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push({ width, message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ width, message: message.text() });
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

async function setScroll(page, y, spec, expected) {
  await page.evaluate((target) => window.scrollTo({ top: target, behavior: 'instant' }), y);
  if (spec) {
    await page.waitForFunction(({ kind, expected }) => {
      const current = kind === 'hero' ? window.packReveal?.target : window.spinPack?.progress;
      return typeof current === 'number' && Math.abs(current - expected) < 0.025;
    }, { kind: spec.kind, expected }, { timeout: 4000 });
    if (spec.kind === 'hero') {
      await page.waitForFunction((expected) =>
        Math.abs((window.packReveal?.progress ?? 0) - expected) < 0.035,
      expected, { timeout: 4000 });
    }
  } else {
    await page.waitForTimeout(100);
  }
}

async function getTrack(page, selector) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing track ${selector}`);
    const rect = element.getBoundingClientRect();
    const start = scrollY + rect.top;
    const end = scrollY + rect.bottom - innerHeight;
    return { start, end, travel: end - start, height: rect.height, viewport: innerHeight };
  }, selector);
}

async function seekProgress(page, spec, track, target) {
  const y = track.start + target * (track.travel + track.viewport * 0.15);
  await setScroll(page, y, spec, target);
  return y;
}

async function measure(page, spec) {
  return page.evaluate(({ kind, stage, scene, track }) => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    const canHit = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= innerHeight && element.contains(point);
    };
    return {
      kind,
      scrollY,
      viewport: { width: innerWidth, height: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      progress: kind === 'hero' ? window.packReveal?.progress : window.spinPack?.progress,
      target: kind === 'hero' ? window.packReveal?.target : window.spinPack?.progress,
      track: box(track),
      scene: box(scene),
      stage: box(stage),
      navbar: kind === 'hero' ? {
        wordmarkVisible: canHit('.site-header .wordmark'),
        controlVisible: canHit(innerWidth <= 700 ? '.site-header .menu-toggle' : '.desktop-nav a[href="#home"]'),
      } : undefined,
    };
  }, spec);
}

function validateSample(sample, label) {
  const { stage, scene, viewport, pageWidth, kind } = sample;
  if (!stage || !scene) {
    report.issues.push(`${label}: missing stage or sticky scene`);
    return;
  }
  const releasing = (sample.requestedProgress ?? 0) >= 0.98;
  if (!releasing) {
    if (stage.top < -tolerance || stage.bottom > viewport.height + tolerance)
      report.issues.push(`${label}: ${kind} stage clipped vertically (${stage.top.toFixed(1)}–${stage.bottom.toFixed(1)} vs 0–${viewport.height})`);
    if (kind === 'turntable' &&
        (stage.left < -tolerance || stage.right > viewport.width + tolerance))
      report.issues.push(`${label}: turntable stage clipped horizontally (${stage.left.toFixed(1)}–${stage.right.toFixed(1)})`);
    if (scene.top < -tolerance || scene.bottom > viewport.height + tolerance)
      report.issues.push(`${label}: sticky scene does not fill viewport (${scene.top.toFixed(1)}–${scene.bottom.toFixed(1)})`);
  } else if (Math.abs(scene.top + viewport.height * 0.15) > 3) {
    report.issues.push(`${label}: 100% clip should finish 15vh into release (scene top ${scene.top.toFixed(1)})`);
  }
  if (pageWidth > viewport.width + tolerance) {
    report.issues.push(`${label}: document horizontal overflow ${pageWidth - viewport.width}px`);
  }
  if (kind === 'hero' && (!sample.navbar?.wordmarkVisible || !sample.navbar?.controlVisible))
    report.issues.push(`${label}: navbar is hidden or occluded while hero animates`);
}

async function checkTrack(page, width, spec) {
  const track = await getTrack(page, spec.track);
  if (track.travel <= 0) {
    report.issues.push(`${width}px ${spec.kind}: scroll track has no travel`);
    return;
  }
  await setScroll(page, track.start);
  if (spec.kind === 'turntable') {
    await page.locator('#spin-stage[data-ready="true"]').waitFor({ timeout: 30000 });
  }
  for (const fraction of [0.05, 1]) {
    const expected = track.travel * fraction / (track.travel + track.viewport * 0.15);
    await setScroll(page, track.start + track.travel * fraction, spec, expected);
    const sample = await measure(page, spec);
    sample.width = width;
    sample.trackFraction = fraction;
    sample.requestedProgress = expected;
    report.checkpoints.push(sample);
    validateSample(sample, `${width}px ${spec.kind} track ${fraction}`);
    if (Math.abs(sample.target - expected) > 0.03)
      report.issues.push(`${width}px ${spec.kind}: track ${fraction} reached ${sample.target} instead of ${expected}`);
    if (fraction === 0.05 && sample.target <= 0.02)
      report.issues.push(`${width}px ${spec.kind}: initial scroll has an unwanted dead hold`);
    if (fraction === 1 && sample.target >= 0.98)
      report.issues.push(`${width}px ${spec.kind}: animation finishes before sticky release`);
  }

  for (const target of [0.25, 0.5, 0.75, 1]) {
    await seekProgress(page, spec, track, target);
    const sample = await measure(page, spec);
    sample.width = width;
    sample.requestedProgress = target;
    const image = `${width}-${spec.kind}-${Math.round(target * 100)}.png`;
    sample.screenshot = image;
    await page.screenshot({ path: `${output}/${image}` });
    report.samples.push(sample);
    validateSample(sample, `${width}px ${spec.kind} ${Math.round(target * 100)}%`);
    if (Math.abs(sample.target - target) > 0.035)
      report.issues.push(`${width}px ${spec.kind}: seek ${target} reached ${sample.target}`);
  }

  await seekProgress(page, spec, track, 0.25);
  const reverse = await measure(page, spec);
  reverse.width = width;
  report.reversals.push(reverse);
  if (Math.abs(reverse.target - 0.25) > 0.035)
    report.issues.push(`${width}px ${spec.kind}: reverse scroll did not return to 25%`);
  await setScroll(page, track.start, spec, 0);
  const reset = await measure(page, spec);
  reset.width = width;
  report.reversals.push(reset);
  if (reset.target > 0.035)
    report.issues.push(`${width}px ${spec.kind}: reverse scroll did not close/reset`);
  for (const fraction of [0.25, 0.75]) {
    await setScroll(page, track.end + track.viewport * fraction);
    const exit = await page.evaluate(({ next }) => {
      const element = document.querySelector(next);
      const rect = element.getBoundingClientRect();
      return {
        scrollY,
        nextTop: rect.top,
        nextBottom: rect.bottom,
        viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
      };
    }, spec);
    exit.width = width;
    exit.kind = spec.kind;
    exit.trackExitFraction = fraction;
    exit.screenshot = `${width}-${spec.kind}-exit-${Math.round(fraction * 100)}.png`;
    await page.screenshot({ path: `${output}/${exit.screenshot}` });
    report.exits.push(exit);
    if (exit.nextTop > exit.viewportHeight + tolerance || exit.nextBottom < -tolerance)
      report.issues.push(`${width}px ${spec.kind}: blank gap after sticky release at ${fraction}`);
  }
}

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const { context, page } = await openPage(width, height);
    await page.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 });
    await checkTrack(page, width, {
      kind: 'hero', track: '.hero', scene: '.hero-frame', stage: '#pack-stage', next: '#packs',
    });
    await page.locator('.hero-cta').click();
    await page.waitForFunction(() =>
      location.hash === '#packs' && document.querySelector('#packs').getBoundingClientRect().top < innerHeight * 0.3,
    null, { timeout: 5000 }).catch(() => {});
    const anchor = await page.evaluate(() => ({
      hash: location.hash,
      productsTop: document.querySelector('#packs').getBoundingClientRect().top,
    }));
    report.interactions.push({ width, type: 'hero CTA anchor', ...anchor });
    if (anchor.hash !== '#packs' || anchor.productsTop > height * 0.3)
      report.issues.push(`${width}px: hero CTA did not reach packs`);
    await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-smooth'),
      null, { timeout: 5000 });
    await page.locator('.site-header .replay').click();
    await page.waitForFunction(() => scrollY < 10 && window.packReveal?.progress > 0.95,
      null, { timeout: 6000 }).catch(() => {});
    const replay = await page.evaluate(() => ({ scrollY, progress: window.packReveal?.progress }));
    report.interactions.push({ width, type: 'hero replay', ...replay });
    if (replay.scrollY > 10 || replay.progress < 0.95)
      report.issues.push(`${width}px: hero replay did not open pack at page top`);
    await checkTrack(page, width, {
      kind: 'turntable', track: '.turntable', scene: '.turntable-frame', stage: '#spin-stage', next: '.campaign',
    });
    await context.close();
  }

  const { context, page } = await openPage(390, 844, 'reduce');
  await page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
  await page.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 });
  const reducedBefore = await measure(page, {
    kind: 'hero', track: '.hero', scene: '.hero-frame', stage: '#pack-stage',
  });
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(120);
  const reducedAfter = await page.evaluate(() => ({
    scrollY,
    smooth: document.documentElement.classList.contains('lenis-smooth'),
    loader: Boolean(document.querySelector('.onepercent-loader')),
  }));
  report.interactions.push({ width: 390, type: 'reduced motion', before: reducedBefore, after: reducedAfter });
  if (reducedBefore.stage.top < -tolerance || reducedBefore.stage.bottom > 844 + tolerance ||
      reducedAfter.scrollY < 300 || reducedAfter.smooth || reducedAfter.loader)
    report.issues.push('Reduced motion: stage or native wheel gate failed');
  await context.close();
} catch (error) {
  report.issues.push(error.stack || String(error));
} finally {
  report.passed = report.issues.length === 0 && report.errors.length === 0;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, issues: report.issues, errors: report.errors, samples: report.samples.length }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
