import sharp from 'sharp';
import { stat } from 'node:fs/promises';
import path from 'node:path';

// Keep generated PNG masters; deliver the same dimensions in a lighter web format.
const names = ['crt-poster','hero-studio-clean','hero-studio','token-bed','gacha-editorial','hover-original','hover-blue','hover-lilac','hover-purple','campaign-hands','pack-closed','pack-first-light','pack-prism','pack-after-hours','pepe-mascot-white','pepe-all-white','pack-3d','pack-silver','pack-anthracite','hover-silver','hover-anthracite','pack-bronze','hover-bronze'];
let sourceBytes = 0, webBytes = 0, images = 0;
const skippedMasters = [];
for (const name of names) {
  const input = path.resolve('public/assets', `${name}.png`);
  const output = path.resolve('public/assets', `${name}.webp`);
  let source;
  try {
    source = await stat(input);
  } catch (error) {
    // The integration kit omits historical studies while retaining active masters.
    if (error.code !== 'ENOENT') throw error;
    skippedMasters.push(name);
    continue;
  }
  await sharp(input).webp({quality:90,alphaQuality:100,effort:6}).toFile(output);
  sourceBytes += source.size;
  webBytes += (await stat(output)).size;
  images += 1;
}
console.log(JSON.stringify({images,skippedMasters,sourceBytes,webBytes,reduction:sourceBytes ? 1-webBytes/sourceBytes : 0},null,2));
