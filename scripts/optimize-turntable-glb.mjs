import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, weld, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const master = resolve("assets/blender/onepercent-foil-master.glb");
const runtime = resolve("public/models/onepercent-foil.glb");
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });
const document = await io.read(master);
const identity = () => ({
  nodes: document.getRoot().listNodes().map((node) => node.getName()).sort(),
  materials: document.getRoot().listMaterials().map((material) => material.getName()).sort(),
});
const before = identity();
await document.transform(
  dedup({ propertyTypes: ["Accessor", "Texture"] }),
  weld(),
  textureCompress({
    encoder: sharp,
    targetFormat: "webp",
    lossless: true,
    resize: [2048, 2048],
  }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
const after = identity();
if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error("Mesh or material identity changed during optimization.");
}
await io.write(runtime, document);
const [sourceStats, runtimeStats] = await Promise.all([stat(master), stat(runtime)]);
console.log(JSON.stringify({
  master,
  runtime,
  masterBytes: sourceStats.size,
  runtimeBytes: runtimeStats.size,
  encoding: "Meshopt geometry; native resolution lossless WebP textures",
  identity: after,
}, null, 2));
