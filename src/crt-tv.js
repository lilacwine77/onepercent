import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadCRTStudio, makeCRTStudioLights } from './crt-studio.js';
import { CRT_MODEL_URL } from './crt-resources.js';

const clamp = (x, a = -1, b = 1) => Math.min(b, Math.max(a, x));
const yieldToBrowser = () => globalThis.scheduler?.yield?.() ?? new Promise(resolve => setTimeout(resolve, 0));

// Exact underdamped spring solution: the same weight and settling time at
// 30/60/120 Hz, including a slow frame after shader compilation.
function springAxis(position, velocity, target, dt, coasting = false) {
  const omega = coasting ? 5.5 : 12, damping = coasting ? 3.6 : 8.4;
  const frequency = Math.sqrt(omega * omega - damping * damping);
  const offset = position - target;
  const decay = Math.exp(-damping * dt), c = Math.cos(frequency * dt), s = Math.sin(frequency * dt);
  const next = target + decay * (offset * c + (velocity + damping * offset) / frequency * s);
  const speed = decay * (velocity * c - (damping * velocity + omega * omega * offset) / frequency * s);
  return Math.abs(next - target) < .0002 && Math.abs(speed) < .002 ? [target, 0] : [next, speed];
}

// This patch keeps real PBR reflections on the curved glass. Only the broadcast
// is distorted; the bevel, bezel and highlight remain optically continuous.
function broadcastMaterial(source, uniforms) {
  const material = new THREE.MeshPhysicalMaterial({
    name: 'CRT_LiveBroadcast',
    map: source.map,
    color: 0x444444,
    emissiveMap: source.map,
    emissive: 0xffffff,
    emissiveIntensity: 0.85,
    roughness: 0.17,
    metalness: 0,
    clearcoat: 0.75,
    clearcoatRoughness: 0.10,
    ior: 1.48,
    specularIntensity: 0.48,
    envMapIntensity: 0.65,
    // The screen is already a display-referred image; keep its ink and lilac
    // intact, while the case still uses AgX and the glass still reflects PBR light.
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCRTTime = uniforms.time;
    shader.uniforms.uCRTAmount = uniforms.amount;
    shader.uniforms.uCRTRows = uniforms.rows;
    shader.uniforms.uCRTPixel = uniforms.pixel;
    shader.uniforms.uCRTVideo = uniforms.video;
    shader.uniforms.uCRTFilmSource = uniforms.filmSource;
    shader.uniforms.uCRTFrameScale = uniforms.frameScale;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform float uCRTTime;
      uniform float uCRTAmount;
      uniform float uCRTRows;
      uniform float uCRTPixel;
      uniform float uCRTVideo;
      uniform sampler2D uCRTFilmSource;
      uniform vec2 uCRTFrameScale;
      float crtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      vec4 crtRead(sampler2D source, vec2 uv) {
        vec4 idle = texture2D(source, uv);
        if (uCRTVideo <= 0.) return idle;
        vec2 frameUV = (uv - .5) / uCRTFrameScale + .5;
        float inside = step(0., frameUV.x) * step(frameUV.x, 1.) * step(0., frameUV.y) * step(frameUV.y, 1.);
        // VideoTexture uses RGBA8, so retain Three's explicit sRGB decoding
        // when replacing its map/emissive chunks with the CRT treatment.
        vec4 picture = sRGBTransferEOTF(texture2D(uCRTFilmSource, clamp(frameUV, 0., 1.)));
        vec4 film = mix(vec4(0., 0., 0., 1.), picture, inside);
        // Both sources are linear here: the idle sRGB texture is decoded by
        // the GPU, while VideoTexture needs the explicit conversion above.
        return mix(idle, film, uCRTVideo);
      }
      vec4 crtBroadcast(sampler2D source, vec2 uv) {
        vec2 p = uv - .5;
        vec2 warped = uv + p * dot(p,p) * .038 * uCRTAmount;
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
        // Dark film scenes need quieter noise than the cream idle artwork;
        // retain the same scanlines while keeping the explanatory copy clear.
        float broadcastGlow = mix(.045 * grain + .075 * band, .009 * grain + .045 * band, uCRTVideo);
        c.rgb += uCRTAmount * broadcastGlow * glowWeight;
        return c;
      }
    `).replace('#include <map_fragment>', `
      #ifdef USE_MAP
        diffuseColor *= crtBroadcast(map, vMapUv);
      #endif
    `).replace('#include <emissivemap_fragment>', `
      #ifdef USE_EMISSIVEMAP
        totalEmissiveRadiance *= crtBroadcast(emissiveMap, vEmissiveMapUv).rgb;
      #endif
    `);
  };
  material.customProgramCacheKey = () => 'onepercent-crt-broadcast-v4-crossfade';
  return material;
}

/** Reusable WebGL CRT. Mouse hover tilts the body; the screen has its own hit test. */
export class CRTTelevision {
  constructor({ container, modelUrl = CRT_MODEL_URL, reducedMotion, resources } = {}) {
    if (!container?.appendChild) throw new TypeError('CRTTelevision needs a container.');
    this.container = container;
    this.destroyed = false;
    this.paused = false;
    this.preparationGeneration = 0;
    this.preparationWaiters = new Set();
    this.reducedMotion = reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderCount = 0;
    this.frame = 0;
    this.screenIntensity = 1;
    this.pointer = new THREE.Vector2(20, 20);
    this.target = new THREE.Vector2();
    this.current = new THREE.Vector2();
    this.velocity = new THREE.Vector2();
    this.hoverWeight = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointerInside = false;
    this.screenHovered = false;
    this.time = 0;
    this.uniforms = { time: { value: 0 }, amount: { value: 1 }, rows: { value: 100 }, pixel: { value: .003 },
      video: { value: 0 }, filmSource: { value: null }, frameScale: { value: new THREE.Vector2(1, 1) } };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(33, 1, 0.1, 50);
    this.camera.position.set(0, 0, 11);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.baseRotation = new THREE.Euler(-0.065, -0.67, 0.19);
    this.pivot.rotation.copy(this.baseRotation);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    // Capability queries can wait for queued GPU work. Read this before any
    // uploads/draws instead of forcing a GPU sync when the model arrives.
    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.className = 'crt-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;';
    container.appendChild(canvas);
    container.dataset.screenActive = 'false';
    this.makeStudio();

    this.onPointerMove = (event) => {
      const press = this.activationStart;
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) press.moved = true;
      if (this.paused || this.film) return;
      if (event.pointerType === 'touch') return;
      const moved = !this.lastPointerPosition || Math.hypot(event.clientX - this.lastPointerPosition.x, event.clientY - this.lastPointerPosition.y) > .5;
      this.lastPointerPosition = { x: event.clientX, y: event.clientY };
      // Scrolling can move the canvas under a stationary cursor. Only an
      // actual pointer displacement should restart the tilt after scrolling.
      if (this.scrollPaused && !moved) return;
      this.scrollPaused = false;
      this.updatePointer(event);
      this.pointerInside = true;
      this.invalidate();
    };
    this.onScroll = () => {
      if (this.film) return;
      this.activationStart = null;
      this.scrollPaused = true;
      this.onPointerLeave();
    };
    this.onPointerLeave = () => {
      this.activationStart = null;
      container.style.cursor = '';
      this.pointerInside = false;
      this.screenHovered = false;
      this.target.set(0, 0);
      this.invalidate();
    };
    this.onPointerDown = (event) => {
      this.activationStart = null;
      if (this.paused || this.film || event.button !== 0 || event.isPrimary === false) return;
      this.updatePointer(event);
      if (this.hitTelevision()) this.activationStart = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
    };
    this.onPointerUp = (event) => {
      const press = this.activationStart;
      this.activationStart = null;
      if (this.paused || this.film || !press || press.id !== event.pointerId || press.moved) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) return;
      this.updatePointer(event);
      if (this.hitTelevision()) container.dispatchEvent(new CustomEvent('crt:activate', { bubbles: true }));
      if (event.pointerType === 'touch') this.target.set(0, 0);
    };
    this.onPointerCancel = () => { this.activationStart = null; this.onPointerLeave(); };
    container.addEventListener('pointermove', this.onPointerMove, { passive: true });
    container.addEventListener('pointerleave', this.onPointerLeave);
    container.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    container.addEventListener('pointerup', this.onPointerUp, { passive: true });
    container.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('wheel', this.onScroll, { passive: true });
    this.onVisibility = () => {
      if (document.hidden) this.stop();
      else this.invalidate();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onContextLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.renderReady = false;
      this.preparationGeneration++;
      this.film?.resolveTransition?.(false);
      if (this.film) {
        this.film.resolveTransition = null;
        this.film.resolveReveal?.(false);
        this.film.resolveReveal = null;
        this.film.revealRequested = false;
        this.film.blend = null;
      }
      this.releasePreparation();
      this.stop();
      delete container.dataset.ready;
      canvas.style.visibility = 'hidden';
      container.dispatchEvent(new CustomEvent('crt:error', { bubbles: true }));
    };
    this.onContextRestored = () => {
      this.contextLost = false;
      // The prefiltered atlas retains its CPU pixels across context loss.
      // Warm the restored context before replacing the matching poster.
      this.prepareRenderer().catch(error => this.fail(error));
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.visible = this.inViewport();
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.invalidate();
      else { this.onPointerLeave(); this.stop(); }
    });
    this.intersectionObserver.observe(container);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const modelReady = resources?.model
      ? resources.model.then(bytes => loader.parseAsync(bytes, new URL('.', new URL(modelUrl, location.href)).href))
      : loader.loadAsync(modelUrl);
    const studioReady = loadCRTStudio(this.renderer, resources?.studio).then(texture => {
      if (this.destroyed) { texture.dispose(); return; }
      this.environment = texture;
      this.scene.environment = texture;
    });
    this.ready = modelReady.then(async (gltf) => {
      if (this.destroyed) { this.disposeModel(gltf.scene); return; }
      this.model = gltf.scene;
      this.screenMesh = this.model.getObjectByName('CRT_Screen');
      if (!this.screenMesh?.isMesh) throw new Error('Missing CRT_Screen in the television asset.');
      this.model.traverse((mesh) => {
        if (!mesh.isMesh) return;
        for (const material of [mesh.material].flat()) {
          if (material.name === 'CRT_Case' || material.name === 'CRT_RearCase') {
            material.roughness = .26;
            material.clearcoat = .38;
            material.clearcoatRoughness = .18;
          }
          for (const value of Object.values(material)) {
            if (value?.isTexture) {
              value.anisotropy = this.maxAnisotropy;
              value.needsUpdate = true;
            }
          }
        }
      });
      const oldScreen = this.screenMesh.material;
      this.uniforms.filmSource.value = oldScreen.map;
      this.screenMesh.material = broadcastMaterial(oldScreen, this.uniforms);
      oldScreen.dispose();
      const bounds = new THREE.Box3().setFromObject(this.model);
      this.model.position.sub(bounds.getCenter(new THREE.Vector3()));
      this.pivot.add(this.model);
      this.resize();
      await studioReady;
      await this.prepareRenderer();
    }).catch((error) => { this.destroy(); throw error; });
    // Model loading and the atlas run concurrently; consume an early atlas
    // rejection even if model loading has not reached its await yet.
    studioReady.catch(() => {});
  }

  makeStudio() {
    this.scene.environmentIntensity = 0.60;
    this.studioLights = makeCRTStudioLights();
    this.scene.add(...this.studioLights);
  }

  async prepareRenderer() {
    if (!this.model || !this.environment || this.destroyed || this.contextLost) return;
    const generation = ++this.preparationGeneration;
    this.releasePreparation();
    const current = () => !this.destroyed && !this.contextLost && generation === this.preparationGeneration;
    const nextTask = async () => {
      await yieldToBrowser();
      if (this.paused && current()) await new Promise(resolve => this.preparationWaiters.add(resolve));
      return current();
    };
    this.renderReady = false;
    try {
      if (!await nextTask()) return;
      const textures = new Set([this.environment]);
      if (this.film?.hasVideoFrame) textures.add(this.film.texture);
      this.model.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of [mesh.material].flat()) {
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      for (const texture of textures) {
        this.renderer.initTexture(texture);
        if (!await nextTask()) return;
      }
      await this.renderer.compileAsync(this.scene, this.camera);
      if (!await nextTask()) return;
      this.renderReady = true;
      this.renderer.domElement.style.visibility = '';
      this.draw(0);
      this.invalidate();
    } catch (error) {
      // A lost or replaced context cannot complete a newer preparation.
      if (current()) throw error;
    }
  }

  releasePreparation() {
    for (const resume of this.preparationWaiters) resume();
    this.preparationWaiters.clear();
  }

  fail(error) {
    if (this.destroyed) return;
    this.destroy();
    this.container.dispatchEvent(new CustomEvent('crt:error', { bubbles: true }));
    console.warn('Could not restore the television; keeping its poster.', error);
  }

  inViewport() {
    const r = this.container.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }

  resize() {
    if (this.destroyed) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    const pixelRatio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(2_000_000 / (width * height)));
    // ResizeObserver can run after rAF but before the browser paints. Resizing
    // the drawing buffer here would erase the just-rendered television during
    // the stage's CSS zoom. Apply only the latest size in the next draw task.
    this.pendingViewport = this.viewportWidth !== width || this.viewportHeight !== height || this.viewportPixelRatio !== pixelRatio
      ? { width, height, pixelRatio } : null;
    this.camera.aspect = width / height;
    if (this.film) {
      this.applyFilmView();
      this.invalidate();
      return;
    }
    if (this.model) {
      // Fit the neutral pose; framing includes room for the spring and lift.
      const saved = this.pivot.rotation.clone();
      const savedPosition = this.pivot.position.clone();
      this.pivot.rotation.copy(this.baseRotation);
      this.pivot.position.set(0, 0, 0);
      // Keep one perspective at every breakpoint. A square, runtime-rendered
      // poster can then match this exact pose through object-fit: contain.
      // Fit actual vertices rather than an inflated world-aligned bounding box.
      if (!this.neutralZoom) {
        this.camera.aspect = 1;
        this.camera.zoom = 1;
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld(true);
        this.pivot.updateMatrixWorld(true);
        const vertex = new THREE.Vector3();
        let extent = 0;
        this.model.traverse((mesh) => {
          if (!mesh.isMesh) return;
          const position = mesh.geometry.attributes.position;
          for (let i = 0; i < position.count; i++) {
            vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).project(this.camera);
            extent = Math.max(extent, Math.abs(vertex.x), Math.abs(vertex.y));
          }
        });
        this.neutralZoom = .84 / extent;
      }
      this.camera.aspect = width / height;
      this.camera.zoom = this.neutralZoom * Math.min(1, this.camera.aspect);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld(true);
      this.interactionBounds = this.projectBounds(this.pivot);
      this.screenMesh.geometry.computeBoundingBox();
      const screenBox = this.screenMesh.geometry.boundingBox;
      const screenCenter = screenBox.getCenter(new THREE.Vector3());
      screenCenter.z = screenBox.max.z;
      this.screenMesh.localToWorld(screenCenter).project(this.camera);
      this.interactionCenter = { x: (screenCenter.x + 1) * width / 2, y: (1 - screenCenter.y) * height / 2 };
      const screenBounds = this.projectBounds(this.screenMesh);
      // Two to three CSS pixels per scanline remain visible in the narrow app
      // preview. Fixed 300-line stripes used to vanish behind the AA filter.
      this.uniforms.rows.value = clamp(screenBounds.height / 2.8, 55, 210);
      this.uniforms.pixel.value = 1 / Math.max(160, screenBounds.width);
      this.pivot.rotation.copy(saved);
      this.pivot.position.copy(savedPosition);
    }
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  updatePointer(event) {
    const r = this.container.getBoundingClientRect();
    this.pointer.set(((event.clientX - r.left) / r.width) * 2 - 1, 1 - ((event.clientY - r.top) / r.height) * 2);
    const b = this.interactionBounds;
    const center = this.interactionCenter;
    this.target.set(
      clamp(b && center ? (event.clientX - r.left - center.x) / b.width * 2.5 : this.pointer.x),
      clamp(b && center ? (center.y - (event.clientY - r.top)) / b.height * 2.5 : this.pointer.y),
    );
  }

  projectBounds(object) {
    const box = new THREE.Box3().setFromObject(object);
    const { width, height } = this.container.getBoundingClientRect();
    const xs = [], ys = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(this.camera);
      xs.push((p.x + 1) * width / 2); ys.push((1 - p.y) * height / 2);
    }
    const left = Math.min(...xs), top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  hitScreen() {
    // Test the entire opaque assembly, so casing occlusion cannot trigger the broadcast.
    return !!this.screenMesh && this.hitModel()?.object === this.screenMesh;
  }

  hitModel() {
    if (!this.model || !this.renderReady || this.contextLost || this.destroyed || this.film) return null;
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObject(this.model, true)[0] ?? null;
  }

  hitTelevision() {
    return !!this.hitModel();
  }

  replay() {
    if (this.destroyed || this.reducedMotion) return;
    this.time = 0;
    this.invalidate();
  }

  setReducedMotion(value) {
    this.reducedMotion = !!value;
    if (this.reducedMotion) {
      this.current.set(0, 0);
      this.velocity.set(0, 0);
      this.hoverWeight = 0;
      this.time = 0;
      this.screenHovered = false;
    }
    this.invalidate();
  }

  setPaused(value) {
    this.paused = !!value;
    if (this.paused) {
      this.onPointerLeave();
      this.stop();
    } else {
      this.releasePreparation();
      this.invalidate();
    }
  }

  get isFilmActive() { return !!this.film; }

  cacheFilmGeometry() {
    if (this.filmGeometry) return this.filmGeometry;
    this.screenMesh.geometry.computeBoundingBox();
    const bounds = this.screenMesh.geometry.boundingBox;
    const corners = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      corners.push(new THREE.Vector3(x, y, z));
    }
    this.pivot.updateMatrixWorld(true);
    const toPivot = this.pivot.matrixWorld.clone().invert().multiply(this.screenMesh.matrixWorld);
    const frontBox = new THREE.Box3().setFromPoints(corners.map(point => point.clone().applyMatrix4(toPivot)));
    this.filmGeometry = { corners, frontBox, center: frontBox.getCenter(new THREE.Vector3()), size: frontBox.getSize(new THREE.Vector3()) };
    return this.filmGeometry;
  }

  /** Viewport coordinates of the actual curved screen, including during zoom. */
  getFilmScreenBounds() {
    if (!this.screenMesh || this.destroyed) return null;
    const { corners } = this.cacheFilmGeometry();
    const rect = this.container.getBoundingClientRect();
    this.pivot.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const corner of corners) {
      const point = corner.clone().applyMatrix4(this.screenMesh.matrixWorld).project(this.camera);
      const x = rect.left + (point.x + 1) * rect.width / 2;
      const y = rect.top + (1 - point.y) * rect.height / 2;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const width = maxX - minX, height = maxY - minY;
    const scale = this.uniforms.frameScale.value;
    return { left: minX, top: minY, width, height,
      content: { left: minX + width * (1 - scale.x) / 2, top: minY + height * (1 - scale.y) / 2,
        width: width * scale.x, height: height * scale.y } };
  }

  /** Parent owns the video playback and the stage's CSS/DOM transition. */
  enterFilm(video, { duration = 900 } = {}) {
    if (this.destroyed || this.contextLost || this.paused || !this.renderReady || !this.screenMesh) return Promise.reject(new Error('The television is not ready for the film.'));
    if (!(video instanceof HTMLVideoElement)) return Promise.reject(new TypeError('enterFilm needs an HTMLVideoElement.'));
    if (this.film) return this.film.transitionPromise ?? Promise.resolve(true);
    const material = this.screenMesh.material;
    const texture = new THREE.VideoTexture(video);
    texture.name = 'CRT_ConceptFilm';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    if (video.readyState >= video.HAVE_CURRENT_DATA) texture.needsUpdate = true;
    const snapshot = {
      map: material.map, emissiveMap: material.emissiveMap,
      position: this.pivot.position.clone(), quaternion: this.pivot.quaternion.clone(),
      cameraPosition: this.camera.position.clone(), cameraQuaternion: this.camera.quaternion.clone(),
      cameraZoom: this.camera.zoom, aspect: this.camera.aspect,
      current: this.current.clone(), velocity: this.velocity.clone(), hoverWeight: this.hoverWeight, time: this.time,
    };
    this.cacheFilmGeometry();
    const film = this.film = { phase: 'entering', progress: 0, fromProgress: 0, elapsed: 0,
      duration: this.reducedMotion ? 0 : Math.max(0, duration), video, texture, snapshot,
      frontQuaternion: new THREE.Quaternion(), hasVideoFrame: false,
      revealPhase: 'hidden', revealProgress: 0, revealRequested: false, blend: null };
    film.transitionPromise = new Promise(resolve => { film.resolveTransition = resolve; });
    film.onMetadata = () => { if (this.film === film) { this.updateFilmContain(); this.invalidate(); } };
    film.onVideoFrame = () => {
      if (this.film !== film || film.hasVideoFrame || film.phase === 'exiting' || video.readyState < video.HAVE_CURRENT_DATA) return;
      film.hasVideoFrame = true;
      texture.needsUpdate = true;
      this.uniforms.filmSource.value = texture;
      this.updateFilmContain();
      this.startFilmReveal();
      this.invalidate();
    };
    film.onVideoError = () => {
      if (this.film !== film) return;
      film.revealRequested = false;
      film.resolveReveal?.(false);
      film.resolveReveal = null;
    };
    video.addEventListener('loadedmetadata', film.onMetadata);
    video.addEventListener('resize', film.onMetadata);
    video.addEventListener('loadeddata', film.onVideoFrame);
    video.addEventListener('canplay', film.onVideoFrame);
    video.addEventListener('error', film.onVideoError);
    this.activationStart = null;
    this.pointerInside = this.screenHovered = false;
    this.container.style.cursor = '';
    this.updateFilmContain();
    film.onVideoFrame();
    this.visible = this.inViewport();
    this.resize();
    this.invalidate();
    return film.transitionPromise;
  }

  /** Begin the screen dissolve only after the parent has finished its zoom. */
  revealFilm({ duration = 400 } = {}) {
    const film = this.film;
    if (!film || film.phase === 'exiting' || this.destroyed || this.contextLost || film.video.error) return Promise.resolve(false);
    if (film.revealPhase === 'shown') return Promise.resolve(true);
    if (film.revealRequested) return film.revealPromise;
    film.revealRequested = true;
    film.revealDuration = this.reducedMotion ? 0 : Math.max(0, duration);
    film.revealPhase = 'waiting';
    film.revealPromise = new Promise(resolve => { film.resolveReveal = resolve; });
    // Media may already be decoded, but enterFilm deliberately keeps Pepe.
    film.onVideoFrame();
    this.startFilmReveal();
    this.invalidate();
    return film.revealPromise;
  }

  startFilmReveal() {
    const film = this.film;
    if (!film || film.phase !== 'playing' || !film.revealRequested || !film.hasVideoFrame || film.revealPhase !== 'waiting') return;
    film.revealPhase = 'fading';
    film.blend = { from: this.uniforms.video.value, to: 1, elapsed: 0, duration: film.revealDuration };
  }

  advanceFilmBlend(dt) {
    const film = this.film;
    const blend = film?.blend;
    if (!blend) return;
    blend.elapsed += dt * 1000;
    const progress = this.reducedMotion || !blend.duration ? 1 : Math.min(1, blend.elapsed / blend.duration);
    const eased = progress * progress * (3 - 2 * progress);
    this.uniforms.video.value = THREE.MathUtils.lerp(blend.from, blend.to, eased);
    film.revealProgress = this.uniforms.video.value;
    if (progress === 1) {
      film.blend = null;
      film.revealPhase = blend.to ? 'shown' : 'hidden';
      if (blend.to) {
        film.resolveReveal?.(true);
        film.resolveReveal = null;
      }
    }
  }

  updateFilmContain() {
    if (!this.film) return;
    const { size } = this.cacheFilmGeometry();
    const { video } = this.film;
    const sourceAspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const screenAspect = size.x / size.y;
    // Contain the whole frame and leave optical overscan room for CRT warp.
    this.uniforms.frameScale.value.set(Math.min(1, sourceAspect / screenAspect) * .94,
      Math.min(1, screenAspect / sourceAspect) * .94);
  }

  applyFilmView() {
    const film = this.film;
    if (!film) return;
    const { snapshot, progress, frontQuaternion } = film;
    const { frontBox, center, size } = this.filmGeometry;
    const mix = progress * progress * (3 - 2 * progress);
    const heroZoom = snapshot.cameraZoom * Math.min(1, this.camera.aspect) / Math.min(1, snapshot.aspect);
    const depth = snapshot.cameraPosition.z - frontBox.max.z;
    const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const filmZoom = .91 * Math.min(halfHeight * this.camera.aspect / (size.x / 2), halfHeight / (size.y / 2));
    this.pivot.quaternion.copy(snapshot.quaternion).slerp(frontQuaternion, mix);
    this.pivot.position.copy(snapshot.position).multiplyScalar(1 - mix);
    this.camera.position.copy(snapshot.cameraPosition);
    this.camera.position.x = THREE.MathUtils.lerp(snapshot.cameraPosition.x, center.x, mix);
    this.camera.position.y = THREE.MathUtils.lerp(snapshot.cameraPosition.y, center.y, mix);
    this.camera.quaternion.copy(snapshot.cameraQuaternion).slerp(frontQuaternion, mix);
    this.camera.zoom = THREE.MathUtils.lerp(heroZoom, filmZoom, mix);
    this.camera.updateProjectionMatrix();
    const screenBounds = this.getFilmScreenBounds();
    this.uniforms.rows.value = clamp(screenBounds.height / 2.8, 55, 210);
    this.uniforms.pixel.value = 1 / Math.max(160, screenBounds.width);
  }

  exitFilm({ duration = 650 } = {}) {
    const film = this.film;
    if (!film) return Promise.resolve(true);
    const immediate = !duration || this.reducedMotion || this.destroyed || this.contextLost || this.paused || document.hidden || !this.inViewport();
    if (film.phase === 'exiting') {
      if (immediate) { this.finishFilm(); this.invalidate(); }
      return film.transitionPromise;
    }
    film.resolveTransition?.(false);
    film.resolveReveal?.(false);
    film.resolveReveal = null;
    film.revealRequested = false;
    film.phase = 'exiting';
    film.fromProgress = film.progress;
    film.elapsed = 0;
    film.duration = this.reducedMotion ? 0 : Math.max(0, duration);
    film.revealPhase = 'hiding';
    film.blend = { from: this.uniforms.video.value, to: 0, elapsed: 0, duration: Math.min(400, film.duration) };
    film.transitionPromise = new Promise(resolve => { film.resolveTransition = resolve; });
    const promise = film.transitionPromise;
    if (immediate || !film.duration) {
      this.finishFilm();
      this.invalidate();
    } else this.invalidate();
    return promise;
  }

  finishFilm(completed = true) {
    const film = this.film;
    if (!film) return;
    const { snapshot, video, texture } = film;
    const material = this.screenMesh?.material;
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
    this.pointerInside = this.screenHovered = false;
    video.removeEventListener('loadedmetadata', film.onMetadata);
    video.removeEventListener('resize', film.onMetadata);
    video.removeEventListener('loadeddata', film.onVideoFrame);
    video.removeEventListener('canplay', film.onVideoFrame);
    video.removeEventListener('error', film.onVideoError);
    texture.dispose();
    this.film = null;
    this.resize();
    film.resolveTransition?.(completed);
    film.resolveReveal?.(false);
  }

  draw(dt) {
    if (this.destroyed || this.contextLost || this.paused) return false;
    if (this.film) {
      const film = this.film;
      film.elapsed += dt * 1000;
      const elapsed = this.reducedMotion || !film.duration ? 1 : Math.min(1, film.elapsed / film.duration);
      if (film.phase === 'entering') film.progress = elapsed;
      else if (film.phase === 'exiting') film.progress = film.fromProgress * (1 - elapsed);
      if (film.phase === 'exiting' && elapsed === 1) this.finishFilm();
      else {
        this.applyFilmView();
        if (film.phase === 'entering' && elapsed === 1) {
          film.phase = 'playing';
          film.resolveTransition?.(true);
          film.resolveTransition = null;
        }
        this.startFilmReveal();
        this.advanceFilmBlend(dt);
      }
      if (!this.reducedMotion) this.time += dt;
    } else {
    // Scroll releases the target, not the accumulated velocity. A softer
    // spring and slower float fade let the television coast back into place.
    const coasting = this.scrollPaused && !this.reducedMotion;
    const mix = 1 - Math.exp(-(coasting ? 2.8 : 9) * dt);
    const tx = this.reducedMotion ? 0 : this.target.x;
    const ty = this.reducedMotion ? 0 : this.target.y;
    [this.current.x, this.velocity.x] = springAxis(this.current.x, this.velocity.x, tx, dt, coasting);
    [this.current.y, this.velocity.y] = springAxis(this.current.y, this.velocity.y, ty, dt, coasting);
    const hovering = !this.reducedMotion && this.pointerInside;
    this.hoverWeight = THREE.MathUtils.lerp(this.hoverWeight, hovering ? 1 : 0, mix);
    if (Math.abs(this.hoverWeight - (hovering ? 1 : 0)) < .001) this.hoverWeight = hovering ? 1 : 0;
    if (!this.reducedMotion) this.time += dt;
    const drift = this.hoverWeight;
    this.pivot.rotation.set(
      this.baseRotation.x - this.current.y * .16 + Math.sin(this.time * 1.7) * .008 * drift,
      this.baseRotation.y + this.current.x * .18 + Math.sin(this.time * 1.25) * .01 * drift,
      this.baseRotation.z - this.current.x * .05,
    );
    this.pivot.position.set(this.current.x * .055, this.current.y * .045 + (.07 + Math.sin(this.time * 1.9) * .024) * drift, 0);
    }
    // Coalesce pointer moves: one assembly hit test per rendered frame serves
    // both the cursor and screen state, even with a high-rate pointing device.
    const hit = this.pointerInside ? this.hitModel() : null;
    this.screenHovered = !this.reducedMotion && hit?.object === this.screenMesh;
    const cursor = hit ? 'pointer' : '';
    if (this.container.style.cursor !== cursor) this.container.style.cursor = cursor;
    // The broadcast is always on, independently from the body interaction.
    // Reduced motion keeps the CRT texture treatment on a frozen frame.
    this.screenIntensity = 1;
    this.uniforms.time.value = this.time;
    this.uniforms.amount.value = this.screenIntensity;
    this.container.dataset.screenActive = 'true';
    if (this.pendingViewport) {
      const { width, height, pixelRatio } = this.pendingViewport;
      this.renderer.setDrawingBufferSize(width, height, pixelRatio);
      this.viewportWidth = width;
      this.viewportHeight = height;
      this.viewportPixelRatio = pixelRatio;
      this.pendingViewport = null;
    }
    this.renderer.render(this.scene, this.camera);
    this.renderCount++;
    if (this.model && this.container.dataset.ready !== 'true') {
      this.container.dataset.ready = 'true';
      this.container.dispatchEvent(new CustomEvent('crt:ready', { bubbles: true }));
    }
    return !!this.film || !this.reducedMotion;
  }

  invalidate() {
    if (this.destroyed || this.contextLost || this.paused || !this.renderReady || document.hidden || !this.visible || this.frame) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      const dt = Math.min(1, Math.max(.001, (now - (this.lastFrame ?? now - 16.67)) / 1000));
      this.lastFrame = now;
      if (this.draw(dt)) this.invalidate();
      else this.lastFrame = null;
    });
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastFrame = null;
  }

  disposeModel(model) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const material of [mesh.material].flat()) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => { t.dispose(); t.source?.data?.close?.(); });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.finishFilm(false);
    this.preparationGeneration++;
    this.releasePreparation();
    this.stop();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('wheel', this.onScroll);
    for (const [type, handler] of [['pointermove', this.onPointerMove], ['pointerleave', this.onPointerLeave], ['pointerdown', this.onPointerDown], ['pointerup', this.onPointerUp], ['pointercancel', this.onPointerCancel]]) this.container.removeEventListener(type, handler);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    if (this.model) this.disposeModel(this.model);
    this.environment?.dispose();
    this.studioLights?.forEach(light => light.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.container.style.cursor = '';
    delete this.container.dataset.ready;
    this.container.dataset.screenActive = 'false';
  }
}
