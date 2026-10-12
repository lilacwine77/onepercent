import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const output = 'artifacts/v4';
const reportPath = `${output}/report.json`;
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
const samples = [], issues = [], errors = [];
try {
  for (const [width, height] of [[320, 640], [1440, 744]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${width}x${height}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${width}x${height}: ${message.text()}`);
    });
    await page.goto(process.env.PACK_PREVIEW_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
    await page.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 });
    const distance = await page.evaluate(() => {
      const track = document.querySelector('.hero'), scene = document.querySelector('.hero-frame');
      return track.offsetHeight - scene.offsetHeight + scene.offsetHeight * .15;
    });
    for (const progress of [0, .5]) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), distance * progress);
      await page.waitForFunction((target) => Math.abs((window.packReveal?.target ?? -1) - target) < .035,
        progress, { timeout: 4500 });
      await page.waitForTimeout(1600);
      const sample = await page.evaluate(() => {
        const box = (selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
            width: rect.width, height: rect.height };
        };
        const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const title = box('.hero-copy h1'), body = box('.hero-copy p'), deposit = box('.hero-deposit');
        const cta = box('.hero-cta'), rip = box('.hero-rip');
        return { scrollY, progress: window.packReveal?.target, title, body, deposit, cta, rip,
          overlap: { titleBody: overlap(title, body), bodyDeposit: overlap(body, deposit),
            depositCta: overlap(deposit, cta), depositRip: overlap(deposit, rip),
            bodyCta: overlap(body, cta), ctaRip: overlap(cta, rip) },
          pageWidth: document.documentElement.scrollWidth };
      });
      sample.viewport = `${width}x${height}`;
      sample.requested = progress;
      samples.push(sample);
      for (const [name, area] of Object.entries(sample.overlap)) {
        if (area > 50) issues.push(`${width}x${height} hero ${progress}: ${name} overlap ${Math.round(area)}px²`);
      }
      if (sample.pageWidth > width + 2) issues.push(`${width}x${height}: page overflow`);
      if (progress === .5) await page.screenshot({ path: `${output}/hero-${width}x${height}-50.png` });
    }
    await context.close();
  }
} finally { await browser.close(); }

report.samples = report.samples.filter((sample) => !['320x640', '1440x744'].includes(sample.viewport)).concat(samples);
report.shortViewportRetest = { passed: issues.length === 0 && errors.length === 0, samples, issues, errors };
report.resolvedIssues = report.issues.filter((entry) => entry.includes('depositRip overlap'));
report.issues = report.issues.filter((entry) => !entry.includes('depositRip overlap')).concat(issues);
report.errors.push(...errors.map((message) => ({ message })));
report.passed = report.issues.length === 0 && report.errors.length === 0;
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, issues: report.issues, errors: report.errors,
  report: reportPath }, null, 2));
if (!report.passed) process.exitCode = 1;
