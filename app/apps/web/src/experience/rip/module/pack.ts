/* eslint-disable */
// Synced from experience/lab/src/rip/pack.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import * as THREE from "three";
import { packFragment, packVertex } from "./shaders";
import { KEY_DIR, radialTexture } from "./card";
import { BLOOM_LAYER, BLOOM_UNIFORM } from "./post";
import type { EditionInfo } from "./brand";
import {
  PACK_SIZE,
  makeTear,
  type PackGeometryData,
  type SheetArrays,
} from "./pack-geometry";

export { PACK_SIZE };

interface Shard {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  age: number;
}

/** A sealed foil pack split into two connected sheets along a serrated tear line. */
export class Pack3D {
  group = new THREE.Group();
  stripPivot = new THREE.Group();
  body: THREE.Mesh;
  strip: THREE.Mesh;
  bodyMat: THREE.ShaderMaterial;
  stripMat: THREE.ShaderMaterial;
  private shards: Shard[] = [];
  private shardMat: THREE.ShaderMaterial;
  private tearV: (u: number) => number;
  private span: [number, number];
  readonly tearMidY: number;
  /** Soft halo behind the pack while it charges (Cranking), in the stage colour. */
  aura: THREE.Mesh;

  constructor(
    public texture: THREE.Texture,
    public edition: EditionInfo,
    geo: PackGeometryData,
  ) {
    const tear = makeTear(edition.tear);
    this.tearV = tear.tearV;
    this.span = tear.span;
    this.tearMidY = (0.5 - this.tearV(0.5)) * PACK_SIZE;

    const uniforms = () => ({
      uMap: { value: texture },
      uXray: { value: 0 },
      uXrayFade: { value: 1 },
      uTearGlow: { value: 0 },
      uTearColor: { value: new THREE.Color("#fff3c4") },
      uAura: { value: new THREE.Color("#d5a2f1") },
      uBloom: BLOOM_UNIFORM,
      uScan: { value: -1 },
      uScanAmt: { value: 0 },
      uLock: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uPointer: { value: new THREE.Vector2() },
      uSheen: { value: 0.6 },
      uKeyDir: { value: KEY_DIR },
      uOpen: { value: 0 },
      uPeel: { value: 0 },
      uIsStrip: { value: 0 },
      uSpan: { value: new THREE.Vector2(this.span[0], this.span[1]) },
      uSize: { value: PACK_SIZE },
    });
    const mat = (strip: boolean) => {
      const u = uniforms();
      u.uIsStrip.value = strip ? 1 : 0;
      return new THREE.ShaderMaterial({
        vertexShader: packVertex,
        fragmentShader: packFragment,
        uniforms: u,
        side: THREE.DoubleSide,
        // Opaque: the pack never lets the machine show through it (fades dissolve instead).
        transparent: false,
        toneMapped: false,
      });
    };
    this.bodyMat = mat(false);
    this.stripMat = mat(true);

    const sheet = (d: SheetArrays) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(d.position, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(d.normal, 3));
      g.setAttribute("aImg", new THREE.BufferAttribute(d.aImg, 2));
      g.setAttribute("aSide", new THREE.BufferAttribute(d.aSide, 1));
      g.setAttribute("aTear", new THREE.BufferAttribute(d.aTear, 1));
      g.setIndex(new THREE.BufferAttribute(d.index, 1));
      g.computeBoundingSphere();
      return g;
    };
    const bodyGeo = sheet(geo.body);
    const stripGeo = sheet(geo.strip);
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.strip = new THREE.Mesh(stripGeo, this.stripMat);
    this.body.name = "Pack_Body";
    this.strip.name = "Pack_Strip";
    // The strip pivots around its own centre when it flies away.
    const stripCenterY = (0.5 - this.tearV(0.5) * 0.5) * PACK_SIZE;
    this.stripPivot.position.set(0, stripCenterY, 0);
    this.strip.position.set(0, -stripCenterY, 0);
    this.stripPivot.add(this.strip);
    this.group.add(this.body, this.stripPivot);
    this.group.name = "RipPack";
    this.body.renderOrder = 7;
    this.strip.renderOrder = 7;
    this.body.layers.enable(BLOOM_LAYER);
    this.strip.layers.enable(BLOOM_LAYER);

    this.aura = new THREE.Mesh(
      new THREE.PlaneGeometry(PACK_SIZE * 1.55, PACK_SIZE * 1.55),
      new THREE.MeshBasicMaterial({
        map: radialTexture(),
        color: "#d5a2f1",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.aura.name = "Pack_Aura";
    this.aura.position.z = -0.35;
    this.aura.renderOrder = 5;
    this.aura.visible = false;
    this.group.add(this.aura);

    this.shardMat = foilFlakeMaterial(new THREE.Color(edition.flake));
    // A hidden flake keeps the flake shader compiled with the pack (no first-tear hitch).
    const warm = new THREE.Mesh(
      new THREE.PlaneGeometry(0.001, 0.001),
      this.shardMat,
    );
    warm.name = "Pack_FlakeWarmup";
    warm.position.z = -0.5;
    this.group.add(warm);
  }

  private each(fn: (m: THREE.ShaderMaterial) => void) {
    fn(this.bodyMat);
    fn(this.stripMat);
  }

  set xray(v: number) {
    this.each((m) => (m.uniforms.uXray.value = v));
  }
  set xrayFade(v: number) {
    this.each((m) => (m.uniforms.uXrayFade.value = v));
  }

  /** Back to a sealed pack, ready for another Rip. */
  reset() {
    for (const sh of this.shards) {
      sh.mesh.geometry.dispose();
      sh.mesh.removeFromParent();
    }
    this.shards = [];
    this.xray = 0;
    this.xrayFade = 1;
    this.lock = 0;
    this.setScan(-1, 0);
    this.open = 0;
    this.peel = 0;
    this.tearGlow = 0;
    this.stripFly(0);
    this.stripMat.uniforms.uOpacity.value = 1;
    this.stripPivot.visible = true;
    this.setAura(0);
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(1);
    this.opacity = 0;
  }
  setScan(pos: number, amount: number) {
    this.each((m) => {
      m.uniforms.uScan.value = pos;
      m.uniforms.uScanAmt.value = amount;
    });
  }
  set lock(v: number) {
    this.each((m) => (m.uniforms.uLock.value = v));
  }
  set time(t: number) {
    this.each((m) => (m.uniforms.uTime.value = t));
  }
  set opacity(v: number) {
    this.bodyMat.uniforms.uOpacity.value = v;
    if (this.stripPivot.visible) this.stripMat.uniforms.uOpacity.value = v;
    this.group.visible = v > 0.001;
  }
  set sheen(v: number) {
    this.each((m) => (m.uniforms.uSheen.value = v));
  }
  setPointer(x: number, y: number) {
    this.each((m) => m.uniforms.uPointer.value.set(x, y));
  }
  set open(v: number) {
    this.bodyMat.uniforms.uOpen.value = v;
  }
  set peel(v: number) {
    this.stripMat.uniforms.uPeel.value = v;
  }
  set tearGlow(v: number) {
    this.each((m) => (m.uniforms.uTearGlow.value = v));
  }
  /** Charge colour (aura, rim and travelling band) and the halo's strength. */
  setAura(amount: number, color?: THREE.ColorRepresentation) {
    const m = this.aura.material as THREE.MeshBasicMaterial;
    if (color !== undefined) {
      m.color.set(color);
      this.each((x) => x.uniforms.uAura.value.set(color));
    }
    m.opacity = amount;
    this.aura.visible = amount > 0.002;
  }
  set tearColor(c: THREE.ColorRepresentation) {
    this.each((m) => m.uniforms.uTearColor.value.set(c));
  }

  /** 0→1: the torn strip is flung up and to the right, spinning, and leaves the frame (opaque). */
  stripFly(t: number) {
    const e = 1 - Math.pow(1 - t, 2.0);
    const y0 = (0.5 - this.tearV(0.5) * 0.5) * PACK_SIZE;
    this.stripPivot.position.x = 2.9 * e + 0.4 * t * t;
    this.stripPivot.position.y = y0 + 2.6 * e - 0.9 * t * t;
    this.stripPivot.position.z = 0.6 * e;
    // It uncurls as it flies so its foil face (not its edge) is seen while it tumbles away.
    this.stripMat.uniforms.uPeel.value =
      t > 0
        ? THREE.MathUtils.lerp(1, 0.2, Math.min(1, e * 1.4))
        : this.stripMat.uniforms.uPeel.value;
    this.stripPivot.rotation.z = -0.55 * e - 0.9 * t * t;
    this.stripPivot.rotation.x = 0.25 * e;
    this.stripPivot.rotation.y = 0.45 * e;
    // Gone by the end (it is off-screen by then); a short dissolve covers small viewports.
    this.stripMat.uniforms.uOpacity.value =
      t < 0.8 ? this.bodyMat.uniforms.uOpacity.value : 1 - (t - 0.8) / 0.2;
    this.stripPivot.visible = t < 0.999;
  }

  /** Bursts foil shards along the tear line (12–16, DA §8.1 C). */
  burst(rnd: () => number, count = 14) {
    for (let i = 0; i < count; i++) {
      const u = THREE.MathUtils.lerp(
        this.span[0] + 0.03,
        this.span[1] - 0.03,
        rnd(),
      );
      const v = this.tearV(u);
      const size = 0.1 + rnd() * 0.08;
      const g = new THREE.BufferGeometry();
      const ang = rnd() * Math.PI * 2;
      const pts = [0, 1, 2].map((k) => {
        const a = ang + k * 2.1 + (rnd() - 0.5) * 0.6;
        const r = size * (0.6 + rnd() * 0.6);
        return [Math.cos(a) * r, Math.sin(a) * r];
      });
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          pts.flatMap((p) => [p[0], p[1], 0]),
          3,
        ),
      );
      g.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
      );
      const phase = rnd();
      g.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          [phase, 0, phase + 0.2, 0.5, phase + 0.1, 1],
          2,
        ),
      );
      const mesh = new THREE.Mesh(g, this.shardMat);
      mesh.position.set((u - 0.5) * PACK_SIZE, (0.5 - v) * PACK_SIZE, 0.05);
      this.group.add(mesh);
      const side = (u - 0.5) * 2;
      this.shards.push({
        mesh,
        vel: new THREE.Vector3(
          side * 1.6 + (rnd() - 0.5) * 1.2,
          1.2 + rnd() * 1.6,
          0.4 + rnd() * 1.3,
        ),
        spin: new THREE.Vector3(
          (rnd() - 0.5) * 14,
          (rnd() - 0.5) * 14,
          (rnd() - 0.5) * 10,
        ),
        life: 0.85 + rnd() * 0.45,
        age: 0,
      });
    }
  }

  update(dt: number) {
    for (const s of [...this.shards]) {
      s.age += dt;
      s.vel.y -= 5.2 * dt;
      s.vel.multiplyScalar(1 - 0.9 * dt);
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      const k = 1 - Math.max(0, (s.age - s.life * 0.6) / (s.life * 0.4));
      s.mesh.scale.setScalar(Math.max(0.001, k));
      if (s.age >= s.life) {
        s.mesh.geometry.dispose();
        s.mesh.removeFromParent();
        this.shards.splice(this.shards.indexOf(s), 1);
      }
    }
  }

  dispose() {
    for (const s of this.shards) {
      s.mesh.geometry.dispose();
      s.mesh.removeFromParent();
    }
    this.shards = [];
    this.body.geometry.dispose();
    this.strip.geometry.dispose();
    this.bodyMat.dispose();
    this.stripMat.dispose();
    this.shardMat.dispose();
    this.group.removeFromParent();
  }
}

/** Torn foil flakes: brand iridescence tinted by the edition, never dark (they read as foil, not dirt). */
export function foilFlakeMaterial(tint: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTint: { value: tint } },
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      vec3 iri(float t) {
        t = fract(t) * 5.0;
        vec3 c0 = vec3(0.66, 0.91, 1.0), c1 = vec3(0.89, 0.76, 1.0), c2 = vec3(1.0, 0.75, 0.85), c3 = vec3(1.0, 0.9, 0.64), c4 = vec3(0.78, 1.0, 0.91);
        float f = fract(t); f = f * f * (3.0 - 2.0 * f);
        if (t < 1.0) return mix(c0, c1, f); if (t < 2.0) return mix(c1, c2, f); if (t < 3.0) return mix(c2, c3, f); if (t < 4.0) return mix(c3, c4, f); return mix(c4, c0, f);
      }
      void main() {
        vec3 V = normalize(cameraPosition - vP);
        vec3 N = normalize(vN);
        float f = abs(dot(N, V));
        vec3 col = mix(iri(vUv.x * 2.0 + N.x + N.y * 0.7), uTint, 0.38) * (0.85 + 0.3 * f);
        col += vec3(1.0, 0.98, 0.94) * pow(f, 14.0) * 0.6;
        gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
      }`,
  });
}
