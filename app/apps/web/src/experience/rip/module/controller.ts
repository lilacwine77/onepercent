/* eslint-disable */
// Synced from experience/lab/src/rip/controller.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import * as THREE from "three";
import { ShaderLifetime } from "../shader-lifetime";
import "@fontsource/fraunces/latin-600-italic.css";
import "@fontsource/dm-sans/latin-700.css";

import {
  Animator,
  AbortRip,
  ease,
  lerp,
  seededRandom,
  clamp01,
  type Ease,
} from "./anim";
import {
  C,
  EDITIONS,
  TIERS,
  fmtAmount,
  fmtSol,
  quotePending,
  ticker,
} from "./brand";
import { ART_W } from "./card-art";
import { ensureFonts, loadImage } from "./assets";
import { CardPainter, texturesFrom, type PaintJob } from "./painter";
import { CARD_H, Card3D, createCardGeometry } from "./card";
type TexPair = [THREE.Texture, THREE.Texture];
import { Pack3D } from "./pack";
import { buildPackGeometry, type PackGeometryData } from "./pack-geometry";
import { POSTERS, POSTER_AXIS } from "./poster";
import {
  MACHINE_LAYER,
  MachineRig,
  buildStandInMachine,
  loadMachineGLB,
  machineEnvironment,
  machineMaterials,
} from "./machine";
import {
  ParticlePool,
  confettiPool,
  holoShardMaterial,
  shardGeometry,
  solCoinTexture,
  sparkTexture,
  sparkleTexture,
} from "./particles";
import { Flash, NEUTRAL, Rays, TELEGRAPH, type Telegraph } from "./fx";
import { BLOOM_LAYER, CRTPass, FinishPass, StageCompositor } from "./post";
import { Overlay, type ActionSpec } from "./overlay";
import { endActions, endCopy } from "./end";
import { pulse, setReducedUI } from "./ui-motion";
import { fullscreenVertex, hazeFragment } from "./shaders";
import { createPackAsset } from "./vendor/pack-asset.js";
import { buildRevealOffThread, type RevealAsset } from "./reveal";
import type {
  ActionState,
  CardAction,
  Edition,
  MountRipOptions,
  RipBeat,
  RipController,
  RipEventMap,
  RipInput,
  RipQuotes,
  RipResult,
  SolQuote,
  SoundCue,
} from "./types";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const BASE_FOV = 30;
/** Drawn after every screen pass (the 1% card over 1% TV). */
const OVERLAY_LAYER = 3;
/** Thrown inside the choreography when skip() cuts to the end state. */
class SkipSignal extends Error {
  constructor() {
    super("skip");
    this.name = "SkipSignal";
  }
}
export class RipFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RipFailedError";
  }
}
const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));

/** World layout. The machine stands behind; the pack and cards play in front of it. */
const MACHINE_POS = V(0, -2.35, -3.1);
const FOCUS = V(0, 0.12, 1.4);
const HERO = V(0, 0.18, 2.4);

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  name?: ShotName;
}
type ShotName = "idle" | "crank" | "reveal" | "end" | "sell";
/** Half-width / half-height (world units, at the look point) each shot must keep in frame: [landscape, portrait]. */
const SHOT_NEEDS: Record<ShotName, [[number, number], [number, number]]> = {
  idle: [
    [2.2, 3.2],
    [1.75, 3.05],
  ],
  crank: [
    [1.25, 0],
    [1.25, 0],
  ],
  reveal: [
    [3.05, 0],
    [1.62, 0],
  ],
  end: [
    [3.2, 0],
    [1.62, 2.7],
  ],
  sell: [
    [3.6, 0],
    [1.8, 2.9],
  ],
};
const SHOTS: Record<ShotName, Shot> = {
  // A 3/4 view (about 11° of yaw) so the volume and the side "1%" emblem read, as in hero.png.
  // Aimed at the machine's middle (foot −2.5 … lid 3.05) so it fills the free band.
  idle: { pos: V(2.9, 1.22, 11.9), look: V(0, 0.27, -3.1) },
  crank: { pos: V(1.45, -0.55, 5.0), look: V(0.05, -1.2, -1.9) },
  reveal: { pos: V(0, 0.32, 9.0), look: V(0, 0.18, 1.2) },
  end: { pos: V(0, 1.0, 9.7), look: V(0, 0.42, 0.4) },
  sell: { pos: V(0, 1.2, 11.4), look: V(0, 0.55, -0.6) },
};

/** Card index → slot in the fan / row (the hit sits in the middle). */
const SLOT_OF = [0, 1, 3, 4, 2];
const HIT = 4;

interface Prepared {
  key: string;
  result: RipResult;
  dust: TexPair[];
  hit: TexPair;
  teaser: TexPair | null;
}

interface Pose {
  pos: THREE.Vector3;
  rotZ: number;
  scale: number;
  opacity?: number;
  dim?: number;
}

/** Landscape end: the selected card large in the middle, the others in a 2×2 grid on its left, the actions panel on its right. */
const END = { SH: 2.0, DS: 0.95, gap: 0.14, G: 0.42, y: 0.3, z: 1.0 };
/** Portrait end: a centred carousel; the selected card large, its neighbours peeking from behind it. */
const CAR = { S: 1.6, side: 0.72, y: 0, z: 1.0, peek: 0.15 };

export class RipStage implements RipController {
  private root: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  private crt: CRTPass;
  private compositor: StageCompositor;
  private finish: FinishPass;
  /** Bloom strength while cards or a pack are on stage (raised at big reveals). */
  private bloomLevel = 0.35;
  private punch = 0;
  private painter: CardPainter;
  private backdrop: THREE.CanvasTexture | null = null;
  private backdropImage: HTMLImageElement | null = null;
  /** Machine defocus 0..1 (see StageCompositor). */
  private defocus = 0;
  /** Jackpot meter, 0..1, linear in coins (setJackpotLevel). */
  private jackpotLevel = 1;
  private jackpotTween = 0;
  private coinScale = 1;
  private anim = new Animator();
  private overlay: Overlay;
  private mats = machineMaterials();
  private machineHolder = new THREE.Group();
  private machine!: MachineRig;
  private haze: THREE.Mesh;
  private hazeMat: THREE.ShaderMaterial;
  private cardGeo = createCardGeometry();
  private cards: Card3D[] = [];
  private pack: Pack3D | null = null;
  private packs = new Map<Edition, Pack3D>();
  private packTextures = new Map<Edition, Promise<THREE.Texture>>();
  private packBuilds = new Map<Edition, Promise<Pack3D>>();
  private packWorker: Worker | null = null;
  private packReq = 0;
  private packPending = new Map<number, (d: PackGeometryData | null) => void>();
  private sparks: ParticlePool;
  private sparkles: ParticlePool;
  private holoShards: ParticlePool;
  private confetti: ParticlePool;
  private rays = new Rays();
  private flash = new Flash();
  /** Camera punch (degrees added to the field of view) and an extra bloom pulse. */
  private fovKick = 0;
  private bloomExtra = 0;
  /** Tap mode: waiting for the viewer to pick a face-down card. */
  private picking = false;
  private pickResolver: ((c: Card3D | "all") => void) | null = null;
  private picked = new Set<number>();
  private pickingHit = false;
  private revealAllRequested = false;
  /** Current fan slot of each card (cards swap places, face-down, when the viewer picks). */
  private slotOf = [...SLOT_OF];
  /** Landscape end: card index per grid cell (0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right). */
  private gridSlots: number[] = [];
  /** Portrait end carousel: current (fractional) and resting position, in cards. */
  private focus = 2;
  private focusTarget = 2;
  /** The end layout is settled and follows the carousel every frame (portrait). */
  private layoutLive = false;
  private swipe: {
    id: number;
    x0: number;
    f0: number;
    pitch: number;
    moved: boolean;
    v: number;
    lastT: number;
  } | null = null;
  private swipedAt = 0;
  /** 0..1: the dealt row floats gently while the viewer picks. */
  private fanFloat = 0;
  private targets: {
    myCards?: HTMLElement | null;
    wallet?: HTMLElement | null;
  } = {};
  private holoShardMat: THREE.ShaderMaterial;
  private coins: ParticlePool;
  private solCoin: THREE.Mesh;
  private reveal: RevealAsset | null = null;
  private revealBuild: Promise<RevealAsset | null> | null = null;
  private revealTextures: Promise<[THREE.Texture, THREE.Texture]> | null = null;
  private cam = { pos: SHOTS.idle.pos.clone(), look: SHOTS.idle.look.clone() };
  private shakeAmp = 0;
  private dolly = 0;
  private pointer = new THREE.Vector2();
  private pointerSmooth = new THREE.Vector2();
  private pointerSeen = -1e9;
  private raycaster = new THREE.Raycaster();
  private hovered: Card3D | null = null;
  private autoHolo = false;
  private state: "idle" | "playing" | "end" = "idle";
  private runId = 0;
  private result: RipResult | null = null;
  private resultUsed = false;
  private prepared: Prepared | null = null;
  private preparing: string | null = null;
  private resultToken = 0;
  private waiters = new Set<() => void>();
  private listeners: { [K in keyof RipEventMap]: Set<RipEventMap[K]> } = {
    cardAction: new Set(),
    share: new Set(),
    retry: new Set(),
    verify: new Set(),
    mood: new Set(),
    sound: new Set(),
    beat: new Set(),
  };
  private reduced: boolean;
  private motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  private reducedOverride: boolean | undefined;
  private edition: Edition = "original";
  private rnd = seededRandom("onepercent");
  private ready: Promise<void>;
  private raf = 0;
  private last = 0;
  private time = 0;
  private resizeObserver: ResizeObserver;
  private destroyed = false;
  private shaders = new ShaderLifetime();
  private aspect = 1.6;
  private soldBack = new Set<number>();
  /** Card whose actions are shown in the portrait layout. */
  private selected = HIT;
  private crank = 0;
  private idleOrbit = 0;
  private orbitTime = 0;
  /** The 1%: the hit card renders after the CRT pass (on OVERLAY_LAYER). */
  private hitOverCrt = false;
  private playT0 = 0;
  private revealMode: "auto" | "tap" = "tap";
  private turbo = false;
  private skipRequested = false;
  private skipArmed = false;
  /** Bumped by a skip: detached continuation chains (fan, flips) stop when it changes. */
  private epoch = 0;
  private tapResolver: (() => void) | null = null;
  private failure: string | null = null;
  private revealedUp = [false, false, false, false, false];
  private assetsBase: string;
  private backTextures: [THREE.Texture, THREE.Texture] | null = null;
  /** Pre-rendered machine shown until the live one is ready (same framing), then cross-faded. */
  private poster: HTMLImageElement | null = null;

  constructor(
    container: HTMLElement,
    private opts: MountRipOptions,
  ) {
    this.assetsBase = opts.assetsBase.endsWith("/")
      ? opts.assetsBase
      : `${opts.assetsBase}/`;
    this.reducedOverride = opts.reducedMotion;
    this.jackpotLevel = THREE.MathUtils.clamp(opts.jackpotLevel ?? 1, 0, 1);
    this.reduced = opts.reducedMotion ?? this.motionQuery.matches;

    this.root = document.createElement("div");
    this.root.className = "rip-root";
    this.root.classList.toggle("is-reduced", this.reduced);
    setReducedUI(opts.reducedMotion ?? null);
    container.appendChild(this.root);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 2),
    );
    // A pure devicePixelRatio change (window dragged to another screen) re-sizes too.
    const watchDpr = () => {
      const mq = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );
      const on = () => {
        mq.removeEventListener("change", on);
        if (!this.destroyed) {
          this.resize();
          watchDpr();
        }
      };
      mq.addEventListener("change", on);
    };
    watchDpr();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The machine was calibrated for AgX at 1.15 (machine README). Printed artwork (cards, pack,
    // haze, UI colours) bypasses tone mapping, so brand colours stay exact.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0xfff1e7, 1);
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute(
      "aria-label",
      "The 1% Machine. A pack is cranked out, ripped open, and five cards are revealed.",
    );
    this.root.appendChild(this.renderer.domElement);
    const posterInfo = this.posterInfo();
    if (this.opts.poster !== false && posterInfo.w > 1) {
      const img = new Image();
      img.className = "rip-poster";
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.decoding = "async";
      img.addEventListener("error", () => {
        img.remove();
        if (this.poster === img) this.poster = null;
      });
      img.src =
        typeof this.opts.poster === "string"
          ? this.opts.poster
          : this.assetsBase + posterInfo.file;
      this.root.appendChild(img);
      this.poster = img;
    }
    this.crt = new CRTPass(this.renderer);
    this.compositor = new StageCompositor(this.renderer, MACHINE_LAYER);
    this.finish = new FinishPass(this.renderer);
    this.painter = new CardPainter(this.assetsBase);
    this.root.dataset.painter = this.painter.mode;

    this.overlay = new Overlay(this.root, {
      action: (i, a, b) => this.handleAction(i, a, b),
      share: () => {
        const r = this.prepared?.result;
        if (r)
          this.listeners.share.forEach((cb) =>
            cb({ cardIndex: HIT, tier: r.hit.tier, result: r }),
          );
      },
      verify: () => this.listeners.verify.forEach((cb) => cb()),
      skip: () => this.revealEverything(),
      retry: () => {
        this.listeners.retry.forEach((cb) => cb());
        this.reset();
      },
    });
    this.revealMode = opts.revealMode ?? "tap";
    this.targets = { ...opts.targets };
    if (opts.insets) {
      this.insets = {
        top: Math.max(0, opts.insets.top ?? 0),
        bottom: Math.max(0, opts.insets.bottom ?? 0),
      };
      if (this.insets.top > 0)
        this.root.style.setProperty(
          "--rip-top",
          `calc(${this.insets.top}px + 3.5%)`,
        );
    }
    this.turbo = !!opts.turbo;

    // Light: the asset's own Blender studio, rebuilt as PMREM lightformers (image-based only,
    // like the Cycles renders): crisp softbox reflections on brass, coins, clearcoat and glass.
    this.scene.environment = machineEnvironment(this.renderer);
    // Opaque backdrop drawn by three: the glass globe's transmission needs it.
    this.scene.background = new THREE.Color(C.cream);
    this.camera.layers.enable(MACHINE_LAYER);

    // Machine: the real GLB is loaded in init(); the primitive stand-in is only a fallback.
    this.machineHolder.position.copy(MACHINE_POS);
    this.scene.add(this.machineHolder);

    // Stage haze between the machine and the cards.
    this.hazeMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: hazeFragment,
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) },
        uHaze: { value: 0 },
        uHazeColor: { value: new THREE.Color(C.cream) },
        uMood: { value: 0 },
        uMoodColor: { value: new THREE.Color(C.blush) },
        uMoodAlpha: { value: 0.85 },
        uWave: { value: 0 },
        uWaveOut: { value: 0 },
        uWaveLo: { value: new THREE.Color(C.goldLo) },
        uWaveHi: { value: new THREE.Color(C.goldHi) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    void fullscreenVertex;
    this.haze = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), this.hazeMat);
    this.haze.position.set(0, 0, -1.25);
    // Drawn after the machine glass, before cards, glows and particles.
    this.haze.renderOrder = 4;
    this.scene.add(this.haze);

    // Cards
    for (let i = 0; i < 5; i++) {
      const c = new Card3D(this.cardGeo, i);
      c.root.visible = false;
      this.scene.add(c.root);
      this.cards.push(c);
    }

    // Particles
    const sparkMat = new THREE.MeshBasicMaterial({
      map: sparkTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NormalBlending,
    });
    this.sparks = new ParticlePool(
      new THREE.PlaneGeometry(0.09, 0.09),
      sparkMat,
      24,
      this.camera,
    );
    const sparkleMat = new THREE.MeshBasicMaterial({
      map: sparkleTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.sparkles = new ParticlePool(
      new THREE.PlaneGeometry(0.26, 0.26),
      sparkleMat,
      24,
      this.camera,
    );
    this.holoShardMat = holoShardMaterial();
    this.holoShards = new ParticlePool(
      shardGeometry(40, seededRandom("holo")),
      this.holoShardMat,
      40,
      this.camera,
    );
    const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.035, 28);
    this.coins = new ParticlePool(
      coinGeo,
      [this.mats.coinSide, this.mats.coinFace, this.mats.coinFace],
      60,
      this.camera,
    );
    this.coins.gravity = -7.5;
    this.coins.drag = 0.15;
    this.sparkles.gravity = 0;
    this.sparkles.drag = 1.8;
    this.sparks.gravity = -1.5;
    this.sparks.drag = 2.4;
    this.holoShards.gravity = -2.2;
    this.holoShards.drag = 1.1;
    this.confetti = confettiPool(this.camera, 60);
    [
      this.sparks,
      this.sparkles,
      this.holoShards,
      this.coins,
      this.confetti,
    ].forEach((p) => (p.mesh.renderOrder = 9));
    this.scene.add(this.confetti.mesh, this.rays.mesh, this.flash.mesh);
    this.sparks.mesh.layers.enable(BLOOM_LAYER);
    this.rays.mesh.layers.enable(BLOOM_LAYER);
    this.sparkles.mesh.layers.enable(BLOOM_LAYER);
    this.scene.add(
      this.sparks.mesh,
      this.sparkles.mesh,
      this.holoShards.mesh,
      this.coins.mesh,
    );

    const solTex = solCoinTexture();
    // Cylinder caps map the texture sideways: turn it upright when the coin faces the camera.
    solTex.center.set(0.5, 0.5);
    solTex.rotation = Math.PI / 2;
    const solFace = new THREE.MeshStandardMaterial({
      map: solTex,
      metalness: 0.55,
      roughness: 0.3,
    });
    const solSide = new THREE.MeshStandardMaterial({
      color: "#e7b85a",
      metalness: 1,
      roughness: 0.22,
    });
    this.solCoin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.05, 64),
      [solSide, solFace, solFace],
    );
    this.solCoin.visible = false;
    this.scene.add(this.solCoin);

    // Events
    this.root.addEventListener("pointermove", this.onPointerMove);
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("pointerdown", this.onStagePointerDown);
    document.addEventListener("keydown", this.onKey);
    this.root.addEventListener("pointerleave", this.onPointerLeave);
    this.motionQuery.addEventListener("change", this.onMotionChange);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.resize();

    this.ready = this.init();
    void this.ready.catch(this.renderFailed);
    this.raf = requestAnimationFrame(this.frame);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private renderFailed = () => {
    if (!this.destroyed)
      this.root.dispatchEvent(new Event("rip-render-error", { bubbles: true }));
  };

  private async init() {
    const url =
      this.opts.machineUrl === undefined
        ? "./models/onepercent-machine.glb"
        : this.opts.machineUrl;
    const machine = url ? loadMachineGLB(url) : Promise.resolve(null);
    this.loadBackdrop();
    await ensureFonts();
    if (this.destroyed) return;
    const back = await this.painter.paint({ kind: "back" });
    if (this.destroyed) return;
    const [backArt, backMask] = texturesFrom(back, this.renderer);
    this.backTextures = [backArt, backMask];
    this.cards.forEach((c) => c.setBack(...this.backTextures!));
    this.packTexture(this.edition);
    const glb = await machine;
    if (this.destroyed) return;
    this.setMachine(
      glb ?? buildStandInMachine(this.mats),
      glb ? "glb" : "stand-in",
    );
    this.machineHolder.visible = false;
    await this.compileDetached(this.machineHolder, () => false);
    if (this.destroyed) return;
    // With a poster on screen, the live machine replaces it in place (a cross-fade);
    // otherwise it arrives through a soft cream veil with a 2 % settle (no pop-in).
    this.machineHolder.visible = true;
    if (this.poster) {
      const img = this.poster;
      this.poster = null;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          img.classList.add("is-out");
          setTimeout(() => img.remove(), this.reduced ? 200 : 600);
        }),
      );
    } else if (!this.reduced) {
      this.hazeMat.uniforms.uHaze.value = 0.95;
      this.machineHolder.scale.setScalar(1.02);
      this.anim.tween(
        650,
        (t) => {
          this.hazeMat.uniforms.uHaze.value = 0.95 * (1 - t);
          this.machineHolder.scale.setScalar(1.02 - 0.02 * t);
        },
        ease.arrive,
      );
    }
    // Cards and particles: both program variants compiled asynchronously, never drawn.
    for (const c of this.cards) {
      await this.compileDetached(c.root, () => false);
      if (this.destroyed) return;
    }
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const pools = [
      this.sparks,
      this.sparkles,
      this.holoShards,
      this.coins,
      this.confetti,
    ];
    pools.forEach((p) => {
      p.mesh.count = 1;
      p.mesh.setMatrixAt(0, hidden);
      p.mesh.instanceMatrix.needsUpdate = true;
    });
    for (const p of pools) await this.compileDetached(p.mesh, () => true);
    if (this.destroyed) return;
    // Warm every screen pass once (render targets, blur, bloom, punch, CRT), then overwrite the
    // image in the same task so the warm-up frame is never presented.
    this.crt.amount = 0.0011;
    this.compositor.blur = 0.5;
    this.finish.bloom = 0.5;
    this.finish.punch = 0.5;
    this.crt.render(() => {
      this.compositor.render(this.scene, this.camera);
      this.finish.render(this.scene, this.camera, this.edgeMaterials);
    }, 0);
    this.finish.bloom = 0;
    this.finish.punch = 0;
    this.compositor.blur = 0;
    this.crt.amount = 0;
    pools.forEach((p) => (p.mesh.count = 0));
    this.compositor.render(this.scene, this.camera);
    this.root.dataset.ready = "true";
    void this.prebuildPacks().catch(this.renderFailed);
  }

  /**
   * Compiles an object's shaders without it ever being drawn: it is detached from the scene
   * while compileAsync runs over several frames (a visible object at its default transform
   * was the "full-screen pack at open" flash), then re-attached with its proper visibility.
   */
  private async compileDetached(
    obj: THREE.Object3D,
    visibleAfter: () => boolean,
  ) {
    if (this.destroyed) return;
    return this.shaders.run(async () => {
      const parent = obj.parent;
      parent?.remove(obj);
      obj.visible = true;
      try {
        // Two program variants: the screen, and the bloom target (linear output).
        const screen = this.shaders.run(async () => {
          await this.renderer.compileAsync(obj, this.camera, this.scene);
        });
        const prev = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.finish.bloomTarget);
        const bloom = this.shaders.run(async () => {
          await this.renderer.compileAsync(obj, this.camera, this.scene);
        });
        this.renderer.setRenderTarget(prev);
        await Promise.all([screen, bloom]);
      } finally {
        obj.visible = visibleAfter();
        parent?.add(obj);
      }
    });
  }

  /** Pack geometry (height field, sheets, normals) is built in a Worker: no long task. */
  private packGeometry(edition: Edition): Promise<PackGeometryData> {
    const url = new URL(
      this.assetsBase + EDITIONS[edition].image,
      document.baseURI,
    ).href;
    if (!this.packWorker && typeof Worker !== "undefined") {
      try {
        this.packWorker = new Worker(
          new URL("./pack-worker.ts", import.meta.url),
          { type: "module", name: "rip-pack-geometry" },
        );
        this.packWorker.onmessage = (
          e: MessageEvent<{ id: number; geo?: PackGeometryData }>,
        ) => {
          this.packPending.get(e.data.id)?.(e.data.geo ?? null);
          this.packPending.delete(e.data.id);
        };
      } catch {
        this.packWorker = null;
      }
    }
    const fallback = async () => {
      const tex = await this.packTexture(edition);
      return buildPackGeometry(tex.image as ImageBitmap, EDITIONS[edition]);
    };
    if (!this.packWorker) return fallback();
    const id = ++this.packReq;
    return new Promise<PackGeometryData | null>((res) => {
      this.packPending.set(id, res);
      this.packWorker!.postMessage({ id, url, tear: EDITIONS[edition].tear });
    }).then((d) => d ?? fallback());
  }

  /** Packs are built once per edition and reused. */
  private getPack(edition: Edition): Promise<Pack3D> {
    let p = this.packBuilds.get(edition);
    if (!p) {
      p = Promise.all([
        this.packTexture(edition),
        this.packGeometry(edition),
      ]).then(([tex, geo]) => {
        const pack = new Pack3D(tex, EDITIONS[edition], geo);
        pack.reset();
        this.scene.add(pack.group);
        this.packs.set(edition, pack);
        return pack;
      });
      this.packBuilds.set(edition, p);
    }
    return p;
  }

  /** Builds and compiles every edition's pack while the machine idles. */
  /** Resolves once nothing is playing (background work never competes with a Rip). */
  private async whileIdle() {
    while (this.state === "playing" && !this.destroyed)
      await new Promise((r) => setTimeout(r, 400));
  }

  private async prebuildPacks() {
    // Selected edition first; each step is small (worker geometry, async compile, bitmap upload).
    const order = [
      this.edition,
      ...(Object.keys(EDITIONS) as Edition[]).filter((e) => e !== this.edition),
    ];
    for (const ed of order) {
      const p = await this.getPack(ed);
      await this.whileIdle();
      if (this.destroyed) return;
      await nextFrame();
      if (this.destroyed) return;
      this.renderer.initTexture(p.texture);
      await nextFrame();
      await this.compileDetached(
        p.group,
        () => p.bodyMat.uniforms.uOpacity.value > 0.001,
      );
    }
    this.packWorker?.terminate();
    this.packWorker = null;
    if (this.destroyed) return;
    // Warm the painting pipeline (worker fonts, canvas) so the first real face paints fast.
    await this.whileIdle();
    await this.painter
      .paint({ kind: "dust", card: null, edition: "original" })
      .then((p) => p.images.forEach((i) => "close" in i && i.close()));
    // The 1% relief is only needed for a 1% pull: build it in the background only after the
    // first-tap window (3 s after ready) and while idle; a 1% result builds it on demand.
    await new Promise((r) => setTimeout(r, 3000));
    await this.whileIdle();
    if (!this.destroyed) await this.ensureReveal();
  }

  /**
   * The PackReveal relief (The 1% only) is built in a Worker, rebuilt here from its buffers,
   * compiled while detached and uploaded once offscreen: no long task, no first-use hitch.
   */
  private revealUrgent = false;
  /** Waits for a quiet moment, unless a The 1% pull needs the relief now. */
  private async revealIdle() {
    while (!this.revealUrgent && this.state === "playing" && !this.destroyed)
      await new Promise((r) => setTimeout(r, 200));
  }

  private ensureReveal(urgent = false): Promise<RevealAsset | null> {
    if (urgent) this.revealUrgent = true;
    if (this.reveal) return Promise.resolve(this.reveal);
    if (!this.revealBuild) {
      this.revealBuild = (async () => {
        const [closed, pepe] = await this.loadReveal();
        let asset: RevealAsset;
        try {
          asset = await buildRevealOffThread(closed, pepe);
        } catch {
          // No module workers: build here (one long task, done while idle).
          await this.revealIdle();
          const a = createPackAsset({
            closedTexture: closed,
            referenceTexture: pepe,
          });
          asset = {
            group: a.group,
            setProgress: a.setProgress,
            dispose: a.dispose,
          };
        }
        if (this.destroyed) {
          asset.dispose();
          return null;
        }
        await this.revealIdle();
        if (this.destroyed) {
          asset.dispose();
          return null;
        }
        this.renderer.initTexture(closed);
        this.renderer.initTexture(pepe);
        await this.compileDetached(asset.group, () => false);
        if (this.destroyed) {
          asset.dispose();
          return null;
        }
        // Offscreen draws upload geometry and morph textures before the first real use, one
        // mesh per frame (no long task).
        const rt = new THREE.WebGLRenderTarget(8, 8);
        const meshes: THREE.Mesh[] = [];
        asset.group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
        });
        asset.group.visible = true;
        for (const m of meshes) {
          await this.revealIdle();
          await nextFrame();
          if (this.destroyed) {
            rt.dispose();
            asset.dispose();
            return null;
          }
          const parent = m.parent;
          const tmp = new THREE.Scene();
          m.updateWorldMatrix(true, false);
          const fc = m.frustumCulled;
          m.frustumCulled = false;
          tmp.add(m);
          this.renderer.setRenderTarget(rt);
          this.renderer.render(tmp, this.camera);
          this.renderer.setRenderTarget(null);
          parent?.add(m);
          m.frustumCulled = fc;
        }
        rt.dispose();
        asset.group.visible = false;
        this.scene.add(asset.group);
        this.reveal = asset;
        return asset;
      })();
    }
    return this.revealBuild;
  }

  private setMachine(root: THREE.Object3D, source: "glb" | "stand-in") {
    this.machineHolder.clear();
    this.machineHolder.add(root);
    root.traverse((o) => o.layers.set(MACHINE_LAYER));
    this.machineHolder.updateMatrixWorld(true);
    this.machine = new MachineRig(
      root.getObjectByName("Machine_Root") ?? root,
      source,
    );
    this.setFill(this.jackpotLevel);
    this.root.dataset.machine = source;
    // Jackpot coins reuse the globe's own coin mesh and material.
    const proto = this.machine.coinPrototype();
    if (proto && source === "glb") {
      this.coins.mesh.geometry = proto.geometry;
      this.coins.mesh.material = proto.material;
      this.coinScale = proto.scale;
    }
  }

  /** Cream studio: the hero studio photo washed in cream, drawn by three (opaque, for the glass). */
  private loadBackdrop() {
    if (this.opts.backdrop && this.opts.backdrop !== "studio") {
      this.scene.background = new THREE.Color(this.opts.backdrop);
      return;
    }
    loadImage(this.assetsBase + "hero-studio-clean.webp").then((img) => {
      if (!img || this.destroyed) return;
      this.backdropImage = img as HTMLImageElement;
      this.paintBackdrop();
    });
  }

  private paintBackdrop() {
    const img = this.backdropImage;
    if (!img) return;
    const r = this.root.getBoundingClientRect();
    const pr = Math.min(2, this.renderer.getPixelRatio());
    const w = Math.max(2, Math.round(r.width * pr)),
      h = Math.max(2, Math.round(r.height * pr));
    const c =
      (this.backdrop?.image as HTMLCanvasElement | undefined) ??
      document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const iw = img.naturalWidth,
      ih = img.naturalHeight;
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s,
      dh = ih * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) * 0.35, dw, dh);
    ctx.fillStyle = "rgba(255,241,231,.86)";
    ctx.fillRect(0, 0, w, h);
    if (!this.backdrop) {
      this.backdrop = new THREE.CanvasTexture(c);
      this.backdrop.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = this.backdrop;
    } else {
      this.backdrop.dispose();
      this.backdrop.needsUpdate = true;
    }
  }

  /** Images decode off the main thread (createImageBitmap, flipped at decode), so uploads are cheap. */
  private bitmapTexture(url: string): Promise<THREE.Texture> {
    const toTex = (img: TexImageSource, flipY: boolean) => {
      const t = new THREE.Texture(img);
      t.flipY = flipY;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      t.needsUpdate = true;
      return t;
    };
    if (typeof createImageBitmap === "undefined")
      return new THREE.TextureLoader()
        .loadAsync(url)
        .then((t) => toTex(t.image, true));
    const loader = new THREE.ImageBitmapLoader();
    loader.setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });
    return loader
      .loadAsync(url)
      .then((bmp) => toTex(bmp as ImageBitmap, false));
  }

  private packTexture(edition: Edition): Promise<THREE.Texture> {
    let p = this.packTextures.get(edition);
    if (!p) {
      p = this.bitmapTexture(this.assetsBase + EDITIONS[edition].image);
      this.packTextures.set(edition, p);
    }
    return p;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  on<E extends keyof RipEventMap>(event: E, cb: RipEventMap[E]): () => void {
    (this.listeners[event] as Set<RipEventMap[E]>).add(cb);
    return () => (this.listeners[event] as Set<RipEventMap[E]>).delete(cb);
  }

  setResult(result: RipResult) {
    // A private copy: quotes that arrive later (setQuotes) update it, never the app's object.
    this.result = {
      ...result,
      hit: { ...result.hit },
      dust: result.dust.map((d) => ({ ...d })),
    };
    this.resultUsed = false;
    this.resultToken++;
    this.quotesVersion = 0;
    if (this.state === "playing") this.kickPrepare();
  }

  setQuotes(q: RipQuotes) {
    const r = this.result;
    if (!r) return;
    let hitChanged = false;
    const dustChanged: number[] = [];
    q.dust?.forEach((v, i) => {
      if (v === undefined || !r.dust[i] || r.dust[i].valueSolUi === v) return;
      r.dust[i].valueSolUi = v;
      dustChanged.push(i);
    });
    if (q.hit) {
      if (
        "valueSolUi" in q.hit &&
        q.hit.valueSolUi !== undefined &&
        q.hit.valueSolUi !== r.hit.valueSolUi
      ) {
        r.hit.valueSolUi = q.hit.valueSolUi;
        // Only the Jackpot and The 1% paint their value; a stock hit's face shows its amount (D30).
        hitChanged = r.hit.tier === "jackpot" || r.hit.tier === "one_pct";
      }
      if ("sellBackSolUi" in q.hit && q.hit.sellBackSolUi !== undefined)
        r.hit.sellBackSolUi = q.hit.sellBackSolUi;
    }
    this.quotesVersion++;
    // Faces painted with the old quotes are repainted off-thread and swapped when ready.
    if (this.prepared && this.prepared.result === r)
      this.repaintQuotes(dustChanged, hitChanged);
    // Overlay chips (title, Sell) update in place.
    if (this.state === "end" && !r.hit.sellBackReason) {
      this.overlay.setActionChip(
        HIT,
        "sell_back",
        this.sellChip(r.hit.sellBackSolUi),
        this.hints().sell_back,
      );
    }
  }

  private quotesVersion = 0;
  private async repaintQuotes(dust: number[], hit: boolean) {
    const prep = this.prepared!;
    const run = this.runId;
    const jobs: [number, PaintJob][] = dust.map((i) => [
      i,
      {
        kind: "dust",
        card: prep.result.dust[i] ?? null,
        edition: this.edition,
      } as PaintJob,
    ]);
    if (hit) jobs.push([HIT, { kind: "hit", hit: prep.result.hit }]);
    const out = await Promise.all(
      jobs.map(
        async ([i, j]) =>
          [
            i,
            texturesFrom(await this.painter.paint(j), this.renderer),
          ] as const,
      ),
    );
    if (run !== this.runId || this.prepared !== prep) {
      out.forEach(([, t]) => t.forEach((x) => x.dispose()));
      return;
    }
    for (const [i, pair] of out) {
      await nextFrame();
      pair.forEach((t) => this.renderer.initTexture(t));
      const old = i === HIT ? prep.hit : prep.dust[i];
      if (i === HIT) prep.hit = pair as TexPair;
      else prep.dust[i] = pair as TexPair;
      const c = this.cards[i];
      // Swap only faces that are already showing their final art (the 1% teaser stays until takeover).
      const showingFinal = c.front.uniforms.uMap.value === old[0];
      if (showingFinal)
        c.setFaceTextures(
          pair[0],
          pair[1],
          i === HIT ? TIERS[prep.result.hit.tier].holo : 0,
        );
      old.forEach((t) => t.dispose());
    }
  }

  setActionState(cardIndex: number, action: CardAction, state: ActionState) {
    this.overlay.setActionState(cardIndex, action, state);
  }

  private insets = { top: 0, bottom: 0 };
  setInsets(insets: { top?: number; bottom?: number }) {
    const next = {
      top: Math.max(0, insets.top ?? 0),
      bottom: Math.max(0, insets.bottom ?? 0),
    };
    if (next.top === this.insets.top && next.bottom === this.insets.bottom)
      return;
    this.insets = next;
    // Titles and captions sit below a host header.
    if (next.top > 0)
      this.root.style.setProperty("--rip-top", `calc(${next.top}px + 3.5%)`);
    else this.root.style.removeProperty("--rip-top");
    // Only the framing changes (no renderer resize, no texture repaint): re-aim the camera.
    if (this.state === "idle") {
      const f = this.fit(SHOTS.idle);
      this.cam.pos.copy(f.pos);
      this.cam.look.copy(f.look);
      this.placePoster();
    } else if (this.state === "end") {
      this.moveCamera(SHOTS.end, this.reduced ? 0 : 300, ease.arrive);
      this.positionActions();
    }
  }

  setReducedMotion(value: boolean) {
    this.reducedOverride = value;
    this.reduced = value;
    setReducedUI(value);
    this.root.classList.toggle("is-reduced", value);
  }

  async play(input: RipInput): Promise<void> {
    const fromEnd =
      this.state === "end" &&
      !this.reduced &&
      this.cards.some((c) => c.root.visible);
    const run = this.beginRun();
    this.edition = input.edition in EDITIONS ? input.edition : "original";
    this.rnd = seededRandom(input.pullId ?? `pull-${Date.now()}`);
    this.state = "playing";
    this.skipRequested = false;
    this.skipArmed = false;
    this.failure = null;
    this.revealedUp = [false, false, false, false, false];
    this.picked.clear();
    this.revealAllRequested = false;
    this.picking = false;
    this.slotOf = [...SLOT_OF];
    this.anim.speed = this.turbo ? 0.55 : 1;
    if (this.resultUsed) {
      // A new pull needs a new result; a result set before play() is kept.
      this.result = null;
      this.disposePrepared();
      this.resultUsed = false;
    }
    await this.ready;
    this.check(run);
    this.playT0 = this.anim.now;
    const packP = this.getPack(this.edition);
    if (fromEnd) await this.exitEnd(run);
    const pack = await packP;
    this.check(run);
    this.resetScene();
    this.kickPrepare();
    this.pack = pack;
    this.pack.reset();
    if (this.reduced) return this.playReduced(run);
    return this.playFull(run, fromEnd);
  }

  setJackpotLevel(level: number, animateMs = 700) {
    const to = THREE.MathUtils.clamp(Number.isFinite(level) ? level : 1, 0, 1);
    this.jackpotLevel = to;
    if (!this.machine) return;
    const tween = ++this.jackpotTween;
    const from = this.machineFill;
    if (animateMs <= 0 || this.reduced) {
      this.setFill(to);
      return;
    }
    // Independent of the Rip timeline: not cancelled by reset().
    const t0 = performance.now();
    const step = () => {
      if (tween !== this.jackpotTween || this.destroyed) return;
      const k = Math.min(1, (performance.now() - t0) / animateMs);
      this.setFill(lerp(from, to, ease.inOutSine(k)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  skip() {
    if (this.state !== "playing" || this.reduced) return;
    this.skipRequested = true;
    this.overlay.showSkip(false);
    this.tapResolver?.();
    this.pickResolver?.("all");
    // Cut now if the result is in; otherwise the cut happens right after the lock.
    if (this.skipArmed) this.anim.finishAll();
  }

  fail(message?: string) {
    if (this.state !== "playing" || this.skipArmed || this.resultUsed) return;
    this.failure = message ?? "The draw didn't complete.";
    this.waiters.forEach((w) => w());
  }

  enableMotion() {
    this.askGyro();
  }

  setRevealMode(mode: "auto" | "tap") {
    this.revealMode = mode === "tap" ? "tap" : "auto";
    if (this.revealMode === "auto") {
      this.tapResolver?.();
      this.revealAll();
    }
  }

  setTurbo(on: boolean) {
    this.turbo = !!on;
    if (this.state === "playing" && !this.skipRequested)
      this.anim.speed = this.turbo ? 0.55 : 1;
  }

  private machineFill = 1;
  private setFill(level: number) {
    this.machineFill = level;
    if (this.machine) this.machine.fill = level;
  }

  reset() {
    this.beginRun();
    this.resetScene();
    this.state = "idle";
    this.cam.pos.copy(this.fit(SHOTS.idle).pos);
    this.cam.look.copy(SHOTS.idle.look);
    this.beat("idle");
  }

  async animateSellBack(
    cardIndex: number,
    solUi?: number | string,
  ): Promise<void> {
    const card = this.cards[cardIndex];
    if (!card || this.soldBack.has(cardIndex) || this.state !== "end") return;
    // Spec C3: only stock hits (Silver, Blue, Holo, Black Foil) can be sold back to the machine.
    const tier = this.prepared?.result.hit.tier;
    if (cardIndex !== HIT || tier === "jackpot" || tier === "one_pct") return;
    this.soldBack.add(cardIndex);
    const run = this.runId;
    const sol = fmtSol(
      solUi ??
        this.prepared?.result.hit.sellBackSolUi ??
        this.prepared?.result.hit.valueSolUi ??
        "",
    );
    this.beat("sell-back");
    this.sound("sellback.slide", cardIndex);
    this.overlay.hideActionsFor(cardIndex);
    const startPos = card.root.position.clone();
    const startScale = card.root.scale.x;
    const slot = this.machine.worldOf(this.machine.slot);
    const tray = this.machine.worldOf(this.machine.packSpawn);
    const r = this.reduced;
    if (r) {
      await this.anim.tween(150, (t) => (card.opacity = 1 - t));
      card.root.visible = false;
    } else {
      this.tweenHaze(0.1, 350);
      this.tweenDefocus(0, 400);
      this.moveCamera(SHOTS.sell, 650, ease.compose);
      // The card slides back into the machine, turning face-down as it goes in.
      // The card arcs to the coin slot and turns edge-on to slip into it.
      const slotIn = slot.clone().add(V(0, 0, 0.05));
      await this.anim.tween(
        760,
        (t, raw) => {
          const p = new THREE.Vector3().copy(startPos).lerp(slotIn, t);
          p.y += Math.sin(Math.PI * t) * 0.9;
          card.root.position.copy(p);
          card.root.scale.setScalar(lerp(startScale, 0.16, t));
          card.flip.rotation.y = lerp(
            0,
            Math.PI / 2,
            ease.inOutSine(clamp01(raw * 1.25)),
          );
          card.root.rotation.z = Math.sin(Math.PI * t) * -0.25;
          card.opacity = 1 - clamp01((raw - 0.86) / 0.14);
        },
        ease.compose,
      );
      card.root.visible = false;
      if (run !== this.runId) return;
      const a0 = this.crank;
      this.anim.tween(
        520,
        (t) => this.setCrank(a0 + Math.PI * t),
        ease.springSoft,
      );
      await this.anim.tween(
        200,
        (t) => (this.machine.flapOpen = t),
        ease.spring,
      );
    }
    if (run !== this.runId) return;
    // A SOL coin pops out of the tray and lands where the card was.
    this.sound("coin.pop", cardIndex);
    const coin = this.solCoin;
    coin.visible = true;
    const land = startPos.clone().add(V(0, 0.05, 0.2));
    if (r) {
      coin.position.copy(land);
      coin.rotation.set(Math.PI / 2, 0, 0);
      coin.scale.setScalar(1);
    } else {
      await this.anim.tween(
        820,
        (t, raw) => {
          const p = tray.clone().lerp(land, t);
          p.y += Math.sin(Math.PI * Math.min(1, raw * 1.05)) * 1.6;
          coin.position.copy(p);
          coin.rotation.set(Math.PI / 2, raw * Math.PI * 6, 0);
          coin.scale.setScalar(lerp(0.4, 1, ease.outCubic(raw)));
        },
        ease.inOutSine,
      );
      this.anim.tween(
        220,
        (t) => (this.machine.flapOpen = 1 - t),
        ease.outQuad,
      );
      this.tweenHaze(0.4, 500);
      this.tweenDefocus(0.6, 600);
      this.moveCamera(SHOTS.end, 650, ease.compose);
    }
    const screen = this.project(land.clone().add(V(0, -0.36, 0)));
    const toast = this.overlay.toast(
      screen.x,
      screen.y,
      `<span class="rip-chip">+${sol} SOL</span><span>${endCopy("rip.end.sold")}</span>`,
    );
    this.overlay.announce(endCopy("cards.done.sell", { sol }));
    this.beat("sell-back-done");
    // The result bar keeps the amount; the coin and toast leave and the row closes the gap.
    if (this.prepared)
      this.overlay.setResult(
        this.tierTitle(this.prepared).title,
        endCopy("rip.end.soldChip", { sol }),
        { verify: this.prepared.result.verifyUrl ?? true },
      );
    await this.anim.wait(r ? 600 : 1300);
    if (run !== this.runId) return;
    toast.classList.remove("is-on");
    setTimeout(() => toast.remove(), 400);
    const c0 = coin.scale.x;
    await this.anim.tween(
      r ? 120 : 320,
      (t) => {
        coin.scale.setScalar(c0 * (1 - t));
      },
      ease.inCubic,
    );
    coin.visible = false;
    if (run !== this.runId) return;
    this.closeRow(r);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.beginRun();
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.root.removeEventListener("pointermove", this.onPointerMove);
    this.root.removeEventListener("pointerleave", this.onPointerLeave);
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("pointerdown", this.onStagePointerDown);
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("deviceorientation", this.onOrientation);
    this.motionQuery.removeEventListener("change", this.onMotionChange);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.overlay.destroy();
    this.root.remove();
    // Stop input and rendering now; Three may still be polling shader programs.
    this.shaders.close(() => this.disposeResources());
  }

  private disposeResources() {
    this.packs.forEach((p) => p.dispose());
    this.reveal?.dispose();
    this.cards.forEach((c) => c.dispose());
    this.cardGeo.dispose();
    this.crt.dispose();
    this.compositor.dispose();
    this.finish.dispose();
    this.painter.dispose();
    this.backdrop?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) =>
          mat?.dispose(),
        );
      }
    });
    this.renderer.dispose();
  }

  // -------------------------------------------------------------------------
  // Run control
  // -------------------------------------------------------------------------

  private beginRun(): number {
    this.runId++;
    this.tapResolver?.();
    this.tapResolver = null;
    this.pickResolver?.("all");
    this.pickResolver = null;
    this.anim.flush();
    this.waiters.forEach((w) => w());
    this.waiters.clear();
    return this.runId;
  }

  private check(run: number) {
    if (run !== this.runId || this.destroyed) throw new AbortRip();
    if (this.skipRequested && this.skipArmed) throw new SkipSignal();
  }

  private beat(b: RipBeat) {
    this.root.dataset.beat = b;
    this.listeners.beat.forEach((cb) => cb(b));
  }

  private sound(cue: SoundCue, index?: number) {
    const ev = index === undefined ? { cue } : { cue, index };
    this.listeners.sound.forEach((cb) => cb(ev));
    this.opts.onSound?.(ev);
  }

  private kickPrepare() {
    const result = this.result;
    if (!result) return;
    const key = `${this.resultToken}:${this.edition}`;
    if (this.prepared?.key === key || this.preparing === key) return;
    this.preparing = key;
    this.prepare(result, key)
      .then((p) => {
        if (this.preparing !== key) return;
        this.preparing = null;
        this.disposePrepared();
        this.prepared = p;
        this.waiters.forEach((w) => w());
        this.waiters.clear();
      })
      .catch((err) => console.error("[rip] could not prepare the result", err));
  }

  private disposePrepared() {
    const p = this.prepared;
    if (!p) return;
    [...p.dust.flat(), ...p.hit, ...(p.teaser ?? [])].forEach((t) =>
      t.dispose(),
    );
    this.prepared = null;
  }

  private async prepare(result: RipResult, key: string): Promise<Prepared> {
    const dustIn = result.dust.slice(0, 4);
    if (result.hit.tier === "one_pct") this.ensureReveal(true);
    // Every face is painted in the Worker (OffscreenCanvas) in parallel with the animation;
    // the main thread only uploads, one texture per frame.
    const jobs: PaintJob[] = [
      ...[0, 1, 2, 3].map(
        (i) =>
          ({
            kind: "dust",
            card: dustIn[i] ?? null,
            edition: this.edition,
          }) as PaintJob,
      ),
      { kind: "hit", hit: result.hit },
      // Painted for every tier so the prepare time never depends on the outcome.
      { kind: "teaser", hit: result.hit },
    ];
    let painted: THREE.Texture[][];
    if (this.painter.mode === "worker") {
      // All faces in parallel off the main thread.
      painted = (await Promise.all(jobs.map((j) => this.painter.paint(j)))).map(
        (p) => texturesFrom(p, this.renderer),
      );
    } else {
      // Main-thread fallback: one face per frame.
      painted = [];
      for (const job of jobs) {
        await nextFrame();
        painted.push(
          texturesFrom(await this.painter.paint(job), this.renderer),
        );
      }
    }
    // Upload one texture per frame (a 1280 × 1792 face with mipmaps is the biggest single cost).
    for (const t of painted.flat()) {
      await nextFrame();
      this.renderer.initTexture(t);
    }
    const dust = painted.slice(0, 4) as TexPair[];
    await nextFrame();
    this.updateBands({ result } as Prepared);
    const hit = painted[4] as TexPair;
    let teaser: TexPair | null = painted[5] as TexPair;
    if (result.hit.tier !== "one_pct") {
      teaser.forEach((t) => t.dispose());
      teaser = null;
    }
    return { key, result, dust, hit, teaser };
  }

  private waitPrepared(run: number): Promise<void> {
    if (
      this.prepared &&
      this.preparing === null &&
      this.result &&
      this.prepared.result === this.result
    )
      return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => {
        if (run !== this.runId) reject(new AbortRip());
        else if (this.failure) reject(new RipFailedError(this.failure));
        else if (this.prepared && this.prepared.result === this.result)
          resolve();
        else this.waiters.add(done);
      };
      this.waiters.add(done);
    });
  }

  private loadReveal() {
    if (!this.revealTextures) {
      this.revealTextures = Promise.all([
        this.bitmapTexture(this.assetsBase + "pack-closed-hq.webp"),
        this.bitmapTexture(this.assetsBase + "pepe-all-white-hq.webp"),
      ]) as Promise<[THREE.Texture, THREE.Texture]>;
    }
    return this.revealTextures;
  }

  // -------------------------------------------------------------------------
  // Scene state
  // -------------------------------------------------------------------------

  /** Rip again from the end state: the cards glide down and out, the title fades, no cut. */
  private async exitEnd(run: number) {
    const A = this.anim;
    this.layoutLive = false;
    this.beat("exit");
    this.overlay.showActions(false);
    this.overlay.clearToasts();
    this.overlay.setResult(null);
    this.overlay.setPips(null);
    this.solCoin.visible = false;
    this.tweenHaze(0, 320);
    this.tweenDefocus(0, 360);
    // The cards clear first; the camera starts its push to the crank a beat later.
    A.wait(110).then(() => {
      if (run === this.runId) this.moveCamera(SHOTS.crank, 640, ease.compose);
    });
    const outs = this.cards.map((c, i) => {
      if (!c.root.visible) return Promise.resolve();
      const slot = SLOT_OF[i];
      const p0 = c.root.position.clone(),
        r0 = c.root.rotation.z,
        s0 = c.root.scale.x;
      // They drop back and away from the camera (which pushes in to the crank), fading early:
      // the large card never sweeps across the lens.
      return A.wait(Math.abs(slot - 2) * 30).then(() =>
        A.tween(
          300,
          (t, raw) => {
            c.root.position.set(
              p0.x + (slot - 2) * 0.2 * t,
              p0.y - 2.2 * t,
              p0.z - 2.4 * t,
            );
            c.root.rotation.z = r0 + (slot - 2) * 0.1 * t;
            c.root.scale.setScalar(s0 * (1 - 0.4 * t));
            const o = 1 - clamp01((raw - 0.15) / 0.6);
            c.opacity = o;
            c.setShadow(0.16 * o);
          },
          ease.inQuad,
        ),
      );
    });
    await Promise.all(outs);
    this.check(run);
    this.overlay.clear();
  }

  private resetScene() {
    this.packs.forEach((p) => p.reset());
    if (this.reveal) {
      this.reveal.group.visible = false;
      this.reveal.setProgress(0);
    }
    this.cards.forEach((c) => {
      c.root.visible = false;
      c.root.position.set(0, 0, 0);
      c.root.rotation.set(0, 0, 0);
      c.root.scale.setScalar(1);
      c.tilt.rotation.set(0, 0, 0);
      c.flip.rotation.set(0, Math.PI, 0);
      c.opacity = 1;
      c.dim = 1;
      c.setGlow(0);
      c.setShadow(0);
      const u = c.front.uniforms;
      u.uShine.value = -1;
      u.uShineAmt.value = 0;
      u.uGlint.value = 0;
      u.uGoldGlow.value = 0;
      u.uGlare.value = 0;
      u.uPointer.value.set(0, 0);
    });
    [
      this.sparks,
      this.sparkles,
      this.holoShards,
      this.coins,
      this.confetti,
    ].forEach((p) => p.clear());
    this.rays.opacity = 0;
    this.flash.opacity = 0;
    this.fovKick = 0;
    this.bloomExtra = 0;
    this.solCoin.visible = false;
    this.soldBack.clear();
    this.resetEndLayout();
    this.overlay.clear();
    const hu = this.hazeMat.uniforms;
    hu.uHaze.value = 0;
    hu.uMood.value = 0;
    hu.uWave.value = 0;
    hu.uWaveOut.value = 0;
    this.crt.amount = 0;
    this.crt.bands = 0;
    if (this.machine) {
      this.setFill(this.jackpotLevel);
      this.machine.flapOpen = 0;
    }
    this.defocus = 0;
    this.hitOverCrt = false;
    this.bloomLevel = 0.35;
    this.punch = 0;
    this.setCrank(0);
    this.shakeAmp = 0;
    this.dolly = 0;
    this.autoHolo = false;
    this.hovered = null;
    this.fanFloat = 0;
  }

  private setCrank(a: number) {
    this.crank = a;
    if (this.machine) this.machine.crankAngle = a;
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  /** Pulls the camera back on narrow viewports so every shot keeps its framing. */
  private get portrait() {
    return this.aspect < 0.85;
  }

  /** Pulls the camera back just enough for the shot's subject to fit this viewport. */
  private fit(shot: Shot): Shot {
    const name = (Object.keys(SHOTS) as ShotName[]).find(
      (k) => SHOTS[k] === shot,
    );
    const dir = shot.pos.clone().sub(shot.look);
    const d = dir.length();
    let k = 1;
    const hh = d * Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
    // A top inset (host header) is always on screen; the bottom one (a dock) only in the idle and
    // end shots (it hides during a Rip).
    const useInsets = name === "idle" || name === "end" || name === "sell";
    const H = Math.max(1, this.root.clientHeight);
    let top = this.insets.top,
      bottom = useInsets ? this.insets.bottom : 0;
    const look = shot.look.clone();
    if (name) {
      let [needW, needH] = SHOT_NEEDS[name][this.portrait ? 1 : 0];
      let minK = 1;
      if (name === "end") {
        // Frame exactly the end layout in the band between the title and the actions / host dock.
        const e = this.endFrame();
        // Aim at the cards' own plane, so the fit is measured where they are.
        look.y = e.y;
        look.z = e.z;
        needW = e.w;
        needH = e.h;
        top = Math.max(top, e.top);
        bottom += e.bottom;
        minK = 0;
      }
      const free = Math.max(0.3, (H - top - bottom) / H);
      const hw = hh * this.aspect;
      k = Math.max(minK, needW / hw, needH ? needH / (hh * free) : 0);
    }
    const pos = look.clone().add(dir.multiplyScalar(k));
    // Centre the shot in the free band: lower the camera so the content rises above the dock.
    const shift = (hh * k * (bottom - top)) / H;
    look.y -= shift;
    pos.y -= shift;
    return { pos, look };
  }

  /** The end layout's subject (half extents in world units) and the screen band it must fit in (px). */
  private endFrame() {
    const W = Math.max(1, this.root.clientWidth);
    const titleBottom = this.overlay.resultBottom();
    if (this.portrait) {
      const panel = this.overlay.actionsHeight(this.selected) || 150;
      return {
        y: CAR.y,
        z: CAR.z,
        w: ((0.5 + CAR.peek) * CAR.S) / Math.max(0.5, 1 - 36 / W),
        h: (CARD_H * CAR.S) / 2 + 0.04,
        top: titleBottom + 10,
        bottom: panel + 24,
      };
    }
    return {
      y: END.y,
      z: END.z,
      w:
        (END.SH / 2 + END.G + 2 * END.DS + END.gap) / Math.max(0.5, 1 - 80 / W),
      h: (END.SH * CARD_H) / 2 + 0.06,
      top: titleBottom + 16,
      bottom: 18,
    };
  }

  /** The poster rendered for this stage's orientation (landscape and portrait framings differ). */
  private posterInfo() {
    const r = this.root?.getBoundingClientRect?.();
    const w =
        r?.width || (typeof window !== "undefined" ? window.innerWidth : 1),
      h = r?.height || (typeof window !== "undefined" ? window.innerHeight : 1);
    return w / Math.max(1, h) < 0.85 ? POSTERS.portrait : POSTERS.landscape;
  }

  /** Puts the poster where the idle machine will be drawn (two axis points, scale + offset). */
  private placePoster() {
    const img = this.poster;
    if (!img) return;
    const POSTER = this.posterInfo();
    if (typeof this.opts.poster !== "string" && !img.src.endsWith(POSTER.file))
      img.src = this.assetsBase + POSTER.file;
    const shot = this.fit(SHOTS.idle);
    const A = this.projectFrom(shot, V(...POSTER_AXIS.a)),
      B = this.projectFrom(shot, V(...POSTER_AXIS.b));
    const s =
      A.distanceTo(B) /
      Math.hypot(POSTER.b[0] - POSTER.a[0], POSTER.b[1] - POSTER.a[1]);
    img.style.width = `${POSTER.w * s}px`;
    img.style.height = `${POSTER.h * s}px`;
    img.style.left = `${A.x - POSTER.a[0] * s}px`;
    img.style.top = `${A.y - POSTER.a[1] * s}px`;
  }

  /**
   * Debug / build tool (scripts/make-poster.mjs): renders the idle machine alone on a transparent
   * background at the idle framing and returns it with the image position of the poster axis points.
   */
  debugPoster() {
    const r = this.renderer,
      cam = this.camera;
    const shot = this.fit(SHOTS.idle);
    cam.fov = BASE_FOV;
    cam.position.copy(shot.pos);
    cam.lookAt(shot.look);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    const bg = this.scene.background,
      mask = cam.layers.mask;
    this.scene.background = null;
    r.setClearColor(0xfff1e7, 0);
    cam.layers.set(MACHINE_LAYER);
    r.setRenderTarget(null);
    r.render(this.scene, cam);
    const url = r.domElement.toDataURL("image/png");
    cam.layers.mask = mask;
    this.scene.background = bg;
    r.setClearColor(0xfff1e7, 1);
    const dpr = r.getPixelRatio();
    const A = this.projectFrom(shot, V(...POSTER_AXIS.a)),
      B = this.projectFrom(shot, V(...POSTER_AXIS.b));
    return {
      url,
      dpr,
      a: [A.x * dpr, A.y * dpr],
      b: [B.x * dpr, B.y * dpr],
      w: r.domElement.width,
      h: r.domElement.height,
    };
  }

  /** Screen position of a world point as seen from a shot's camera (not the live, moving one). */
  private projectFrom(shot: Shot, p: THREE.Vector3): THREE.Vector2 {
    const cam = this.camera.clone();
    cam.fov = BASE_FOV;
    cam.position.copy(shot.pos);
    cam.lookAt(shot.look);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    const v = p.clone().project(cam);
    const W = this.root.clientWidth,
      H = this.root.clientHeight;
    return new THREE.Vector2((v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H);
  }

  private moveCamera(
    shot: Shot,
    ms: number,
    e: Ease = ease.compose,
  ): Promise<void> {
    const to = this.fit(shot);
    const p0 = this.cam.pos.clone(),
      l0 = this.cam.look.clone();
    return this.anim.tween(
      ms,
      (t) => {
        this.cam.pos.lerpVectors(p0, to.pos, t);
        this.cam.look.lerpVectors(l0, to.look, t);
      },
      e,
    );
  }

  private project(p: THREE.Vector3): THREE.Vector2 {
    const v = p.clone().project(this.camera);
    const r = this.root.getBoundingClientRect();
    return new THREE.Vector2(
      (v.x * 0.5 + 0.5) * r.width,
      (-v.y * 0.5 + 0.5) * r.height,
    );
  }

  private tweenHaze(to: number, ms: number) {
    const u = this.hazeMat.uniforms.uHaze;
    const from = u.value;
    return this.anim.tween(
      ms,
      (t) => (u.value = lerp(from, to, t)),
      ease.inOutSine,
    );
  }

  private tweenBloom(to: number, ms: number) {
    const from = this.bloomLevel;
    return this.anim.tween(
      ms,
      (t) => (this.bloomLevel = lerp(from, to, t)),
      ease.inOutSine,
    );
  }

  private tweenDefocus(to: number, ms: number) {
    const from = this.defocus;
    return this.anim.tween(
      ms,
      (t) => (this.defocus = lerp(from, to, t)),
      ease.inOutSine,
    );
  }

  private tweenMood(color: string, alpha: number, to: number, ms: number) {
    const u = this.hazeMat.uniforms;
    if (to > 0) {
      u.uMoodColor.value.set(color);
      u.uMoodAlpha.value = alpha;
    }
    const from = u.uMood.value;
    return this.anim.tween(
      ms,
      (t) => (u.uMood.value = lerp(from, to, t)),
      ease.inOutSine,
    );
  }

  // -------------------------------------------------------------------------
  // Layouts
  // -------------------------------------------------------------------------

  /**
   * The deal: one straight, even row on landscape; on phones a 3-over-2 pyramid (the hit in the
   * middle of the top row) so the cards are big enough to tap and to read. No per-card tilt; the
   * cards float gently while they wait.
   */
  private fanPose(slot: number): Pose {
    if (this.portrait) {
      const s = 0.86,
        dx = s + 0.14,
        dy = (s * CARD_H + 0.16) / 2;
      // slot → [column offset, row]: 0 top-left, 2 top-centre (the hit), 4 top-right, 1 / 3 below.
      const at: [number, number][] = [
        [-1, 0],
        [-0.5, 1],
        [0, 0],
        [0.5, 1],
        [1, 0],
      ];
      const [cx, row] = at[slot];
      return {
        pos: V(
          cx * dx,
          FOCUS.y + 0.05 + (row ? -dy : dy),
          FOCUS.z + (row ? 0.01 : 0),
        ),
        rotZ: 0,
        scale: s,
      };
    }
    const d = slot - 2;
    return {
      pos: V(d * 1.1, FOCUS.y + 0.05, FOCUS.z + 0.01 * (2 - Math.abs(d))),
      rotZ: 0,
      scale: 0.88,
    };
  }

  /** End cards still on the table, in fan order (left to right). */
  private endOrder(): number[] {
    return [0, 1, 2, 3, 4]
      .map((sl) => SLOT_OF.indexOf(sl))
      .filter((i) => !this.soldBack.has(i));
  }

  private resetEndLayout() {
    this.selected = HIT;
    this.gridSlots = this.endOrder().filter((i) => i !== HIT);
    this.focus = this.focusTarget = Math.max(0, this.endOrder().indexOf(HIT));
    this.layoutLive = false;
    this.swipe = null;
  }

  private endPose(cardIndex: number): Pose {
    if (this.portrait) return this.carouselPose(cardIndex, this.focusTarget);
    if (cardIndex === this.selected)
      return {
        pos: V(0, END.y, END.z),
        rotZ: 0,
        scale: END.SH,
        opacity: 1,
        dim: 1,
      };
    const j = Math.max(0, this.gridSlots.indexOf(cardIndex));
    const col = j % 2,
      row = j >> 1;
    const x =
      -(END.SH / 2 + END.G + END.DS / 2) - (1 - col) * (END.DS + END.gap);
    const y = END.y + ((row === 0 ? 1 : -1) * (END.DS * CARD_H + END.gap)) / 2;
    return { pos: V(x, y, END.z), rotZ: 0, scale: END.DS, opacity: 1, dim: 1 };
  }

  /** Carousel pose for a card when the carousel's focus is `f` (a fractional position while swiping). */
  private carouselPose(cardIndex: number, f: number): Pose {
    const order = this.endOrder();
    const o = order.indexOf(cardIndex) - f,
      a = Math.abs(o),
      sg = Math.sign(o);
    const S = CAR.S;
    // A neighbour shows a sliver (CAR.peek of the large card's width) past each side of it.
    const X1 = (0.5 - CAR.side / 2 + CAR.peek) * S,
      X2 = 0.06 * S;
    const x = sg * (a <= 1 ? a * X1 : X1 + (a - 1) * X2);
    const scale =
      S *
      (a <= 1
        ? lerp(1, CAR.side, a)
        : CAR.side * lerp(1, 0.9, Math.min(1, a - 1)));
    return {
      pos: V(x, CAR.y, CAR.z - 0.35 * Math.min(a, 2)),
      rotZ: 0,
      scale,
      // Neighbours sit back: dimmer and partly see-through, so their edges read as "more cards"
      // rather than as text; the ones further out fade away.
      opacity: Math.min(
        lerp(1, 0.62, Math.min(1, a)),
        clamp01(1 - (a - 1.25) / 0.5),
      ),
      dim: lerp(1, 0.8, Math.min(1, a)),
    };
  }

  /** Portrait end: the carousel follows the finger, then springs to the nearest card. */
  private updateCarousel(dt: number) {
    if (!this.swipe) {
      this.focus = lerp(
        this.focus,
        this.focusTarget,
        1 - Math.exp(-dt * (this.reduced ? 60 : 11)),
      );
      if (Math.abs(this.focus - this.focusTarget) < 0.0005)
        this.focus = this.focusTarget;
    }
    for (const i of this.endOrder()) {
      const c = this.cards[i];
      if (!c.root.visible) continue;
      const p = this.carouselPose(i, this.focus);
      this.applyPose(c, p);
      c.opacity = p.opacity!;
      c.dim = p.dim!;
    }
  }

  private onSwipeMove = (e: PointerEvent) => {
    const sw = this.swipe;
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x0;
    if (!sw.moved && Math.abs(dx) > 8) sw.moved = true;
    if (!sw.moved) return;
    const n = this.endOrder().length;
    let f = sw.f0 - dx / sw.pitch;
    // Rubber band past the ends.
    if (f < 0) f = -0.35 * (1 - Math.exp(f / 0.35));
    if (f > n - 1) f = n - 1 + 0.35 * (1 - Math.exp(-(f - (n - 1)) / 0.35));
    const now = performance.now();
    const dtm = Math.max(1, now - sw.lastT);
    sw.v = lerp(sw.v, (f - this.focus) / dtm, 0.5);
    sw.lastT = now;
    this.focus = f;
  };

  private onSwipeEnd = (e: PointerEvent) => {
    const sw = this.swipe;
    if (!sw || e.pointerId !== sw.id) return;
    window.removeEventListener("pointermove", this.onSwipeMove);
    window.removeEventListener("pointerup", this.onSwipeEnd);
    window.removeEventListener("pointercancel", this.onSwipeEnd);
    this.swipe = null;
    if (!sw.moved) return;
    this.swipedAt = performance.now();
    const order = this.endOrder();
    const target = Math.round(
      Math.max(0, Math.min(order.length - 1, this.focus + sw.v * 160)),
    );
    const idx = order[target];
    if (idx !== undefined && idx !== this.selected) this.select(idx);
    else this.focusTarget = target;
  };

  private applyPose(c: Card3D, p: Pose) {
    c.root.position.copy(p.pos);
    c.root.rotation.z = p.rotZ;
    c.root.scale.setScalar(p.scale);
  }

  private tweenPose(
    c: Card3D,
    to: Pose,
    ms: number,
    e: Ease = ease.arrive,
    arc = 0,
  ) {
    const p0 = c.root.position.clone(),
      r0 = c.root.rotation.z,
      s0 = c.root.scale.x;
    const o0 = c.front.uniforms.uOpacity.value as number,
      d0 = c.front.uniforms.uDim.value as number;
    return this.anim.tween(
      ms,
      (t) => {
        c.root.position.lerpVectors(p0, to.pos, t);
        if (arc) c.root.position.y += Math.sin(Math.PI * clamp01(t)) * arc;
        c.root.rotation.z = lerp(r0, to.rotZ, t);
        c.root.scale.setScalar(lerp(s0, to.scale, t));
        if (to.opacity !== undefined)
          c.opacity = lerp(o0, to.opacity, clamp01(t));
        if (to.dim !== undefined) c.dim = lerp(d0, to.dim, clamp01(t));
      },
      e,
    );
  }

  // -------------------------------------------------------------------------
  // Full choreography
  // -------------------------------------------------------------------------

  private async playFull(run: number, fromEnd: boolean) {
    const A = this.anim;
    const m = this.machine;
    const pack = this.pack!;
    if (!fromEnd) {
      const startCam = this.fit(SHOTS.idle);
      this.cam.pos.copy(startCam.pos);
      this.cam.look.copy(startCam.look);
    }

    // 1. Crank: instant response (camera push + crank pull-back on the first frame) -------
    this.beat("crank");
    this.sound("crank.turn");
    this.moveCamera(SHOTS.crank, fromEnd ? 620 : 700, ease.compose);
    A.tween(110, (t) => this.setCrank(-0.3 * t), ease.outQuad).then(() => {
      if (run !== this.runId) return;
      A.tween(
        720,
        (t, raw) => {
          this.setCrank(-0.3 + (Math.PI * 2 + 0.3) * t);
          m.jiggle(this.time, 1 - raw);
        },
        ease.springSoft,
      );
    });
    await A.wait(200);
    this.check(run);

    // 2. Dispense: the flap swings open and the pack slides out of the chute, lying flat ---
    this.beat("dispense");
    this.sound("slot.drop");
    const spawn = m.worldOf(m.packSpawn);
    // Sized to the chute mouth (the GLB's cavity is 0.70 wide in world units).
    const small = m.source === "glb" ? 0.24 : 0.17;
    const lie = -1.25;
    pack.group.scale.setScalar(small);
    pack.group.rotation.set(lie, 0, 0);
    pack.group.position.set(spawn.x, spawn.y - 0.05, spawn.z - 0.2);
    pack.opacity = 1;
    pack.sheen = 0.5;
    A.tween(200, (t) => (m.flapOpen = t), ease.spring);
    await A.wait(110);
    this.check(run);
    const zOut = spawn.z + 0.62;
    await A.tween(
      320,
      (t, raw) => {
        pack.group.position.z = lerp(spawn.z - 0.2, zOut, t);
        pack.group.position.y = spawn.y - 0.05 + 0.04 * Math.sin(Math.PI * raw);
      },
      ease.outBack,
    );
    this.check(run);

    // 3. Fly to centre-front: the pack stands up off the flap and arcs to the stage --------
    this.beat("fly");
    const p0 = pack.group.position.clone();
    const ctrl = V(-0.9, 1.0, 0.2);
    this.moveCamera(SHOTS.reveal, 680, ease.compose);
    this.tweenHaze(0.42, 650);
    this.tweenDefocus(0.45, 700);
    A.tween(300, (t) => (m.flapOpen = 1 - t), ease.outQuad);
    let xrayStarted = false;
    let t0 = A.now;
    await A.tween(
      680,
      (t, raw) => {
        // Quadratic Bézier arc from the chute to the stage focus.
        const a = p0.clone().multiplyScalar((1 - t) * (1 - t));
        const b = ctrl.clone().multiplyScalar(2 * (1 - t) * t);
        const c = FOCUS.clone().multiplyScalar(t * t);
        pack.group.position.copy(a.add(b).add(c));
        pack.group.scale.setScalar(lerp(small, 1, t));
        const up = ease.outCubic(Math.min(1, raw * 1.8));
        pack.group.rotation.set(
          lerp(lie, 0, up) + Math.sin(Math.PI * t) * 0.22,
          Math.sin(Math.PI * t) * -0.6,
          lerp(0, -0.035, t) + Math.sin(Math.PI * t) * 0.18,
        );
        if (raw > 0.45 && !xrayStarted) {
          // The pack starts to charge (the foil stays the edition's): "Cranking…" starts here.
          xrayStarted = true;
          t0 = A.now;
          pack.setAura(0, C.lilac);
          A.tween(
            300,
            (k) => {
              pack.xray = k;
              pack.setAura(0.5 * k);
            },
            ease.inOutSine,
          );
          this.overlay.setCaption("Cranking…", "xray");
        }
      },
      ease.compose,
    );
    this.check(run);

    // 4. Cranking… (waits for the result, interruptible) ----------------------
    this.beat("cranking");
    this.sound("crank.loop");
    let scanPhase = 0;
    let stillShown = false;
    const stopLoop = A.loop((now) => {
      scanPhase = ((now - t0) % 900) / 900;
      pack.setScan(-0.08 + 1.16 * scanPhase, 1);
      // The halo breathes at the loop's 128 BPM.
      pack.setAura(0.42 + 0.14 * Math.sin((now - t0) * 0.0134));
      pack.group.position.y = FOCUS.y + Math.sin((now - t0) * 0.0036) * 0.025;
      pack.group.rotation.y = Math.sin((now - t0) * 0.0012) * 0.07;
      pack.group.rotation.x = -this.pointerSmooth.y * 0.05;
      if (!stillShown && now - t0 > 5000) {
        stillShown = true;
        this.overlay.setCaption(
          "Still cranking. The draw is on-chain.",
          "xray",
        );
        this.beat("still-cranking");
      }
    });
    try {
      await this.waitPrepared(run);
    } catch (err) {
      stopLoop();
      if (err instanceof RipFailedError)
        await this.failSequence(run, err.message);
      throw err;
    }
    this.check(run);
    // Lock at a fixed beat whatever the result's timing (no tell): Cranking lasts at least
    // minCrankingMs from the tap (DA §8.1 A) and shows at least one scan pass.
    const minMs = (this.opts.minCrankingMs ?? 900) * A.speed;
    const need = Math.max(
      minMs - (A.now - this.playT0),
      380 * A.speed - (A.now - t0),
    );
    if (need > 0) await A.wait(need / A.speed);
    this.check(run);
    stopLoop();
    this.resultUsed = true;
    this.sound("crank.loop.stop");
    // Finish the current scan pass quickly instead of waiting for the loop.
    const from = scanPhase;
    await A.tween(Math.max(60, (1 - from) * 180), (t) =>
      pack.setScan(-0.08 + 1.16 * lerp(from, 1, t), 1 - t * 0.5),
    );
    this.check(run);
    const prep = this.prepared!;
    this.dressCards(prep);
    this.skipArmed = true;
    try {
      await this.reveal_(run, prep, pack);
    } catch (err) {
      if (!(err instanceof SkipSignal)) throw err;
      await this.jumpToEnd(run, prep);
    }
  }

  /** Lock → tear → cards → tier → end. Throws SkipSignal (via check) when skip() is pressed. */
  private async reveal_(run: number, prep: Prepared, pack: Pack3D) {
    const A = this.anim;
    const ep = this.epoch;

    // 5. Lock ---------------------------------------------------------------
    this.beat("lock");
    this.sound("lock");
    this.overlay.setCaption(null);
    // Locked: the charge takes the drawn tier's colour (the rarity telegraph; neutral lilac
    // when it is off) and swells once.
    const T = this.tele(prep);
    const auraFrom = new THREE.Color(C.lilac),
      auraTo = new THREE.Color(T.color),
      auraC = new THREE.Color();
    const aura0 = (pack.aura.material as THREE.MeshBasicMaterial).opacity;
    pack.tearColor = T.color;
    const ry = pack.group.rotation.y,
      rx = pack.group.rotation.x,
      py = pack.group.position.y;
    await A.tween(
      220,
      (t) => {
        pack.setAura(
          lerp(aura0, 0.55 + 0.35 * Math.min(1, T.power), t),
          auraC.lerpColors(auraFrom, auraTo, t),
        );
        pack.lock = t;
        pack.setScan(1.2, 0);
        pack.group.rotation.y = lerp(ry, 0, t);
        pack.group.rotation.x = lerp(rx, 0, t);
        pack.group.position.y = lerp(py, FOCUS.y, t);
      },
      ease.outCubic,
    );
    this.check(run);
    if (!this.reduced) this.overlay.showSkip(true);
    await A.wait(40);
    this.check(run);

    // 6. Rip ----------------------------------------------------------------
    this.beat("tear");
    this.sound("pack.rip");
    const auraLock = (pack.aura.material as THREE.MeshBasicMaterial).opacity;
    A.tween(
      300,
      (t) => {
        pack.xrayFade = 1 - t;
        pack.setAura(auraLock * (1 - t));
      },
      ease.inOutSine,
    );
    // Anticipation squash, then the snap: the body pops to 1.04 and settles.
    await A.tween(
      90,
      (t) => pack.group.scale.set(1 + 0.025 * t, 1 - 0.03 * t, 1),
      ease.outQuad,
    );
    this.check(run);
    A.tween(
      120,
      (t) => pack.group.scale.setScalar(lerp(1.04, 1, t)),
      ease.outQuad,
    );
    let burst = false,
      flying = false,
      opening = false;
    A.tween(
      560,
      (_, raw) =>
        (pack.tearGlow = Math.sin(Math.PI * Math.min(1, raw * 1.4)) * 1.4),
    );
    await A.tween(
      300,
      (t, raw) => {
        pack.peel = t;
        if (raw > 0.3 && !burst) {
          burst = true;
          pack.burst(this.rnd, 14);
          this.packBurst(pack, prep);
        }
        if (raw > 0.5 && !opening) {
          opening = true;
          A.tween(460, (k) => (pack.open = k), ease.springSoft);
        }
        if (raw > 0.65 && !flying) {
          flying = true;
          A.tween(520, (k) => pack.stripFly(k), ease.linear);
        }
      },
      ease.inOutSine,
    );
    this.check(run);

    // 7. Cards rise out of the pack and fan in one move (never leaving the frame) ----------
    this.beat("cards-out");
    this.updatePips();
    this.sound("card.slide");
    const stackY = FOCUS.y - 0.25;
    this.cards.forEach((c, i) => {
      c.root.visible = true;
      c.opacity = 1;
      c.root.position.set(0, stackY, FOCUS.z + 0.004 * (i - 2));
      c.root.rotation.set(0, 0, 0);
      c.root.scale.setScalar(0.92);
      c.flip.rotation.y = Math.PI;
    });
    // The opened pack drops out of the frame as the cards rise out of it. It stays opaque (the
    // cards are inside it until they clear the mouth); a short dissolve only once it is low.
    const packY = pack.group.position.y,
      packZ = pack.group.position.z;
    A.tween(
      460,
      (t, raw) => {
        pack.group.position.y = packY - 4.2 * t;
        pack.group.position.z = packZ - 0.35 * ease.outCubic(raw);
        pack.group.rotation.z = -0.035 - 0.1 * t;
        pack.opacity = 1 - clamp01((raw - 0.72) / 0.28);
      },
      ease.inQuad,
    ).then(() => {
      if (run === this.runId) pack.opacity = 0;
    });
    this.beat("fan");
    const fans = this.cards.map((c, i) => {
      const pose = this.fanPose(SLOT_OF[i]);
      const p0 = c.root.position.clone(),
        s0 = c.root.scale.x;
      const delay = Math.abs(SLOT_OF[i] - 2) * 30;
      return A.wait(delay).then(() => {
        if (ep !== this.epoch) return;
        c.setShadow(0.16);
        // Rise first (ease-out on y), spread a beat later (compose on x): one continuous arc.
        return A.tween(560, (_, raw) => {
          const ty = ease.arrive(Math.min(1, raw * 1.25));
          const tx = ease.compose(raw);
          c.root.position.set(
            lerp(p0.x, pose.pos.x, tx),
            lerp(p0.y, pose.pos.y, ty) + Math.sin(Math.PI * ty) * 0.35,
            lerp(p0.z, pose.pos.z, tx),
          );
          c.root.rotation.z = lerp(0, pose.rotZ, tx);
          c.root.scale.setScalar(lerp(s0, pose.scale, tx));
        });
      });
    });
    await Promise.all(fans);
    this.check(run);
    if (this.revealMode === "tap")
      A.tween(500, (t) => (this.fanFloat = t), ease.inOutSine);

    // 9. Dust Cards: the viewer picks them (tap mode) or they turn by themselves ------------
    this.beat("dust-flip");
    if (this.revealMode === "tap" && !this.reduced && !this.skipRequested) {
      await this.pickDust(run, ep);
    } else {
      const flips: Promise<void>[] = [];
      for (let k = 0; k < 4; k++) {
        this.picked.add(k);
        flips.push(this.flipCard(this.cards[k], k, ep));
        await A.wait(150);
        this.check(run);
      }
      await Promise.all(flips);
      this.check(run);
    }

    // 10. The hit: its own tap (tap mode), then the charge -------------------------------
    if (this.revealMode === "tap" && !this.reduced) await this.pickHit(run);
    this.picking = false;
    const float0 = this.fanFloat;
    if (float0 > 0)
      A.tween(
        260,
        (t) => (this.fanFloat = float0 * (1 - t)),
        ease.inOutSine,
      ).then(() => (this.fanFloat = 0));
    this.beat("buildup");
    this.overlay.clearPops();
    this.sound("card.rise", HIT);
    this.sound("hit.charge", T.rank);
    this.overlay.setPips(null);
    const hit = this.cards[HIT];
    const dustOut = [0, 1, 2, 3].map((i) => {
      const c = this.cards[i];
      const pose = this.fanPose(this.slotOf[i]);
      // They step back (and aside on landscape) for the hit; on phones they stay inside the frame.
      if (!this.portrait) pose.pos.x *= 1.16;
      pose.pos.z -= 0.5;
      pose.scale *= 0.92;
      const d0 = c.front.uniforms.uDim.value;
      return Promise.all([
        this.tweenPose(c, pose, 700, ease.arrive),
        A.tween(700, (t) => (c.dim = lerp(d0, 0.7, t))),
      ]);
    });
    this.tweenHaze(0.55, 700);
    this.tweenDefocus(1, 700);
    // The stage dims to the tier's dusk; the aura and the rays behind the card build.
    this.tweenMood(T.dusk, T.duskAlpha, 1, Math.min(800, T.ms));
    this.rays.mesh.position.copy(HERO).add(V(0, 0.05, -0.5));
    this.rays.color = T.color;
    this.rays.holo = T.holo;
    this.rays.mesh.scale.setScalar(3.4 + 2.4 * T.power);
    if (T.power >= 0.8) {
      this.sparkles.emit(
        {
          origin: HERO.clone(),
          count: this.cap(Math.round(8 + 6 * T.power)),
          rnd: this.rnd,
          speed: [0.05, 0.25],
          dir: V(0, 1, 0),
          spread: Math.PI,
          scale: [0.35, 0.7],
          life: [(T.ms / 1000) * 0.7, (T.ms / 1000) * 1.05],
          box: V(3.2, 3.4, 0.4),
          spin: 2,
        },
        { billboard: true, grow: 1 },
      );
    }
    const heroPose: Pose = { pos: HERO.clone(), rotZ: 0, scale: 1.16 };
    const dolly0 = this.dolly;
    await Promise.all([
      this.tweenPose(hit, heroPose, 700, ease.compose, 0.18),
      A.tween(
        T.ms,
        (_, raw) => {
          // Charge: the shake grows in amplitude and frequency, then holds still for a breath.
          const k = ease.inQuad(raw);
          const hold = raw < 0.84 ? 1 : Math.max(0, 1 - (raw - 0.84) / 0.1);
          const freq = 3 + 12 * k;
          const amp =
            (0.012 + 0.04 * T.power) * k * hold * (this.reduced ? 0 : 1);
          hit.tilt.rotation.z = Math.sin(this.time * Math.PI * 2 * freq) * amp;
          hit.tilt.position.x =
            Math.sin(this.time * Math.PI * 2 * freq * 1.3 + 1) * amp * 0.5;
          hit.tilt.rotation.x = -0.06 * Math.sin(Math.PI * raw);
          hit.setGlow(0.25 + 0.75 * k, T.color);
          this.rays.opacity = (0.12 + 0.4 * k) * Math.min(1, T.power + 0.25);
          this.rays.speed = 0.25 + 1.6 * k;
          this.dolly = dolly0 + 0.9 * T.power * ease.inOutSine(raw);
        },
        ease.linear,
      ),
      ...dustOut,
    ]);
    this.check(run);
    hit.tilt.rotation.set(0, 0, 0);
    hit.tilt.position.set(0, 0, 0);

    // 11. Hit flip: burst ---------------------------------------------------------------
    this.beat("hit-flip");
    this.sound("card.flip", HIT);
    await A.tween(
      100,
      (t) => (hit.flip.rotation.y = Math.PI + 0.16 * t),
      ease.outQuad,
    );
    this.check(run);
    let edged = false;
    await A.tween(
      420,
      (t, raw) => {
        hit.flip.rotation.y = lerp(Math.PI + 0.16, 0, t);
        // The tier edge appears once the card is edge-on; the burst fires at the same instant.
        if (!edged && raw > 0.22) {
          edged = true;
          this.edgeHit(prep);
          this.hitBurst(hit, T, prep);
        }
      },
      ease.spring,
    );
    const dolly1 = this.dolly;
    A.tween(600, (t) => (this.dolly = lerp(dolly1, 0, t)), ease.inOutSine);
    this.revealedUp[HIT] = true;
    this.updatePips();
    this.check(run);

    // 12. Tier effect --------------------------------------------------------
    await this.tierEffect(run, prep);
    this.check(run);

    // 13. End state ----------------------------------------------------------
    await this.endState(run, prep);
  }

  /** Lift, anticipation, spring flip, settle. */
  private async flipCard(c: Card3D, dustIndex: number, ep = this.epoch) {
    const A = this.anim;
    const z0 = c.root.position.z,
      s0 = c.root.scale.x;
    await A.tween(
      90,
      (t) => {
        c.root.position.z = z0 + 0.32 * t;
        c.root.scale.setScalar(s0 * (1 + 0.06 * t));
        c.flip.rotation.y = Math.PI + 0.2 * t;
        c.tilt.rotation.x = -0.08 * t;
      },
      ease.outQuad,
    );
    if (ep !== this.epoch) return;
    this.sound("card.flip", dustIndex);
    await A.tween(
      330,
      (t) => (c.flip.rotation.y = lerp(Math.PI + 0.2, 0, t)),
      ease.spring,
    );
    if (ep !== this.epoch) return;
    this.sound("dust.tick", dustIndex);
    this.revealedUp[dustIndex] = true;
    this.updatePips();
    // Each Dust Card's own quote pops from its top edge, centred (its own number; never a sum).
    // Phones skip it: the cards are small there and the quote is printed on the card.
    const q = this.prepared?.result.dust[dustIndex];
    if (q && !q.house && !quotePending(q.valueSolUi) && !this.portrait) {
      const top = this.project(
        V(c.root.position.x, c.root.position.y + (CARD_H / 2) * s0 + 0.04, z0),
      );
      this.overlay.pop(top.x, top.y, `≈ ${fmtSol(q.valueSolUi ?? null)} SOL`);
    }
    const u = c.front.uniforms;
    A.tween(420, (t) => {
      u.uShine.value = lerp(-0.7, 0.8, t);
      u.uShineAmt.value = 0.55 * Math.sin(Math.PI * t);
    });
    await A.tween(
      180,
      (t) => {
        if (ep !== this.epoch) return;
        c.root.position.z = lerp(z0 + 0.32, z0, t);
        c.root.scale.setScalar(s0 * lerp(1.06, 1, t));
        c.tilt.rotation.x = lerp(-0.08, 0, t);
      },
      ease.outCubic,
    );
  }

  private updatePips(next?: number) {
    this.overlay.setPips({ up: this.revealedUp, hit: HIT, next });
  }

  private onStagePointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") this.askGyro();
    if ((e.target as HTMLElement).closest("button, a, .rip-card-actions"))
      return;
    if (
      this.state === "end" &&
      this.portrait &&
      this.layoutLive &&
      this.endOrder().length > 1
    ) {
      // Swipe the carousel (a tap still selects through the click handler).
      const shot = this.fit(SHOTS.end);
      const a = this.projectFrom(shot, V(0, CAR.y, CAR.z)),
        b = this.projectFrom(shot, V(CAR.S, CAR.y, CAR.z));
      this.swipe = {
        id: e.pointerId,
        x0: e.clientX,
        f0: this.focus,
        pitch: Math.max(60, (b.x - a.x) * 0.62),
        moved: false,
        v: 0,
        lastT: performance.now(),
      };
      window.addEventListener("pointermove", this.onSwipeMove);
      window.addEventListener("pointerup", this.onSwipeEnd);
      window.addEventListener("pointercancel", this.onSwipeEnd);
      return;
    }
    if (this.pickResolver) {
      // Tap mode: the face-down card under the pointer (generous on touch: the nearest one).
      this.onPointerMove(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const candidates = this.faceDownCandidates();
      const hit = this.raycaster.intersectObjects(
        candidates.map((c) => c.mesh),
        false,
      )[0];
      let card = hit
        ? candidates.find((c) => c.mesh === hit.object)
        : undefined;
      if (!card && e.pointerType !== "mouse") {
        let best = Infinity;
        for (const c of candidates) {
          const p = c.root.position.clone().project(this.camera);
          const d = Math.hypot(
            p.x - this.pointer.x,
            (p.y - this.pointer.y) / this.aspect,
          );
          if (d < best && d < 0.25) {
            best = d;
            card = c;
          }
        }
      }
      if (card) this.pickResolver(card);
      return;
    }
    this.tapResolver?.();
  };

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (
      this.state === "end" &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      // Keyboard: the previous / next card takes the large spot.
      const order = this.endOrder().filter((i) => this.cards[i].root.visible);
      const k =
        order.indexOf(this.selected) + (e.key === "ArrowRight" ? 1 : -1);
      if (k >= 0 && k < order.length) {
        e.preventDefault();
        this.select(order[k]);
      }
      return;
    }
    if (this.state !== "playing") return;
    if (
      this.pickResolver &&
      (e.key === " " || e.key === "Enter" || e.key === "ArrowRight")
    ) {
      // Keyboard: the left-most face-down card.
      e.preventDefault();
      const next = this.faceDownCandidates().sort(
        (a, b) => this.slotOf[a.index] - this.slotOf[b.index],
      )[0];
      if (next) this.pickResolver(next);
    } else if (
      this.tapResolver &&
      (e.key === " " || e.key === "Enter" || e.key === "ArrowRight")
    ) {
      e.preventDefault();
      this.tapResolver();
    } else if (e.key === "Escape") this.skip();
  };

  /** fail(): the charge switches off, the pack sinks back into the machine, the reason is shown. */
  private async failSequence(run: number, message: string) {
    const A = this.anim;
    const pack = this.pack!;
    this.beat("failed");
    this.overlay.setCaption(null);
    const y0 = pack.group.position.y;
    A.tween(
      300,
      (t) => {
        pack.xray = 1 - t;
        pack.setAura(0.45 * (1 - t));
      },
      ease.inOutSine,
    );
    await A.tween(
      520,
      (t) => {
        pack.group.position.y = y0 - 2.6 * t;
        pack.opacity = 1 - t;
      },
      ease.inCubic,
    );
    if (run !== this.runId) return;
    this.tweenHaze(0, 400);
    this.tweenDefocus(0, 500);
    this.moveCamera(SHOTS.idle, 800, ease.compose);
    this.state = "idle";
    this.overlay.showNotice("Not cranked.", message, "Try again");
    this.overlay.announce(message);
  }

  /** skip(): cut to the end state, with every card and effect in its final, consistent state. */
  private async jumpToEnd(run: number, prep: Prepared) {
    const A = this.anim;
    this.beat("skip");
    this.epoch++;
    this.skipArmed = false;
    A.finishAll();
    A.speed = 1;
    this.tapResolver = null;
    this.overlay.setCaption(null);
    this.overlay.setCounter(null);
    this.overlay.setResult(null);
    this.overlay.showSkip(false);
    this.packs.forEach((p) => (p.opacity = 0));
    if (this.reveal) this.reveal.group.visible = false;
    [
      this.sparks,
      this.sparkles,
      this.holoShards,
      this.coins,
      this.confetti,
    ].forEach((p) => p.clear());
    this.rays.opacity = 0;
    this.flash.opacity = 0;
    this.fovKick = 0;
    this.bloomExtra = 0;
    const hu = this.hazeMat.uniforms;
    hu.uMood.value = 0;
    hu.uWave.value = 0;
    hu.uWaveOut.value = 0;
    this.crt.amount = 0;
    this.crt.bands = 0;
    this.shakeAmp = 0;
    this.autoHolo = false;
    this.fanFloat = 0;
    this.machine.flapOpen = 0;
    const tier = prep.result.hit.tier;
    if (tier === "jackpot") {
      const d = Math.min(this.machineFill, 0.05);
      this.setFill(d);
      this.jackpotLevel = d;
    }
    if (tier === "one_pct")
      this.cards[HIT].setFaceTextures(...prep.hit, TIERS.one_pct.holo);
    this.edgeHit(prep);
    this.cards.forEach((c) => {
      c.root.visible = true;
      c.opacity = 1;
      c.dim = 1;
      c.flip.rotation.y = 0;
      c.tilt.rotation.set(0, 0, 0);
      c.tilt.position.set(0, 0, 0);
      c.setGlow(0);
      c.setShadow(0.16);
    });
    this.revealedUp = [true, true, true, true, true];
    const { title, chip } = this.tierTitle(prep);
    this.sound(
      (tier === "one_pct" ? "tier.onepct" : `tier.${tier}`) as SoundCue,
      HIT,
    );
    this.overlay.announce(chip ? `${title} ${chip}.` : title);
    await this.endState(run, prep);
  }

  private dressCards(prep: Prepared) {
    const ed = EDITIONS[this.edition];
    for (let i = 0; i < 4; i++) {
      this.cards[i].setFaceTextures(...prep.dust[i], 0);
      this.cards[i].setEdge(ed.edge, ed.edgeMetal);
    }
    const tier = TIERS[prep.result.hit.tier];
    this.cards[HIT].setFaceTextures(...(prep.teaser ?? prep.hit), tier.holo);
    // Face-down, every card has the same edge: the tier edge appears at the flip (edgeHit).
    this.cards[HIT].setEdge(ed.edge, ed.edgeMetal);
  }

  private edgeHit(prep: Prepared) {
    const tier = TIERS[prep.result.hit.tier];
    this.cards[HIT].setEdge(tier.edge, tier.edgeMetal);
  }

  /** `name` "Holo Foil 4×"; `title` "You pulled Holo Foil 4×." (one title, shown from the tier moment on). */
  private tierTitle(prep: Prepared) {
    const hit = prep.result.hit;
    const tier = TIERS[hit.tier];
    const name = tier.mult ? `${tier.name} ${tier.mult}` : tier.name;
    // The amount, never a market value: a stock hit is offered for Sell beside it (D30).
    const chip = `${fmtAmount(hit.amountUi)} ${ticker(hit.symbol)}`;
    // "You pulled the Jackpot." / "You pulled The 1%." / "You pulled Holo Foil 4×."
    const article = hit.tier === "jackpot" ? "the " : "";
    return { name, title: `You pulled ${article}${name}.`, chip };
  }

  private emitMood(color: string, amount: number, durationMs: number) {
    this.listeners.mood.forEach((cb) => cb({ color, amount, durationMs }));
  }

  private async tierEffect(run: number, prep: Prepared) {
    const A = this.anim;
    const hit = this.cards[HIT];
    const u = hit.front.uniforms;
    const tierId = prep.result.hit.tier;
    const tier = TIERS[tierId];
    const { title, chip } = this.tierTitle(prep);
    const heroPos = hit.root.position.clone();
    this.beat("tier");
    this.overlay.setPips(null);
    const shine = (ms: number, amt = 1) =>
      A.tween(
        ms,
        (t) => {
          u.uShine.value = lerp(-0.75, 0.95, t);
          u.uShineAmt.value = amt * Math.sin(Math.PI * t);
        },
        ease.inOutSine,
      );

    if (tierId !== "one_pct") {
      this.sound(`tier.${tierId}` as SoundCue, HIT);
      // Jackpot: let the pour play before the title lands. Black Foil: gold title only once the
      // stage is dark enough for it (gold on cream is forbidden, DA §4.2).
      // Others: a beat for the dusk to lift so ink text never lands on a dark stage.
      const delay =
        tierId === "jackpot" ? 1350 : tierId === "black" ? 240 : 200;
      const show = () => {
        if (run === this.runId && !this.skipRequested)
          this.overlay.setResult(title, chip, { onDark: tierId === "black" });
      };
      if (delay) A.wait(delay).then(show);
      else show();
      if (tier.id === "holo" || tier.id === "black" || tier.id === "jackpot")
        this.overlay.announce(chip ? `${title} ${chip}.` : title);
    }

    switch (tierId) {
      case "silver": {
        hit.setGlow(0.6, "#eef1f7");
        await shine(620, 1.1);
        this.beat("tier-peak");
        await A.wait(80);
        break;
      }
      case "blue": {
        hit.setGlow(0.65, "#9fdcff");
        shine(650, 1.0);
        A.tween(
          900,
          (t) =>
            (u.uGlint.value =
              Math.sin(Math.PI * Math.min(1, t * 1.6)) * 0.9 + 0.25 * t),
          ease.linear,
        );
        this.sparks.emit({
          origin: heroPos.clone().add(V(0, 0, -0.25)),
          count: 12,
          rnd: this.rnd,
          speed: [1.6, 3.2],
          dir: V(0, 0.2, -0.25),
          spread: Math.PI * 0.9,
          scale: [0.6, 1.3],
          life: [0.35, 0.55],
          box: V(1.0, 1.4, 0.05),
        });
        await A.wait(450);
        this.beat("tier-peak");
        await A.wait(450);
        break;
      }
      case "holo": {
        this.tweenMood(C.blush, 0.92, 1, 450);
        this.emitMood(C.blush, 0.92, 450);
        this.tweenBloom(0.95, 450);
        this.autoHolo = true;
        hit.setGlow(0.8, "#f3d6ff");
        this.holoShards.emit({
          origin: heroPos.clone().add(V(0, 0, -0.3)),
          count: this.cap(16),
          rnd: this.rnd,
          speed: [1.6, 3.2],
          dir: V(0, 0.55, -0.2),
          spread: Math.PI * 0.8,
          scale: [0.05, 0.1],
          life: [0.9, 1.3],
          spin: 12,
        });
        shine(800, 0.8);
        await A.wait(600);
        this.beat("tier-peak");
        await A.wait(600);
        break;
      }
      case "black": {
        this.tweenMood(C.anthracite, 0.74, 1, 520);
        this.emitMood(C.anthracite, 0.74, 520);
        this.shake(300);
        this.punchFx(520, 0.9);
        this.tweenBloom(1.1, 500);
        hit.setGlow(0.0, C.gold);
        A.tween(
          600,
          (t) => {
            u.uGoldGlow.value = t;
            hit.setGlow(0.85 * t, "#e8b64f");
          },
          ease.outCubic,
        );
        this.sparkles.emit(
          {
            origin: heroPos.clone().add(V(0, 0, -0.3)),
            count: 10,
            rnd: this.rnd,
            speed: [0.3, 0.9],
            dir: V(0, 0, -1),
            spread: Math.PI,
            scale: [0.5, 1.1],
            life: [1.0, 1.5],
            delay: [0, 0.5],
            box: V(3.0, 3.2, 0.2),
            spin: 2,
          },
          { billboard: true, grow: 1 },
        );
        A.tween(1800, (t) => (this.dolly = 0.35 * t), ease.inOutSine);
        shine(900, 0.9);
        await A.wait(900);
        this.beat("tier-peak");
        await A.wait(900);
        break;
      }
      case "jackpot":
        await this.jackpot(run, prep);
        break;
      case "one_pct":
        await this.onePct(run, prep);
        break;
    }
    this.check(run);
  }

  private async jackpot(run: number, prep: Prepared) {
    const A = this.anim;
    const hit = this.cards[HIT];
    const u = hit.front.uniforms;
    const hu = this.hazeMat.uniforms;
    const m = this.machine;
    // The machine comes back into focus, the globe drains and the coins pour out of the chute.
    this.tweenHaze(0.06, 300);
    this.tweenDefocus(0, 350);
    A.tween(600, (t) => {
      u.uGoldGlow.value = t;
      hit.setGlow(0.9 * t, "#f0c766");
    });
    const y0 = hit.root.position.y,
      s0 = hit.root.scale.x;
    A.tween(
      700,
      (t) => {
        hit.root.position.y = y0 + 0.32 * t;
        hit.root.scale.setScalar(lerp(s0, s0 * 0.92, t));
      },
      ease.arrive,
    );
    A.tween(900, (t) => (this.dolly = -1.3 * t), ease.compose);
    A.tween(260, (t) => (m.flapOpen = t), ease.spring);
    const from = this.machineFill;
    const drained = Math.min(from, 0.05);
    A.tween(
      1700,
      (t) => this.setFill(lerp(from, drained, t)),
      ease.inOutSine,
    ).then(() => (this.jackpotLevel = drained));
    const chute = m.worldOf(m.packSpawn).add(V(0, 0, 0.35));
    const cs = this.coinScale * 1.4;
    this.coins.floorY = MACHINE_POS.y + 0.02;
    let bursts = 0;
    A.tween(1500, (_, raw) => {
      // Ten bursts of three coins: a stream, not a fountain.
      while (bursts < Math.floor(raw * 10)) {
        bursts++;
        this.coins.emit(
          {
            origin: chute,
            count: 3,
            rnd: this.rnd,
            speed: [2.6, 4.2],
            dir: V(0, 0.42, 1),
            spread: 0.38,
            scale: [cs * 0.95, cs * 1.1],
            life: [1.5, 2.1],
            spin: 11,
            box: V(0.5, 0.1, 0.1),
          },
          { bounce: true },
        );
      }
    });
    // A light rain of coins from above the frame.
    this.coins.emit(
      {
        origin: V(0, 3.6, 0.6),
        count: 20,
        rnd: this.rnd,
        speed: [0.2, 0.7],
        dir: V(0, -1, 0),
        spread: 0.35,
        scale: [cs * 0.95, cs * 1.1],
        life: [2.0, 2.6],
        delay: [0.25, 1.4],
        box: V(7.5, 0.4, 1.6),
        spin: 9,
      },
      { bounce: true },
    );
    this.sparkles.emit(
      {
        origin: hit.root.position.clone().add(V(0, 0.3, -0.3)),
        count: 8,
        rnd: this.rnd,
        speed: [0.3, 0.8],
        dir: V(0, 0, -1),
        spread: Math.PI,
        scale: [0.5, 1.0],
        life: [1.0, 1.4],
        delay: [0.2, 0.9],
        box: V(3.0, 3.2, 0.2),
        spin: 2,
      },
      { billboard: true, grow: 1 },
    );
    A.wait(1700).then(() => {
      if (run === this.runId)
        A.tween(300, (t) => (m.flapOpen = 1 - t), ease.outQuad);
    });
    // Gold wave (waveTransition variant) behind the card.
    hu.uWaveLo.value.set(C.gold);
    hu.uWaveHi.value.set(C.goldHi);
    hu.uWaveOut.value = 0;
    await A.wait(1100);
    this.check(run);
    A.tween(1000, (t) => (hu.uWave.value = t), ease.compose);
    A.tween(900, (t) => (this.dolly = lerp(-1.3, 0, t)), ease.compose);
    this.punchFx(600, 0.8);
    this.tweenBloom(1.15, 600);
    // $1PCT counter.
    const target =
      Number(String(prep.result.hit.amountUi).replace(/[^0-9.]/g, "")) || 0;
    const unit = ticker(prep.result.hit.symbol);
    await A.wait(300);
    this.check(run);
    await A.tween(
      1700,
      (t) => {
        const v = target * t;
        this.overlay.setCounter(
          target
            ? fmtAmount(Math.round(v))
            : fmtAmount(prep.result.hit.amountUi),
          unit,
        );
      },
      ease.outCubic,
    );
    this.check(run);
    this.beat("tier-peak");
    this.overlay.setCounter(fmtAmount(prep.result.hit.amountUi), unit);
    await A.wait(450);
    this.check(run);
    A.tween(650, (t) => (hu.uWaveOut.value = t), ease.compose).then(() => {
      hu.uWave.value = 0;
      hu.uWaveOut.value = 0;
    });
    this.overlay.setCounter(null);
    await A.wait(300);
  }

  private async onePct(run: number, prep: Prepared) {
    const A = this.anim;
    const hit = this.cards[HIT];
    const hu = this.hazeMat.uniforms;
    // Lilac wave.
    hu.uWaveLo.value.set("#c58fe6");
    hu.uWaveHi.value.set(C.lilac);
    hu.uWaveOut.value = 0;
    A.tween(620, (t) => (hu.uWave.value = t), ease.compose);
    this.sound("tier.onepct", HIT);
    await A.wait(320);
    this.check(run);
    // The sealed mini Signature pack grows to fill the stage; PackReveal plays.
    const asset = this.reveal ?? (await this.ensureReveal(true));
    this.check(run);
    if (!asset) return;
    [0, 1, 2, 3].forEach((i) => {
      const c = this.cards[i];
      const z0 = c.root.position.z,
        d0 = c.front.uniforms.uDim.value;
      A.tween(
        360,
        (t) => {
          c.root.position.z = lerp(z0, z0 - 0.8, t);
          c.dim = lerp(d0, 0.4, t);
        },
        ease.arrive,
      );
    });
    const g = asset.group;
    g.visible = true;
    g.position.copy(hit.root.position).add(V(0, 0.05, 0.1));
    g.scale.setScalar(0.32);
    g.renderOrder = 6;
    asset.setProgress(0);
    A.tween(240, (t) => (hit.opacity = 1 - t));
    await A.tween(
      480,
      (t) => {
        g.scale.setScalar(lerp(0.32, 0.8, t));
        g.position.y = lerp(hit.root.position.y + 0.05, 0.2, t);
      },
      ease.compose,
    );
    this.check(run);
    hit.root.visible = false;
    let burst = false;
    await A.tween(
      2200,
      (t, raw) => {
        asset.setProgress(t);
        if (raw > 0.5 && !burst) {
          burst = true;
          this.beat("tier-peak");
          this.sparkles.emit(
            {
              origin: g.position.clone().add(V(0, 0.3, 0.6)),
              count: 12,
              rnd: this.rnd,
              speed: [0.6, 1.6],
              dir: V(0, 0, 1),
              spread: Math.PI,
              scale: [0.6, 1.2],
              life: [1.0, 1.5],
              box: V(2.4, 2.2, 0.2),
              spin: 2,
            },
            { billboard: true, grow: 1 },
          );
          this.holoShards.emit({
            origin: g.position.clone().add(V(0, 0.2, 0.4)),
            count: 22,
            rnd: this.rnd,
            speed: [2.2, 4.0],
            dir: V(0, 0, 1),
            spread: Math.PI * 0.8,
            scale: [0.08, 0.15],
            life: [0.9, 1.3],
            spin: 14,
          });
        }
      },
      ease.inOutSine,
    );
    this.check(run);
    // Cut to the 1% Card on 1% TV (the broadcast owns the screen: no Skip over its bands).
    this.beat("takeover");
    this.overlay.showSkip(false);
    this.punchFx(560, 1);
    this.tweenBloom(1.05, 400);
    hit.setFaceTextures(...prep.hit, TIERS.one_pct.holo);
    hit.root.visible = true;
    hit.opacity = 1;
    hit.setGlow(0.8, "#f4e6ff");
    hit.root.position.set(0, 0.04, 2.75);
    // The card rises out of the opened pack (no hard cut): it grows into place while the pack
    // shrinks back behind it.
    const climax = this.portrait ? 1.8 : 1.45;
    hit.root.scale.setScalar(climax * 0.72);
    A.tween(
      260,
      (t) => hit.root.scale.setScalar(lerp(climax * 0.72, climax, t)),
      ease.arrive,
    );
    const gs = g.scale.x,
      gz = g.position.z;
    A.tween(
      200,
      (t) => {
        g.scale.setScalar(lerp(gs, gs * 0.6, t));
        g.position.z = gz - 0.8 * t;
      },
      ease.inQuad,
    ).then(() => {
      g.visible = false;
    });
    // The climax card is drawn after the 1% TV pass: the broadcast frames it, never degrades it.
    this.hitOverCrt = true;
    // The 1% Card takes over; the Dust Cards come back a little into the broadcast.
    [0, 1, 2, 3].forEach((i) => {
      const c = this.cards[i];
      const z0 = c.root.position.z,
        d0 = c.front.uniforms.uDim.value;
      A.tween(
        420,
        (t) => {
          c.root.position.z = lerp(z0, z0 + 0.2, t);
          c.dim = lerp(d0, 0.6, t);
        },
        ease.arrive,
      );
    });
    hit.flip.rotation.y = 0;
    this.autoHolo = true;
    hu.uWaveLo.value.set(C.paperEdge);
    hu.uWaveHi.value.set(C.paper);
    A.tween(
      380,
      (t) => {
        this.crt.amount = t;
        this.crt.bands = t;
      },
      ease.outCubic,
    );
    const { title, chip } = this.tierTitle(prep);
    this.overlay.setResult(title, chip);
    this.overlay.announce(`${title} ${chip}.`);
    // Sparkles around the card, from behind it: never over its text.
    this.sparkles.emit(
      {
        origin: hit.root.position.clone().add(V(0, -0.3, -0.3)),
        count: 8,
        rnd: this.rnd,
        speed: [0.3, 0.8],
        dir: V(0, 0, -1),
        spread: Math.PI,
        scale: [0.5, 1.0],
        life: [1.0, 1.4],
        delay: [0, 0.5],
        box: V(3.2, 2.8, 0.2),
        spin: 2,
      },
      { billboard: true, grow: 1 },
    );
    const u = hit.front.uniforms;
    A.tween(
      900,
      (t) => {
        u.uShine.value = lerp(-0.75, 0.95, t);
        u.uShineAmt.value = Math.sin(Math.PI * t);
      },
      ease.inOutSine,
    );
    await A.wait(1500);
    this.check(run);
  }

  /** Paints the 1% TV bands at CSS resolution (they sit under scanlines and RGB split) and uploads them. */
  private updateBands(prep: Prepared) {
    // Painted for every tier (equal prepare work, no timing tell); used by The 1% only.
    const r = this.root.getBoundingClientRect();
    const pr = Math.min(2, this.renderer.getPixelRatio());
    const w = Math.max(2, Math.round(r.width)),
      h = Math.max(2, Math.round(r.height));
    const hit = prep.result.hit;
    const copy =
      hit.tier === "one_pct"
        ? `THE 1% ✳ ${fmtAmount(hit.amountUi)} ${ticker(hit.symbol)}`
        : "THE 1%";
    this.crt.drawBands(Math.round(w * pr), Math.round(h * pr), w, h, copy);
    this.crt.uploadBands();
  }

  private tele(prep: Prepared): Telegraph {
    return this.opts.rarityTelegraph === false
      ? NEUTRAL
      : TELEGRAPH[prep.result.hit.tier];
  }

  /** Particle budget: 60 on desktop, 24 on phones (DA §8.2). */
  private cap(n: number) {
    return Math.min(n, this.portrait ? 24 : 60);
  }

  private flashAt(
    pos: THREE.Vector3,
    color: string,
    size: number,
    peak: number,
    ms: number,
  ) {
    const f = this.flash;
    f.mesh.position.copy(pos);
    f.color = color;
    this.anim
      .tween(
        ms,
        (_, raw) => {
          const k = raw < 0.16 ? raw / 0.16 : 1 - (raw - 0.16) / 0.84;
          f.opacity = peak * k * k;
          f.mesh.scale.setScalar(size * (0.55 + 0.65 * ease.outCubic(raw)));
        },
        ease.linear,
      )
      .then(() => (f.opacity = 0));
  }

  /** Camera punch: a quick field-of-view kick that springs back. */
  private punchCamera(deg: number, ms: number) {
    if (this.reduced) return;
    // A 60 ms attack (never a one-frame zoom jump), then a damped spring back.
    const a = Math.min(0.2, 60 / ms);
    this.anim
      .tween(
        ms,
        (_, raw) => {
          this.fovKick =
            raw < a
              ? -deg * ease.outCubic(raw / a)
              : -deg * Math.exp(-(raw - a) * 4.5) * Math.cos((raw - a) * 10);
        },
        ease.linear,
      )
      .then(() => (this.fovKick = 0));
  }

  /** A light tick under the finger when a card is picked (touch devices). */
  private tick() {
    if (
      this.reduced ||
      this.opts.haptics === false ||
      !window.matchMedia("(pointer: coarse)").matches
    )
      return;
    try {
      (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(
        8,
      );
    } catch {
      /* not allowed */
    }
  }

  /** A short vibration on phones for Holo Foil and up (silent where unsupported; off under reduced motion). */
  private haptic(rank: number) {
    if (this.reduced || this.opts.haptics === false || rank < 2) return;
    const nav = navigator as Navigator & {
      vibrate?: (p: number | number[]) => boolean;
    };
    try {
      nav.vibrate?.(
        rank >= 4 ? [30, 40, 60, 40, 90] : rank === 3 ? [25, 35, 55] : [35],
      );
    } catch {
      /* not allowed */
    }
  }

  private bloomPulse(extra: number, ms: number) {
    this.anim
      .tween(
        ms,
        (_, raw) =>
          (this.bloomExtra =
            extra *
            Math.sin(Math.PI * Math.min(1, raw * 1.15)) *
            (1 - raw * 0.3)),
        ease.linear,
      )
      .then(() => (this.bloomExtra = 0));
  }

  /** The pack bursts open: light from the opening (tier coloured), foil confetti, punch, bloom. */
  private packBurst(pack: Pack3D, prep: Prepared) {
    const T = this.tele(prep);
    const A = this.anim;
    this.sound("pack.burst", T.rank);
    const at = pack.group.position
      .clone()
      .add(V(0, pack.tearMidY * pack.group.scale.y, 0.25));
    this.flashAt(
      at,
      T.color,
      1.6 + 1.4 * T.power,
      0.3 + 0.35 * Math.min(1, T.power),
      320,
    );
    this.rays.mesh.position.copy(at).add(V(0, 0.15, -0.35));
    this.rays.color = T.color;
    this.rays.holo = T.holo;
    this.rays.mesh.scale.setScalar(2.6 + 2.2 * T.power);
    this.rays.speed = 0.7;
    A.tween(
      760,
      (_, raw) =>
        (this.rays.opacity = Math.sin(Math.PI * raw) * (0.12 + 0.45 * T.power)),
      ease.linear,
    );
    this.confetti.emit(
      {
        origin: at,
        count: this.cap(10 + Math.round(22 * T.power)),
        rnd: this.rnd,
        speed: [1.8, 3.6],
        dir: V(0, 1, 0.45),
        spread: 0.95,
        scale: [0.8, 1.3],
        life: [1.2, 1.8],
        spin: 12,
        palette: T.palette,
        box: V(1.4, 0.1, 0.1),
      },
      { flutter: 0.6 },
    );
    this.punchCamera(0.8 + 1.1 * T.power, 420);
    this.bloomPulse(0.35 * T.power, 520);
  }

  /** The hit card turns: flash, confetti burst, camera punch, bloom pulse; the rays flare. */
  private hitBurst(hit: Card3D, T: Telegraph, prep: Prepared) {
    const A = this.anim;
    this.sound("hit.burst", T.rank);
    const at = hit.root.position.clone().add(V(0, 0, 0.35));
    this.flashAt(
      at,
      T.color,
      2.6 + 2.4 * T.power,
      0.55 + 0.35 * Math.min(1, T.power),
      380,
    );
    this.punchCamera(1.2 + 1.8 * T.power, 600);
    this.bloomPulse(0.85 * T.power, 760);
    // Confetti bursts out from behind the card, around its edges (never across its face).
    this.confetti.emit(
      {
        origin: hit.root.position.clone().add(V(0, 0.1, -0.3)),
        count: this.cap(12 + Math.round(38 * T.power)),
        rnd: this.rnd,
        speed: [2.4, 5.0],
        dir: V(0, 0.75, -0.1),
        spread: Math.PI * 0.85,
        scale: [0.8, 1.4],
        life: [1.3, 2.2],
        spin: 14,
        palette: T.palette,
        box: V(0.9, 1.2, 0.05),
      },
      { flutter: 0.8 },
    );
    this.haptic(T.rank);
    const r0 = this.rays.opacity,
      peak = 0.35 + 0.5 * Math.min(1, T.power);
    A.tween(
      950,
      (_, raw) => {
        this.rays.opacity =
          raw < 0.12
            ? lerp(r0, peak, raw / 0.12)
            : lerp(peak, 0.18 * T.power, ease.outCubic((raw - 0.12) / 0.88));
        this.rays.speed = lerp(2.2, 0.25, ease.outCubic(raw));
      },
      ease.linear,
    );
    // The dusk lifts (Black Foil keeps its own dark stage).
    if (prep.result.hit.tier !== "black")
      this.tweenMood(T.dusk, T.duskAlpha, 0, 420);
  }

  /** Swaps two face-down cards in place (identical backs: the swap is invisible). */
  private swapCards(a: Card3D, b: Card3D) {
    const swapV = (x: THREE.Vector3, y: THREE.Vector3) => {
      const t = x.clone();
      x.copy(y);
      y.copy(t);
    };
    const swapE = (x: THREE.Euler, y: THREE.Euler) => {
      const t = x.clone();
      x.copy(y);
      y.copy(t);
    };
    swapV(a.root.position, b.root.position);
    swapE(a.root.rotation, b.root.rotation);
    swapV(a.root.scale, b.root.scale);
    swapV(a.tilt.position, b.tilt.position);
    swapE(a.tilt.rotation, b.tilt.rotation);
    swapV(a.tilt.scale, b.tilt.scale);
    const ga = a.glow.material as THREE.MeshBasicMaterial,
      gb = b.glow.material as THREE.MeshBasicMaterial;
    const go = ga.opacity,
      gc = ga.color.clone();
    ga.opacity = gb.opacity;
    ga.color.copy(gb.color);
    gb.opacity = go;
    gb.color.copy(gc);
    const sa = this.slotOf[a.index];
    this.slotOf[a.index] = this.slotOf[b.index];
    this.slotOf[b.index] = sa;
  }

  private faceDownCandidates() {
    return this.cards.filter(
      (c) => c.root.visible && !this.picked.has(c.index),
    );
  }

  /** Tap mode: resolves with the face-down card the viewer picks, or 'all' (Reveal all / skip). */
  private async waitPick(run: number): Promise<Card3D | "all"> {
    this.check(run);
    this.beat("pick");
    const v = await new Promise<Card3D | "all">((res) => {
      this.pickResolver = res;
    });
    this.pickResolver = null;
    this.check(run);
    if (v !== "all") {
      this.picked.add(v.index);
      this.tick();
    }
    return v;
  }

  revealAll() {
    this.revealAllRequested = true;
    this.pickResolver?.("all");
  }

  /** The one "Reveal all" button: while the viewer turns the cards, the rest turn over (and the
   * button goes: nothing is left to reveal); before that, a cut to the end, every card revealed. */
  private revealEverything() {
    if (this.picking) {
      this.overlay.showSkip(false);
      this.revealAll();
    } else this.skip();
  }

  /** Tap mode: the viewer turns the four Dust Cards in any order (the last card is the hit). */
  private async pickDust(run: number, ep: number) {
    const A = this.anim;
    this.picking = true;
    this.overlay.setCaption("Tap a card to reveal it", "tap");
    const flips: Promise<void>[] = [];
    try {
      for (let n = 0; n < 4; n++) {
        this.updatePips();
        const pick = this.revealAllRequested ? "all" : await this.waitPick(run);
        if (n === 0) this.overlay.setCaption(null);
        if (pick === "all") {
          for (let k = n; k < 4; k++) {
            this.picked.add(k);
            flips.push(this.flipCard(this.cards[k], k, ep));
            await A.wait(150);
            this.check(run);
          }
          break;
        }
        const target = this.cards[n];
        if (pick !== target) {
          this.swapCards(target, pick);
          this.picked.delete(pick.index);
          this.picked.add(target.index);
        }
        flips.push(this.flipCard(target, n, ep));
      }
      await Promise.all(flips);
      this.check(run);
    } finally {
      this.overlay.setCaption(null);
    }
  }

  /** Tap mode: the last face-down card is the hit; it waits for its own tap. */
  private async pickHit(run: number) {
    if (this.revealAllRequested || this.skipRequested) return;
    const hit = this.cards[HIT];
    this.pickingHit = true;
    this.overlay.setCaption("Last card: your hit", "tap");
    this.updatePips(HIT);
    const t0 = this.anim.now;
    const stop = this.anim.loop((now) => {
      const k = Math.min(1, (now - t0) / 300);
      hit.setGlow((0.25 + 0.12 * Math.sin((now - t0) * 0.006)) * k, C.lilac);
    });
    try {
      await this.waitPick(run);
    } finally {
      stop();
      this.pickingHit = false;
      this.overlay.setCaption(null);
    }
  }

  private shake(ms: number) {
    this.anim
      .tween(ms, (t) => (this.shakeAmp = 1 - t), ease.linear)
      .then(() => (this.shakeAmp = 0));
  }

  private async endState(run: number, prep: Prepared) {
    const A = this.anim;
    const hu = this.hazeMat.uniforms;
    this.beat("end");
    this.autoHolo = false;
    this.resetEndLayout();
    const tier = TIERS[prep.result.hit.tier];
    const r = prep.result;
    const { title } = this.tierTitle(prep);
    this.overlay.showSkip(false);
    this.overlay.setPips(null);
    // Title and actions are laid out first (still hidden) so the camera frames the cards in the
    // band between them; the money stays on the card and on its own action.
    const big =
      r.hit.tier === "holo" ||
      r.hit.tier === "black" ||
      r.hit.tier === "jackpot" ||
      r.hit.tier === "one_pct";
    this.overlay.setResult(title, undefined, {
      verify: r.verifyUrl ?? true,
      share: big,
    });
    this.buildActions(prep);
    this.moveCamera(SHOTS.end, 700, ease.compose);
    // The machine recedes behind the cards: more haze, deeper defocus.
    this.tweenHaze(0.52, 600);
    this.tweenDefocus(0.85, 700);
    this.tweenBloom(0.35, 700);
    const rays0 = this.rays.opacity;
    A.tween(
      600,
      (t) => (this.rays.opacity = lerp(rays0, 0, t)),
      ease.inOutSine,
    );
    this.tweenMood(C.cream, 0.85, 0, 600);
    this.emitMood(C.cream, 0, 600);
    const dolly0 = this.dolly;
    A.tween(600, (t) => (this.dolly = lerp(dolly0, 0, t)));
    const crt0 = this.crt.amount;
    A.tween(650, (t) => {
      this.crt.amount = lerp(crt0, 0, t);
      this.crt.bands = lerp(crt0, 0, t);
    });
    if (hu.uWave.value > 0 && hu.uWaveOut.value === 0) {
      A.tween(650, (t) => (hu.uWaveOut.value = t), ease.compose).then(() => {
        hu.uWave.value = 0;
        hu.uWaveOut.value = 0;
      });
    }
    const hit = this.cards[HIT];
    const glow0 = (hit.glow.material as THREE.MeshBasicMaterial).opacity;
    const gold = tier.id === "black" || tier.id === "jackpot";
    const moves = this.cards.map((c, i) =>
      A.wait(Math.abs(SLOT_OF[i] - 2) * 40).then(() =>
        Promise.all([
          this.tweenPose(c, this.endPose(i), 650, ease.arrive),
          A.tween(500, (t) => {
            c.tilt.rotation.set(0, 0, 0);
            c.tilt.position.y = lerp(c.tilt.position.y, 0, t);
            c.setShadow(0.16);
            if (c === hit) {
              hit.setGlow(lerp(glow0, 0.35, t), gold ? "#e8b64f" : undefined);
              hit.front.uniforms.uGoldGlow.value = lerp(
                hit.front.uniforms.uGoldGlow.value,
                gold ? 0.35 : 0,
                t,
              );
              hit.front.uniforms.uGlint.value = lerp(
                hit.front.uniforms.uGlint.value,
                tier.id === "blue" ? 0.25 : 0,
                t,
              );
            }
          }),
        ]),
      ),
    );
    await Promise.all(moves);
    this.check(run);
    this.state = "end";
    this.crt.amount = 0;
    this.crt.bands = 0;
    this.layoutLive = this.portrait;
    this.glowSelected();
    this.positionActions();
    this.overlay.showActions(true);
  }

  /** Lines shown under the actions on hover / focus: none by default (each button says what it
   * does); the app can pass its own. */
  private hints(): Partial<Record<CardAction, string>> {
    return { ...this.opts.actionHints };
  }

  /** "+3.48 SOL · instant": the Sell price on its own ("n/a" while the quote is pending). */
  private sellChip(quote: SolQuote | undefined): string {
    return quotePending(quote)
      ? "n/a"
      : endCopy("cards.figure.sell", { sol: fmtSol(quote ?? null) });
  }

  /**
   * Default actions (founder rule, after a pull), used when the app does not pass `actions`: a stock hit
   * is sold in one tap or found in My cards; the Jackpot and The 1% wait in My cards; Dust Cards and
   * House slots have none (they land in My cards).
   */
  private defaultActions(i: number, prep: Prepared): CardAction[] {
    return i === HIT
      ? endActions({ hit: true, tier: prep.result.hit.tier })
      : endActions({ hit: false });
  }

  private buildActions(prep: Prepared) {
    const hit = prep.result.hit;
    const hints = this.hints();
    const LABEL: Record<CardAction, string> = {
      sell_back: endCopy("cards.choice.sell"),
      my_cards: endCopy("rip.end.myCards"),
    };
    // Sell first (the money, now), then Go to My cards; one per row. "Rip again", in the host's dock,
    // stays the strongest call to action: neither button is the ink primary.
    const RANK: Record<CardAction, number> = { sell_back: 0, my_cards: 1 };
    const cards = this.cards.map((_, i) => {
      const isHit = i === HIT;
      const d = prep.result.dust[i];
      const list = [
        ...((isHit ? hit.actions : d?.actions) ?? this.defaultActions(i, prep)),
      ].sort((a, b) => RANK[a] - RANK[b]);
      const refused = isHit && !!hit.sellBackReason;
      const specs: ActionSpec[] = list.map((a) => ({
        action: a,
        label: LABEL[a],
        hint:
          a === "sell_back" && refused
            ? (hit.sellBackReason ?? undefined)
            : hints[a],
        chip:
          a === "sell_back" && !refused
            ? this.sellChip(hit.sellBackSolUi)
            : undefined,
        arrow: a === "my_cards",
        disabled: a === "sell_back" && refused,
        wide: true,
      }));
      const name = isHit
        ? this.tierTitle(prep).name
        : !d || d.house
          ? "House card"
          : `${ticker(d.symbol)}`;
      const sub = isHit
        ? `${fmtAmount(hit.amountUi)} ${ticker(hit.symbol)}`
        : !d || d.house
          ? undefined
          : "Dust Card";
      const label = isHit
        ? `${name}, ${fmtAmount(hit.amountUi)} ${ticker(hit.symbol)}`
        : !d || d.house
          ? "House card"
          : `Dust Card, ${fmtAmount(d.amountUi)} ${ticker(d.symbol)}`;
      // The plain line under the buttons, only where it says something they don't: a refused
      // Sell says why; a Dust Card (no button) says where it goes.
      const help =
        refused && list.includes("sell_back")
          ? (hit.sellBackReason ?? undefined)
          : list.length
            ? undefined
            : d && !d.house
              ? endCopy("rip.end.dust")
              : undefined;
      return { index: i, label, title: name, sub, help, specs };
    });
    this.overlay.buildActions(cards);
  }

  /** The selected card's actions: a panel right of the large card (landscape) or above the host dock (portrait). */
  private positionActions() {
    if (
      !this.cards[this.selected]?.root.visible ||
      this.soldBack.has(this.selected)
    ) {
      const next = this.endOrder().find((i) => this.cards[i].root.visible);
      if (next !== undefined) this.selected = next;
    }
    this.overlay.showOnly(this.selected);
    const W = this.root.clientWidth,
      H = this.root.clientHeight;
    if (this.portrait) {
      const ph = this.overlay.actionsHeight(this.selected);
      this.overlay.positionActions(
        this.selected,
        16,
        H - this.insets.bottom - 12 - ph,
        W - 32,
      );
      return;
    }
    const shot = this.fit(SHOTS.end);
    const a = this.projectFrom(shot, V(END.SH / 2 + END.G, END.y, END.z));
    const b = this.projectFrom(
      shot,
      V(END.SH / 2 + END.G + 2 * END.DS + END.gap, END.y, END.z),
    );
    const width = Math.max(280, Math.min(400, b.x - a.x, W - 16 - a.x));
    const ph = this.overlay.actionsHeight(this.selected);
    const y = Math.max(
      this.overlay.resultBottom() + 12 + ph / 2,
      Math.min(a.y, H - this.insets.bottom - 12 - ph / 2),
    );
    this.overlay.positionActions(this.selected, a.x, y, width);
  }

  private glowSelected() {
    const tier = this.prepared?.result.hit.tier;
    const gold = tier === "black" || tier === "jackpot";
    this.cards.forEach((c) => {
      const on = c.index === this.selected;
      if (c.index === HIT)
        c.setGlow(on ? 0.35 : 0.12, gold ? "#e8b64f" : C.lilac);
      else c.setGlow(on ? 0.22 : 0, C.lilac);
    });
  }

  private select(index: number) {
    if (
      index === this.selected ||
      this.state !== "end" ||
      this.soldBack.has(index) ||
      !this.cards[index]?.root.visible
    )
      return;
    if (this.portrait) {
      this.selected = index;
      this.focusTarget = Math.max(0, this.endOrder().indexOf(index));
    } else {
      // The clicked card and the large one trade places.
      const j = this.gridSlots.indexOf(index);
      if (j >= 0) this.gridSlots[j] = this.selected;
      this.selected = index;
      this.cards.forEach((c) => {
        if (c.root.visible && !this.soldBack.has(c.index))
          this.tweenPose(
            c,
            this.endPose(c.index),
            this.reduced ? 0 : 480,
            ease.arrive,
            c.index === index && !this.reduced ? 0.18 : 0,
          );
      });
    }
    this.glowSelected();
    this.positionActions();
    this.sound("card.flip", index);
  }

  private async handleAction(
    index: number,
    action: CardAction,
    button: HTMLButtonElement,
  ) {
    void button;
    this.listeners.cardAction.forEach((cb) => cb(index, action));
    const auto =
      this.opts.autoActionAnimations !== false &&
      (action !== "sell_back" || this.opts.autoSellBackAnimation !== false);
    if (auto) {
      await this.animateAction(index, action);
      return;
    }
    // Go to My cards needs no transaction: the app animates it at once.
    if (action === "my_cards") return;
    // Waiting for the app (it calls animateAction when done): a small acknowledgement on the card.
    const c = this.cards[index];
    if (this.reduced || !c.root.visible) return;
    const y0 = this.endPose(index).pos.y;
    await this.anim.tween(
      380,
      (_, raw) => (c.root.position.y = y0 + Math.sin(Math.PI * raw) * 0.1),
      ease.linear,
    );
  }

  setTargets(targets: {
    myCards?: HTMLElement | null;
    wallet?: HTMLElement | null;
  }) {
    this.targets = { ...this.targets, ...targets };
  }

  /** World point on the plane z = `z` under a screen point (a host element's centre, or a fallback). */
  private worldAtScreen(
    el: HTMLElement | null | undefined,
    fallback: [number, number],
    z: number,
  ) {
    const r = this.root.getBoundingClientRect();
    let x: number, y: number;
    if (el && el.isConnected) {
      const b = el.getBoundingClientRect();
      x = b.left + b.width / 2;
      y = b.top + b.height / 2;
    } else {
      x = r.left + r.width * fallback[0];
      y = r.top + r.height * fallback[1];
    }
    const ndc = new THREE.Vector2(
      ((x - r.left) / r.width) * 2 - 1,
      -((y - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const out = new THREE.Vector3();
    ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z),
      out,
    );
    return out;
  }

  async animateAction(cardIndex: number, action: CardAction): Promise<void> {
    if (action === "sell_back") return this.animateSellBack(cardIndex);
    const c = this.cards[cardIndex];
    if (
      !c ||
      !c.root.visible ||
      this.soldBack.has(cardIndex) ||
      this.state !== "end"
    )
      return;
    this.soldBack.add(cardIndex);
    this.overlay.hideActionsFor(cardIndex);
    this.beat("action");
    const run = this.runId;
    const A = this.anim;
    const r = this.reduced;
    const start = c.root.position.clone();
    const s0 = c.root.scale.x;
    // Go to My cards: the card shrinks into the "My cards" entry, the entry pulses; the app then opens
    // My cards with this card highlighted (no toast: the page changes).
    this.sound("card.keep", cardIndex);
    const tgt = this.worldAtScreen(
      this.targets.myCards,
      [0.94, -0.04],
      start.z + 0.8,
    );
    if (r) await A.tween(150, (t) => (c.opacity = 1 - t));
    else {
      await A.tween(
        130,
        (t) => {
          c.root.position.z = start.z + 0.3 * t;
          c.root.scale.setScalar(s0 * (1 + 0.05 * t));
        },
        ease.outQuad,
      );
      const p0 = c.root.position.clone();
      await A.tween(
        560,
        (t, raw) => {
          c.root.position.lerpVectors(p0, tgt, t);
          c.root.position.y += Math.sin(Math.PI * t) * 0.5;
          c.root.scale.setScalar(s0 * lerp(1.05, 0.1, t));
          c.root.rotation.z = lerp(0, -0.45, t);
          c.opacity = 1 - clamp01((raw - 0.82) / 0.18);
        },
        ease.compose,
      );
    }
    if (this.targets.myCards) pulse(this.targets.myCards, "#d5a2f1");
    c.root.visible = false;
    c.opacity = 1;
    c.flip.rotation.y = 0;
    c.root.rotation.set(0, 0, 0);
    this.beat("action-done");
    if (run !== this.runId) return;
    this.closeRow(r);
  }

  /** After a card leaves: the next one takes the large spot and the others close the gap. */
  private closeRow(r: boolean) {
    const order = this.endOrder().filter((i) => this.cards[i].root.visible);
    this.gridSlots = this.gridSlots.filter(
      (i) => order.includes(i) && i !== this.selected,
    );
    if (!order.includes(this.selected)) {
      const next = this.portrait
        ? order[
            Math.min(
              order.length - 1,
              Math.max(0, Math.round(this.focusTarget)),
            )
          ]
        : (this.gridSlots.shift() ?? order[0]);
      if (next !== undefined) this.selected = next;
    }
    this.gridSlots = this.gridSlots.filter((i) => i !== this.selected);
    this.focusTarget = Math.max(0, order.indexOf(this.selected));
    const live = this.layoutLive;
    this.layoutLive = false;
    this.focus = this.focusTarget;
    const moves = order.map((i) =>
      this.tweenPose(this.cards[i], this.endPose(i), r ? 0 : 420, ease.arrive),
    );
    // The title block may have grown ("Sold · +X SOL"): re-aim at the end framing.
    this.moveCamera(SHOTS.end, r ? 0 : 420, ease.arrive);
    Promise.all(moves).then(() => {
      if (this.state === "end") this.layoutLive = live || this.portrait;
    });
    this.glowSelected();
    this.positionActions();
  }

  // -------------------------------------------------------------------------
  // Reduced motion: same information, ≤150 ms cross-fades, nothing moves.
  // -------------------------------------------------------------------------

  private async playReduced(run: number) {
    const A = this.anim;
    const pack = this.pack!;
    const shot = this.fit(SHOTS.reveal);
    this.cam.pos.copy(shot.pos);
    this.cam.look.copy(shot.look);
    this.hazeMat.uniforms.uHaze.value = 0.42;
    this.defocus = 0.45;
    this.beat("crank");
    this.sound("crank.turn");
    pack.group.position.copy(FOCUS);
    pack.group.rotation.set(0, 0, -0.035);
    pack.group.scale.setScalar(1);
    pack.sheen = 0.2;
    pack.xray = 1;
    pack.setAura(0.45, C.lilac);
    pack.setScan(-1, 0);
    await A.tween(150, (t) => (pack.opacity = t));
    this.check(run);
    this.beat("cranking");
    this.overlay.setCaption("Cranking…", "xray");
    const t0 = A.now;
    const stillTimer = A.loop((now) => {
      if (now - t0 > 5000 && this.root.dataset.beat === "cranking") {
        this.overlay.setCaption(
          "Still cranking. The draw is on-chain.",
          "xray",
        );
        this.beat("still-cranking");
      }
    });
    try {
      await this.waitPrepared(run);
    } catch (err) {
      stillTimer();
      if (err instanceof RipFailedError) {
        pack.opacity = 0;
        this.overlay.setCaption(null);
        this.state = "idle";
        this.beat("failed");
        this.overlay.showNotice("Not cranked.", err.message, "Try again");
        this.overlay.announce(err.message);
      }
      throw err;
    }
    this.check(run);
    const elapsed = A.now - t0;
    if (elapsed < (this.opts.minCrankingMs ?? 900))
      await A.wait((this.opts.minCrankingMs ?? 900) - elapsed);
    this.check(run);
    stillTimer();
    this.resultUsed = true;
    const prep = this.prepared!;
    this.dressCards(prep);
    this.beat("lock");
    this.sound("lock");
    pack.setAura(0.6, this.tele(prep).color);
    pack.lock = 1;
    this.overlay.setCaption(null);
    await A.wait(500);
    this.check(run);
    this.beat("tear");
    this.sound("pack.rip");
    await A.tween(150, (t) => (pack.opacity = 1 - t));
    this.check(run);
    // Lay out the end first (actions hidden) so the cards appear where they will stay.
    this.resetEndLayout();
    this.buildActions(prep);
    const end = this.fit(SHOTS.end);
    this.cam.pos.copy(end.pos);
    this.cam.look.copy(end.look);
    this.hazeMat.uniforms.uHaze.value = 0.4;
    this.defocus = 0.6;
    this.beat("dust-flip");
    for (let i = 0; i < 5; i++) {
      const c = this.cards[i];
      this.applyPose(c, this.endPose(i));
      c.dim = this.endPose(i).dim ?? 1;
      c.flip.rotation.y = 0;
      c.opacity = 0;
      c.root.visible = true;
      c.setShadow(0);
    }
    for (let i = 0; i < 4; i++) {
      this.sound("card.flip", i);
      const to = this.endPose(i).opacity ?? 1;
      await A.tween(150, (t) => {
        this.cards[i].opacity = t * to;
        this.cards[i].setShadow(0.16 * t);
      });
      this.check(run);
      await A.wait(120);
      this.check(run);
    }
    this.beat("buildup");
    await A.wait(250);
    this.check(run);
    this.beat("hit-flip");
    const hit = this.cards[HIT];
    if (prep.result.hit.tier === "one_pct")
      hit.setFaceTextures(...prep.hit, TIERS.one_pct.holo);
    this.sound("card.flip", HIT);
    await A.tween(150, (t) => {
      hit.opacity = t;
      hit.setShadow(0.16 * t);
    });
    this.check(run);
    this.beat("tier");
    const tierId = prep.result.hit.tier;
    // Same information without motion: the Jackpot globe is emptied at once.
    if (tierId === "jackpot") {
      const d = Math.min(this.machineFill, 0.05);
      this.setFill(d);
      this.jackpotLevel = d;
    }
    this.sound(
      tierId === "one_pct" ? "tier.onepct" : (`tier.${tierId}` as SoundCue),
      HIT,
    );
    const { title, chip } = this.tierTitle(prep);
    this.overlay.setResult(title, chip);
    this.overlay.announce(chip ? `${title} ${chip}.` : title);
    hit.setGlow(
      0.35,
      tierId === "black" || tierId === "jackpot" ? "#e8b64f" : C.lilac,
    );
    this.beat("tier-peak");
    await A.wait(900);
    this.check(run);
    this.beat("end");
    this.state = "end";
    const r = prep.result;
    this.overlay.setResult(title, undefined, {
      verify: r.verifyUrl ?? true,
      share: ["holo", "black", "jackpot", "one_pct"].includes(r.hit.tier),
    });
    this.layoutLive = this.portrait;
    this.glowSelected();
    this.positionActions();
    this.overlay.showActions(true);
  }

  // -------------------------------------------------------------------------
  // Frame loop, input, resize
  // -------------------------------------------------------------------------

  /** Debug-only: called after every rendered frame with what is on screen (scripts/flash-check.mjs). */
  debugHook:
    | ((info: {
        t: number;
        beat: string;
        items: { name: string; area: number }[];
      }) => void)
    | null = null;
  private probeBox = new THREE.Box3();
  private get edgeMaterials(): THREE.Material[] {
    return this.cards.map((c) => c.side);
  }

  private overlayOn = false;
  private setOverlayLayer(on: boolean) {
    if (on === this.overlayOn) return;
    this.overlayOn = on;
    const hit = this.cards[HIT];
    for (const o of [hit.mesh, hit.glow, hit.shadow]) {
      o.layers.set(on ? OVERLAY_LAYER : 0);
      if (o === hit.mesh) o.layers.enable(BLOOM_LAYER);
    }
  }

  private renderOverlayLayer() {
    const r = this.renderer;
    const auto = r.autoClear;
    const bg = this.scene.background;
    const mask = this.camera.layers.mask;
    r.autoClear = false;
    r.setRenderTarget(null);
    r.clearDepth();
    this.scene.background = null;
    this.camera.layers.set(OVERLAY_LAYER);
    r.render(this.scene, this.camera);
    this.camera.layers.mask = mask;
    this.scene.background = bg;
    r.autoClear = auto;
  }

  /** Brief chromatic aberration + vignette punch (Black Foil, Jackpot, The 1%). */
  private punchFx(ms = 520, amount = 1) {
    if (this.reduced) return;
    this.anim
      .tween(
        ms,
        (_, raw) =>
          (this.punch = amount * Math.pow(1 - raw, 2) * Math.min(1, raw * 8)),
        ease.linear,
      )
      .then(() => (this.punch = 0));
  }

  private frameProbe() {
    const items: { name: string; area: number }[] = [];
    const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
    const measure = (name: string, obj: THREE.Object3D, opacity: number) => {
      if (opacity <= 0.001) return;
      for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
        if (!o.visible) return;
        if (o === this.scene) break;
        if (!o.parent) return; // detached: not drawn
      }
      obj.updateWorldMatrix(true, true);
      // Only what is drawn: visible meshes (a hidden halo or warm-up mesh is not on screen).
      this.probeBox.makeEmpty();
      const part = new THREE.Box3();
      obj.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh)
          this.probeBox.union(part.setFromObject(o, false));
      });
      if (this.probeBox.isEmpty()) return;
      const { min, max } = this.probeBox;
      let x0 = 1,
        y0 = 1,
        x1 = -1,
        y1 = -1;
      corners.forEach((c, i) => {
        c.set(
          i & 1 ? max.x : min.x,
          i & 2 ? max.y : min.y,
          i & 4 ? max.z : min.z,
        ).project(this.camera);
        x0 = Math.min(x0, c.x);
        x1 = Math.max(x1, c.x);
        y0 = Math.min(y0, c.y);
        y1 = Math.max(y1, c.y);
      });
      const w = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)) / 2;
      const h = Math.max(0, Math.min(1, y1) - Math.max(-1, y0)) / 2;
      items.push({ name, area: +(w * h).toFixed(4) });
    };
    // Everything actually in the scene graph and visible, whoever owns it.
    const packOpacity = new Map<THREE.Object3D, [string, number]>();
    this.packs.forEach((p, ed) =>
      packOpacity.set(p.group, [
        `pack:${ed}`,
        p.bodyMat.uniforms.uOpacity.value,
      ]),
    );
    const cardOpacity = new Map<THREE.Object3D, number>();
    this.cards.forEach((c) =>
      cardOpacity.set(c.mesh, c.front.uniforms.uOpacity.value),
    );
    this.scene.traverseVisible((o) => {
      if (o.name === "RipPack") {
        const [n, op] = packOpacity.get(o) ?? ["pack:?", 1];
        measure(n, o, op);
      } else if (o.name === "OnePercentPack") measure("reveal", o, 1);
      else if (o.name.startsWith("RipCard_"))
        measure(`card:${o.name.slice(8)}`, o, cardOpacity.get(o) ?? 1);
    });
    return {
      t: Math.round(performance.now()),
      beat: this.root.dataset.beat ?? "none",
      items,
    };
  }

  // Debug-only clock control (used by the capture script to grab exact beats).
  private clockOffset = 0;
  private frozen = false;
  private freezeQueue: { at: number; resolve: () => void }[] = [];
  private animNow = 0;
  /** Freezes the choreography clock `delayMs` from now (animation time). Resolves once frozen. */
  debugFreezeAfter(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.freezeQueue.push({ at: this.animNow + delayMs, resolve });
      this.freezeQueue.sort((a, b) => a.at - b.at);
    });
  }
  debugResume() {
    this.frozen = false;
  }

  private frame = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const realDt = Math.min(0.05, (now - (this.last || now - 16.7)) / 1000);
    this.last = now;
    this.watchFrameRate(realDt);
    if (this.frozen) this.clockOffset += realDt * 1000;
    let t = now - this.clockOffset;
    const head = this.freezeQueue[0];
    if (!this.frozen && head && t >= head.at) {
      this.clockOffset += t - head.at;
      t = head.at;
      this.frozen = true;
      this.freezeQueue.shift();
      requestAnimationFrame(() => requestAnimationFrame(() => head.resolve()));
    }
    const dt = this.frozen
      ? 0
      : Math.min(0.05, Math.max(0, (t - this.animNow) / 1000));
    this.animNow = t;
    this.time += dt;
    const prof = (
      window as unknown as { __ripProfile?: Record<string, number>[] }
    ).__ripProfile;
    const p0 = prof ? performance.now() : 0;
    this.anim.tick(t, dt);
    const p1 = prof ? performance.now() : 0;

    // Pointer smoothing (no parallax under reduced motion).
    const k = 1 - Math.exp(-dt * 6);
    const target = this.reduced ? new THREE.Vector2() : this.pointer;
    this.pointerSmooth.lerp(target, k);

    // Camera with gentle parallax, dolly and shake.
    const look = this.cam.look.clone();
    const pos = this.cam.pos.clone();
    const dir = look.clone().sub(pos).normalize();
    pos.addScaledVector(dir, this.dolly);
    // Parallax is subtle, and almost off in the end state (DOM title and actions stay aligned).
    const px = this.state === "end" ? 0.03 : 0.16;
    pos.x += this.pointerSmooth.x * px;
    pos.y += this.pointerSmooth.y * px * 0.5;
    // Idle life: a slow ±4° orbit (40 s period) so highlights travel across brass and glass.
    if (!this.reduced) {
      // The orbit starts from 0° once the live machine is on screen (it matches the poster then).
      const live = this.root.dataset.ready === "true";
      if (live) this.orbitTime += dt;
      const w = (this.idleOrbit = lerp(
        this.idleOrbit,
        this.state === "idle" && live ? 1 : 0,
        1 - Math.exp(-dt * 1.5),
      ));
      if (w > 0.001) {
        const a =
          THREE.MathUtils.degToRad(4) *
          Math.sin(this.orbitTime * ((Math.PI * 2) / 40)) *
          w;
        const off = pos.clone().sub(look);
        off.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
        pos.copy(look).add(off);
      }
    }
    if (this.shakeAmp > 0 && !this.reduced) {
      const h = this.root.clientHeight || 800;
      const dist = pos.distanceTo(look);
      const unit =
        (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) /
        h;
      const amp = 6 * unit * this.shakeAmp;
      pos.x += (Math.random() - 0.5) * 2 * amp;
      pos.y += (Math.random() - 0.5) * 2 * amp;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    const fov = BASE_FOV + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.flash.mesh.visible)
      this.flash.mesh.quaternion.copy(this.camera.quaternion);
    if (this.rays.mesh.visible)
      this.rays.mesh.quaternion.copy(this.camera.quaternion);

    // Hover: tilt and light the card under the pointer.
    this.updateHover(dt);
    if (this.layoutLive && this.state === "end" && this.portrait)
      this.updateCarousel(realDt);
    if (this.fanFloat > 0.001) {
      for (const c of this.cards)
        c.tilt.position.y =
          this.fanFloat *
          0.028 *
          Math.sin(this.time * 1.7 + this.slotOf[c.index] * 1.25);
    }
    for (const c of this.cards) c.time = this.time;
    if (this.pack) {
      this.pack.time = this.time;
      this.pack.update(dt);
      this.pack.setPointer(this.pointerSmooth.x, this.pointerSmooth.y);
    }
    this.sparks.update(dt);
    this.sparkles.update(dt);
    this.confetti.update(dt);
    this.rays.update(dt, this.time);
    this.holoShards.update(dt);
    this.coins.update(dt);
    this.hazeMat.uniforms.uTime.value = this.time;
    this.crt.motion = this.reduced ? 0 : 1;
    this.compositor.blur = this.defocus;
    const onStage =
      this.cards.some(
        (c) => c.root.visible && c.front.uniforms.uOpacity.value > 0.01,
      ) ||
      (this.pack?.group.visible ?? false);
    this.finish.bloom = onStage ? this.bloomLevel + this.bloomExtra : 0;
    this.finish.punch = this.reduced ? 0 : this.punch;
    const over = this.hitOverCrt && this.crt.active;
    this.setOverlayLayer(over);
    let p2 = 0,
      p3 = 0;
    this.crt.render(() => {
      p2 = prof ? performance.now() : 0;
      this.compositor.render(this.scene, this.camera);
      p3 = prof ? performance.now() : 0;
      this.finish.render(this.scene, this.camera, this.edgeMaterials);
    }, this.time);
    if (over) this.renderOverlayLayer();
    if (prof) {
      const p4 = performance.now();
      if (p4 - p0 > 8)
        prof.push({
          t: Math.round(p0),
          anim: +(p1 - p0).toFixed(1),
          pre: +(p2 - p1).toFixed(1),
          stage: +(p3 - p2).toFixed(1),
          finish: +(p4 - p3).toFixed(1),
          beat: this.root.dataset.beat as unknown as number,
          progs: this.renderer.info.programs?.length ?? 0,
        });
    }
    if (this.debugHook) this.debugHook(this.frameProbe());
  };

  private updateHover(dt: number) {
    const k = 1 - Math.exp(-dt * 10);
    let hovered: Card3D | null = null;
    let uv: THREE.Vector2 | null = null;
    const interactive = this.state === "end" || this.autoHolo || this.picking;
    if (interactive && this.pointerSeen > 0 && !this.reduced) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(
        this.cards.filter((c) => c.root.visible).map((c) => c.mesh),
        false,
      );
      if (hits.length) {
        hovered = this.cards.find((c) => c.mesh === hits[0].object) ?? null;
        uv = hits[0].uv ?? null;
      }
    }
    this.hovered = hovered;
    const auto = this.autoHolo && performance.now() - this.pointerSeen > 600;
    for (const c of this.cards) {
      const u = c.front.uniforms;
      let px = 0,
        py = 0,
        glare = 0,
        tx = 0,
        ty = 0;
      if (c === hovered && uv) {
        px = uv.x * 2 - 1;
        py = uv.y * 2 - 1;
        glare = 1;
        tx = -py * 0.16;
        ty = px * 0.2;
      } else if (
        this.gyroOn &&
        !this.reduced &&
        c.root.visible &&
        (this.state === "end" || (this.autoHolo && c.index === HIT))
      ) {
        // Phones: the foil follows the device tilt.
        px = this.gyro.x;
        py = this.gyro.y;
        glare = c.index === HIT ? 0.7 : 0.35;
        tx = -py * 0.08;
        ty = px * 0.1;
      } else if (auto && c.index === HIT) {
        px = Math.sin(this.time * 2.1) * 0.9;
        py = Math.cos(this.time * 1.4) * 0.6;
        glare = 0.6;
        tx = -py * 0.1;
        ty = px * 0.14;
      }
      u.uPointer.value.lerp(new THREE.Vector2(px, py), k);
      u.uGlare.value = lerp(u.uGlare.value, glare, k);
      if (this.state === "end" || this.autoHolo || this.picking) {
        c.tilt.rotation.x = lerp(c.tilt.rotation.x, tx, k);
        c.tilt.rotation.y = lerp(c.tilt.rotation.y, ty, k);
        // Hovered cards lift a little toward the viewer (in tap mode: the face-down ones).
        const pickable = this.picking && !this.picked.has(c.index);
        const lift =
          c === hovered && (this.state === "end" || pickable) ? 1 : 0;
        if (this.picking && !this.pickingHit && !this.picked.has(c.index))
          c.setGlow(
            lerp(
              (c.glow.material as THREE.MeshBasicMaterial).opacity,
              lift * 0.32,
              k,
            ),
            C.lilac,
          );
        c.tilt.position.z = lerp(c.tilt.position.z, lift * 0.14, k);
        c.tilt.scale.setScalar(lerp(c.tilt.scale.x, 1 + lift * 0.035, k));
      }
    }
    this.root.style.cursor =
      this.hovered &&
      (this.state === "end" ||
        (this.picking && !this.picked.has(this.hovered.index)))
        ? "pointer"
        : "";
  }

  private gyro = new THREE.Vector2();
  private gyroOn = false;
  private gyroAsked = false;
  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    this.gyroOn = true;
    const c = (v: number) => Math.max(-1, Math.min(1, v));
    this.gyro.set(c((e.gamma ?? 0) / 22), c(((e.beta ?? 45) - 45) / 22));
  };
  /** iOS asks for motion permission inside a user gesture: the first tap on the stage. */
  private askGyro() {
    if (this.gyroAsked || !window.matchMedia("(pointer: coarse)").matches)
      return;
    this.gyroAsked = true;
    const D = (
      window as unknown as {
        DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
      }
    ).DeviceOrientationEvent;
    const listen = () =>
      window.addEventListener("deviceorientation", this.onOrientation);
    if (D?.requestPermission)
      D.requestPermission()
        .then((r) => r === "granted" && listen())
        .catch(() => {});
    else listen();
  }

  private onPointerMove = (e: PointerEvent) => {
    const r = this.root.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.pointerSeen = performance.now();
  };

  /** Tapping a card selects it (portrait shows the selected card's actions). */
  private onClick = (e: MouseEvent) => {
    if (this.state !== "end" || performance.now() - this.swipedAt < 350) return;
    if ((e.target as HTMLElement).closest("button, a, .rip-card-actions"))
      return;
    this.onPointerMove(e as PointerEvent);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(
      this.cards.filter((c) => c.root.visible).map((c) => c.mesh),
      false,
    )[0];
    const card = hit && this.cards.find((c) => c.mesh === hit.object);
    if (card && !this.soldBack.has(card.index)) this.select(card.index);
  };

  /** Phones (small canvases) render up to 3×, larger canvases 2×, unless the app sets maxPixelRatio. */
  private maxPixelRatio(w: number, h: number) {
    if (this.opts.maxPixelRatio) return this.opts.maxPixelRatio;
    return w * h <= 600_000 ? 3 : 2;
  }

  /**
   * Pixel ratio = min(devicePixelRatio, maxPixelRatio). Only if frames keep dropping (two seconds
   * averaging under ~52 fps) is it lowered, by 0.25 steps, never below 1.
   */
  private fr = { acc: 0, n: 0, slow: 0, since: performance.now() };
  private watchFrameRate(dt: number) {
    const f = this.fr;
    if (performance.now() - f.since < 3000 || document.hidden) return;
    f.acc += dt;
    f.n++;
    if (f.n < 60) return;
    const avg = f.acc / f.n;
    f.acc = 0;
    f.n = 0;
    f.slow = avg > 0.0192 ? f.slow + 1 : 0;
    const pr = this.renderer.getPixelRatio();
    if (f.slow >= 2 && pr > 1) {
      f.slow = 0;
      this.renderer.setPixelRatio(Math.max(1, pr - 0.25));
      this.resize(true);
      this.root.dataset.pixelRatio = String(this.renderer.getPixelRatio());
    }
  }

  private onPointerLeave = () => {
    this.pointer.set(0, 0);
    this.pointerSeen = -1e9;
  };

  private onMotionChange = () => {
    if (this.reducedOverride === undefined) {
      this.reduced = this.motionQuery.matches;
      this.root.classList.toggle("is-reduced", this.reduced);
    }
  };

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (!this.raf && !this.destroyed) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private resize(keepPixelRatio = false) {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)),
      h = Math.max(1, Math.floor(r.height));
    if (!keepPixelRatio)
      this.renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, this.maxPixelRatio(w, h)),
      );
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.aspect = w / h;
    this.root.classList.toggle("is-portrait", this.portrait);
    this.root.classList.toggle("is-short", this.portrait && h < 700);
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.hazeMat.uniforms.uRes.value.copy(size);
    this.crt.setSize(size.x, size.y, w, h);
    this.compositor.setSize(size.x, size.y, this.renderer.getPixelRatio());
    this.finish.setSize(size.x, size.y);
    this.paintBackdrop();
    if (this.prepared) this.updateBands(this.prepared);
    if (this.state === "idle") {
      const s = this.fit(SHOTS.idle);
      this.cam.pos.copy(s.pos);
      this.cam.look.copy(s.look);
    }
    this.placePoster();
    if (this.state === "end") {
      this.focus = this.focusTarget;
      this.layoutLive = this.portrait;
      this.cards.forEach((c, i) => {
        if (this.soldBack.has(i) || !c.root.visible) return;
        const p = this.endPose(i);
        this.applyPose(c, p);
        c.opacity = p.opacity ?? 1;
        c.dim = p.dim ?? 1;
      });
      const s = this.fit(SHOTS.end);
      this.cam.pos.copy(s.pos);
      this.cam.look.copy(s.look);
      this.positionActions();
    }
  }
}

export { ART_W };
