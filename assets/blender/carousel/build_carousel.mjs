/** Derive the carousel LOD from the authoritative sculpted Signature master.
 * Run: node assets/blender/carousel/build_carousel.mjs
 * Then: blender --background --factory-startup --python assets/blender/carousel/build_source.py
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, weld, simplifyPrimitive, reorder, textureCompress, getBounds, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const input = resolve(here, '../onepercent-foil-master.glb');
const master = resolve(here, 'onepercent-carousel-master.glb');
const runtime = resolve(root, 'public/models/onepercent-carousel.glb');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const document = await io.read(input);
await document.transform(weld(), dedup({propertyTypes: ['Accessor', 'Texture']}));
const budgets = {'Printed front': 32000, 'Branded reverse': 7200, 'Sealed foil edge': Infinity};
const parts = [];
for (const node of document.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const name = node.getName();
  if (!(name in budgets)) throw new Error(`Unexpected mesh ${name}`);
  mesh.setName(name);
  for (const primitive of mesh.listPrimitives()) {
    const before = primitive.getIndices().getCount()/3;
    if (name === 'Sealed foil edge') {
      // The canonical edge was authored with inward winding and relied on
      // DoubleSide. The derived pouch has an outward-facing physical shell.
      const indices = primitive.getIndices().getArray();
      for (let i=0; i<indices.length; i+=3) {
        [indices[i+1], indices[i+2]] = [indices[i+2], indices[i+1]];
      }
      const normals = primitive.getAttribute('NORMAL').getArray();
      for (let i=0; i<normals.length; i++) normals[i] = -normals[i];
      const tangents = primitive.getAttribute('TANGENT')?.getArray();
      if (tangents) for (let i=3; i<tangents.length; i+=4) tangents[i] = -tangents[i];
    }
    if (Number.isFinite(budgets[name])) {
      // Locked boundaries retain every point shared with the sealed rim.
      // Interior vertices are selected from the existing relief; no luma-based
      // displacement, resculpted proportions, or resized artwork is introduced.
      simplifyPrimitive(primitive, {
        simplifier: MeshoptSimplifier,
        ratio: Math.min(1, budgets[name]/before), error: .0015, lockBorder: true,
      });
    }
    // The original row-based silhouette contains collapsed triangles at its
    // sharp seal tips. Strip only zero-area faces, keeping all visible edges.
    const positions = primitive.getAttribute('POSITION').getArray();
    const indices = primitive.getIndices().getArray();
    const valid = [];
    const uniqueFaces = new Set();
    for (let i=0; i<indices.length; i+=3) {
      const a=indices[i]*3, b=indices[i+1]*3, c=indices[i+2]*3;
      const ux=positions[b]-positions[a], uy=positions[b+1]-positions[a+1], uz=positions[b+2]-positions[a+2];
      const vx=positions[c]-positions[a], vy=positions[c+1]-positions[a+1], vz=positions[c+2]-positions[a+2];
      const area2=Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx);
      const key = [a,b,c].map(offset => `${positions[offset]},${positions[offset+1]},${positions[offset+2]}`).sort().join(';');
      if (area2 > 2e-12 && !uniqueFaces.has(key)) {
        valid.push(indices[i], indices[i+1], indices[i+2]);
        uniqueFaces.add(key);
      }
    }
    primitive.getIndices().setArray(new Uint32Array(valid));
    compactPrimitive(primitive);
    const material = primitive.getMaterial();
    material.setName(name);
    const positionValues = primitive.getAttribute('POSITION').getArray();
    const normalValues = primitive.getAttribute('NORMAL').getArray();
    const edgeNormals = name === 'Sealed foil edge' ? {outward:0,inward:0} : undefined;
    if (edgeNormals) {
      for (let i=0; i<positionValues.length; i+=3) {
        const radialDot = positionValues[i]*normalValues[i] + positionValues[i+1]*normalValues[i+1];
        edgeNormals[radialDot > 0 ? 'outward' : 'inward']++;
      }
      if (edgeNormals.inward) throw new Error('Seal normal points inward after repair.');
    }
    parts.push({name, before, triangles: primitive.getIndices().getCount()/3,
      vertices: primitive.getAttribute('POSITION').getCount(),
      uv: !!primitive.getAttribute('TEXCOORD_0'),
      metalness: material.getMetallicFactor(), roughness: material.getRoughnessFactor(),
      ...(edgeNormals ? {edgeNormals} : {})});
  }
}
const triangles = parts.reduce((sum, part) => sum + part.triangles, 0);
if (triangles > 52000) throw new Error(`LOD exceeds ceiling: ${triangles}`);
await io.write(master, document);
const bounds = getBounds(document.getRoot().getDefaultScene());
await document.transform(
  textureCompress({encoder: sharp, targetFormat: 'webp', lossless: true}),
  reorder({encoder: MeshoptEncoder, target: 'size'}),
);
// Full-precision positions preserve subpixel crimp tips. Default 14-bit
// position quantization collapses those boundary triangles into slivers.
document.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({method: EXTMeshoptCompression.EncoderMethod.QUANTIZE});
await io.write(runtime, document);
// Fresh Blender validation uses decoded runtime geometry and lossless PNG
// containers because Blender's importer cannot read EXT_meshopt directly.
const decoded = await io.read(runtime);
decoded.getRoot().listExtensionsUsed().find(extension => extension.extensionName === 'EXT_meshopt_compression')?.dispose();
await decoded.transform(textureCompress({encoder: sharp, targetFormat: 'png'}));
const evidence = resolve(root, 'artifacts/carousel-volume');
await mkdir(evidence, {recursive: true});
await io.write(resolve(evidence, 'fresh-import.glb'), decoded);
const report = {
  input, master, runtime, triangles, parts, bounds,
  bytes: (await stat(runtime)).size,
  artwork: 'Native canonical 1254x1254 front and reverse; lossless WebP. UVs unchanged.',
  axes: 'glTF: width X; vertical Y; front +Z. Pivot unchanged at origin.',
  finish: 'Existing sculpted puffed foil, raised logo and connected sealed perimeter retained.',
};
await writeFile(resolve(here, 'lod-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
