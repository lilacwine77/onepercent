import { chromium } from '@playwright/test';
import sharp from 'sharp';

// Run against npm run dev. The poster uses the same camera, materials, lights
// and neutral pose as the live scene, so loading it never changes the product.
const base = process.env.CRT_PREVIEW_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 2 });
  await page.route('**/__crt-poster', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html><head><style>html,body{margin:0;background:transparent}#stage{width:640px;height:640px}</style></head><body><div id="stage"></div></body></html>' }));
  await page.goto(`${base}/__crt-poster`);
  await page.evaluate(async () => {
    const { CRTTelevision } = await import('/src/crt-tv.js');
    const television = new CRTTelevision({ container: document.querySelector('#stage'), reducedMotion: true });
    await television.ready;
    television.stop();
    television.draw(0);
  });
  const png = await page.locator('canvas').screenshot({ omitBackground: true });
  await sharp(png).png().toFile('public/assets/crt-poster.png');
  await sharp(png).webp({ quality: 94, alphaQuality: 100, effort: 6 }).toFile('public/assets/crt-poster.webp');
  console.log('CRT poster: 1280×1280, captured from the neutral live renderer.');
} finally { await browser.close(); }
