import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'artifacts/v3';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
const page = await context.newPage();
const report = { cards: [], errors: [], issues: [] };
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
try {
  await page.goto(process.env.PACK_PREVIEW_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const rect = document.querySelector('#product-grid').getBoundingClientRect();
    window.scrollTo({ top: scrollY + rect.top - 92, behavior: 'instant' });
  });
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => [...document.querySelectorAll('.product-primary')]
    .every((image) => image.complete && image.naturalWidth > 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${output}/catalog-final-desktop.png` });
  const expected = ['hover-silver.webp', 'hover-blue.webp', 'hover-original.webp', 'hover-anthracite.webp'];
  for (let index = 0; index < 4; index += 1) {
    const card = page.locator('.product-card').nth(index);
    await card.locator('.product-media').hover({ position: { x: 80, y: 140 } });
    await page.waitForTimeout(280);
    const state = await card.evaluate((element) => {
      const image = element.querySelector('.product-hover');
      const rect = element.getBoundingClientRect();
      return {
        name: element.querySelector('.product-name-price strong')?.textContent.trim(),
        hover: (image.currentSrc || image.src).split('/').at(-1),
        opacity: Number.parseFloat(getComputedStyle(image).opacity),
        loaded: image.complete && image.naturalWidth > 0,
        cardTop: rect.top,
        cardBottom: rect.bottom,
      };
    });
    report.cards.push(state);
    if (state.hover !== expected[index] || state.opacity < 0.95 || !state.loaded)
      report.issues.push(`Card ${index + 1}: wrong or unloaded hover scene`);
    await page.mouse.move(0, 0);
  }
} catch (error) {
  report.issues.push(error.stack || String(error));
} finally {
  report.passed = report.issues.length === 0 && report.errors.length === 0;
  await writeFile(`${output}/catalog-hover-report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
