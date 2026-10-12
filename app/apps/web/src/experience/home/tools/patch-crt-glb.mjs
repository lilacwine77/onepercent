/**
 * Swaps the screen texture of the landing's CRT GLB (public/models/onepercent-crt.glb,
 * unchanged at the repository root) for an app-specific broadcast (DA §17.1), keeping
 * every other byte: meshopt geometry, materials and node names. The hero shows the
 * landing's own model and broadcast (render-tv.mjs); this is for when they differ.
 *
 *   node app/apps/web/src/experience/home/tools/patch-crt-glb.mjs <crt-screen.webp>
 *
 * The screen image comes from tools/render-tv.mjs screen and make-assets.py screen.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../../../..");
const source = resolve(repo, "public/models/onepercent-crt.glb");
const output = resolve(
  here,
  "../../../../public/experience/home/onepercent-crt.glb",
);
const screen = readFileSync(process.argv[2]);
const glb = readFileSync(source);
const pad4 = (n) => (n + 3) & ~3;
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
const binStart = 20 + jsonLength + 8;
const bin = glb.subarray(
  binStart,
  binStart + glb.readUInt32LE(20 + jsonLength),
);
const image = json.images.find((item) => item.name === "crt-screen");
const view = json.bufferViews[image.bufferView];
if (view.buffer !== 0 || view.byteOffset !== 0)
  throw new Error("Unexpected screen layout");
const oldEnd = pad4(view.byteLength);
const newEnd = pad4(screen.length);
const delta = newEnd - oldEnd;
for (const item of json.bufferViews) {
  if (item !== view && item.buffer === 0 && (item.byteOffset ?? 0) >= oldEnd)
    item.byteOffset += delta;
  const meshopt = item.extensions?.EXT_meshopt_compression;
  if (meshopt && meshopt.buffer === 0 && (meshopt.byteOffset ?? 0) >= oldEnd)
    meshopt.byteOffset += delta;
}
view.byteLength = screen.length;
const body = Buffer.concat([
  screen,
  Buffer.alloc(newEnd - screen.length),
  bin.subarray(oldEnd, json.buffers[0].byteLength),
]);
json.buffers[0].byteLength = body.length;
let text = JSON.stringify(json);
text += " ".repeat(pad4(text.length) - text.length);
const binPadded = Buffer.concat([
  body,
  Buffer.alloc(pad4(body.length) - body.length),
]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + text.length + 8 + binPadded.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(text.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binPadded.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
writeFileSync(
  output,
  Buffer.concat([header, jsonHeader, Buffer.from(text), binHeader, binPadded]),
);
console.log(
  `onepercent-crt.glb: ${glb.length} → ${12 + 8 + text.length + 8 + binPadded.length} bytes (screen ${view.byteLength})`,
);
