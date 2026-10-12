import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { stat } from 'node:fs/promises';

const master = 'assets/blender/crt/onepercent-crt-master.glb';
const runtime = 'public/models/onepercent-crt.glb';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});
const document = await io.read(master);
const identity = () => ({
  nodes: document.getRoot().listNodes().map(n => n.getName()).sort(),
  materials: document.getRoot().listMaterials().map(m => m.getName()).sort(),
});
const before = identity();
await document.transform(
  dedup({ propertyTypes: ['Accessor', 'Texture'] }),
  weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [2048, 2048] }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
if (JSON.stringify(before) !== JSON.stringify(identity())) throw new Error('CRT material or node identity changed.');
await io.write(runtime, document);
console.log(JSON.stringify({ master, runtime, masterBytes: (await stat(master)).size,
  runtimeBytes: (await stat(runtime)).size, encoding: 'Meshopt, WebP quality 88 at native 1536×1152',
  identity: identity() }, null, 2));
