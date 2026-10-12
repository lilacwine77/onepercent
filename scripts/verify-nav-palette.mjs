import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'artifacts/v3';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
const expected = [
  ['The Original', '$10.00', 'pack-silver.webp', 'hover-silver.webp'],
  ['Blue Shift', '$25.00', 'pack-first-light.webp', 'hover-blue.webp'],
  ['Signature', '$50.00', 'pack-closed.webp', 'hover-original.webp'],
  ['After Hours', '$100.00', 'pack-anthracite.webp', 'hover-anthracite.webp'],
];
const report = { samples: [], catalog: [], errors: [], issues: [] };

async function waitForTitle(page, selector) {
  await page.waitForFunction((selector) => [...document.querySelectorAll(`${selector} .char`)]
    .every((char) => getComputedStyle(char).transform === 'matrix(1, 0, 0, 1, 0, 0)'),
  selector, { timeout: 5500 });
}

async function checkAnchor(page, width, trigger, hash, target) {
  await page.locator(trigger).click();
  await page.waitForFunction(({ hash, target }) => {
    if (location.hash !== hash) return false;
    if (hash === '#home') return scrollY < 8;
    const top = document.querySelector(target).getBoundingClientRect().top;
    return top > -50 && top < 200;
  }, { hash, target }, { timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-smooth'),
    null, { timeout: 6000 }).catch(() => {});
  const result = await page.evaluate((target) => ({
    hash: location.hash,
    scrollY,
    targetTop: document.querySelector(target).getBoundingClientRect().top,
    menuHidden: document.querySelector('#mobile-menu').hidden,
  }), target);
  result.width = width;
  result.trigger = trigger;
  report.navigation ??= [];
  report.navigation.push(result);
  if (result.hash !== hash ||
      (hash === '#home' ? result.scrollY > 8 : result.targetTop < -50 || result.targetTop > 200))
    report.issues.push(`${width}px ${trigger}: did not reach ${hash}`);
  return result;
}

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen', '1'));
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push({ width, message: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push({ width, message: message.text() });
    });
    await page.goto(process.env.PACK_PREVIEW_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
    await page.locator('#pack-stage[data-ready="true"]').waitFor({ timeout: 30000 });
    const clipDistance = await page.evaluate(() => {
      const hero = document.querySelector('.hero');
      const frame = document.querySelector('.hero-frame');
      return hero.offsetHeight - frame.offsetHeight + frame.offsetHeight * 0.15;
    });
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), clipDistance * progress);
      await page.waitForFunction((target) => Math.abs(window.packReveal?.target - target) < 0.025,
        progress, { timeout: 4000 });
      const sample = await page.evaluate(() => {
        const header = document.querySelector('.site-header');
        const hit = (selector) => {
          const element = document.querySelector(selector);
          const rect = element.getBoundingClientRect();
          const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return element.contains(top);
        };
        const rect = header.getBoundingClientRect();
        return {
          scrollY,
          progress: window.packReveal?.target,
          headerTop: rect.top,
          headerBottom: rect.bottom,
          fixed: header.classList.contains('is-fixed'),
          wordmarkHit: hit('.site-header .wordmark'),
          controlHit: hit(innerWidth <= 700 ? '.site-header .menu-toggle' : '.desktop-nav a[href="#home"]'),
          pageWidth: document.documentElement.scrollWidth,
        };
      });
      sample.width = width;
      sample.requestedProgress = progress;
      report.samples.push(sample);
      if (!sample.wordmarkHit || !sample.controlHit || sample.headerTop < -2 || sample.pageWidth > width + 2)
        report.issues.push(`${width}px hero ${progress}: navbar hidden, occluded, or page overflowing`);
      if ([0, 0.5, 1].includes(progress))
        await page.screenshot({ path: `${output}/${width}-navbar-${Math.round(progress * 100)}.png` });
    }
    if (width === 390) {
      await page.locator('.site-header .menu-toggle').click();
      const menu = {
        expanded: await page.locator('.menu-toggle').getAttribute('aria-expanded'),
        visible: await page.locator('#mobile-menu').isVisible(),
      };
      report.mobileMenu = menu;
      await page.screenshot({ path: `${output}/390-navbar-menu.png` });
      if (menu.expanded !== 'true' || !menu.visible)
        report.issues.push('Mobile menu does not open over scrolling hero');
      await page.locator('.site-header .menu-toggle').click();
    }

    await page.evaluate(() => document.querySelector('#packs').scrollIntoView({ block: 'start', behavior: 'instant' }));
    await waitForTitle(page, '#products-title');
    const cards = await page.locator('.product-card').evaluateAll((nodes) => nodes.map((card) => ({
      name: card.querySelector('.product-name-price strong')?.textContent.trim(),
      price: card.querySelector('.product-name-price span')?.textContent.trim(),
      primary: card.querySelector('.product-primary')?.getAttribute('src').split('/').at(-1),
      hover: card.querySelector('.product-hover')?.getAttribute('src').split('/').at(-1),
      loaded: card.querySelector('.product-primary')?.naturalWidth > 0,
    })));
    report.catalog.push({ width, cards });
    await page.screenshot({ path: `${output}/${width}-final-catalog.png` });
    if (cards.length !== 4) report.issues.push(`${width}px: expected four product cards`);
    cards.forEach((card, index) => {
      const values = [card.name, card.price, card.primary, card.hover];
      if (values.some((value, position) => value !== expected[index]?.[position]))
        report.issues.push(`${width}px: card ${index + 1} palette/content mismatch`);
      if (width === 1440 && !card.loaded)
        report.issues.push(`Desktop: card ${index + 1} asset failed to load`);
    });

    const footer = () => page.evaluate(() => document.querySelector('.footer').scrollIntoView({ block: 'start', behavior: 'instant' }));
    await footer();
    if (width === 1440) {
      await checkAnchor(page, width, '.desktop-nav a[href="#home"]', '#home', '.hero');
      await page.screenshot({ path: `${output}/1440-nav-home-from-footer.png` });
      await checkAnchor(page, width, '.desktop-nav a[href="#packs"]', '#packs', '#packs');
      await checkAnchor(page, width, '.desktop-nav a[href="#about"]', '#about', '#about');
      await footer();
      await checkAnchor(page, width, '.site-header .wordmark', '#home', '.hero');
    } else {
      await page.locator('.site-header .menu-toggle').click();
      await checkAnchor(page, width, '#mobile-menu a[href="#home"]', '#home', '.hero');
      await page.screenshot({ path: `${output}/390-nav-home-from-footer.png` });
      await footer();
      await checkAnchor(page, width, '.site-header .wordmark', '#home', '.hero');
      for (const [hash, target] of [['#packs', '#packs'], ['#how', '#how'], ['#about', '#about']]) {
        await page.locator('.site-header .menu-toggle').click();
        await checkAnchor(page, width, `#mobile-menu a[href="${hash}"]`, hash, target);
        if (!await page.locator('#mobile-menu').isHidden())
          report.issues.push(`Mobile menu stayed open after ${hash}`);
      }
    }
    await context.close();
  }
} catch (error) {
  report.issues.push(error.stack || String(error));
} finally {
  report.passed = report.issues.length === 0 && report.errors.length === 0;
  await writeFile(`${output}/nav-palette-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
