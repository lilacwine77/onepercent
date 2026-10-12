import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { createPackUVFitter, fitPackUVs } from '../src/pack-uv-fit.js';

const imagePath = (name) => new URL(`../public/assets/${name}`, import.meta.url);
async function rgba(name) {
  const { data, info } = await sharp(fileURLToPath(imagePath(name))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function sampleAlpha(image, u, v) {
  const x = Math.max(0, Math.min(image.width - 1, u * image.width - .5));
  const y = Math.max(0, Math.min(image.height - 1, (1 - v) * image.height - .5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const p = (px, py) => image.data[(Math.min(image.height - 1, py) * image.width + Math.min(image.width - 1, px)) * 4 + 3];
  return (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy)
    + (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy;
}

function rectangle(width, height, left, top, right, bottom) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) data[(y * width + x) * 4 + 3] = 255;
  return { data, width, height };
}

test('UV fitting preserves artwork orientation, row order and original coordinates', () => {
  const canonical = rectangle(20, 20, 2, 2, 17, 17);
  const edition = rectangle(40, 30, 10, 4, 29, 25);
  const coordinates = [];
  for (const y of [2, 8, 17]) for (const x of [2, 9, 17]) coordinates.push((x + .5) / 20, 1 - (y + .5) / 20);
  const original = new Float32Array(coordinates);
  const mapped = fitPackUVs(original, canonical, edition);
  assert.deepEqual(original, new Float32Array(coordinates));
  for (let row = 0; row < 3; row++) {
    const offset = row * 6;
    assert.ok(mapped[offset] < mapped[offset + 2] && mapped[offset + 2] < mapped[offset + 4]);
    assert.equal(mapped[offset + 1], mapped[offset + 3]);
    if (row > 0) assert.ok(mapped[offset + 1] < mapped[offset - 5]);
  }
  for (let i = 0; i < mapped.length; i += 2) assert.ok(sampleAlpha(edition, mapped[i], mapped[i + 1]) > 254.99);
});

test('browser fitter caches an edition without modifying decoded RGBA buffers', () => {
  const canonical = rectangle(10, 10, 1, 1, 8, 8);
  const edition = rectangle(10, 10, 2, 2, 7, 7);
  const previous = edition.data.slice();
  const fitter = createPackUVFitter(new Float32Array([.5, .5]), canonical);
  assert.equal(fitter('blue', edition), fitter('blue', edition));
  assert.deepEqual(edition.data, previous);
  assert.throws(() => fitPackUVs(new Float32Array([.5, .5]), canonical, rectangle(10, 10, 2, 2, 1, 1)), /no opaque silhouette/);
});

test('all real carousel front vertices stay on printed artwork for each alternate finish', async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read(fileURLToPath(new URL('../public/models/onepercent-carousel.glb', import.meta.url)));
  const original = document.getRoot().listMeshes().find((mesh) => mesh.getName() === 'Printed front').listPrimitives()[0].getAttribute('TEXCOORD_0').getArray();
  const canonical = await rgba('pack-closed.webp');
  for (const name of ['pack-silver.webp', 'pack-first-light.webp', 'pack-anthracite.webp']) {
    const image = await rgba(name);
    const mapped = fitPackUVs(original, canonical, image);
    let originallyTransparent = 0;
    for (let i = 0; i < mapped.length; i += 2) {
      if (sampleAlpha(image, original[i], original[i + 1]) < .08 * 255) originallyTransparent++;
      assert.ok(sampleAlpha(image, mapped[i], mapped[i + 1]) > .08 * 255, `${name}: transparent front vertex ${i / 2}`);
      assert.ok(mapped[i] >= 0 && mapped[i] <= 1 && mapped[i + 1] >= 0 && mapped[i + 1] <= 1);
    }
    assert.ok(originallyTransparent > 100, `${name}: fixture should reproduce the silhouette mismatch`);
  }
});
