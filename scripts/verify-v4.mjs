import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'artifacts/v4';
await mkdir(output, { recursive: true });
const url = process.env.PACK_PREVIEW_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
const report = { samples: [], carousel: {}, modal: {}, ways: {}, reducedMotion: {}, errors: [], issues: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitWave = (page) => page.waitForFunction(() => !document.querySelector('.onepercent-wave'),
  null, { timeout: 5000 });

function issue(message) { report.issues.push(message); }

async function newPage(width, height, opts = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 700,
    hasTouch: width < 700,
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
  });
  await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push({ width, message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ width, message: message.text() });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 }).catch(() => {});
  return { context, page };
}

async function scrollTo(page, selector, offset = 88) {
  await page.evaluate(({ selector, offset }) => {
    const top = document.querySelector(selector).getBoundingClientRect().top + scrollY - offset;
    scrollTo({ top, behavior: 'instant' });
  }, { selector, offset });
  await sleep(450);
}

async function heroSample(page, width, height, progress) {
  const distance = await page.evaluate(() => {
    const track = document.querySelector('.hero');
    const scene = document.querySelector('.hero-frame');
    return track.offsetHeight - scene.offsetHeight + scene.offsetHeight * .15;
  });
  await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), distance * progress);
  await page.waitForFunction((target) => Math.abs((window.packReveal?.target || 0) - target) < .035,
    progress, { timeout: 4500 }).catch(() => {});
  await sleep(1600);
  const sample = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector), r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        width: r.width, height: r.height, opacity: +getComputedStyle(el).opacity };
    };
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const title = box('.hero-copy h1'), body = box('.hero-copy p'), deposit = box('.hero-deposit');
    const cta = box('.hero-cta'), rip = box('.hero-rip');
    return {
      scrollY, progress: window.packReveal?.target, title, body, deposit, cta, rip,
      overlap: { titleBody: overlap(title, body), bodyDeposit: overlap(body, deposit),
        depositCta: overlap(deposit, cta), depositRip: overlap(deposit, rip), bodyCta: overlap(body, cta) },
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  sample.viewport = `${width}x${height}`;
  sample.requested = progress;
  report.samples.push(sample);
  for (const [name, area] of Object.entries(sample.overlap)) {
    if (area > 50) issue(`${width}x${height} hero ${progress}: ${name} overlap ${Math.round(area)}px²`);
  }
  if (sample.pageWidth > width + 2) issue(`${width}x${height}: horizontal page overflow ${sample.pageWidth}`);
  if (progress === .5) await page.screenshot({ path: `${output}/hero-${width}x${height}-50.png` });
  return sample;
}

async function runMain(width, height) {
  const { context, page } = await newPage(width, height);
  try {
    await heroSample(page, width, height, 0);
    await heroSample(page, width, height, .5);

    await scrollTo(page, '.token-lineup', 140);
    await page.screenshot({ path: `${output}/catalog-${width}x${height}.png` });
    const logoData = await page.locator('.token-group').first().locator('li').evaluateAll(async (nodes) =>
      Promise.all(nodes.map(async (node) => {
        const img = node.querySelector('img'), probe = new Image();
        probe.src = img.src;
        let decoded = true;
        try { await probe.decode(); } catch { decoded = false; }
        return { symbol: node.querySelector('strong').textContent, src: img.getAttribute('src'),
          decoded, width: probe.naturalWidth, height: probe.naturalHeight };
      })));
    report.carousel[width] = { logos: logoData };
    if (logoData.map((row) => row.symbol).join(',') !== 'PONS,BUN,NVDA,AI,UBIK,TSLA,BONER,AAPL,AUR,META')
      issue(`${width}px: wrong token lineup/order`);
    if (logoData.some((row) => !row.decoded || !row.width)) issue(`${width}px: token logo did not decode`);
    if (await page.locator('.token-group').count() !== 2) issue(`${width}px: carousel repeat absent`);

    const window = page.locator('.token-window');
    const current = () => window.evaluate((el) => el.scrollLeft);
    await page.mouse.move(width - 5, 5);
    await sleep(800);
    report.carousel[width].autoState = await page.evaluate(() => {
      const root = document.querySelector('.token-lineup');
      const rect = root.getBoundingClientRect();
      return { hidden: document.hidden, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        hovered: root.matches(':hover'), focused: root.contains(document.activeElement),
        active: document.activeElement?.className || document.activeElement?.tagName,
        top: rect.top, bottom: rect.bottom, scrollY };
    });
    const autoA = await current();
    await sleep(650);
    const autoB = await current();
    report.carousel[width].autoDelta = autoB - autoA;
    if (autoB - autoA < 5) issue(`${width}px: carousel did not move automatically`);

    const holdBox = await window.boundingBox();
    await page.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2);
    await page.mouse.down();
    await sleep(150);
    const pauseA = await current();
    await sleep(500);
    const pauseB = await current();
    report.carousel[width].pauseDelta = pauseB - pauseA;
    if (Math.abs(pauseB - pauseA) > 2) issue(`${width}px: pause did not stop carousel`);
    await page.mouse.up();
    await sleep(200);
    const resumeA = await current();
    await sleep(550);
    const resumeB = await current();
    report.carousel[width].resumeDelta = resumeB - resumeA;
    if (resumeB - resumeA < 5) issue(`${width}px: resume did not restart carousel`);

    await page.locator('.token-next').click();
    await sleep(900);
    const next = await current();
    report.carousel[width].nextPosition = next;
    if (next <= resumeB + 40) issue(`${width}px: Next arrow did not advance`);
    await window.focus();
    await page.keyboard.press('ArrowRight');
    await sleep(900);
    const keyboard = await current();
    report.carousel[width].keyboardPosition = keyboard;
    if (keyboard <= next + 40) issue(`${width}px: keyboard ArrowRight did not advance`);

    if (width < 700) {
      const rect = await window.boundingBox();
      const cdp = await context.newCDPSession(page);
      const y = rect.y + rect.height / 2, x = Math.min(rect.x + rect.width - 45, width - 45);
      const touchStart = await current();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 28, y, id: 1 }] });
        await sleep(35);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(450);
      const touchEnd = await current();
      report.carousel[width].touchDelta = touchEnd - touchStart;
      if (touchEnd - touchStart < 30) issue(`${width}px: native touch swipe did not move carousel`);
    }

    await scrollTo(page, '#product-grid', 120);
    await page.screenshot({ path: `${output}/products-${width}x${height}.png` });
    await page.locator('.product-card').first().click();
    await page.locator('#pack-detail[open]').waitFor({ timeout: 5000 });
    await waitWave(page);
    const product = await page.evaluate(() => ({ title: document.querySelector('#detail-title').textContent,
      action: document.querySelector('.detail-preview > span').textContent,
      description: document.querySelector('#detail-description').textContent }));
    report.modal[`${width}-product`] = product;
    if (product.title !== 'The Original' || !product.action.includes('Preview the opening'))
      issue(`${width}px: product detail title/action incorrect`);
    await page.screenshot({ path: `${output}/product-modal-${width}x${height}.png` });
    await page.locator('.detail-close').click();
    await page.locator('#pack-detail').waitFor({ state: 'hidden', timeout: 5000 });
    await waitWave(page);

    await scrollTo(page, '#ways', 110);
    const ways = await page.locator('.ways-grid .way-card').evaluateAll((nodes) => nodes.map((el) => ({
      title: el.querySelector('h3')?.textContent, width: el.getBoundingClientRect().width,
      imageLoaded: el.querySelector('img')?.complete && el.querySelector('img')?.naturalWidth > 0,
    })));
    report.ways[width] = ways;
    if (ways.length !== 2 || ways.some((item) => !item.imageLoaded || item.width < 100))
      issue(`${width}px: way cards absent or image failed`);
    await page.screenshot({ path: `${output}/ways-${width}x${height}.png` });
    await page.locator('.way-card[data-info="supply"]').click();
    await page.locator('#pack-detail[open]').waitFor({ timeout: 5000 });
    await waitWave(page);
    const supply = await page.evaluate(() => ({ title: document.querySelector('#detail-title').textContent,
      action: document.querySelector('.detail-preview > span').textContent,
      description: document.querySelector('#detail-description').textContent }));
    report.modal[`${width}-supply`] = supply;
    if (supply.title !== 'Deposit in the pool.' || !supply.action.includes('See how packs work'))
      issue(`${width}px: supply modal context/action incorrect`);
    await page.screenshot({ path: `${output}/supply-modal-${width}x${height}.png` });
    await page.locator('#pack-detail').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await sleep(800);
    await page.locator('.detail-preview').click();
    await page.locator('#pack-detail').waitFor({ state: 'hidden', timeout: 5000 });
    await waitWave(page);
    await sleep(1500);
    const howTop = await page.locator('#how').evaluate((el) => el.getBoundingClientRect().top);
    report.modal[`${width}-supply`].howTop = howTop;
    if (howTop < -100 || howTop > 250) issue(`${width}px: supply action did not navigate to #how (${Math.round(howTop)}px)`);
    await scrollTo(page, '#product-grid', 120);
    await page.locator('.product-card').first().click();
    await page.locator('#pack-detail[open]').waitFor({ timeout: 5000 });
    await waitWave(page);
    const reset = await page.locator('.detail-preview > span').first().textContent();
    report.modal[`${width}-reset`] = reset;
    if (!reset.includes('Preview the opening')) issue(`${width}px: pack action not reset after supply modal`);
    await page.locator('.detail-close').click();
    await page.locator('#pack-detail').waitFor({ state: 'hidden', timeout: 5000 });
    await waitWave(page);
  } finally { await context.close(); }
}

try {
  await runMain(1440, 900);
  await runMain(390, 844);
  for (const [width, height] of [[360, 740], [320, 640], [1440, 744]]) {
    const { context, page } = await newPage(width, height);
    try {
      await heroSample(page, width, height, 0);
      await heroSample(page, width, height, .5);
    } finally { await context.close(); }
  }
  const { context, page } = await newPage(390, 844, { reduced: true });
  try {
    await scrollTo(page, '.token-lineup', 140);
    const window = page.locator('.token-window');
    const start = await window.evaluate((el) => el.scrollLeft);
    await sleep(1000);
    const end = await window.evaluate((el) => el.scrollLeft);
    report.reducedMotion = { start, end };
    if (Math.abs(end - start) > 2) issue('Reduced motion carousel moved');
    await page.screenshot({ path: `${output}/reduced-390.png` });
  } finally { await context.close(); }
} catch (error) {
  issue(`QA script aborted: ${error.stack || error.message}`);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify({ issues: report.issues, errors: report.errors, report: `${output}/report.json` }, null, 2));
if (report.issues.length || report.errors.length) process.exitCode = 1;
