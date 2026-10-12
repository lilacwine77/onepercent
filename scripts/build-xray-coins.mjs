import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPackXraySVG } from '../src/pack-xray.js';

// The coins the pack X-ray reveals, top to bottom. Their logos and sources are
// listed in public/assets/tokens/SOURCES.md. Pass three slugs to try others,
// and `--out <dir>` to write somewhere other than public/assets.
const DEFAULT_COINS = ['wif', 'fone', 'jimothy'];
// A coin face is about 216 px wide in the 1024 px atlas.
const LOGO_PIXELS = 256;

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args.splice(outIndex, 2)[1] : 'public/assets';
const ids = args.length ? args : DEFAULT_COINS;

const coins = await Promise.all(ids.map(async (id) => {
  const logo = sharp(path.resolve('public/assets/tokens', `${id}.webp`)).resize(LOGO_PIXELS, LOGO_PIXELS, { fit: 'cover' });
  const { hasAlpha } = await logo.metadata();
  const [type, data] = hasAlpha
    ? ['png', await logo.png().toBuffer()]
    : ['jpeg', await logo.jpeg({ quality: 92, mozjpeg: true }).toBuffer()];
  return { id, image: `data:image/${type};base64,${data.toString('base64')}` };
}));
const svg = createPackXraySVG(coins);
await writeFile(path.resolve(outDir, 'pack-xray-coins.svg'), svg);
const info = await sharp(Buffer.from(svg))
  .webp({ quality: 90, alphaQuality: 100, effort: 6 })
  .toFile(path.resolve(outDir, 'pack-xray-coins.webp'));
console.log(JSON.stringify({ coins: ids, width: info.width, height: info.height, webpBytes: info.size, svgBytes: Buffer.byteLength(svg) }));
