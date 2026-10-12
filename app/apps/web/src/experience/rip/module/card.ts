/* eslint-disable */
// Synced from experience/lab/src/rip/card.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import * as THREE from "three";
import { cardFragment, cardVertex } from "./shaders";
import { BLOOM_LAYER, BLOOM_UNIFORM } from "./post";
import type { CardArt } from "./card-art";

export const CARD_W = 1;
export const CARD_H = 1.4;
export const CARD_T = 0.014;

/**
 * Rounded 5:7 card with real thickness and a fine bevel. Triangles are regrouped:
 * group 0 = front face, 1 = back face, 2 = edge. Front/back get 0..1 UVs; the back is
 * mirrored so it reads correctly once the card is turned.
 */
export function createCardGeometry(): THREE.BufferGeometry {
  const w = CARD_W,
    h = CARD_H,
    r = CARD_W * 0.045;
  const shape = new THREE.Shape();
  const x = -w / 2,
    y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const bevel = 0.0028;
  const src = new THREE.ExtrudeGeometry(shape, {
    depth: CARD_T - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 14,
  });
  src.translate(0, 0, -(CARD_T - bevel * 2) / 2);
  const pos = src.getAttribute("position");
  const count = pos.count;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3();
  const buckets: number[][] = [[], [], []];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
    const kind = n.z > 0.999 ? 0 : n.z < -0.999 ? 1 : 2;
    buckets[kind].push(i);
    if (kind === 0) {
      for (const v of [a, b, c]) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
  }
  const P: number[] = [],
    N: number[] = [],
    U: number[] = [];
  const g = new THREE.BufferGeometry();
  let start = 0;
  const srcN = src.getAttribute("normal");
  buckets.forEach((tris, kind) => {
    for (const i of tris) {
      for (let k = 0; k < 3; k++) {
        const vx = pos.getX(i + k),
          vy = pos.getY(i + k),
          vz = pos.getZ(i + k);
        P.push(vx, vy, vz);
        if (kind === 0) N.push(0, 0, 1);
        else if (kind === 1) N.push(0, 0, -1);
        else N.push(srcN.getX(i + k), srcN.getY(i + k), srcN.getZ(i + k));
        const u = (vx - minX) / (maxX - minX),
          v = (vy - minY) / (maxY - minY);
        U.push(kind === 1 ? 1 - u : u, v);
      }
    }
    g.addGroup(start, tris.length * 3, kind);
    start += tris.length * 3;
  });
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  src.dispose();
  return g;
}

export const KEY_DIR = new THREE.Vector3(-0.45, 0.65, 0.62).normalize();

export function canvasTexture(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  renderer: THREE.WebGLRenderer,
  srgb: boolean,
): THREE.Texture {
  const t = new THREE.Texture(canvas as TexImageSource);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function faceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: cardVertex,
    fragmentShader: cardFragment,
    uniforms: {
      uMap: { value: null },
      uMask: { value: null },
      uHolo: { value: 0 },
      uFoil: { value: 1 },
      uShine: { value: -1 },
      uShineAmt: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
      uGlare: { value: 0 },
      uGlintColor: { value: new THREE.Color("#3fe6ff") },
      uGlint: { value: 0 },
      uTime: { value: 0 },
      uDim: { value: 1 },
      uOpacity: { value: 1 },
      uGoldGlow: { value: 0 },
      uBloom: BLOOM_UNIFORM,
      uSharpen: { value: 0.5 },
      uKeyDir: { value: KEY_DIR },
    },
    transparent: true,
    toneMapped: false,
  });
}

let glowTexture: THREE.Texture | null = null;
export function radialTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,.55)");
  g.addColorStop(0.7, "rgba(255,255,255,.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

let shadowTexture: THREE.Texture | null = null;
function softShadowTexture(): THREE.Texture {
  if (shadowTexture) return shadowTexture;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext("2d")!;
  ctx.filter = "blur(18px)";
  ctx.fillStyle = "rgba(38,6,46,1)";
  ctx.beginPath();
  ctx.roundRect(58, 62, 140, 196, 10);
  ctx.fill();
  shadowTexture = new THREE.CanvasTexture(c);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  return shadowTexture;
}

/** A card: `root` carries layout, `flip` the turn (π = face-down), `tilt` the hover. */
export class Card3D {
  root = new THREE.Group();
  tilt = new THREE.Group();
  flip = new THREE.Group();
  mesh: THREE.Mesh;
  front = faceMaterial();
  back = faceMaterial();
  side: THREE.MeshStandardMaterial;
  glow: THREE.Mesh;
  shadow: THREE.Mesh;
  private ownTextures: THREE.Texture[] = [];

  constructor(
    geometry: THREE.BufferGeometry,
    public readonly index: number,
  ) {
    this.side = new THREE.MeshStandardMaterial({
      color: "#d9d2e0",
      metalness: 0.7,
      roughness: 0.32,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(geometry, [this.front, this.back, this.side]);
    this.mesh.name = `RipCard_${index}`;
    this.mesh.renderOrder = 7;
    this.mesh.layers.enable(BLOOM_LAYER);
    this.flip.add(this.mesh);
    this.tilt.add(this.flip);
    this.root.add(this.tilt);
    this.flip.rotation.y = Math.PI;

    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6 * 1.2),
      new THREE.MeshBasicMaterial({
        map: radialTexture(),
        color: "#d5a2f1",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.glow.position.z = -0.08;
    this.glow.renderOrder = 6;
    this.root.add(this.glow);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W * 1.9, CARD_H * 1.65),
      new THREE.MeshBasicMaterial({
        map: softShadowTexture(),
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.shadow.position.set(0.05, -0.08, -0.12);
    this.shadow.renderOrder = 5;
    this.root.add(this.shadow);
  }

  setBack(art: THREE.Texture, mask: THREE.Texture) {
    this.back.uniforms.uMap.value = art;
    this.back.uniforms.uMask.value = mask;
    this.back.uniforms.uHolo.value = 0.42;
  }

  setFace(art: CardArt, renderer: THREE.WebGLRenderer, holo: number) {
    this.disposeOwn();
    const a = canvasTexture(art.art, renderer, true);
    const m = canvasTexture(art.mask, renderer, false);
    this.ownTextures.push(a, m);
    this.front.uniforms.uMap.value = a;
    this.front.uniforms.uMask.value = m;
    this.front.uniforms.uHolo.value = holo;
  }

  /** Faces whose textures are owned by the caller (pre-uploaded during "Cranking…"). */
  setFaceTextures(art: THREE.Texture, mask: THREE.Texture, holo: number) {
    this.disposeOwn();
    this.front.uniforms.uMap.value = art;
    this.front.uniforms.uMask.value = mask;
    this.front.uniforms.uHolo.value = holo;
  }

  setEdge(color: string, metal: number) {
    this.side.color.set(color);
    this.side.metalness = metal;
    this.side.roughness = metal > 0.8 ? 0.24 : 0.4;
  }

  set opacity(v: number) {
    this.front.uniforms.uOpacity.value = v;
    this.back.uniforms.uOpacity.value = v;
    this.side.opacity = v;
    this.mesh.visible = v > 0.001;
  }

  set dim(v: number) {
    this.front.uniforms.uDim.value = v;
    this.back.uniforms.uDim.value = v;
  }

  setShadow(v: number) {
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = v;
  }

  setGlow(opacity: number, color?: string) {
    const m = this.glow.material as THREE.MeshBasicMaterial;
    m.opacity = opacity;
    if (color) m.color.set(color);
  }

  set time(t: number) {
    this.front.uniforms.uTime.value = t;
    this.back.uniforms.uTime.value = t;
  }

  private disposeOwn() {
    this.ownTextures.forEach((t) => t.dispose());
    this.ownTextures = [];
  }

  dispose() {
    this.disposeOwn();
    this.front.dispose();
    this.back.dispose();
    this.side.dispose();
    (this.glow.material as THREE.Material).dispose();
    this.glow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    this.root.removeFromParent();
  }
}
