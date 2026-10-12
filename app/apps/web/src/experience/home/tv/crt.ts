/**
 * 1% TV: the landing's WebGL CRT (crt-tv.js, crt-studio.js), ported to the app.
 * Same model, materials, studio, broadcast shader, pose, spring tilt and film
 * path (the TV turns to face the viewer and plays the film on its glass), so
 * the poster and the live TV are the same picture. Changes: a power-on replay
 * (DA §9.3), the studio is built from its source scene at runtime instead of a
 * 670 KB bake, and meshopt decodes in a Worker without WebAssembly (CSP).
 */
import * as THREE from "three";
import { cspGltfLoader } from "../../shared/gltf";
import type { FilmBounds, FilmTelevision } from "./mount";

const clamp = (x: number, a = -1, b = 1) => Math.min(b, Math.max(a, x));
const yieldToBrowser = () =>
  (
    globalThis as { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler?.yield?.() ??
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// Exact underdamped spring, frame-rate independent (unchanged from the landing).
function springAxis(
  position: number,
  velocity: number,
  target: number,
  dt: number,
  coasting = false,
) {
  const omega = coasting ? 5.5 : 12;
  const damping = coasting ? 3.6 : 8.4;
  const frequency = Math.sqrt(omega * omega - damping * damping);
  const offset = position - target;
  const decay = Math.exp(-damping * dt);
  const c = Math.cos(frequency * dt);
  const s = Math.sin(frequency * dt);
  const next =
    target +
    decay * (offset * c + ((velocity + damping * offset) / frequency) * s);
  const speed =
    decay *
    (velocity * c -
      ((damping * velocity + omega * omega * offset) / frequency) * s);
  return Math.abs(next - target) < 0.0002 && Math.abs(speed) < 0.002
    ? [target, 0]
    : [next, speed];
}

/** The offline studio scene the landing baked (crt-studio.js); convolved here at runtime. */
function studioScene() {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x35303b);
  const card = (
    color: number,
    intensity: number,
    w: number,
    h: number,
    p: [number, number, number],
  ) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    material.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(...p);
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
function studioLights() {
  const key = new THREE.DirectionalLight(0xfff5e9, 2.6);
  key.position.set(-3, 6, 5);
  const fill = new THREE.DirectionalLight(0xe7d2ff, 0.4);
  fill.position.set(4, 1, 3);
  const rim = new THREE.DirectionalLight(0xfff7ec, 1.4);
  rim.position.set(3, 4, -5);
  return [key, fill, rim];
}

interface Uniforms {
  time: { value: number };
  amount: { value: number };
  rows: { value: number };
  pixel: { value: number };
  power: { value: number };
  /** 0 = the idle broadcast, 1 = the film (cross-fade). */
  video: { value: number };
  filmSource: { value: THREE.Texture | null };
  frameScale: { value: THREE.Vector2 };
}
// Real PBR glass; only the broadcast is distorted (unchanged), plus uCRTPower.
function broadcastMaterial(
  source: THREE.MeshStandardMaterial,
  uniforms: Uniforms,
) {
  const material = new THREE.MeshPhysicalMaterial({
    name: "CRT_LiveBroadcast",
    map: source.map,
    color: 0x444444,
    emissiveMap: source.map,
    emissive: 0xffffff,
    emissiveIntensity: 0.85,
    roughness: 0.17,
    metalness: 0,
    clearcoat: 0.75,
    clearcoatRoughness: 0.1,
    ior: 1.48,
    specularIntensity: 0.48,
    envMapIntensity: 0.65,
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCRTTime = uniforms.time;
    shader.uniforms.uCRTAmount = uniforms.amount;
    shader.uniforms.uCRTRows = uniforms.rows;
    shader.uniforms.uCRTPixel = uniforms.pixel;
    shader.uniforms.uCRTPower = uniforms.power;
    shader.uniforms.uCRTVideo = uniforms.video;
    shader.uniforms.uCRTFilmSource = uniforms.filmSource;
    shader.uniforms.uCRTFrameScale = uniforms.frameScale;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `
      #include <common>
      uniform float uCRTTime;
      uniform float uCRTAmount;
      uniform float uCRTRows;
      uniform float uCRTPixel;
      uniform float uCRTPower;
      uniform float uCRTVideo;
      uniform sampler2D uCRTFilmSource;
      uniform vec2 uCRTFrameScale;
      float crtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      vec4 crtRead(sampler2D source, vec2 uv) {
        vec4 idle = texture2D(source, uv);
        if (uCRTVideo <= 0.) return idle;
        vec2 frameUV = (uv - .5) / uCRTFrameScale + .5;
        float inside = step(0., frameUV.x) * step(frameUV.x, 1.) * step(0., frameUV.y) * step(frameUV.y, 1.);
        // VideoTexture uses RGBA8: decode sRGB explicitly (the idle map is decoded by the GPU).
        vec4 picture = sRGBTransferEOTF(texture2D(uCRTFilmSource, clamp(frameUV, 0., 1.)));
        vec4 film = mix(vec4(0., 0., 0., 1.), picture, inside);
        return mix(idle, film, uCRTVideo);
      }
      vec4 crtBroadcast(sampler2D source, vec2 uv) {
        vec2 p = uv - .5;
        vec2 warped = uv + p * dot(p,p) * .038 * uCRTAmount;
        // Power-on (replay): a bright dot opens to a line, then to the picture.
        float inBand = 1.;
        if (uCRTPower < 1.) {
          float open = mix(.004, 1., smoothstep(.16, .82, uCRTPower));
          float wide = smoothstep(0., .16, uCRTPower);
          inBand = step(abs(warped.y - .5), open * .5) * step(abs(warped.x - .5), wide * .5);
          warped.y = (warped.y - .5) / open + .5;
        }
        float roll = fract(warped.y - uCRTTime * .21);
        float band = exp(-pow((roll - .5) * 18., 2.));
        float shadowBand = exp(-pow((roll - .59) * 23., 2.));
        warped.x += sin(warped.y * 37. + uCRTTime * 3.) * uCRTPixel * 1.5 * band * uCRTAmount;
        vec2 shift = vec2(uCRTPixel * .9 * uCRTAmount, 0.);
        vec4 c = crtRead(source, warped);
        c.r = crtRead(source, warped + shift).r;
        c.b = crtRead(source, warped - shift).b;
        float lineAA = 1. - smoothstep(.40, .85, fwidth(warped.y) * uCRTRows);
        float scan = .5 + .5 * sin(warped.y * uCRTRows * 6.283185);
        float grain = crtHash(floor(warped * vec2(620.,465.)) + floor(uCRTTime * 22.)) - .5;
        float glowWeight = 1.;
        if (uCRTVideo > 0.) {
          vec2 frameUV = (warped - .5) / uCRTFrameScale + .5;
          float inFrame = step(0., frameUV.x) * step(frameUV.x, 1.) * step(0., frameUV.y) * step(frameUV.y, 1.);
          glowWeight = mix(1., mix(.12, 1., inFrame), uCRTVideo);
        }
        c.rgb *= 1. - uCRTAmount * (.18 * scan * lineAA + .11 * shadowBand);
        // Dark film scenes take quieter noise than the cream idle artwork.
        float broadcastGlow = mix(.045 * grain + .075 * band, .009 * grain + .045 * band, uCRTVideo);
        c.rgb += uCRTAmount * broadcastGlow * glowWeight;
        float flash = 1. - smoothstep(.1, .62, uCRTPower);
        c.rgb = mix(c.rgb, vec3(1.), flash) * inBand;
        return c;
      }
    `,
      )
      .replace(
        "#include <map_fragment>",
        `
      #ifdef USE_MAP
        diffuseColor *= crtBroadcast(map, vMapUv);
      #endif
    `,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `
      #ifdef USE_EMISSIVEMAP
        totalEmissiveRadiance *= crtBroadcast(emissiveMap, vEmissiveMapUv).rgb;
      #endif
    `,
      );
  };
  material.customProgramCacheKey = () => "onepercent-crt-broadcast-app-v2-film";
  return material;
}

interface FilmSnapshot {
  map: THREE.Texture | null;
  emissiveMap: THREE.Texture | null;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  cameraPosition: THREE.Vector3;
  cameraQuaternion: THREE.Quaternion;
  cameraZoom: number;
  aspect: number;
  current: THREE.Vector2;
  velocity: THREE.Vector2;
  hoverWeight: number;
  time: number;
}
interface Film {
  phase: "entering" | "playing" | "exiting";
  progress: number;
  fromProgress: number;
  elapsed: number;
  duration: number;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  snapshot: FilmSnapshot;
  frontQuaternion: THREE.Quaternion;
  hasVideoFrame: boolean;
  revealPhase: "hidden" | "waiting" | "fading" | "shown" | "hiding";
  revealRequested: boolean;
  revealDuration: number;
  blend: { from: number; to: number; elapsed: number; duration: number } | null;
  transitionPromise: Promise<boolean>;
  resolveTransition: ((done: boolean) => void) | null;
  revealPromise: Promise<boolean> | null;
  resolveReveal: ((shown: boolean) => void) | null;
  onMetadata(): void;
  onVideoFrame(): void;
  onVideoError(): void;
}
interface FilmGeometry {
  corners: THREE.Vector3[];
  frontBox: THREE.Box3;
  center: THREE.Vector3;
  size: THREE.Vector3;
}

export class CRTTelevision implements FilmTelevision {
  readonly ready: Promise<void>;
  destroyed = false;
  renderReady = false;
  contextLost = false;
  private paused = false;
  private frame = 0;
  private lastFrame: number | null = null;
  private time = 0;
  private visible = true;
  private pointer = new THREE.Vector2(20, 20);
  private target = new THREE.Vector2();
  private current = new THREE.Vector2();
  private velocity = new THREE.Vector2();
  private hoverWeight = 0;
  private pointerInside = false;
  private scrollPaused = false;
  private lastPointer: { x: number; y: number } | null = null;
  private activationStart: {
    x: number;
    y: number;
    id: number;
    moved: boolean;
  } | null = null;
  private powerAnimation: { elapsed: number; duration: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private uniforms: Uniforms = {
    time: { value: 0 },
    amount: { value: 1 },
    rows: { value: 100 },
    pixel: { value: 0.003 },
    power: { value: 1 },
    video: { value: 0 },
    filmSource: { value: null },
    frameScale: { value: new THREE.Vector2(1, 1) },
  };
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(33, 1, 0.1, 50);
  private pivot = new THREE.Group();
  private baseRotation = new THREE.Euler(-0.065, -0.67, 0.19);
  private renderer: THREE.WebGLRenderer;
  private model: THREE.Object3D | null = null;
  private screenMesh: THREE.Mesh | null = null;
  private environment: THREE.Texture | null = null;
  private lights = studioLights();
  private neutralZoom = 0;
  private interactionBounds: { width: number; height: number } | null = null;
  private interactionCenter: { x: number; y: number } | null = null;
  private pendingViewport: {
    width: number;
    height: number;
    pixelRatio: number;
  } | null = null;
  private viewport = { width: 0, height: 0, pixelRatio: 0 };
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private listeners: [EventTarget, string, EventListener][] = [];
  private film: Film | null = null;
  private filmGeometry: FilmGeometry | null = null;

  constructor(
    private container: HTMLElement,
    private options: {
      modelUrl: string;
      reducedMotion: boolean;
      /** Drawing-buffer cap (CSS px² × DPR²); the poster renderer raises it. */
      maxPixels?: number;
    },
  ) {
    this.camera.position.set(0, 0, 11);
    this.scene.add(this.pivot);
    this.pivot.rotation.copy(this.baseRotation);
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.className = "crt-canvas";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    this.scene.environmentIntensity = 0.6;
    this.scene.add(...this.lights);

    const on = (
      target: EventTarget,
      type: string,
      handler: EventListener,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler, opts);
      this.listeners.push([target, type, handler]);
    };
    on(
      container,
      "pointermove",
      (event) => this.onPointerMove(event as PointerEvent),
      { passive: true },
    );
    on(container, "pointerleave", () => this.onPointerLeave());
    on(
      container,
      "pointerdown",
      (event) => this.onPointerDown(event as PointerEvent),
      { passive: true },
    );
    on(
      container,
      "pointerup",
      (event) => this.onPointerUp(event as PointerEvent),
      { passive: true },
    );
    on(container, "pointercancel", () => {
      this.activationStart = null;
      this.onPointerLeave();
    });
    on(window, "scroll", () => this.onScroll(), { passive: true });
    on(window, "wheel", () => this.onScroll(), { passive: true });
    on(document, "visibilitychange", () =>
      document.hidden ? this.stop() : this.invalidate(),
    );
    on(canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.renderReady = false;
      const film = this.film;
      if (film) {
        film.resolveTransition?.(false);
        film.resolveTransition = null;
        film.resolveReveal?.(false);
        film.resolveReveal = null;
        film.revealRequested = false;
        film.blend = null;
      }
      this.stop();
      container.dispatchEvent(new CustomEvent("crt:error", { bubbles: true }));
    });
    on(canvas, "webglcontextrestored", () => {
      this.contextLost = false;
      void this.prepare().catch(() => this.destroy());
    });
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = Boolean(entry?.isIntersecting);
      if (this.visible) this.invalidate();
      else {
        this.onPointerLeave();
        this.stop();
      }
    });
    this.intersectionObserver.observe(container);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.ready = this.load();
  }

  private async load() {
    const gltf = await cspGltfLoader().loadAsync(this.options.modelUrl);
    if (this.destroyed) return;
    const model = gltf.scene;
    const screen = model.getObjectByName("CRT_Screen");
    if (!(screen instanceof THREE.Mesh)) throw new Error("CRT_Screen missing");
    const anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of [
        node.material,
      ].flat() as THREE.MeshPhysicalMaterial[]) {
        if (material.name === "CRT_Case" || material.name === "CRT_RearCase") {
          material.roughness = 0.26;
          material.clearcoat = 0.38;
          material.clearcoatRoughness = 0.18;
        }
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) {
            value.anisotropy = anisotropy;
            value.needsUpdate = true;
          }
      }
    });
    const old = screen.material as THREE.MeshStandardMaterial;
    // The film sampler always has a texture: the idle broadcast until a frame arrives.
    this.uniforms.filmSource.value = old.map;
    screen.material = broadcastMaterial(old, this.uniforms);
    old.dispose();
    const bounds = new THREE.Box3().setFromObject(model);
    model.position.sub(bounds.getCenter(new THREE.Vector3()));
    this.pivot.add(model);
    this.model = model;
    this.screenMesh = screen;
    // The landing's bake: PMREM.fromScene(studio, .04, .1, 30, { size: 256 }).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = studioScene();
    this.environment = pmrem.fromScene(studio, 0.04, 0.1, 30, {
      size: 256,
    }).texture;
    studio.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.resize();
    await this.prepare();
  }

  private async prepare() {
    if (!this.model || this.destroyed || this.contextLost) return;
    this.renderReady = false;
    await yieldToBrowser();
    const textures = new Set<THREE.Texture>();
    if (this.film?.hasVideoFrame) textures.add(this.film.texture);
    this.model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of [node.material].flat())
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
    });
    for (const texture of textures) {
      this.renderer.initTexture(texture);
      await yieldToBrowser();
      if (this.destroyed || this.contextLost) return;
    }
    await this.renderer.compileAsync(this.scene, this.camera);
    await yieldToBrowser();
    if (this.destroyed || this.contextLost) return;
    this.renderReady = true;
    this.draw(0);
    this.invalidate();
  }

  resize() {
    if (this.destroyed) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    const pixelRatio = Math.min(
      devicePixelRatio || 1,
      2,
      Math.sqrt((this.options.maxPixels ?? 2_000_000) / (width * height)),
    );
    // Applied in the next draw: resizing the buffer here would blank the
    // just-drawn TV during the film's CSS zoom.
    if (
      this.viewport.width !== width ||
      this.viewport.height !== height ||
      this.viewport.pixelRatio !== pixelRatio
    )
      this.pendingViewport = { width, height, pixelRatio };
    this.camera.aspect = width / height;
    if (this.film) {
      this.applyFilmView();
      this.invalidate();
      return;
    }
    if (this.model && this.screenMesh) {
      const savedRotation = this.pivot.rotation.clone();
      const savedPosition = this.pivot.position.clone();
      this.pivot.rotation.copy(this.baseRotation);
      this.pivot.position.set(0, 0, 0);
      if (!this.neutralZoom) {
        // Fit the neutral pose on its vertices: one framing at every size (the poster's).
        this.camera.aspect = 1;
        this.camera.zoom = 1;
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld(true);
        this.pivot.updateMatrixWorld(true);
        const vertex = new THREE.Vector3();
        let extent = 0;
        this.model.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          const position = node.geometry.attributes
            .position as THREE.BufferAttribute;
          for (let i = 0; i < position.count; i++) {
            vertex
              .fromBufferAttribute(position, i)
              .applyMatrix4(node.matrixWorld)
              .project(this.camera);
            extent = Math.max(extent, Math.abs(vertex.x), Math.abs(vertex.y));
          }
        });
        this.neutralZoom = 0.84 / extent;
      }
      this.camera.aspect = width / height;
      this.camera.zoom = this.neutralZoom * Math.min(1, this.camera.aspect);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld(true);
      this.interactionBounds = this.projectBounds(this.pivot);
      const box =
        this.screenMesh.geometry.boundingBox ??
        (this.screenMesh.geometry.computeBoundingBox(),
        this.screenMesh.geometry.boundingBox!);
      const center = box.getCenter(new THREE.Vector3());
      center.z = box.max.z;
      this.screenMesh.localToWorld(center).project(this.camera);
      this.interactionCenter = {
        x: ((center.x + 1) * width) / 2,
        y: ((1 - center.y) * height) / 2,
      };
      const screenBounds = this.projectBounds(this.screenMesh);
      this.uniforms.rows.value = clamp(screenBounds.height / 2.8, 55, 210);
      this.uniforms.pixel.value = 1 / Math.max(160, screenBounds.width);
      this.pivot.rotation.copy(savedRotation);
      this.pivot.position.copy(savedPosition);
    }
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private projectBounds(object: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(object);
    const { width, height } = this.container.getBoundingClientRect();
    const xs: number[] = [];
    const ys: number[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, y, z).project(this.camera);
          xs.push(((p.x + 1) * width) / 2);
          ys.push(((1 - p.y) * height) / 2);
        }
    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  private updatePointer(event: PointerEvent) {
    const r = this.container.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      1 - ((event.clientY - r.top) / r.height) * 2,
    );
    const b = this.interactionBounds;
    const c = this.interactionCenter;
    this.target.set(
      clamp(
        b && c
          ? ((event.clientX - r.left - c.x) / b.width) * 2.5
          : this.pointer.x,
      ),
      clamp(
        b && c
          ? ((c.y - (event.clientY - r.top)) / b.height) * 2.5
          : this.pointer.y,
      ),
    );
  }
  private onPointerMove(event: PointerEvent) {
    const press = this.activationStart;
    if (
      press?.id === event.pointerId &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12
    )
      press.moved = true;
    if (this.paused || this.film) return;
    if (event.pointerType === "touch" || this.options.reducedMotion) return;
    const moved =
      !this.lastPointer ||
      Math.hypot(
        event.clientX - this.lastPointer.x,
        event.clientY - this.lastPointer.y,
      ) > 0.5;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    if (this.scrollPaused && !moved) return;
    this.scrollPaused = false;
    this.updatePointer(event);
    this.pointerInside = true;
    this.invalidate();
  }
  /** A tap or click on the TV itself (not a drag or a scroll) asks for the film. */
  private onPointerDown(event: PointerEvent) {
    this.activationStart = null;
    if (
      this.paused ||
      this.film ||
      event.button !== 0 ||
      event.isPrimary === false
    )
      return;
    this.updatePointer(event);
    if (this.hitModel())
      this.activationStart = {
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
        moved: false,
      };
  }
  private onPointerUp(event: PointerEvent) {
    const press = this.activationStart;
    this.activationStart = null;
    if (
      this.paused ||
      this.film ||
      !press ||
      press.id !== event.pointerId ||
      press.moved
    )
      return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12)
      return;
    this.updatePointer(event);
    if (this.hitModel())
      this.container.dispatchEvent(
        new CustomEvent("crt:activate", { bubbles: true }),
      );
    if (event.pointerType === "touch") this.target.set(0, 0);
  }
  private onScroll() {
    if (this.film) return;
    this.activationStart = null;
    this.scrollPaused = true;
    this.onPointerLeave();
  }
  private onPointerLeave() {
    this.activationStart = null;
    this.container.style.cursor = "";
    this.pointerInside = false;
    this.target.set(0, 0);
    this.invalidate();
  }
  private hitModel() {
    if (
      !this.model ||
      !this.renderReady ||
      this.contextLost ||
      this.destroyed ||
      this.film
    )
      return null;
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObject(this.model, true)[0] ?? null;
  }

  /** The television effect: the picture powers on again from a white line. */
  replay() {
    if (this.destroyed || this.film) return;
    this.time = 0;
    if (!this.options.reducedMotion) {
      this.powerAnimation = { elapsed: 0, duration: 1100 };
      this.uniforms.power.value = 0;
    }
    this.invalidate();
  }

  setPaused(value: boolean) {
    this.paused = value;
    if (value) {
      this.onPointerLeave();
      this.stop();
    } else this.invalidate();
  }

  private cacheFilmGeometry(screen: THREE.Mesh) {
    if (this.filmGeometry) return this.filmGeometry;
    screen.geometry.computeBoundingBox();
    const bounds = screen.geometry.boundingBox!;
    const corners: THREE.Vector3[] = [];
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          corners.push(new THREE.Vector3(x, y, z));
    this.pivot.updateMatrixWorld(true);
    const toPivot = this.pivot.matrixWorld
      .clone()
      .invert()
      .multiply(screen.matrixWorld);
    const frontBox = new THREE.Box3().setFromPoints(
      corners.map((point) => point.clone().applyMatrix4(toPivot)),
    );
    this.filmGeometry = {
      corners,
      frontBox,
      center: frontBox.getCenter(new THREE.Vector3()),
      size: frontBox.getSize(new THREE.Vector3()),
    };
    return this.filmGeometry;
  }

  /** Viewport coordinates of the curved screen, including during the zoom. */
  getFilmScreenBounds(): FilmBounds | null {
    const screen = this.screenMesh;
    if (!screen || this.destroyed) return null;
    const { corners } = this.cacheFilmGeometry(screen);
    const rect = this.container.getBoundingClientRect();
    this.pivot.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      const point = corner
        .clone()
        .applyMatrix4(screen.matrixWorld)
        .project(this.camera);
      const x = rect.left + ((point.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - point.y) * rect.height) / 2;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  }

  /** The parent owns playback and the stage's CSS/DOM move; the TV turns to face the viewer. */
  enterFilm(video: HTMLVideoElement, { duration = 900 } = {}) {
    const screen = this.screenMesh;
    if (
      this.destroyed ||
      this.contextLost ||
      this.paused ||
      !this.renderReady ||
      !screen
    )
      return Promise.reject(new Error("The TV is not ready for the film."));
    if (this.film) return this.film.transitionPromise;
    const material = screen.material as THREE.MeshPhysicalMaterial;
    const texture = new THREE.VideoTexture(video);
    texture.name = "CRT_ConceptFilm";
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    if (video.readyState >= video.HAVE_CURRENT_DATA) texture.needsUpdate = true;
    const snapshot: FilmSnapshot = {
      map: material.map,
      emissiveMap: material.emissiveMap,
      position: this.pivot.position.clone(),
      quaternion: this.pivot.quaternion.clone(),
      cameraPosition: this.camera.position.clone(),
      cameraQuaternion: this.camera.quaternion.clone(),
      cameraZoom: this.camera.zoom,
      aspect: this.camera.aspect,
      current: this.current.clone(),
      velocity: this.velocity.clone(),
      hoverWeight: this.hoverWeight,
      time: this.time,
    };
    this.cacheFilmGeometry(screen);
    let resolveTransition: (done: boolean) => void = () => undefined;
    const transitionPromise = new Promise<boolean>((resolve) => {
      resolveTransition = resolve;
    });
    const film: Film = {
      phase: "entering",
      progress: 0,
      fromProgress: 0,
      elapsed: 0,
      duration: this.options.reducedMotion ? 0 : Math.max(0, duration),
      video,
      texture,
      snapshot,
      frontQuaternion: new THREE.Quaternion(),
      hasVideoFrame: false,
      revealPhase: "hidden",
      revealRequested: false,
      revealDuration: 0,
      blend: null,
      transitionPromise,
      resolveTransition,
      revealPromise: null,
      resolveReveal: null,
      onMetadata: () => {
        if (this.film !== film) return;
        this.updateFilmContain();
        this.invalidate();
      },
      onVideoFrame: () => {
        if (
          this.film !== film ||
          film.hasVideoFrame ||
          film.phase === "exiting" ||
          video.readyState < video.HAVE_CURRENT_DATA
        )
          return;
        film.hasVideoFrame = true;
        texture.needsUpdate = true;
        this.uniforms.filmSource.value = texture;
        this.updateFilmContain();
        this.startFilmReveal();
        this.invalidate();
      },
      onVideoError: () => {
        if (this.film !== film) return;
        film.revealRequested = false;
        film.resolveReveal?.(false);
        film.resolveReveal = null;
      },
    };
    this.film = film;
    video.addEventListener("loadedmetadata", film.onMetadata);
    video.addEventListener("resize", film.onMetadata);
    video.addEventListener("loadeddata", film.onVideoFrame);
    video.addEventListener("canplay", film.onVideoFrame);
    video.addEventListener("error", film.onVideoError);
    this.activationStart = null;
    this.pointerInside = false;
    this.container.style.cursor = "";
    this.updateFilmContain();
    film.onVideoFrame();
    this.visible = this.inViewport();
    this.resize();
    this.invalidate();
    return transitionPromise;
  }

  /** The screen dissolves to the film only after the parent's zoom has finished. */
  revealFilm({ duration = 400 } = {}) {
    const film = this.film;
    if (
      !film ||
      film.phase === "exiting" ||
      this.destroyed ||
      this.contextLost ||
      film.video.error
    )
      return Promise.resolve(false);
    if (film.revealPhase === "shown") return Promise.resolve(true);
    if (film.revealRequested && film.revealPromise) return film.revealPromise;
    film.revealRequested = true;
    film.revealDuration = this.options.reducedMotion
      ? 0
      : Math.max(0, duration);
    film.revealPhase = "waiting";
    film.revealPromise = new Promise<boolean>((resolve) => {
      film.resolveReveal = resolve;
    });
    film.onVideoFrame();
    this.startFilmReveal();
    this.invalidate();
    return film.revealPromise;
  }

  private startFilmReveal() {
    const film = this.film;
    if (
      !film ||
      film.phase !== "playing" ||
      !film.revealRequested ||
      !film.hasVideoFrame ||
      film.revealPhase !== "waiting"
    )
      return;
    film.revealPhase = "fading";
    film.blend = {
      from: this.uniforms.video.value,
      to: 1,
      elapsed: 0,
      duration: film.revealDuration,
    };
  }

  private advanceFilmBlend(dt: number) {
    const film = this.film;
    const blend = film?.blend;
    if (!film || !blend) return;
    blend.elapsed += dt * 1000;
    const progress =
      this.options.reducedMotion || !blend.duration
        ? 1
        : Math.min(1, blend.elapsed / blend.duration);
    const eased = progress * progress * (3 - 2 * progress);
    this.uniforms.video.value = THREE.MathUtils.lerp(
      blend.from,
      blend.to,
      eased,
    );
    if (progress === 1) {
      film.blend = null;
      film.revealPhase = blend.to ? "shown" : "hidden";
      if (blend.to) {
        film.resolveReveal?.(true);
        film.resolveReveal = null;
      }
    }
  }

  private updateFilmContain() {
    const film = this.film;
    if (!film || !this.filmGeometry) return;
    const { size } = this.filmGeometry;
    const { video } = film;
    const sourceAspect =
      video.videoWidth && video.videoHeight
        ? video.videoWidth / video.videoHeight
        : 16 / 9;
    const screenAspect = size.x / size.y;
    // Contain the whole frame, with optical overscan room for the CRT warp.
    this.uniforms.frameScale.value.set(
      Math.min(1, sourceAspect / screenAspect) * 0.94,
      Math.min(1, screenAspect / sourceAspect) * 0.94,
    );
  }

  private applyFilmView() {
    const film = this.film;
    const geometry = this.filmGeometry;
    if (!film || !geometry) return;
    const { snapshot, progress, frontQuaternion } = film;
    const { frontBox, center, size } = geometry;
    const mix = progress * progress * (3 - 2 * progress);
    const heroZoom =
      (snapshot.cameraZoom * Math.min(1, this.camera.aspect)) /
      Math.min(1, snapshot.aspect);
    const depth = snapshot.cameraPosition.z - frontBox.max.z;
    const halfHeight =
      depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const filmZoom =
      0.91 *
      Math.min(
        (halfHeight * this.camera.aspect) / (size.x / 2),
        halfHeight / (size.y / 2),
      );
    this.pivot.quaternion.copy(snapshot.quaternion).slerp(frontQuaternion, mix);
    this.pivot.position.copy(snapshot.position).multiplyScalar(1 - mix);
    this.camera.position.copy(snapshot.cameraPosition);
    this.camera.position.x = THREE.MathUtils.lerp(
      snapshot.cameraPosition.x,
      center.x,
      mix,
    );
    this.camera.position.y = THREE.MathUtils.lerp(
      snapshot.cameraPosition.y,
      center.y,
      mix,
    );
    this.camera.quaternion
      .copy(snapshot.cameraQuaternion)
      .slerp(frontQuaternion, mix);
    this.camera.zoom = THREE.MathUtils.lerp(heroZoom, filmZoom, mix);
    this.camera.updateProjectionMatrix();
    const screenBounds = this.getFilmScreenBounds();
    if (screenBounds) {
      this.uniforms.rows.value = clamp(screenBounds.height / 2.8, 55, 210);
      this.uniforms.pixel.value = 1 / Math.max(160, screenBounds.width);
    }
  }

  exitFilm({ duration = 650 } = {}) {
    const film = this.film;
    if (!film) return Promise.resolve(true);
    const immediate =
      !duration ||
      this.options.reducedMotion ||
      this.destroyed ||
      this.contextLost ||
      this.paused ||
      document.hidden ||
      !this.inViewport();
    if (film.phase === "exiting") {
      if (immediate) {
        this.finishFilm();
        this.invalidate();
      }
      return film.transitionPromise;
    }
    film.resolveTransition?.(false);
    film.resolveReveal?.(false);
    film.resolveReveal = null;
    film.revealRequested = false;
    film.phase = "exiting";
    film.fromProgress = film.progress;
    film.elapsed = 0;
    film.duration = this.options.reducedMotion ? 0 : Math.max(0, duration);
    film.revealPhase = "hiding";
    film.blend = {
      from: this.uniforms.video.value,
      to: 0,
      elapsed: 0,
      duration: Math.min(400, film.duration),
    };
    film.transitionPromise = new Promise<boolean>((resolve) => {
      film.resolveTransition = resolve;
    });
    const promise = film.transitionPromise;
    if (immediate || !film.duration) this.finishFilm();
    this.invalidate();
    return promise;
  }

  private finishFilm(completed = true) {
    const film = this.film;
    if (!film) return;
    const { snapshot, video, texture } = film;
    const material = this.screenMesh?.material as
      THREE.MeshPhysicalMaterial | undefined;
    if (material) {
      material.map = snapshot.map;
      material.emissiveMap = snapshot.emissiveMap;
    }
    this.uniforms.video.value = 0;
    this.uniforms.filmSource.value = snapshot.map;
    this.uniforms.frameScale.value.set(1, 1);
    this.pivot.position.copy(snapshot.position);
    this.pivot.quaternion.copy(snapshot.quaternion);
    this.camera.position.copy(snapshot.cameraPosition);
    this.camera.quaternion.copy(snapshot.cameraQuaternion);
    this.current.copy(snapshot.current);
    this.velocity.copy(snapshot.velocity);
    this.hoverWeight = snapshot.hoverWeight;
    this.time = snapshot.time;
    this.target.set(0, 0);
    this.pointerInside = false;
    video.removeEventListener("loadedmetadata", film.onMetadata);
    video.removeEventListener("resize", film.onMetadata);
    video.removeEventListener("loadeddata", film.onVideoFrame);
    video.removeEventListener("canplay", film.onVideoFrame);
    video.removeEventListener("error", film.onVideoError);
    texture.dispose();
    this.film = null;
    this.resize();
    film.resolveTransition?.(completed);
    film.resolveReveal?.(false);
  }

  private inViewport() {
    const r = this.container.getBoundingClientRect();
    return (
      r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
    );
  }

  private draw(dt: number) {
    if (this.destroyed || this.contextLost || this.paused) return false;
    const reduced = this.options.reducedMotion;
    const film = this.film;
    if (film) {
      film.elapsed += dt * 1000;
      const elapsed =
        reduced || !film.duration
          ? 1
          : Math.min(1, film.elapsed / film.duration);
      if (film.phase === "entering") film.progress = elapsed;
      else if (film.phase === "exiting")
        film.progress = film.fromProgress * (1 - elapsed);
      if (film.phase === "exiting" && elapsed === 1) this.finishFilm();
      else {
        this.applyFilmView();
        if (film.phase === "entering" && elapsed === 1) {
          film.phase = "playing";
          film.resolveTransition?.(true);
          film.resolveTransition = null;
        }
        this.startFilmReveal();
        this.advanceFilmBlend(dt);
      }
      if (!reduced) this.time += dt;
    } else {
      const coasting = this.scrollPaused && !reduced;
      const mix = 1 - Math.exp(-(coasting ? 2.8 : 9) * dt);
      const tx = reduced ? 0 : this.target.x;
      const ty = reduced ? 0 : this.target.y;
      [this.current.x, this.velocity.x] = springAxis(
        this.current.x,
        this.velocity.x,
        tx,
        dt,
        coasting,
      ) as [number, number];
      [this.current.y, this.velocity.y] = springAxis(
        this.current.y,
        this.velocity.y,
        ty,
        dt,
        coasting,
      ) as [number, number];
      const hovering = !reduced && this.pointerInside;
      this.hoverWeight = THREE.MathUtils.lerp(
        this.hoverWeight,
        hovering ? 1 : 0,
        mix,
      );
      if (Math.abs(this.hoverWeight - (hovering ? 1 : 0)) < 0.001)
        this.hoverWeight = hovering ? 1 : 0;
      if (!reduced) this.time += dt;
      const drift = this.hoverWeight;
      this.pivot.rotation.set(
        this.baseRotation.x -
          this.current.y * 0.16 +
          Math.sin(this.time * 1.7) * 0.008 * drift,
        this.baseRotation.y +
          this.current.x * 0.18 +
          Math.sin(this.time * 1.25) * 0.01 * drift,
        this.baseRotation.z - this.current.x * 0.05,
      );
      this.pivot.position.set(
        this.current.x * 0.055,
        this.current.y * 0.045 +
          (0.07 + Math.sin(this.time * 1.9) * 0.024) * drift,
        0,
      );
    }
    if (this.powerAnimation) {
      this.powerAnimation.elapsed += dt * 1000;
      const t = Math.min(
        1,
        this.powerAnimation.elapsed / this.powerAnimation.duration,
      );
      this.uniforms.power.value = t;
      if (t === 1) this.powerAnimation = null;
    }
    // One hit test per drawn frame serves the cursor (the whole TV is clickable).
    const hit = this.pointerInside ? this.hitModel() : null;
    const cursor = hit ? "pointer" : "";
    if (this.container.style.cursor !== cursor)
      this.container.style.cursor = cursor;
    this.uniforms.time.value = this.time;
    if (this.pendingViewport) {
      const { width, height, pixelRatio } = this.pendingViewport;
      this.renderer.setDrawingBufferSize(width, height, pixelRatio);
      this.viewport = this.pendingViewport;
      this.pendingViewport = null;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.container.dataset.ready !== "true") {
      this.container.dataset.ready = "true";
      this.container.dispatchEvent(
        new CustomEvent("crt:ready", { bubbles: true }),
      );
    }
    return !!this.film || !reduced || this.powerAnimation !== null;
  }

  /** Slow frames (a weak GPU): stop the idle loop; pointer, replay and the film still draw. */
  private frames = 0;
  private slowFrames = 0;
  private idleLoop = true;
  private invalidate() {
    if (
      this.destroyed ||
      this.contextLost ||
      this.paused ||
      !this.renderReady ||
      document.hidden ||
      !this.visible ||
      this.frame
    )
      return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      const dt = Math.min(
        1,
        Math.max(0.001, (now - (this.lastFrame ?? now - 16.67)) / 1000),
      );
      this.lastFrame = now;
      const started = performance.now();
      const more = this.draw(dt);
      // After warm-up (shader compile, uploads), three slow frames in a row
      // (CPU or GPU bound) stop the idle loop.
      if (
        !this.film &&
        ++this.frames > 6 &&
        (performance.now() - started > 60 || dt > 0.12)
      ) {
        if (++this.slowFrames >= 3) this.idleLoop = false;
      } else this.slowFrames = 0;
      if (
        more &&
        (this.idleLoop ||
          this.pointerInside ||
          this.powerAnimation ||
          this.film)
      )
        this.invalidate();
      else this.lastFrame = null;
    });
  }
  private stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastFrame = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.finishFilm(false);
    this.stop();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    for (const [target, type, handler] of this.listeners)
      target.removeEventListener(type, handler);
    this.model?.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      for (const material of [node.material].flat()) {
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    this.environment?.dispose();
    this.lights.forEach((light) => light.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.container.style.cursor = "";
    delete this.container.dataset.ready;
  }
}
