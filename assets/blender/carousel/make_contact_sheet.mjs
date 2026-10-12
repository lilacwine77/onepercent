import sharp from 'sharp';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = resolve(root, 'artifacts/carousel-volume');
const files = ['fresh-front','fresh-quarter','fresh-back','fresh-left','fresh-right','fresh-top','clay-front','clay-quarter','clay-right'];
const composite = [];
for (let i=0; i<files.length; i++) {
  composite.push({input: await sharp(resolve(dir, `${files[i]}.png`)).resize(384,384).png().toBuffer(), left:(i%3)*384, top:Math.floor(i/3)*416});
  const label = Buffer.from(`<svg width="384" height="32"><rect width="384" height="32" fill="#efe4d9"/><text x="12" y="23" font-family="Arial" font-size="18" fill="#30112d">${files[i]}</text></svg>`);
  composite.push({input:label,left:(i%3)*384,top:Math.floor(i/3)*416+384});
}
await sharp({create:{width:1152,height:1248,channels:4,background:'#efe4d9'}}).composite(composite).png().toFile(resolve(dir, 'contact-sheet.png'));
