import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CRT_STUDIO_FORMAT } from '../src/crt-studio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = resolve(root, argument('--output', 'public/assets/crt-studio-v1.bin.gz'));
const reportPath = resolve(root, argument('--report', 'artifacts/crt-startup-v1/bake-report.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const server = await createServer({ configFile: false, root, resolve: { preserveSymlinks: true },
  optimizeDeps: { noDiscovery: true, include: ['three'] },
  server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
server.middlewares.use('/__bake-crt-studio', (_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><html><body></body></html>');
});
await server.listen();
const address = server.httpServer.address();
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await page.goto(`http://127.0.0.1:${address.port}/__bake-crt-studio`);
  const baked = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { makeCRTStudioScene } = await import('/src/crt-studio.js');
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    const scene = makeCRTStudioScene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const atlas = pmrem.fromScene(scene, .04, .1, 30, { size: 256 });
    const data = new Uint16Array(atlas.width * atlas.height * 4);
    await renderer.readRenderTargetPixelsAsync(atlas, 0, 0, atlas.width, atlas.height, data);
    const bytes = new Uint8Array(data.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const result = { base64: btoa(binary), width: atlas.width, height: atlas.height,
      revision: THREE.REVISION, byteLength: bytes.byteLength };
    scene.traverse(mesh => { if (mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); } });
    atlas.dispose(); pmrem.dispose(); renderer.dispose();
    return result;
  });
  const format = CRT_STUDIO_FORMAT;
  if (baked.width !== format.width || baked.height !== format.height || Number(baked.revision) !== format.threeRevision
      || baked.byteLength !== format.payloadBytes) throw new Error('Three PMREM layout changed; review the loader format before rebaking.');
  const pixels = Buffer.from(baked.base64, 'base64');
  const header = Buffer.alloc(format.headerBytes);
  header.write(format.magic, 0, 'ascii');
  header.writeUInt16LE(format.version, 8); header.writeUInt16LE(format.threeRevision, 10);
  header.writeUInt16LE(format.width, 12); header.writeUInt16LE(format.height, 14);
  header.writeUInt8(format.channels, 16); header.writeUInt8(format.bytesPerChannel, 17);
  header.writeUInt8(1, 18); // RGBA16F little-endian.
  header.writeUInt8(1, 19); // Three CubeUV atlas layout.
  header.writeUInt32LE(format.payloadBytes, 20);
  header.writeUInt32LE(1, 24); // Linear sRGB, without tone mapping.
  const raw = Buffer.concat([header, pixels]);
  const compressed = gzipSync(raw, { level: 9 });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, compressed);
  const report = { output, format, rawBytes: raw.length, compressedBytes: compressed.length,
    payloadSha256: sha256(pixels), assetSha256: sha256(compressed),
    studioSourceSha256: sha256(await readFile(resolve(root, 'src/crt-studio.js'))),
    renderer: 'Chrome headless / ANGLE SwiftShader', generation: 'PMREM.fromScene(studio, .04, .1, 30, { size: 256 })',
    note: 'RGBA16F pixels are lossless; GPU/Three changes require visual comparison before replacing a released bake.' };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
