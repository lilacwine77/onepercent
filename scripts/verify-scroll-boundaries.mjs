import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PACK_PREVIEW_URL || 'http://127.0.0.1:5173';
const output = process.env.QA_OUTPUT || 'artifacts/v3';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
const report = { base, gestures: [], boundaries: [], errors: [], issues: [] };

const bounds = async (page, scene, next) => page.evaluate(({ scene, next }) => {
  const box = (selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  };
  return {
    scrollY, viewport: { width: innerWidth, height: innerHeight },
    pageWidth: document.documentElement.scrollWidth,
    scene: box(scene), next: box(next),
  };
}, { scene, next });

try {
  for (const [width, height, wheelSteps] of [[1440, 900, 5], [390, 844, 4]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference' });
    await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push({ width, message: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push({ width, message: message.text() });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 });
    let previousY = 0;
    let previousProgress = 0;
    for (let step = 0; step <= wheelSteps; step += 1) {
      if (step) {
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(1450);
      }
      const sample = await page.evaluate(() => {
        const frame = document.querySelector('.hero-frame').getBoundingClientRect();
        const stage = document.querySelector('#pack-stage').getBoundingClientRect();
        const products = document.querySelector('#packs').getBoundingClientRect();
        return {
          scrollY, progress: window.packReveal?.progress, target: window.packReveal?.target,
          frameTop: frame.top, frameBottom: frame.bottom,
          stageTop: stage.top, stageBottom: stage.bottom,
          productsTop: products.top,
          viewportHeight: innerHeight, pageWidth: document.documentElement.scrollWidth,
        };
      });
      sample.width = width;
      sample.step = step;
      sample.wheelDelta = step ? 300 : 0;
      report.gestures.push(sample);
      if (step === 2 || step === wheelSteps) {
        sample.screenshot = `${width}-wheel-${step}.png`;
        await page.screenshot({ path: `${output}/${sample.screenshot}` });
      }
      if (sample.target < 0.88 &&
          (sample.stageTop < -2 || sample.stageBottom > height + 2 ||
           sample.frameTop < -2 || sample.frameBottom > height + 2))
        report.issues.push(`${width}px wheel step ${step}: frame/stage leaves before 88% of clip`);
      if (sample.pageWidth > width + 2 ||
          (sample.frameTop < -2 && Math.abs(sample.productsTop - sample.frameBottom) > 3))
        report.issues.push(`${width}px wheel step ${step}: horizontal overflow or blank gap during release`);
      if (step && sample.scrollY - previousY < 150)
        report.issues.push(`${width}px wheel step ${step}: 300px wheel failed to advance scroll`);
      if (step && sample.target + 0.025 < previousProgress)
        report.issues.push(`${width}px wheel step ${step}: pack progress reversed during downward scroll`);
      previousY = sample.scrollY;
      previousProgress = sample.target;
    }
    if (report.gestures.filter((entry) => entry.width === width).at(-1).target < 0.72)
      report.issues.push(`${width}px: four/five small wheel steps did not visibly advance the rip`);

    for (const [trackSelector, sceneSelector, nextSelector, name] of [
      ['.hero', '.hero-frame', '#packs', 'hero'],
      ['.turntable', '.turntable-frame', '.campaign', 'turntable'],
    ]) {
      if (name === 'turntable') {
        await page.locator('.turntable').scrollIntoViewIfNeeded();
        await page.locator('#spin-stage[data-ready="true"]').waitFor({ timeout: 30000 });
      }
      const track = await page.evaluate((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { end: scrollY + rect.bottom - innerHeight, viewport: innerHeight };
      }, trackSelector);
      for (const fraction of [0.25, 0.75]) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), track.end + fraction * track.viewport);
        await page.waitForTimeout(250);
        const sample = await bounds(page, sceneSelector, nextSelector);
        sample.width = width;
        sample.track = name;
        sample.exitFraction = fraction;
        sample.gap = sample.next.top - sample.scene.bottom;
        sample.screenshot = `${width}-${name}-exit-${Math.round(fraction * 100)}.png`;
        await page.screenshot({ path: `${output}/${sample.screenshot}` });
        report.boundaries.push(sample);
        if (Math.abs(sample.gap) > 3 || sample.pageWidth > width + 2 ||
            sample.next.top >= height || sample.scene.bottom <= 0)
          report.issues.push(`${width}px ${name} exit ${fraction}: visible blank gap or horizontal overflow`);
      }
    }
    await context.close();
  }
} catch (error) {
  report.issues.push(error.stack || String(error));
} finally {
  report.passed = report.issues.length === 0 && report.errors.length === 0;
  await writeFile(`${output}/boundary-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
