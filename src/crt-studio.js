import {
  Color, CubeUVReflectionMapping, DataTexture, DirectionalLight, DoubleSide,
  HalfFloatType, LinearFilter, LinearSRGBColorSpace, Mesh, MeshBasicMaterial,
  PlaneGeometry, RGBAFormat, Scene,
} from 'three';
import { CRT_STUDIO_URL } from './crt-resources.js';

export { CRT_STUDIO_URL };

// The binary stores Three r180's final CubeUV atlas without color conversion.
// Re-bake with scripts/bake-crt-studio.mjs when these cards or its layout change.
export const CRT_STUDIO_FORMAT = Object.freeze({
  magic: 'CRTUV1\0\0', version: 1, threeRevision: 180, headerBytes: 32,
  width: 768, height: 1024, channels: 4, bytesPerChannel: 2,
  payloadBytes: 768 * 1024 * 4 * 2,
});

/** Offline source for the baked atlas. Never convolved in the live viewer. */
export function makeCRTStudioScene() {
  const studio = new Scene();
  studio.background = new Color(0x35303b);
  const card = (color, intensity, width, height, position) => {
    const material = new MeshBasicMaterial({ color, side: DoubleSide, toneMapped: false });
    material.color.multiplyScalar(intensity);
    const mesh = new Mesh(new PlaneGeometry(width, height), material);
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    studio.add(mesh);
  };
  card(0xfff4e8, 3.4, 4, 6, [-4.5, 5, 6]);
  card(0xffffff, 4.0, 1.3, 5.5, [-6, 2.1, 1.8]);
  card(0xffffff, 5.0, 1.0, 7, [5, 1, 5]);
  card(0xe3c4ff, 1.5, 4, 5, [4, 3, -4]);
  card(0xffefd5, 2.0, 4, 2, [-1, -4, 3]);
  return studio;
}

export function makeCRTStudioLights() {
  const key = new DirectionalLight(0xfff5e9, 2.6);
  key.position.set(-3, 6, 5);
  const fill = new DirectionalLight(0xe7d2ff, 0.4);
  fill.position.set(4, 1, 3);
  const rim = new DirectionalLight(0xfff7ec, 1.4);
  rim.position.set(3, 4, -5);
  return [key, fill, rim];
}

async function fetchStudio() {
  const response = await fetch(CRT_STUDIO_URL);
  if (!response.ok) throw new Error(`Could not load CRT studio (${response.status}).`);
  return response.arrayBuffer();
}

/**
 * Decode the exact prefiltered half-float atlas; leave GPU upload to the caller.
 * Accept a prefetched ArrayBuffer promise so network work can start without Three.
 * The CPU pixels remain available for Three's normal context-restoration upload.
 */
export async function loadCRTStudio(renderer, compressedBufferPromise) {
  let buffer = await (compressedBufferPromise ?? fetchStudio());
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('CRT studio must be an ArrayBuffer.');
  const prefix = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  // Static servers can apply Content-Encoding:gzip to .gz files. In that case
  // fetch has already decompressed the payload and it must not be decoded twice.
  if (prefix[0] === 0x1f && prefix[1] === 0x8b) {
    if (typeof DecompressionStream !== 'function') throw new Error('CRT studio gzip decoding is unavailable.');
    buffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const format = CRT_STUDIO_FORMAT;
  if (buffer.byteLength !== format.headerBytes + format.payloadBytes) throw new Error('Invalid CRT studio payload size.');
  const header = new DataView(buffer, 0, format.headerBytes);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 8));
  if (magic !== format.magic || header.getUint16(8, true) !== format.version
      || header.getUint16(10, true) !== format.threeRevision
      || header.getUint16(12, true) !== format.width || header.getUint16(14, true) !== format.height
      || header.getUint8(16) !== format.channels || header.getUint8(17) !== format.bytesPerChannel
      || header.getUint8(18) !== 1 || header.getUint8(19) !== 1
      || header.getUint32(20, true) !== format.payloadBytes || header.getUint32(24, true) !== 1
      || header.getUint32(28, true) !== 0) throw new Error('Invalid CRT studio format.');
  if (renderer?.capabilities?.maxTextureSize < Math.max(format.width, format.height)) throw new Error('CRT studio exceeds this GPU texture size.');
  let data = new Uint16Array(buffer, format.headerBytes, format.payloadBytes / 2);
  // On a big-endian host, honor the binary's explicit little-endian storage.
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    data = Uint16Array.from(data, value => ((value & 255) << 8) | (value >> 8));
  }
  const texture = new DataTexture(data, format.width, format.height, RGBAFormat, HalfFloatType);
  texture.name = 'CRT_Studio_CubeUV_v1';
  texture.mapping = CubeUVReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}
