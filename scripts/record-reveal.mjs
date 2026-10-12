import { chromium } from '@playwright/test';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('artifacts/motion', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: 'artifacts/motion', size: { width: 1280, height: 900 } },
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:5173');
await page.waitForSelector('[data-ready="true"]');
await page.evaluate(() => document.fonts.ready);
// Exercise the actual scroll integration and its smoothing, then reverse it.
await page.evaluate(() => new Promise(resolve => {
  let start;
  const duration = 13000;
  function frame(time) {
    start ??= time;
    const elapsed = time - start;
    const forward = Math.min(1, Math.max(0, (elapsed - 600) / 6800));
    const backward = Math.min(1, Math.max(0, (elapsed - 8600) / 3500));
    const progress = elapsed < 8600 ? forward : 1 - backward;
    const travel = document.querySelector('#experience').offsetHeight - innerHeight;
    window.scrollTo(0, progress * travel);
    if (elapsed < duration) requestAnimationFrame(frame);
    else resolve();
  }
  requestAnimationFrame(frame);
}));
const video = page.video();
await context.close();
await copyFile(await video.path(), 'artifacts/pepe-reveal.webm');
await browser.close();
console.log('Recorded artifacts/pepe-reveal.webm');
