/* eslint-disable */
// Synced from experience/lab/src/rip/post.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import * as THREE from "three";
import { crtFragment, fullscreenVertex } from "./shaders";
import { C } from "./brand";

/**
 * Optional screen pass. The scene is rendered to the canvas as usual, copied into a
 * FramebufferTexture and redrawn through the CRT shader. Unlike a render target, this
 * never asks three.js for new (linear, un-tone-mapped) program variants of every material,
 * so switching the CRT on mid-sequence costs no shader compilation.
 */
export class CRTPass {
  amount = 0;
  bands = 0;
  motion = 1;
  private fbTex: THREE.FramebufferTexture;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private bandTex: THREE.CanvasTexture;
  private bandCanvas = document.createElement("canvas");
  private bandKey = "";

  constructor(private renderer: THREE.WebGLRenderer) {
    this.fbTex = new THREE.FramebufferTexture(4, 4);
    this.bandTex = new THREE.CanvasTexture(this.bandCanvas);
    // Raw sRGB values: the copied framebuffer is already display-encoded.
    this.bandTex.colorSpace = THREE.NoColorSpace;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: crtFragment,
      uniforms: {
        tScene: { value: this.fbTex },
        tBands: { value: this.bandTex },
        uAmount: { value: 0 },
        uBands: { value: 0 },
        uTime: { value: 0 },
        uRows: { value: 300 },
        uPx: { value: new THREE.Vector2(1 / 1000, 1 / 600) },
        uMotion: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get active() {
    return this.amount > 0.001 || this.bands > 0.001;
  }

  setSize(w: number, h: number, cssW: number, cssH: number) {
    if (this.fbTex.image.width !== w || this.fbTex.image.height !== h) {
      this.fbTex.dispose();
      this.fbTex = new THREE.FramebufferTexture(w, h);
      this.mat.uniforms.tScene.value = this.fbTex;
    }
    this.mat.uniforms.uPx.value.set(
      1 / Math.max(320, cssW),
      1 / Math.max(240, cssH),
    );
    // About three CSS pixels per scanline, as on 1% TV.
    this.mat.uniforms.uRows.value = THREE.MathUtils.clamp(cssH / 3.2, 90, 420);
  }

  /** Lilac top and bottom bands of the 1% TV broadcast (build-crt-screen.mjs), with copy. */
  drawBands(
    w: number,
    h: number,
    cssW: number,
    cssH: number,
    bottomCopy = "THE 1% ✳ 10,000,000 $1PCT",
  ) {
    const key = `${w}x${h}:${bottomCopy}`;
    if (key === this.bandKey) return;
    this.bandKey = key;
    const c = this.bandCanvas;
    // A texture cannot grow in place once uploaded (immutable storage): free it first.
    if (c.width !== w || c.height !== h) this.bandTex.dispose();
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const k = w / cssW;
    ctx.clearRect(0, 0, w, h);
    const topH = Math.round(Math.max(44, cssH * 0.075) * k);
    const botH = Math.round(Math.max(56, cssH * 0.1) * k);
    ctx.fillStyle = C.lilac;
    ctx.fillRect(0, 0, w, topH);
    ctx.fillRect(0, h - botH, w, botH);
    ctx.fillStyle = C.ink;
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(topH * 0.5)}px "Fraunces", Georgia, serif`;
    (ctx as unknown as { letterSpacing: string }).letterSpacing =
      `${-topH * 0.04}px`;
    ctx.textAlign = "left";
    ctx.fillText("1%", 28 * k, topH * 0.54);
    ctx.font = `italic 600 ${Math.round(topH * 0.4)}px "Fraunces", Georgia, serif`;
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
    ctx.textAlign = "right";
    ctx.fillText("Onepercent.", w - 28 * k, topH * 0.54);
    // Fit the broadcast line to the screen width (phones).
    let px = Math.round(botH * 0.36);
    (ctx as unknown as { letterSpacing: string }).letterSpacing =
      `${botH * 0.01}px`;
    ctx.font = `700 ${px}px "Fraunces", Georgia, serif`;
    while (px > 10 && ctx.measureText(bottomCopy).width > w - 56 * k) {
      px -= 1;
      ctx.font = `700 ${px}px "Fraunces", Georgia, serif`;
    }
    ctx.textAlign = "center";
    ctx.fillText(bottomCopy, w / 2, h - botH * 0.48);
    this.bandTex.needsUpdate = true;
  }

  /** Uploads the band texture now (so turning the CRT on later costs no upload). */
  uploadBands() {
    this.renderer.initTexture(this.bandTex);
  }

  /** Runs `draw` (which renders the stage to the screen), then applies the CRT treatment when active. */
  render(draw: () => void, time: number) {
    draw();
    if (!this.active) return;
    const u = this.mat.uniforms;
    u.uAmount.value = this.amount;
    u.uBands.value = this.bands;
    u.uTime.value = time;
    u.uMotion.value = this.motion;
    this.renderer.copyFramebufferToTexture(this.fbTex);
    this.renderer.render(this.scene, this.cam);
  }

  dispose() {
    this.fbTex.dispose();
    this.mat.dispose();
    this.bandTex.dispose();
    this.quad.geometry.dispose();
  }
}

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Draws the machine in its own pass so it can be defocused behind the cards:
 *   1. background + machine layer → screen (tone mapped, sRGB, transmission works as usual);
 *   2. copy → separable Gaussian blur at half resolution → mixed back over the screen;
 *   3. everything else (haze, pack, cards, particles) on top, keeping the machine's depth.
 * With `blur` at 0 it is a single ordinary render.
 */
export class StageCompositor {
  /** 0 = sharp … 1 = fully defocused. */
  blur = 0;
  /** Blur radius at `blur` = 1, in CSS pixels. */
  radius = 9;
  private fbTex = new THREE.FramebufferTexture(4, 4);
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private blurMat: THREE.ShaderMaterial;
  private mixMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private dpr = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private machineLayer: number,
  ) {
    const opts = {
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
      type: THREE.UnsignedByteType,
      generateMipmaps: false,
    } as const;
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tSrc, vUv) * 0.2270270270;
          c += texture2D(tSrc, vUv + uDir * 1.3846153846) * 0.3162162162;
          c += texture2D(tSrc, vUv - uDir * 1.3846153846) * 0.3162162162;
          c += texture2D(tSrc, vUv + uDir * 3.2307692308) * 0.0702702703;
          c += texture2D(tSrc, vUv - uDir * 3.2307692308) * 0.0702702703;
          gl_FragColor = c;
        }`,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
    this.mixMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSharp; uniform sampler2D tBlur; uniform float uMix; varying vec2 vUv;
        void main() { gl_FragColor = vec4(mix(texture2D(tSharp, vUv).rgb, texture2D(tBlur, vUv).rgb, uMix), 1.0); }`,
      uniforms: {
        tSharp: { value: this.fbTex },
        tBlur: { value: this.rtA.texture },
        uMix: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
  }

  setSize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    if (this.fbTex.image.width !== w || this.fbTex.image.height !== h) {
      this.fbTex.dispose();
      this.fbTex = new THREE.FramebufferTexture(w, h);
      this.mixMat.uniforms.tSharp.value = this.fbTex;
    }
    const hw = Math.max(1, Math.round(w / 2)),
      hh = Math.max(1, Math.round(h / 2));
    this.rtA.setSize(hw, hh);
    this.rtB.setSize(hw, hh);
  }

  private pass(
    mat: THREE.ShaderMaterial,
    target: THREE.WebGLRenderTarget | null,
  ) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    if (this.blur < 0.002) {
      camera.layers.enable(this.machineLayer);
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    // 1. Background + machine.
    camera.layers.set(this.machineLayer);
    r.setRenderTarget(null);
    r.render(scene, camera);
    r.copyFramebufferToTexture(this.fbTex);
    // 2. Blur (two separable iterations at half resolution).
    const w = this.rtA.width,
      h = this.rtA.height;
    const texels =
      Math.max(0.0001, this.blur * this.radius * this.dpr * 0.5) / 2.6;
    const u = this.blurMat.uniforms;
    const autoClear = r.autoClear;
    u.tSrc.value = this.fbTex;
    u.uDir.value.set(texels / w, 0);
    this.pass(this.blurMat, this.rtB);
    u.tSrc.value = this.rtB.texture;
    u.uDir.value.set(0, texels / h);
    this.pass(this.blurMat, this.rtA);
    u.tSrc.value = this.rtA.texture;
    u.uDir.value.set((texels * 0.6) / w, 0);
    this.pass(this.blurMat, this.rtB);
    u.tSrc.value = this.rtB.texture;
    u.uDir.value.set(0, (texels * 0.6) / h);
    this.pass(this.blurMat, this.rtA);
    this.mixMat.uniforms.uMix.value = Math.min(1, this.blur * 4);
    r.autoClear = false;
    this.pass(this.mixMat, null);
    // 3. Everything else, over the defocused machine.
    const bg = scene.background;
    scene.background = null;
    camera.layers.set(0);
    r.render(scene, camera);
    scene.background = bg;
    r.autoClear = autoClear;
    camera.layers.enable(this.machineLayer);
  }

  dispose() {
    this.fbTex.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.blurMat.dispose();
    this.mixMat.dispose();
    this.quad.geometry.dispose();
  }
}

/** Shared by card and pack shaders: 1 while the bloom source is rendered. */
export const BLOOM_UNIFORM = { value: 0 };
/** Objects that emit bloom (card faces, packs, sparkles) are also on this layer. */
export const BLOOM_LAYER = 2;

/**
 * Finishing touches after the stage is drawn:
 *  - selective bloom: only card/pack highlights above the print white (the part the shaders
 *    soft-clip) and the gold sparkles glow, rendered on BLOOM_LAYER at half resolution,
 *    blurred at quarter resolution and added back;
 *  - punch: a brief radial chromatic aberration + vignette for Black Foil, Jackpot and The 1%.
 */
export class FinishPass {
  bloom = 0;
  punch = 0;
  private src: THREE.WebGLRenderTarget;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private c: THREE.WebGLRenderTarget;
  private blurMat: THREE.ShaderMaterial;
  private addMat: THREE.ShaderMaterial;
  private punchMat: THREE.ShaderMaterial;
  private fbTex = new THREE.FramebufferTexture(4, 4);
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(private renderer: THREE.WebGLRenderer) {
    const o = {
      depthBuffer: true,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: false,
    } as const;
    this.src = new THREE.WebGLRenderTarget(4, 4, o);
    this.a = new THREE.WebGLRenderTarget(4, 4, { ...o, depthBuffer: false });
    this.b = new THREE.WebGLRenderTarget(4, 4, { ...o, depthBuffer: false });
    this.c = new THREE.WebGLRenderTarget(4, 4, { ...o, depthBuffer: false });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tSrc, vUv) * 0.2270270270;
          c += texture2D(tSrc, vUv + uDir * 1.3846153846) * 0.3162162162;
          c += texture2D(tSrc, vUv - uDir * 1.3846153846) * 0.3162162162;
          c += texture2D(tSrc, vUv + uDir * 3.2307692308) * 0.0702702703;
          c += texture2D(tSrc, vUv - uDir * 3.2307692308) * 0.0702702703;
          gl_FragColor = c;
        }`,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
    this.addMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tBloom; uniform sampler2D tSharp; uniform float uStrength; varying vec2 vUv;
        void main() {
          // Wide glow only: a tight glow over the cards read as softness.
          vec3 c = texture2D(tBloom, vUv).rgb * 0.8 + texture2D(tSharp, vUv).rgb * 0.08;
          // Warm the glow towards gold and keep it soft (screen-like, never a white flash).
          c *= vec3(1.0, 0.93, 0.8) * uStrength;
          gl_FragColor = vec4(c / (1.0 + c), 1.0);
        }`,
      uniforms: {
        tBloom: { value: this.c.texture },
        tSharp: { value: this.a.texture },
        uStrength: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
    });
    this.punchMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform float uPunch; varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float r2 = dot(p, p);
          vec2 off = p * r2 * 0.09 * uPunch;
          vec3 c = vec3(texture2D(tSrc, vUv + off).r, texture2D(tSrc, vUv).g, texture2D(tSrc, vUv - off).b);
          c *= 1.0 - uPunch * 0.32 * smoothstep(0.12, 0.62, r2 * 2.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
      uniforms: { tSrc: { value: this.fbTex }, uPunch: { value: 0 } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
  }

  /** The bloom source target (materials drawn into it need their own program variant). */
  get bloomTarget() {
    return this.src;
  }

  setSize(w: number, h: number) {
    const hw = Math.max(1, Math.round(w / 2)),
      hh = Math.max(1, Math.round(h / 2));
    this.src.setSize(hw, hh);
    const qw = Math.max(1, Math.round(w / 4)),
      qh = Math.max(1, Math.round(h / 4));
    this.a.setSize(qw, qh);
    this.b.setSize(qw, qh);
    this.c.setSize(qw, qh);
    if (this.fbTex.image.width !== w || this.fbTex.image.height !== h) {
      this.fbTex.dispose();
      this.fbTex = new THREE.FramebufferTexture(w, h);
      this.punchMat.uniforms.tSrc.value = this.fbTex;
    }
  }

  private pass(
    mat: THREE.ShaderMaterial,
    target: THREE.WebGLRenderTarget | null,
  ) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  /** `hide` lists materials that must not draw into the bloom source (card edges). */
  render(scene: THREE.Scene, camera: THREE.Camera, hide: THREE.Material[]) {
    const r = this.renderer;
    const autoClear = r.autoClear;
    if (this.bloom > 0.002) {
      const mask = camera.layers.mask;
      const bg = scene.background;
      const clear = r.getClearColor(new THREE.Color());
      const clearA = r.getClearAlpha();
      scene.background = null;
      camera.layers.set(BLOOM_LAYER);
      hide.forEach((m) => (m.visible = false));
      BLOOM_UNIFORM.value = 1;
      r.setClearColor(0x000000, 1);
      r.setRenderTarget(this.src);
      r.autoClear = true;
      r.render(scene, camera);
      BLOOM_UNIFORM.value = 0;
      hide.forEach((m) => (m.visible = true));
      camera.layers.mask = mask;
      scene.background = bg;
      r.setClearColor(clear, clearA);
      const u = this.blurMat.uniforms;
      const w = this.a.width,
        h = this.a.height;
      // Down to quarter resolution (tight glow, kept in tSharp), then a wide blur.
      u.tSrc.value = this.src.texture;
      u.uDir.value.set(1 / w, 0);
      this.pass(this.blurMat, this.b);
      u.tSrc.value = this.b.texture;
      u.uDir.value.set(0, 1 / h);
      this.pass(this.blurMat, this.a);
      // a = tight glow. Wide blur: a → b (horizontal), b → c (vertical).
      u.tSrc.value = this.a.texture;
      u.uDir.value.set(3 / w, 0);
      this.pass(this.blurMat, this.b);
      u.tSrc.value = this.b.texture;
      u.uDir.value.set(0, 3 / h);
      this.pass(this.blurMat, this.c);
      this.addMat.uniforms.uStrength.value = this.bloom;
      r.autoClear = false;
      this.pass(this.addMat, null);
    }
    if (this.punch > 0.002) {
      r.setRenderTarget(null);
      r.copyFramebufferToTexture(this.fbTex);
      this.punchMat.uniforms.uPunch.value = this.punch;
      r.autoClear = false;
      this.pass(this.punchMat, null);
    }
    r.autoClear = autoClear;
  }

  dispose() {
    [this.src, this.a, this.b, this.c].forEach((t) => t.dispose());
    this.fbTex.dispose();
    this.blurMat.dispose();
    this.addMat.dispose();
    this.punchMat.dispose();
    this.quad.geometry.dispose();
  }
}
