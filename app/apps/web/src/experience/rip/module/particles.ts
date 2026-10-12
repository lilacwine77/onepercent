/* eslint-disable */
// Synced from experience/lab/src/rip/particles.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import * as THREE from "three";
import { IRIDESCENCE } from "./brand";

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  scale: number;
  life: number;
  age: number;
  delay: number;
  bounce: boolean;
  billboard: boolean;
  grow: number;
  color: THREE.Color | null;
  /** Flutter: confetti swings sideways as it falls. */
  flutter: number;
}

export interface EmitOptions {
  origin: THREE.Vector3;
  count: number;
  rnd: () => number;
  speed: [number, number];
  /** Main direction (normalised); spread is the cone half-angle in radians. */
  dir?: THREE.Vector3;
  spread?: number;
  scale: [number, number];
  life: [number, number];
  delay?: [number, number];
  spin?: number;
  /** Area emitter: random offset box around the origin. */
  box?: THREE.Vector3;
  /** Per-particle colours picked at random (instance colour). */
  palette?: readonly string[];
}

/** A capped pool of instanced particles with simple physics (gravity, drag, floor bounce). */
export class ParticlePool {
  mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  gravity = -6;
  drag = 0.6;
  floorY = -Infinity;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    public readonly capacity: number,
    private camera: THREE.Camera,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  emit(
    o: EmitOptions,
    flags: {
      bounce?: boolean;
      billboard?: boolean;
      grow?: number;
      flutter?: number;
    } = {},
  ) {
    const dir = o.dir ?? new THREE.Vector3(0, 1, 0);
    const spread = o.spread ?? Math.PI;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < o.count && this.parts.length < this.capacity; i++) {
      // Random direction inside the cone.
      const theta = o.rnd() * Math.PI * 2;
      const cosPhi = 1 - o.rnd() * (1 - Math.cos(spread));
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      tmp.set(Math.cos(theta) * sinPhi, Math.sin(theta) * sinPhi, cosPhi);
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        dir.clone().normalize(),
      );
      tmp.applyQuaternion(quat);
      const speed = THREE.MathUtils.lerp(o.speed[0], o.speed[1], o.rnd());
      const pos = o.origin.clone();
      if (o.box)
        pos.add(
          new THREE.Vector3(
            (o.rnd() - 0.5) * o.box.x,
            (o.rnd() - 0.5) * o.box.y,
            (o.rnd() - 0.5) * o.box.z,
          ),
        );
      const spin = o.spin ?? 8;
      this.parts.push({
        pos,
        vel: tmp.clone().multiplyScalar(speed),
        rot: new THREE.Euler(o.rnd() * 6.28, o.rnd() * 6.28, o.rnd() * 6.28),
        spin: new THREE.Vector3(
          (o.rnd() - 0.5) * spin,
          (o.rnd() - 0.5) * spin,
          (o.rnd() - 0.5) * spin,
        ),
        scale: THREE.MathUtils.lerp(o.scale[0], o.scale[1], o.rnd()),
        life: THREE.MathUtils.lerp(o.life[0], o.life[1], o.rnd()),
        age: 0,
        delay: o.delay
          ? THREE.MathUtils.lerp(o.delay[0], o.delay[1], o.rnd())
          : 0,
        bounce: !!flags.bounce,
        billboard: !!flags.billboard,
        grow: flags.grow ?? 0,
        color: o.palette
          ? new THREE.Color(o.palette[Math.floor(o.rnd() * o.palette.length)])
          : null,
        flutter: flags.flutter ?? 0,
      });
    }
  }

  /** Optional per-instance colours (holo shards). */
  setColors(rnd: () => number, palette: readonly string[] = IRIDESCENCE) {
    const c = new THREE.Color();
    for (let i = 0; i < this.capacity; i++) {
      c.set(palette[Math.floor(rnd() * palette.length)]);
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get active() {
    return this.parts.length > 0;
  }

  update(dt: number) {
    const camQ = this.camera.quaternion;
    let n = 0;
    let colored = false;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.age += dt;
      if (p.age >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vel.y += this.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - this.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.flutter)
        p.pos.x += Math.sin(p.age * 7 + p.rot.y * 3) * p.flutter * dt;
      if (p.bounce && p.pos.y < this.floorY) {
        p.pos.y = this.floorY;
        p.vel.y = Math.abs(p.vel.y) * 0.38;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
        p.spin.multiplyScalar(0.6);
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
    }
    for (const p of this.parts) {
      if (p.delay > 0) continue;
      const t = p.age / p.life;
      const fade = Math.min(1, (1 - t) / 0.25) * Math.min(1, p.age / 0.06);
      const grow = p.grow ? Math.sin(Math.min(1, t) * Math.PI) : 1;
      this.s.setScalar(p.scale * fade * (p.grow ? grow : 1));
      if (p.billboard) {
        this.q.copy(camQ);
        this.q.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            p.rot.z,
          ),
        );
      } else this.q.setFromEuler(p.rot);
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      if (p.color) {
        this.mesh.setColorAt(n, p.color);
        colored = true;
      }
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colored && this.mesh.instanceColor)
      this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.parts = [];
    this.mesh.count = 0;
  }
}

/** Gold four-point sparkle (Pepe's hit glyph). */
export function sparkleTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.translate(64, 64);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
  g.addColorStop(0, "#fffbe8");
  g.addColorStop(0.3, "#f6d272");
  g.addColorStop(1, "#d9a441");
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const b = a + Math.PI / 4;
    ctx.lineTo(Math.cos(a) * 60, Math.sin(a) * 60);
    ctx.quadraticCurveTo(
      0,
      0,
      Math.cos(a + Math.PI / 2) * 60,
      Math.sin(a + Math.PI / 2) * 60,
    );
    void b;
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(58,34,8,.5)";
  ctx.lineWidth = 3;
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Thin elongated spark used for Blue Foil cyan sparks. */
export function sparkTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(239,255,255,1)");
  g.addColorStop(0.35, "rgba(63,230,255,.9)");
  g.addColorStop(1, "rgba(63,230,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function shardGeometry(
  capacity = 40,
  rnd: () => number = Math.random,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0.6, 0, -0.45, -0.35, 0, 0.55, -0.25, 0],
      3,
    ),
  );
  g.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  g.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([0.5, 1, 0.05, 0.2, 1, 0.3], 2),
  );
  // Each shard shows a different patch of the holographic foil.
  const off = new Float32Array(capacity * 2);
  for (let i = 0; i < capacity; i++) {
    off[i * 2] = 0.25 + rnd() * 0.45;
    off[i * 2 + 1] = 0.25 + rnd() * 0.4;
  }
  g.setAttribute("aUvOff", new THREE.InstancedBufferAttribute(off, 2));
  return g;
}

/** Foil shards textured with the Signature holo pack; they flash as they turn. */
export function holoShardMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: null } },
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec2 aUvOff;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vUv = aUvOff + uv * 0.09;
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(position, 1.0);
        vP = wp.xyz;
        vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      vec3 iri(float t) {
        t = fract(t) * 5.0;
        vec3 c0 = vec3(0.392, 0.799, 1.0), c1 = vec3(0.775, 0.552, 1.0), c2 = vec3(1.0, 0.521, 0.693), c3 = vec3(1.0, 0.783, 0.371), c4 = vec3(0.565, 1.0, 0.815);
        float f = fract(t); f = f * f * (3.0 - 2.0 * f);
        if (t < 1.0) return mix(c0, c1, f); if (t < 2.0) return mix(c1, c2, f); if (t < 3.0) return mix(c2, c3, f); if (t < 4.0) return mix(c3, c4, f); return mix(c4, c0, f);
      }
      void main() {
        // Pastel holo flakes: the brand iridescence, shifting with the angle, never dark.
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vP);
        float f = abs(dot(N, V));
        vec3 col = iri(vUv.x * 3.0 + vUv.y * 2.0 + N.x * 0.8 + N.y * 0.6) * (0.78 + 0.35 * f) + vec3(1.0, 0.98, 0.94) * pow(f, 16.0) * 0.5;
        gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
      }`,
  });
}

/** SOL coin face: gold rim on a plum face, "SOL" in gold (DA "Gold chip" language, no third-party logo). */
export function solCoinTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  const rim = ctx.createLinearGradient(0, 0, 512, 512);
  rim.addColorStop(0, "#fff3c4");
  rim.addColorStop(0.35, "#f6d272");
  rim.addColorStop(0.65, "#d9a441");
  rim.addColorStop(1, "#a8701f");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, 512, 512);
  const face = ctx.createRadialGradient(200, 180, 20, 256, 256, 230);
  face.addColorStop(0, "#4c2459");
  face.addColorStop(1, "#2c1235");
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(256, 256, 196, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3a2208";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(256, 256, 199, 0, Math.PI * 2);
  ctx.stroke();
  const g = ctx.createLinearGradient(0, 200, 0, 320);
  g.addColorStop(0, "#fff3c4");
  g.addColorStop(0.45, "#f6d272");
  g.addColorStop(1, "#d9a441");
  ctx.fillStyle = g;
  ctx.font = '700 150px "DM Sans", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SOL", 256, 268);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Foil confetti: small rectangles, metallic so they flash as they tumble; tinted per instance. */
export function confettiPool(
  camera: THREE.Camera,
  capacity: number,
): ParticlePool {
  // Unlit foil: always bright (never reads as dark specks on cream), with a glint as it turns.
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vC; varying float vFacing;
      void main() {
        vC = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(position, 1.0);
        vec3 n = normalize(mat3(m) * normal);
        vFacing = abs(dot(n, normalize(cameraPosition - wp.xyz)));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vFacing;
      void main() {
        vec3 col = vC * (0.78 + 0.28 * vFacing) + vec3(1.0, 0.98, 0.94) * pow(vFacing, 18.0) * 0.55;
        gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
      }`,
  });
  const pool = new ParticlePool(
    new THREE.PlaneGeometry(0.075, 0.042),
    mat,
    capacity,
    camera,
  );
  // Instance colours must exist before the first compile (USE_INSTANCING_COLOR).
  pool.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  pool.gravity = -2.6;
  pool.drag = 1.4;
  return pool;
}
