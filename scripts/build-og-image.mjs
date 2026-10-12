import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { readFile, stat } from 'node:fs/promises';

// Link-preview card (og:image / twitter:image), 1200 × 630: the hero's violet set,
// the 1% wordmark, "Dust in, Packs out." and the CRT poster, composed in Chrome.
const W = 1200, H = 630, SCALE = 2;
const OUTPUT = 'public/assets/og-onepercent.jpg';
const data = async (path, type) => `data:${type};base64,${(await readFile(path)).toString('base64')}`;
const fraunces = await data('node_modules/@fontsource/fraunces/files/fraunces-latin-700-normal.woff2', 'font/woff2');
const backdrop = await data('public/assets/hero-studio-clean.webp', 'image/webp');
const television = await data('public/assets/crt-poster.png', 'image/png');
const html = `<!doctype html><html><head><style>
  @font-face { font-family: Fraunces; font-weight: 700; src: url(${fraunces}) format('woff2'); }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { position: relative; background: #8a5aa6 url(${backdrop}) 38% center / cover; font-family: Fraunces, Georgia, serif;
    color: #fff1e7; -webkit-font-smoothing: antialiased; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, #3d1b4f55, #3d1b4f22 46%, transparent 62%); }
  .tv { position: absolute; width: 760px; height: 760px; left: 502px; top: -50px; }
  .mark { position: absolute; left: 64px; top: 46px; font-size: 76px; font-weight: 700; letter-spacing: -0.11em; line-height: 1;
    transform: rotate(-6deg); transform-origin: left center; }
  .mark span { font-size: .8em; }
  h1 { position: absolute; left: 60px; top: 214px; margin: 0; font-size: 106px; font-weight: 700; letter-spacing: -0.064em;
    line-height: .91; text-shadow: 0 2px 18px #2a0d3a40; }
</style></head><body>
  <div class="shade"></div>
  <img class="tv" src="${television}" alt="">
  <div class="mark">1<span>%</span></div>
  <h1>Dust in,<br>Packs out.</h1>
</body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const fits = await page.evaluate(() => {
    const title = document.querySelector('h1').getBoundingClientRect();
    return { titleRight: Math.round(title.right), titleBottom: Math.round(title.bottom), lines: Math.round(title.height / (106 * .91)) };
  });
  const shot = await page.screenshot({ type: 'png' });
  await sharp(shot).resize(W, H, { kernel: 'lanczos3' })
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(OUTPUT);
  console.log(JSON.stringify({ output: OUTPUT, width: W, height: H, bytes: (await stat(OUTPUT)).size, ...fits }));
} finally {
  await browser.close();
}
