/* eslint-disable */
// Synced from experience/lab/src/rip/fx.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/** Gacha-grade light effects: god rays, a flash bloom, and the per-tier telegraph table. */
import * as THREE from "three";
import { IRIDESCENCE } from "./brand";
import type { HitTier } from "./types";

export interface Telegraph {
  /** Light colour of the aura, rays and flash. */
  color: string;
  /** Stage "dusk" behind the cards during the charge (colour and opacity). */
  dusk: string;
  duskAlpha: number;
  /** 0..1.2: how big everything gets (rays, flash, confetti, camera punch, charge shake). */
  power: number;
  /** Length of the charge before the flip (ms). */
  ms: number;
  /** Iridescence mixed into the rays (Holo, The 1%). */
  holo: number;
  /** Confetti palette. */
  palette: readonly string[];
  /** 0..5, for the sound hooks (pitch / intensity). */
  rank: number;
}

/**
 * Rarity telegraph (founder request, gacha style): the light that escapes the pack and the aura
 * that charges the hit card take the hit tier's colour, and higher tiers charge longer and burst
 * bigger. It is truthful (it is the drawn tier, never a fake-out or a downgrade) but it is a tell:
 * da-direction §8.5 asks for identical anticipation; `rarityTelegraph: false` restores that.
 */
export const TELEGRAPH: Record<HitTier, Telegraph> = {
  silver: {
    color: "#f2f5fb",
    dusk: "#cfd3dd",
    duskAlpha: 0.28,
    power: 0.35,
    ms: 650,
    holo: 0,
    rank: 0,
    palette: ["#f4f6fa", "#d7dae0", "#ffffff", "#c9ccd2"],
  },
  blue: {
    color: "#5cc6ff",
    dusk: "#0b1d5e",
    duskAlpha: 0.5,
    power: 0.55,
    ms: 850,
    holo: 0,
    rank: 1,
    palette: ["#3fe6ff", "#1f4fe0", "#a8e7ff", "#ffffff"],
  },
  holo: {
    color: "#e4c3ff",
    dusk: "#2c1235",
    duskAlpha: 0.62,
    power: 0.8,
    ms: 1100,
    holo: 1,
    rank: 2,
    palette: IRIDESCENCE,
  },
  black: {
    color: "#f6d272",
    dusk: "#0e0e10",
    duskAlpha: 0.82,
    power: 0.95,
    ms: 1350,
    holo: 0,
    rank: 3,
    palette: ["#f6d272", "#d9a441", "#fff3c4", "#3c3c3c"],
  },
  jackpot: {
    color: "#ffd66b",
    dusk: "#3a2208",
    duskAlpha: 0.78,
    power: 1.1,
    ms: 1550,
    holo: 0.15,
    rank: 4,
    palette: ["#f6d272", "#d9a441", "#fff3c4", "#a8701f"],
  },
  one_pct: {
    color: "#efd6ff",
    dusk: "#2c1235",
    duskAlpha: 0.8,
    power: 1.2,
    ms: 1650,
    holo: 0.85,
    rank: 5,
    palette: ["#e4c3ff", "#ffffff", "#f6d272", "#a8e7ff", "#ffbfd9"],
  },
};

/** DA §8.5 mode: the same neutral lilac anticipation for every tier. */
export const NEUTRAL: Telegraph = {
  color: "#d5a2f1",
  dusk: "#efddee",
  duskAlpha: 0.35,
  power: 0.6,
  ms: 700,
  holo: 0,
  rank: 2,
  palette: ["#d5a2f1", "#efddee", "#ffffff", "#f6d272"],
};

const IRI = /* glsl */ `
vec3 iri(float t) {
  t = fract(t) * 5.0;
  vec3 c0 = vec3(0.66, 0.91, 1.0), c1 = vec3(0.89, 0.76, 1.0), c2 = vec3(1.0, 0.75, 0.85), c3 = vec3(1.0, 0.9, 0.64), c4 = vec3(0.78, 1.0, 0.91);
  float f = fract(t); f = f * f * (3.0 - 2.0 * f);
  if (t < 1.0) return mix(c0, c1, f); if (t < 2.0) return mix(c1, c2, f); if (t < 3.0) return mix(c2, c3, f); if (t < 4.0) return mix(c3, c4, f); return mix(c4, c0, f);
}`;

/** Rotating god rays (additive), drawn behind the hero card or out of the pack's opening. */
export class Rays {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#ffffff") },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uHolo: { value: 0 },
        uSpin: { value: 0 },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uHolo; uniform float uSpin;
        varying vec2 vUv;
        ${IRI}
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p) * 2.0;
          float a = atan(p.y, p.x);
          float s = uSpin;
          float rays = pow(0.5 + 0.5 * sin(a * 9.0 + s), 6.0) * 0.8 + pow(0.5 + 0.5 * sin(a * 14.0 - s * 1.3 + 1.7), 8.0) * 0.6
                     + pow(0.5 + 0.5 * sin(a * 5.0 + s * 0.6 + 0.4), 10.0) * 0.5;
          float fall = smoothstep(1.0, 0.12, r) * smoothstep(0.0, 0.18, r);
          float core = exp(-r * r / 0.05);
          vec3 col = mix(uColor, iri(a / 6.2832 + uTime * 0.06) , uHolo);
          float v = (rays * fall * 0.75 + core * 0.9) * uOpacity;
          gl_FragColor = vec4(col * v, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 4.5;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }
  set color(c: string) {
    this.mat.uniforms.uColor.value.set(c);
  }
  set holo(v: number) {
    this.mat.uniforms.uHolo.value = v;
  }
  set opacity(v: number) {
    this.mat.uniforms.uOpacity.value = v;
    this.mesh.visible = v > 0.002;
  }
  get opacity() {
    return this.mat.uniforms.uOpacity.value;
  }
  /** Rotation phase advances with `speed` (radians per second). */
  speed = 0.25;
  update(dt: number, time: number) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uSpin.value += dt * this.speed;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** A soft radial flash (additive), sized and coloured per burst. Never full screen (DA §8.2). */
export class Flash {
  mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  constructor() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,.75)");
    g.addColorStop(0.5, "rgba(255,255,255,.18)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }
  set color(c: string) {
    this.mat.color.set(c);
  }
  set opacity(v: number) {
    this.mat.opacity = v;
    this.mesh.visible = v > 0.002;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
  }
}
