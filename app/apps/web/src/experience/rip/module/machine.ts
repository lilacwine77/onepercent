/* eslint-disable */
// Synced from experience/lab/src/rip/machine.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { cspGltfLoader } from "../../shared/gltf";
import { C } from "./brand";

/** Height the machine is normalised to, in world units (floor at y = 0). */
export const MACHINE_HEIGHT = 5.4;

/** Render layer of the machine: it can be drawn in its own pass (defocus). */
export const MACHINE_LAYER = 1;

/**
 * The 1% Machine rig, driven through the runtime contract of
 * experience/assets/machine/README.md (also honoured by the primitive stand-in):
 *   Machine_Root            extras: layer_surface_y[n], coins_per_layer[n]
 *   Machine_Crank           clockwise from the front = decreasing rotation.z
 *   Machine_TrayFlap        opens with rotation.x → about −1.1 rad (lower edge swings out)
 *   Machine_CoinLayer_00..N fill level k shows layers 0…k
 *   Machine_Pack_A/_B       position.y = rest + userData.rest_offset_y[k]
 *   Machine_ChuteCavity     the pack is dispensed from here
 *   Machine_Globe, Machine_Slot
 */
export class MachineRig {
  root: THREE.Object3D;
  crank: THREE.Object3D | null;
  flap: THREE.Object3D | null;
  coinLayers: THREE.Object3D[];
  packs: { node: THREE.Object3D; restY: number; offsets: number[] }[] = [];
  packSpawn: THREE.Object3D;
  slot: THREE.Object3D;
  globe: THREE.Object3D;
  source: "glb" | "stand-in";
  /** Coins per layer (fill is linear in coins, as the README advises for a meter). */
  coinsPerLayer: number[];
  private bands: number[];
  private flapAngle: number;
  private crankRest = 0;
  private flapRest = 0;
  private layerRest: THREE.Vector3[] = [];
  private level = -1;

  constructor(root: THREE.Object3D, source: "glb" | "stand-in") {
    this.root = root;
    this.source = source;
    const find = (name: string) => root.getObjectByName(name) ?? null;
    this.crank = find("Machine_Crank");
    this.flap = find("Machine_TrayFlap");
    this.coinLayers = [];
    root.traverse((o) => {
      if (/^Machine_CoinLayer_\d+$/.test(o.name)) this.coinLayers.push(o);
    });
    this.coinLayers.sort((a, b) => a.name.localeCompare(b.name));
    this.layerRest = this.coinLayers.map((l) => l.position.clone());
    const n = this.coinLayers.length;
    const extras = (find("Machine_Root") ?? root).userData as {
      layer_surface_y?: number[];
      coins_per_layer?: number[];
    };
    const surfaces =
      extras.layer_surface_y?.length === n ? extras.layer_surface_y : null;
    this.bands = this.coinLayers.map((_, i) =>
      surfaces
        ? i
          ? surfaces[i] - surfaces[i - 1]
          : surfaces[1] - surfaces[0]
        : 0.17,
    );
    this.coinsPerLayer =
      extras.coins_per_layer?.length === n
        ? extras.coins_per_layer
        : this.coinLayers.map(() => 1);
    for (const name of ["Machine_Pack_A", "Machine_Pack_B"]) {
      const node = find(name);
      const offsets = node?.userData.rest_offset_y as number[] | undefined;
      if (node && offsets?.length === n)
        this.packs.push({ node, restY: node.position.y, offsets });
    }
    this.flapAngle = source === "glb" ? 1.1 : 1.7;
    const anchor = (name: string, fallback: () => THREE.Vector3) => {
      const found = find(name);
      if (found) return found;
      const o = new THREE.Object3D();
      o.name = name;
      o.position.copy(fallback());
      root.add(o);
      return o;
    };
    this.packSpawn = anchor("Machine_PackSpawn", () => {
      // Centre of the chute cavity, a little inside the cabinet.
      const cavity = find("Machine_ChuteCavity");
      root.updateMatrixWorld(true);
      if (cavity) {
        const box = new THREE.Box3().setFromObject(cavity);
        const c = box.getCenter(new THREE.Vector3());
        root.worldToLocal(c);
        return c;
      }
      if (!this.flap) return new THREE.Vector3(0, 0.6, 1.0);
      const p = new THREE.Vector3();
      this.flap.getWorldPosition(p);
      root.worldToLocal(p);
      return p.add(new THREE.Vector3(0, -0.25, -0.25));
    });
    this.slot = anchor("Machine_Slot", () => new THREE.Vector3(0, 1.75, 1.2));
    this.globe = anchor("Machine_Globe", () => new THREE.Vector3(0, 3.7, 0));
    this.crankRest = this.crank?.rotation.z ?? 0;
    this.flapRest = this.flap?.rotation.x ?? 0;
    if (source === "glb") this.polish();
  }

  /**
   * Contact darkening for the coin pile (Cycles gets it from bounce light): each coin is darkened
   * by the coins resting above and around it, as a per-instance colour (warmer in the shadows).
   */
  private bakeCoinOcclusion() {
    const meshes: THREE.InstancedMesh[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh)
        meshes.push(o as THREE.InstancedMesh);
    });
    if (!meshes.length) return;
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const pts: { mesh: THREE.InstancedMesh; i: number; p: THREE.Vector3 }[] =
      [];
    const m = new THREE.Matrix4();
    for (const mesh of meshes) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        const p = new THREE.Vector3()
          .setFromMatrixPosition(m)
          .applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(inv);
        pts.push({ mesh, i, p });
      }
    }
    // Typical coin radius in root space (from the first instance's scale).
    meshes[0].getMatrixAt(0, m);
    const sc = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
    meshes[0].geometry.computeBoundingSphere();
    const r = (meshes[0].geometry.boundingSphere?.radius ?? 0.1) * sc.x * 2.2;
    const c = new THREE.Color();
    for (const a of pts) {
      let occ = 0;
      for (const b of pts) {
        if (a === b) continue;
        const dy = b.p.y - a.p.y;
        if (dy <= 0) continue;
        const d = Math.hypot(b.p.x - a.p.x, dy, b.p.z - a.p.z);
        if (d < r) occ += 1 - d / r;
      }
      const ao = THREE.MathUtils.clamp(1 - occ * 0.34, 0.34, 1);
      c.setRGB(ao, ao * (0.9 + 0.1 * ao), ao * (0.72 + 0.28 * ao));
      a.mesh.setColorAt(a.i, c);
    }
    meshes.forEach((mesh) => {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  /** Runtime look matched to renders/hero.png: livelier glass reflections, slightly warmer coins. */
  private polish() {
    const seen = new Set<THREE.Material>();
    const glassMeshes: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mats = mesh.material;
      for (const m of (Array.isArray(mats)
        ? mats
        : mats
          ? [mats]
          : []) as THREE.MeshStandardMaterial[]) {
        if (m.name === "Machine_GlassMaterial") glassMeshes.push(mesh);
        if (seen.has(m)) continue;
        seen.add(m);
        if (m.name === "Machine_CoinGold") {
          // Warmer gold (no coin-to-coin bounce light in real time), and softer, dimmer highlights:
          // a polished flat coin face mirrors the key softbox as a flat white shape otherwise.
          m.color.multiply(new THREE.Color(1, 0.87, 0.64));
          m.roughness = 1.3;
          m.envMapIntensity = 0.8;
        }
        // Every texture: mipmaps + maximum anisotropy (coins are small and seen at grazing angles).
        for (const t of [
          m.map,
          m.normalMap,
          m.roughnessMap,
          m.metalnessMap,
          m.emissiveMap,
          m.aoMap,
        ]) {
          if (!t) continue;
          t.anisotropy = 16;
          t.generateMipmaps = true;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.needsUpdate = true;
        }
      }
    });
    this.bakeCoinOcclusion();
    // Clear glass without a transmission pass: the coins and packs inside are drawn directly at
    // full resolution (a transmission buffer resamples them and made them soft), and the glass
    // adds only what glass shows on a white set: studio reflections and a fresnel edge.
    for (const mesh of glassMeshes) {
      mesh.material = clearGlassMaterial(THREE.FrontSide);
      mesh.renderOrder = 3;
      const inner = new THREE.Mesh(
        mesh.geometry,
        clearGlassMaterial(THREE.BackSide),
      );
      inner.name = `${mesh.name}_Inner`;
      inner.renderOrder = 2;
      inner.layers.mask = mesh.layers.mask;
      mesh.add(inner);
    }
    // Soft contact shadow under the foot (the Blender renders have a shadow catcher).
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 64, 8, 128, 64, 124);
    g.addColorStop(0, "rgba(44,18,53,.5)");
    g.addColorStop(0.45, "rgba(44,18,53,.22)");
    g.addColorStop(1, "rgba(44,18,53,0)");
    ctx.setTransform(1, 0, 0, 0.5, 0, 32);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    shadow.name = "Machine_ContactShadow";
    shadow.rotation.x = -Math.PI / 2;
    // Foot of the GLB is at y = −2.1 in Machine_Root space.
    shadow.position.set(-0.25, -2.095, 0.15);
    shadow.renderOrder = -5;
    this.root.add(shadow);
  }

  /** Crank angle in radians (positive = clockwise as seen from the front). */
  set crankAngle(a: number) {
    if (this.crank) this.crank.rotation.z = this.crankRest - a;
  }
  /** 0 closed → 1 open. */
  set flapOpen(t: number) {
    if (this.flap) this.flap.rotation.x = this.flapRest - this.flapAngle * t;
  }

  /**
   * Continuous fill in layers: 0 = empty, n = full. Layer i is shown when i < count; the
   * partly drained top layer sinks into the one below (bands are equal-height and every coin
   * rests on its own or lower layers, so nothing floats). The packs settle with the coins.
   */
  set layerCount(count: number) {
    const n = this.coinLayers.length;
    const c = THREE.MathUtils.clamp(count, 0, n);
    if (Math.abs(c - this.level) < 1e-4) return;
    this.level = c;
    this.coinLayers.forEach((l, i) => {
      const k = THREE.MathUtils.clamp(c - i, 0, 1);
      l.visible = k > 0.08;
      l.position.y = this.layerRest[i].y - (1 - k) * this.bands[i] * 1.1;
      if (this.source === "stand-in") l.scale.setScalar(0.6 + 0.4 * k);
    });
    // Level index k = c − 1 ("show layers 0…k"); interpolate the packs' rest offsets.
    const kf = THREE.MathUtils.clamp(c - 1, 0, n - 1);
    const k0 = Math.floor(kf),
      k1 = Math.min(n - 1, k0 + 1),
      f = kf - k0;
    const below = c < 1 ? (1 - c) * this.bands[0] : 0;
    for (const p of this.packs) {
      p.node.position.y =
        p.restY + THREE.MathUtils.lerp(p.offsets[k0], p.offsets[k1], f) - below;
    }
  }

  /** 0..1 fill, linear in coins (not in height). */
  set fill(level: number) {
    this.layerCount = this.layersForFill(level);
  }

  layersForFill(level: number): number {
    const counts = this.coinsPerLayer;
    const total = counts.reduce((a, b) => a + b, 0);
    let target = THREE.MathUtils.clamp(level, 0, 1) * total;
    for (let i = 0; i < counts.length; i++) {
      if (target <= counts[i]) return i + target / counts[i];
      target -= counts[i];
    }
    return counts.length;
  }

  /** Small jiggle of the coins while cranking. */
  jiggle(t: number, amount: number) {
    this.coinLayers.forEach((l, i) => {
      l.position.x =
        this.layerRest[i].x + Math.sin(t * 31 + i * 1.7) * 0.006 * amount;
      l.rotation.y = Math.sin(t * 23 + i) * 0.012 * amount;
    });
  }

  /** The coin mesh used inside the globe (geometry, material, per-instance scale), for particles. */
  coinPrototype(): {
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    scale: number;
  } | null {
    let found: THREE.InstancedMesh | null = null;
    this.root.traverse((o) => {
      if (!found && (o as THREE.InstancedMesh).isInstancedMesh)
        found = o as THREE.InstancedMesh;
    });
    if (!found) return null;
    const mesh = found as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const s = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    const world = new THREE.Vector3();
    mesh.getWorldScale(world);
    return {
      geometry: mesh.geometry,
      material: mesh.material,
      scale: s.x * world.x,
    };
  }

  worldOf(o: THREE.Object3D): THREE.Vector3 {
    const v = new THREE.Vector3();
    o.getWorldPosition(v);
    return v;
  }
}

/**
 * Thin clear glass: black base (no diffuse), physical reflections of the studio environment and
 * a fresnel rim, composited premultiplied (reflections add, the wall darkens only a little).
 */
export function clearGlassMaterial(
  side: THREE.Side,
): THREE.MeshPhysicalMaterial {
  const back = side === THREE.BackSide;
  const m = new THREE.MeshPhysicalMaterial({
    name: back ? "Machine_GlassInner" : "Machine_GlassClear",
    color: 0x000000,
    metalness: 0,
    roughness: back ? 0.2 : 0.11,
    clearcoat: 0,
    envMapIntensity: back ? 0.3 : 0.7,
    specularIntensity: 1,
    ior: 1.5,
    side,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      float glassNdv = abs(dot(normalize(normal), normalize(vViewPosition)));
      float glassRim = pow(1.0 - glassNdv, 3.0);
      // Only the bright studio cards read in the reflection, as soft veils that roll off
      // smoothly (never a clipped white shape): the coins always stay visible through them.
      // The blend is a true mix toward a pale studio white in display space (premultiplied, not
      // tone mapped): a reflection can veil a coin, never clip it to a flat white shape.
      float glassL = max(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) - 0.05, 0.0);
      float glassA = ${back ? "0.22" : "0.5"} * (1.0 - exp(-glassL * 1.8)) + glassRim * ${back ? "0.05" : "0.13"};
      glassA = clamp(glassA, 0.0, ${back ? "0.25" : "0.56"});
      vec3 glassVeil = vec3(0.98, 0.96, 1.0) * glassA;
      outgoingLight = pow(glassVeil, vec3(2.2));
      float glassOut = glassA;
      gl_FragColor = vec4(outgoingLight, glassOut);`,
    );
  };
  m.customProgramCacheKey = () =>
    back ? "rip-clear-glass-back" : "rip-clear-glass-front";
  return m;
}

/**
 * Loads the machine: binary glTF (.glb) or JSON glTF (.gltf / .gltf.json with embedded data URIs,
 * for static hosts that cannot serve .glb). The payload is sniffed (dev servers answer 200 with
 * index.html for missing files); anything else is reported and returns null.
 */
export async function loadMachineGLB(
  url: string,
): Promise<THREE.Object3D | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(
        `[rip] machine not found at ${url} (${res.status}): using the stand-in.`,
      );
      return null;
    }
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(64, buf.byteLength));
    const isBinary =
      buf.byteLength >= 12 &&
      head[0] === 0x67 &&
      head[1] === 0x6c &&
      head[2] === 0x54 &&
      head[3] === 0x46; // "glTF"
    const firstChar = [...head].find(
      (c) =>
        c !== 0x20 &&
        c !== 0x0a &&
        c !== 0x0d &&
        c !== 0x09 &&
        c !== 0xef &&
        c !== 0xbb &&
        c !== 0xbf,
    );
    const isJSON = !isBinary && firstChar === 0x7b; // "{"
    if (!isBinary && !isJSON) {
      console.error(
        `[rip] ${url} is neither binary nor JSON glTF: using the stand-in.`,
      );
      return null;
    }
    const loader = cspGltfLoader();
    const base = new URL(".", new URL(url, document.baseURI)).href;
    const gltf = await loader.parseAsync(
      isBinary ? buf : new TextDecoder().decode(buf),
      base,
    );
    const root = gltf.scene.getObjectByName("Machine_Root") ?? gltf.scene;
    const holder = new THREE.Group();
    holder.name = "Machine_Holder";
    // Contract: height 4.2, origin at the centre of the bounds (foot at y = −2.1).
    // Keep every decoded node matrix (quantised geometry); only the holder is scaled.
    const height = Number((root.userData as { height?: number }).height) || 4.2;
    const s = MACHINE_HEIGHT / height;
    gltf.scene.scale.setScalar(s);
    gltf.scene.position.y = (height / 2) * s;
    holder.add(gltf.scene);
    return holder;
  } catch (err) {
    console.error(
      "[rip] machine glTF failed to load: using the stand-in.",
      err,
    );
    return null;
  }
}

export interface StudioOptions {
  /** Overall gain on the light cards (calibrated against renders/hero.png). */
  gain?: number;
  /** Ambient ("world") colour and strength, as in the Blender rig. */
  world?: [number, number, number];
  worldStrength?: number;
  /** Show the black flags in reflections (as the Blender rig does). */
  flags?: boolean;
  /** Cubemap face size of the PMREM source (crisper reflections at 512). */
  size?: number;
}

/**
 * The asset's Blender studio (build_machine.py: five area lights, a cool world at 0.32 and two
 * black flags seen only in reflections) rebuilt as lightformers and prefiltered with PMREM.
 * Blender (x, y, z) → three (x, z, −y). Each area light becomes an emissive card facing the
 * machine with radiance ≈ power / (π · area) × gain. Calibrated with machine-check.html against
 * renders/hero.png (AgX, exposure 1.0).
 */
export function machineEnvironment(
  renderer: THREE.WebGLRenderer,
  opts: StudioOptions = {},
): THREE.Texture {
  const gain = opts.gain ?? 1.5;
  const studio = new THREE.Scene();
  // Blender's world is a cool (.64, .69, .78); it is warmed here because three.js has no
  // coin-to-coin interreflections, which is what keeps the coins gold in Cycles.
  const w = opts.world ?? [0.82, 0.74, 0.68];
  const ws = opts.worldStrength ?? 0.32;
  studio.background = new THREE.Color(w[0] * ws, w[1] * ws, w[2] * ws);
  const geos: THREE.BufferGeometry[] = [];
  const add = (
    b: [number, number, number],
    power: number,
    sx: number,
    sy: number,
    color: [number, number, number],
    ellipse = false,
  ) => {
    const pos = new THREE.Vector3(b[0], b[2], -b[1]);
    const area = ellipse ? Math.PI * (sx / 2) * (sy / 2) : sx * sy;
    const L = (power / (Math.PI * area)) * gain;
    const g = ellipse
      ? new THREE.CircleGeometry(0.5, 64)
      : new THREE.PlaneGeometry(1, 1);
    geos.push(g);
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color[0] * L, color[1] * L, color[2] * L),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.scale.set(sx, sy, 1);
    mesh.position.copy(pos);
    mesh.lookAt(0, 0, 0);
    studio.add(mesh);
  };
  add([-4.2, -5.6, 6.2], 1300, 5, 4, [1, 0.89, 0.77], true); // Machine_KeySoftbox
  add([5.4, -2.6, 2.4], 820, 2, 6.5, [0.79, 0.86, 1]); // Machine_RightStrip
  add([1.2, 4.6, 5.0], 1250, 4, 3, [1, 0.93, 0.8]); // Machine_RearRim
  add([-1.0, -6.4, 2.8], 180, 4, 0.75, [1, 1, 1], true); // Machine_Catchlight
  add([-5.2, -1.2, 1.2], 380, 1.2, 6, [1, 0.95, 0.9]); // Machine_LeftStrip
  if (opts.flags ?? true) {
    // Studio_FlagL / Studio_FlagR: dark vertical cards that give brass and glass their edges.
    for (const [b, size, rz] of [
      [[-4.2, -3.5, 0.5], [3.0, 7], -50],
      [[4.6, -2.2, 0.5], [2.4, 7], 62],
    ] as const) {
      const g = new THREE.PlaneGeometry(size[0], size[1]);
      geos.push(g);
      const flag = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color: 0x020203,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      flag.position.set(b[0], b[2], -b[1]);
      flag.rotation.y = THREE.MathUtils.degToRad(rz);
      studio.add(flag);
    }
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(studio, 0, 0.1, 100, {
    size: opts.size ?? 512,
  }).texture;
  pmrem.dispose();
  geos.forEach((g) => g.dispose());
  studio.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) (m.material as THREE.Material).dispose();
  });
  return env;
}

/** makeCRTStudioLights() (repo/src/crt-studio.js), unchanged. */
export function machineLights(): THREE.DirectionalLight[] {
  const key = new THREE.DirectionalLight(0xfff5e9, 2.6);
  key.position.set(-3, 6, 5);
  const fill = new THREE.DirectionalLight(0xe7d2ff, 0.4);
  fill.position.set(4, 1, 3);
  const rim = new THREE.DirectionalLight(0xfff7ec, 1.4);
  rim.position.set(3, 4, -5);
  return [key, fill, rim];
}

function canvasTex(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  srgb = true,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Brushed brass plate with engraved "ONEPERCENT", a coin slot and a hairline frame. */
function plateTexture(
  label: string,
  slot: boolean,
  W = 1024,
  H = 640,
): THREE.CanvasTexture {
  return canvasTex(W, H, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#f3d27e");
    g.addColorStop(0.35, "#d9a441");
    g.addColorStop(0.62, "#f6d98e");
    g.addColorStop(1, "#b07a26");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Brushing
    let seed = 9;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < H; i += 2) {
      ctx.fillStyle = `rgba(${rnd() > 0.5 ? "255,245,210" : "120,80,20"},${0.04 + rnd() * 0.05})`;
      ctx.fillRect(0, i, W, 1);
    }
    ctx.strokeStyle = "rgba(58,34,8,.55)";
    ctx.lineWidth = 6;
    ctx.strokeRect(20, 20, W - 40, H - 40);
    if (label) {
      ctx.fillStyle = "rgba(58,34,8,.82)";
      ctx.font = `500 ${Math.round(H * 0.36)}px "DM Sans", sans-serif`;
      (ctx as unknown as { letterSpacing: string }).letterSpacing =
        `${Math.round(H * 0.11)}px`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, W / 2 + H * 0.055, H * 0.47);
      ctx.fillStyle = "rgba(255,240,200,.45)";
      ctx.fillText(label, W / 2 + H * 0.055, H * 0.47 + 3);
      ctx.fillStyle = "rgba(58,34,8,.5)";
      ctx.fillRect(W * 0.33, H * 0.74, W * 0.34, 3);
    }
    if (slot) {
      ctx.fillStyle = "#2a1408";
      ctx.beginPath();
      ctx.roundRect(487, 260, 50, 150, 22);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,240,200,.5)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // Screws
    for (const [x, y] of slot
      ? [
          [70, 70],
          [W - 70, 70],
          [70, H - 70],
          [W - 70, H - 70],
        ]
      : []) {
      const sg = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, 20);
      sg.addColorStop(0, "#fff2c8");
      sg.addColorStop(1, "#8a5a16");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(58,34,8,.7)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 11, y - 4);
      ctx.lineTo(x + 11, y + 4);
      ctx.stroke();
    }
  });
}

/** Coin face with an engraved "%" (the gold coins of gacha-editorial.png). */
export function coinFaceTexture(): THREE.CanvasTexture {
  return canvasTex(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(100, 90, 10, 128, 128, 140);
    g.addColorStop(0, "#fff0b8");
    g.addColorStop(0.5, "#e2b04c");
    g.addColorStop(1, "#a8701f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "rgba(90,56,10,.55)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(90,56,10,.6)";
    ctx.font = '700 150px "Fraunces", Georgia, serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("%", 128, 136);
    ctx.fillStyle = "rgba(255,246,214,.55)";
    ctx.fillText("%", 126, 132);
  });
}

export interface MachineMaterials {
  paint: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshStandardMaterial;
  glass: THREE.ShaderMaterial;
  glassBack: THREE.ShaderMaterial;
  dark: THREE.MeshStandardMaterial;
  coinSide: THREE.MeshStandardMaterial;
  coinFace: THREE.MeshStandardMaterial;
}

/** Studio glass on a light set: fresnel body, two softbox reflections, a lilac rim. Cheaper and
 * more legible on cream than physical transmission (which needs an opaque background). */
export function glassMaterial(side: THREE.Side): THREE.ShaderMaterial {
  const back = side === THREE.BackSide;
  return new THREE.ShaderMaterial({
    side,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
    uniforms: { uBack: { value: back ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBack;
      varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vP);
        if (uBack > 0.5) N = -N;
        float ndv = abs(dot(N, V));
        float fres = pow(1.0 - ndv, 2.4);
        vec3 R = reflect(-V, N);
        // Two tall studio softboxes reflected as soft rectangles (not round blobs).
        vec2 d1 = abs(R.xy - vec2(-0.52, 0.32)) - vec2(0.06, 0.24);
        vec2 d2 = abs(R.xy - vec2(0.58, 0.18)) - vec2(0.035, 0.16);
        float front = smoothstep(0.1, 0.4, R.z);
        float box1 = (1.0 - smoothstep(0.0, 0.05, max(d1.x, d1.y))) * front;
        float box2 = (1.0 - smoothstep(0.0, 0.04, max(d2.x, d2.y))) * front * 0.8;
        float strip = exp(-pow((R.x + 0.42) / 0.035, 2.0)) * smoothstep(-0.1, 0.5, R.y) * (1.0 - uBack);
        vec3 col = mix(vec3(1.0, 0.985, 1.0), vec3(0.86, 0.74, 0.97), fres);
        float a = 0.06 + fres * 0.62 + box1 * 0.85 + box2 * 0.6 + strip * 0.55;
        a *= uBack > 0.5 ? 0.5 : 1.0;
        col += (box1 + box2 + strip) * 0.3;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function machineMaterials(): MachineMaterials {
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color: "#9a82b6",
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.24,
      envMapIntensity: 0.45,
    }),
    brass: new THREE.MeshStandardMaterial({
      color: "#e0ad4f",
      metalness: 1,
      roughness: 0.24,
    }),
    glass: glassMaterial(THREE.FrontSide),
    glassBack: glassMaterial(THREE.BackSide),
    dark: new THREE.MeshStandardMaterial({
      color: C.plum,
      roughness: 0.85,
      metalness: 0.1,
    }),
    coinSide: new THREE.MeshStandardMaterial({
      color: "#d9a441",
      metalness: 1,
      roughness: 0.3,
    }),
    coinFace: new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: coinFaceTexture(),
      metalness: 1,
      roughness: 0.28,
    }),
  };
}

/** Lilac cabinet, brass trim, glass globe of gold "%" coins (gacha-editorial.png, simplified). */
export function buildStandInMachine(
  mats: MachineMaterials,
  layers = 6,
): THREE.Group {
  const root = new THREE.Group();
  root.name = "Machine_Root";
  const add = (
    mesh: THREE.Mesh,
    name: string,
    parent: THREE.Object3D = root,
  ) => {
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };

  // Plinth
  const plinth = add(
    new THREE.Mesh(
      new THREE.CylinderGeometry(1.34, 1.42, 0.24, 72),
      mats.paint,
    ),
    "Machine_Plinth",
  );
  plinth.position.y = 0.12;
  const ringLow = add(
    new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.035, 12, 96), mats.brass),
    "Machine_PlinthRing",
  );
  ringLow.rotation.x = Math.PI / 2;
  ringLow.position.y = 0.245;

  // Cabinet (lathe)
  const profile = [
    new THREE.Vector2(0, 0.24),
    new THREE.Vector2(1.24, 0.24),
    new THREE.Vector2(1.25, 0.32),
    new THREE.Vector2(1.2, 1.2),
    new THREE.Vector2(1.13, 2.2),
    new THREE.Vector2(1.1, 2.36),
    new THREE.Vector2(1.04, 2.44),
    new THREE.Vector2(0, 2.44),
  ];
  add(
    new THREE.Mesh(new THREE.LatheGeometry(profile, 96), mats.paint),
    "Machine_Cabinet",
  );

  // Collar
  const collar = add(
    new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.14, 0.22, 96), mats.brass),
    "Machine_Collar",
  );
  collar.position.y = 2.53;
  const collarLip = add(
    new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.04, 12, 96), mats.brass),
    "Machine_CollarLip",
  );
  collarLip.rotation.x = Math.PI / 2;
  collarLip.position.y = 2.645;

  // Globe
  const globeR = 1.3,
    globeY = 2.64 + globeR * 0.86;
  const globeGeo = new THREE.SphereGeometry(globeR, 72, 48);
  const globeBack = add(
    new THREE.Mesh(globeGeo, mats.glassBack),
    "Machine_GlobeGlassInner",
  );
  globeBack.position.y = globeY;
  globeBack.renderOrder = 2;
  const globe = add(new THREE.Mesh(globeGeo, mats.glass), "Machine_GlobeGlass");
  globe.position.y = globeY;
  globe.renderOrder = 3;
  const globeAnchor = new THREE.Object3D();
  globeAnchor.name = "Machine_Globe";
  globeAnchor.position.set(0, globeY, 0);
  root.add(globeAnchor);

  // Cap
  const cap = add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.7, 0.16, 72), mats.brass),
    "Machine_Cap",
  );
  cap.position.y = globeY + globeR * 0.94;
  const dome = add(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      mats.brass,
    ),
    "Machine_Dome",
  );
  dome.position.y = cap.position.y + 0.08;
  dome.scale.y = 0.45;
  const knob = add(
    new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 16), mats.brass),
    "Machine_Knob",
  );
  knob.position.y = dome.position.y + 0.3;

  // A domed pile of gold "%" coins in the bottom of the globe, in layers (fill level).
  const coinGeo = new THREE.CylinderGeometry(0.165, 0.165, 0.036, 32);
  const coinMats = [mats.coinSide, mats.coinFace, mats.coinFace];
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const floorY = globeY - globeR * 0.84;
  const pileH = globeR * 0.78;
  const dh = pileH / layers;
  for (let l = 0; l < layers; l++) {
    const yMid = floorY + (l + 0.5) * dh;
    const rSphere =
      Math.sqrt(Math.max(0, globeR * globeR - (yMid - globeY) ** 2)) - 0.16;
    const mats4: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      e = new THREE.Euler(),
      p = new THREE.Vector3(),
      sc = new THREE.Vector3(1, 1, 1);
    for (let tries = 0; tries < 900 && mats4.length < 70; tries++) {
      const a = rnd() * Math.PI * 2,
        r = Math.sqrt(rnd()) * rSphere;
      // Dome: the pile is higher in the middle.
      const top = pileH * (1 - 0.42 * Math.pow(r / Math.max(rSphere, 0.01), 2));
      const y = (l + rnd()) * dh;
      if (y > top) continue;
      p.set(Math.cos(a) * r, y - (l + 0.5) * dh, Math.sin(a) * r);
      const steep = rnd() > 0.85;
      e.set(
        (rnd() - 0.5) * (steep ? 2.2 : 0.55),
        rnd() * Math.PI * 2,
        (rnd() - 0.5) * (steep ? 2.2 : 0.55),
      );
      q.setFromEuler(e);
      m.compose(p, q, sc);
      mats4.push(m.clone());
    }
    const mesh = new THREE.InstancedMesh(
      coinGeo,
      coinMats,
      Math.max(1, mats4.length),
    );
    mats4.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.name = `Machine_CoinLayer_${String(l).padStart(2, "0")}`;
    mesh.position.y = yMid;
    root.add(mesh);
  }

  // Name plate + slot plate
  const namePlate = add(
    new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.26, 0.05), [
      mats.brass,
      mats.brass,
      mats.brass,
      mats.brass,
      new THREE.MeshStandardMaterial({
        map: plateTexture("ONEPERCENT", false, 1024, 266),
        metalness: 1,
        roughness: 0.3,
      }),
      mats.brass,
    ]),
    "Machine_NamePlate",
  );
  namePlate.position.set(0, 2.08, 1.12);
  namePlate.rotation.x = -0.035;
  const slotPlate = add(
    new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.92, 0.06), [
      mats.brass,
      mats.brass,
      mats.brass,
      mats.brass,
      new THREE.MeshStandardMaterial({
        map: plateTexture("", true, 1024, 980),
        metalness: 1,
        roughness: 0.28,
      }),
      mats.brass,
    ]),
    "Machine_SlotPlate",
  );
  slotPlate.position.set(0, 1.42, 1.19);
  slotPlate.rotation.x = -0.05;
  const slot = new THREE.Object3D();
  slot.name = "Machine_Slot";
  slot.position.set(0, 1.55, 1.3);
  root.add(slot);

  // Crank
  const crank = new THREE.Group();
  crank.name = "Machine_Crank";
  crank.position.set(0, 1.28, 1.25);
  crank.rotation.x = -0.05;
  root.add(crank);
  const hub = add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.1, 64), mats.brass),
    "Machine_CrankHub",
    crank,
  );
  hub.rotation.x = Math.PI / 2;
  const handle = add(
    new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 8, 24), mats.brass),
    "Machine_CrankHandle",
    crank,
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.z = 0.1;
  const grip = add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 24), mats.brass),
    "Machine_CrankGrip",
    crank,
  );
  grip.rotation.x = Math.PI / 2;
  grip.position.set(0.28, 0, 0.2);

  // Tray: brass frame, dark recess, hinged flap.
  const tray = new THREE.Group();
  tray.name = "Machine_Tray";
  tray.position.set(0, 0.62, 1.12);
  root.add(tray);
  const frameTop = add(
    new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.3), mats.brass),
    "Machine_TrayTop",
    tray,
  );
  frameTop.position.set(0, 0.24, 0.08);
  const frameBottom = add(
    new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.42), mats.brass),
    "Machine_TrayLip",
    tray,
  );
  frameBottom.position.set(0, -0.24, 0.14);
  for (const sx of [-1, 1]) {
    const side = add(
      new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.34), mats.brass),
      "Machine_TraySide",
      tray,
    );
    side.position.set(sx * 0.45, 0, 0.1);
  }
  const recess = add(
    new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.44, 0.3), mats.dark),
    "Machine_TrayRecess",
    tray,
  );
  recess.position.set(0, 0, -0.04);
  const hinge = new THREE.Group();
  hinge.name = "Machine_TrayFlap";
  hinge.position.set(0, 0.22, 0.24);
  tray.add(hinge);
  const flap = add(
    new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 0.025), mats.brass),
    "Machine_TrayFlapPanel",
    hinge,
  );
  flap.position.set(0, -0.21, 0);
  const spawn = new THREE.Object3D();
  spawn.name = "Machine_PackSpawn";
  spawn.position.set(0, 0.62, 1.12);
  root.add(spawn);

  // Contact shadow
  const shadow = canvasTex(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, "rgba(44,18,53,.55)");
    g.addColorStop(0.55, "rgba(44,18,53,.2)");
    g.addColorStop(1, "rgba(44,18,53,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  });
  const floor = add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 3.2),
      new THREE.MeshBasicMaterial({
        map: shadow,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
    "Machine_ContactShadow",
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.renderOrder = -5;
  return root;
}
