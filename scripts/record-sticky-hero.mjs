import { chromium } from '@playwright/test';
import { mkdir, rename, writeFile } from 'node:fs/promises';

const output = 'artifacts/v3';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: output, size: { width: 1440, height: 900 } },
  reducedMotion: 'no-preference',
});
await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(process.env.PACK_PREVIEW_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
await page.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${output}/hero-wheel-frame-0.png` });
const samples = [];
for (let step = 1; step <= 9; step += 1) {
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(800);
  const sample = await page.evaluate(() => ({
    scrollY, progress: window.packReveal?.progress,
    frameTop: document.querySelector('.hero-frame').getBoundingClientRect().top,
    frameBottom: document.querySelector('.hero-frame').getBoundingClientRect().bottom,
    productsTop: document.querySelector('#packs').getBoundingClientRect().top,
  }));
  sample.step = step;
  samples.push(sample);
  if ([3, 6, 9].includes(step))
    await page.screenshot({ path: `${output}/hero-wheel-frame-${step}.png` });
}
await page.waitForTimeout(1100);
const video = page.video();
await context.close();
await rename(await video.path(), `${output}/hero-native-wheel.webm`);
await browser.close();
await writeFile(`${output}/hero-native-wheel.json`, JSON.stringify({ samples, errors }, null, 2));
console.log(JSON.stringify({ samples, errors, video: `${output}/hero-native-wheel.webm` }, null, 2));
