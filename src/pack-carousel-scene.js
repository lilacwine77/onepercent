import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createPackShapeFitter } from './pack-uv-fit.js';
import { getPackCarouselLayout, getPackCarouselPose, PACK_CAROUSEL_FLOOR } from './pack-carousel-layout.js';
import { createPackXrayState, loadPackXrayTexture, patchPackXray } from './pack-xray.js';

const COUNT = 8;
const HALF_HEIGHT = 3.8;
const PACK_HEIGHT = 4.2;
const FLOOR = PACK_CAROUSEL_FLOOR;

/** One shared renderer and mesh for the entire foil carousel. */
export class PackCarouselScene {
  constructor(container, onReady) {
    this.container = container;
    this.onReady = onReady;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-5, 5, HALF_HEIGHT, -HALF_HEIGHT, .1, 40);
    this.camera.position.z = 15;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'pack-volume-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.prepend(this.canvas);
    this.geometries = new Set();
    this.materials = new Set();
    this.textures = new Set();
    this.editionCache = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.size = new THREE.Vector3();
    this.items = [];
    this.rotationX = Array(COUNT).fill(0);
    this.rotationY = Array(COUNT).fill(0);
    this.last = null;
    this.initialState = { angle: 0, lifts: Array(COUNT).fill(0), hovered: null,
      cursor: { x: 0, y: 0 }, time: 0, reducedMotion: true, dragging: false };
    this.buildStudio();
    this.xrayReady = loadPackXrayTexture(this.renderer).then((texture) => {
      if (this.disposed) { texture.dispose(); return null; }
      // Upload during preparation, before revealing the first complete frame.
      try { this.renderer.initTexture(texture); }
      catch (error) { texture.dispose(); throw error; }
      this.textures.add(texture);
      this.xrayTexture = texture;
      return texture;
    }).catch((error) => {
      // Capture an early network error immediately, even while GLB decoding is
      // pending. createEdition reports it through the existing fallback path.
      this.xrayError = error;
      return null;
    });
    this.resize();
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.ready = loader.loadAsync('/models/onepercent-carousel.glb?v=sealed-volume-1').then((gltf) => {
      if (this.disposed) { this.collect(gltf.scene); this.disposeResources(); return; }
      this.collect(gltf.scene);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const center = bounds.getCenter(new THREE.Vector3());
      this.normalization = PACK_HEIGHT / bounds.getSize(this.size).y;
      this.source = gltf.scene;
      this.source.position.sub(center);
      this.baseBounds = bounds.clone().translate(center.clone().negate());
      this.source.traverse((mesh) => {
        if (!mesh.isMesh) return;
        mesh.name = mesh.name.replaceAll('_', ' ');
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const value of Object.values(material)) {
            if (!value?.isTexture) continue;
            value.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
          }
        }
      });
      for (let i = 0; i < COUNT; i++) {
        const group = new THREE.Group();
        const model = this.source.clone(true);
        group.add(model);
        group.userData.index = i;
        this.scene.add(group);
        const reflection = new THREE.Group();
        const mirror = this.source.clone(true);
        reflection.add(mirror);
        this.scene.add(reflection);
        const shadow = this.makeShadow();
        this.scene.add(shadow);
        this.items.push({ group, model, reflection, mirror, shadow, restPose: new THREE.Object3D(), xray: createPackXrayState() });
      }
      return this.setEdition(this.pendingEdition).then(() => {
        if (this.disposed) return;
        this.loaded = true;
        this.render(this.last || this.initialState);
      });
    });
  }

  buildStudio() {
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = new THREE.Scene();
    studio.background = new THREE.Color(0x55525a);
    const panel = (color, power, width, height, x, y, z) => {
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
      mesh.position.set(x, y, z); mesh.lookAt(0, 0, 0); studio.add(mesh);
    };
    panel(0xfff5e8, 5, 4, 8, -4, 2, 5);
    panel(0xffffff, 11, 1.3, 8, 4, .5, 5);
    panel(0xe7deff, 4, 5, 2, 0, 6, 3);
    panel(0xffffff, 7, 3, 8, 4, 1, -5);
    panel(0xbddfff, 5, 1.5, 7, -5, .5, -3);
    panel(0x070609, 1, 1.4, 8, 1.7, 0, 6);
    this.env = this.pmrem.fromScene(studio, .025);
    studio.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 1;
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(44,12,48,.5)');
    gradient.addColorStop(.35, 'rgba(44,12,48,.25)');
    gradient.addColorStop(1, 'rgba(44,12,48,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    this.shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    this.textures.add(this.shadowTexture);
    this.shadowGeometry = new THREE.PlaneGeometry(1, 1);
    this.geometries.add(this.shadowGeometry);
  }

  makeShadow() {
    const mat = new THREE.MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false, toneMapped: false });
    this.materials.add(mat);
    return new THREE.Mesh(this.shadowGeometry, mat);
  }

  async setEdition(pack) {
    if (!pack || this.disposed) return;
    this.pendingEdition = pack;
    if (!this.source) return;
    let cached = this.editionCache.get(pack.id);
    if (!cached) {
      cached = this.createEdition(pack);
      this.editionCache.set(pack.id, cached);
    }
    const materials = await cached;
    if (!materials || this.disposed || this.pendingEdition.id !== pack.id) return;
    for (const [i, item] of this.items.entries()) {
      item.model.traverse((mesh) => { if (mesh.isMesh) { mesh.material = materials.instances[i].front[mesh.name]; mesh.geometry = materials.geometry[mesh.name]; } });
      item.mirror.traverse((mesh) => { if (mesh.isMesh) { mesh.material = materials.instances[i].reflection[mesh.name]; mesh.geometry = materials.geometry[mesh.name]; } });
    }
    this.currentMaterials = materials;
    this.baseBounds.copy(materials.bounds);
    this.baseBounds.getSize(this.size);
    this.normalization = PACK_HEIGHT / this.size.y;
    this.resize(false);
    this.applyPose(this.last || this.initialState);
    this.compiling = true;
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed || this.pendingEdition.id !== pack.id) return;
    this.compiling = false;
    if (this.loaded) this.render(this.last || this.initialState);
  }

  async createEdition(pack) {
    const [frontMap, xrayTexture] = await Promise.all([
      new THREE.TextureLoader().loadAsync(`/assets/${pack.image}`),
      this.xrayReady,
    ]);
    if (this.disposed) { frontMap.dispose(); return null; }
    if (!xrayTexture) {
      frontMap.dispose();
      throw this.xrayError || new Error('The pack X-ray texture could not load.');
    }
    frontMap.flipY = true;
    frontMap.colorSpace = THREE.SRGBColorSpace;
    frontMap.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    this.textures.add(frontMap);
    let fitShape;
    if (pack.id !== 'signature') {
      if (!this.shapeFitter) {
        this.shapeFitter = new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            resolve(createPackShapeFitter(image));
          };
          image.onerror = reject;
          image.src = '/assets/pack-closed.webp';
        });
      }
      fitShape = await this.shapeFitter;
      if (this.disposed) return null;
    }
    const result = { front: {}, reflection: {}, geometry: {}, bounds: new THREE.Box3() };
    this.source.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const source = mesh.material;
      let geometry = mesh.geometry;
      if (fitShape) {
        const position = geometry.getAttribute('position');
        const native = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) { native[i * 3] = position.getX(i); native[i * 3 + 1] = position.getY(i); native[i * 3 + 2] = position.getZ(i); }
        const fitted = fitShape(native, frontMap.image);
        geometry = geometry.clone();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(fitted.positions, 3));
        if (mesh.name === 'Printed front') geometry.setAttribute('uv', new THREE.Float32BufferAttribute(fitted.uv, 2));
        geometry.computeVertexNormals();
        this.geometries.add(geometry);
      }
      geometry.computeBoundingBox();
      result.bounds.union(geometry.boundingBox);
      result.geometry[mesh.name] = geometry;
      const printed = mesh.name === 'Printed front';
      const material = new THREE.MeshPhysicalMaterial({
        map: printed ? frontMap : source.map,
        color: printed ? 0xffffff : source.color,
        metalness: mesh.name === 'Sealed foil edge' ? .94 : .68,
        roughness: mesh.name === 'Sealed foil edge' ? .23 : .29,
        clearcoat: .25,
        clearcoatRoughness: .24,
        side: source.side,
        alphaTest: source.alphaTest,
        envMapIntensity: printed ? .5 : 1.05,
        toneMapped: !printed,
      });
      const preservePrint = (shader) => {
        if (!printed) return;
        // Native artwork already contains its gold/foil lighting. Keep those
        // exact pixels and add only a restrained physical moving reflection.
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
          'outgoingLight = diffuseColor.rgb + min(totalSpecular, vec3(0.4)) * 0.07;\n#include <opaque_fragment>');
      };
      material.onBeforeCompile = preservePrint;
      material.customProgramCacheKey = () => printed ? 'carousel-native-print-v2' : 'carousel-foil';
      if (mesh.name !== 'Printed front' && pack.id !== 'signature') {
        // The reverse retains its printed panel; a metal tint ties it to the selected finish.
        material.color.set(pack.id === 'blue' ? 0x3865dc : pack.id === 'after-hours' ? 0x343139 : 0xc4c6cd);
      }
      this.materials.add(material);
      result.front[mesh.name] = material;
      const reflection = material.clone();
      reflection.transparent = true;
      reflection.opacity = .16;
      reflection.depthWrite = false;
      reflection.roughness = .5;
      reflection.onBeforeCompile = (shader) => {
        preservePrint(shader);
        shader.vertexShader = 'varying float vMirrorY;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvMirrorY = (modelMatrix * vec4(transformed, 1.0)).y;');
        shader.fragmentShader = 'varying float vMirrorY;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\ndiffuseColor.a *= smoothstep(${FLOOR - 1.25}, ${FLOOR - .05}, vMirrorY);`);
      };
      reflection.customProgramCacheKey = () => `carousel-mirror-fade-${printed ? 'native-v2' : 'foil'}`;
      this.materials.add(reflection);
      result.reflection[mesh.name] = reflection;
    });
    // Per-item materials share a single compiled shader program, while their
    // uniforms are independent. Standard/PhysicalMaterial cannot force custom
    // per-draw uploads with ShaderMaterial.uniformsNeedUpdate.
    result.instances = this.items.map((item) => {
      const instance = { front: { ...result.front }, reflection: { ...result.reflection } };
      for (const key of ['front', 'reflection']) {
        const original = result[key]['Printed front'];
        const material = original.clone();
        const previousCompile = original.onBeforeCompile;
        material.onBeforeCompile = (shader) => {
          previousCompile(shader);
          // Remove only the existing native-print replacement: the shared
          // patch emits it verbatim for progress zero and adds X-ray after it.
          shader.fragmentShader = shader.fragmentShader.replace(
            'outgoingLight = diffuseColor.rgb + min(totalSpecular, vec3(0.4)) * 0.07;\n#include <opaque_fragment>',
            '#include <opaque_fragment>');
          patchPackXray(shader, item.xray, this.xrayTexture);
        };
        material.customProgramCacheKey = () => `carousel-xray-v1-${key}`;
        material.userData.xray = item.xray;
        this.materials.add(material);
        instance[key]['Printed front'] = material;
      }
      return instance;
    });
    result.bounds.translate(this.source.position);
    return result;
  }

  resize(draw = true) {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height || this.disposed) return;
    this.width = width; this.height = height;
    const { halfHeight, halfWidth, spacing } = getPackCarouselLayout(width, height);
    this.spacing = spacing;
    this.camera.left = -halfWidth; this.camera.right = halfWidth;
    this.camera.top = halfHeight; this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio || 1, 1.5), 2, Math.sqrt(1_800_000 / (width * height))));
    this.renderer.setSize(width, height, false);
    if (draw && this.last) this.render(this.last);
  }

  render(state) {
    this.last = state;
    if (!this.loaded || !this.currentMaterials || this.disposed || this.compiling || document.hidden) return;
    const bounds = this.container.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= innerHeight || bounds.right <= 0 || bounds.left >= innerWidth) return;
    this.applyPose(state);
    this.renderer.render(this.scene, this.camera);
    // Keep native artwork visible until shaders and the first complete draw
    // are ready. Offscreen preparation never reveals a blank canvas.
    if (!this.hasFrame) {
      this.hasFrame = true;
      this.container.dataset.volume = 'ready';
      this.onReady?.();
    }
  }

  applyPose(state) {
    const { angle, lifts, hovered, cursor, time, reducedMotion, dragging } = state;
    this.items.forEach((item, i) => {
      item.xray.progress.value = THREE.MathUtils.clamp(state.xray?.[i] || 0, 0, 1);
      item.xray.cursor.value.set(hovered === i && !reducedMotion ? cursor.x : 0, hovered === i && !reducedMotion ? cursor.y : 0);
      const pose = getPackCarouselPose(angle, i, this.spacing);
      const { depth, x, yaw } = pose;
      const scale = pose.scale * this.normalization;
      const active = hovered === i && !dragging && !reducedMotion;
      this.rotationX[i] = reducedMotion ? .035 : this.rotationX[i] + ((active ? -cursor.y * .19 : .035) - this.rotationX[i]) * .15;
      this.rotationY[i] = reducedMotion ? 0 : this.rotationY[i] + ((active ? cursor.x * .28 : 0) - this.rotationY[i]) * .15;
      const bob = reducedMotion || dragging ? 0 : Math.sin(time / 1100 + i * .7) * .045;
      item.group.visible = Math.abs(x) < this.camera.right + this.spacing / 2;
      item.group.position.set(x, pose.y + lifts[i] * .016 + bob, pose.z);
      item.group.rotation.set(this.rotationX[i], yaw + this.rotationY[i], pose.roll);
      item.group.scale.setScalar(scale);
      // Keep the hover footprint anchored at rest; lifting must never move its own hit target away.
      item.restPose.position.set(x, pose.y, pose.z);
      item.restPose.rotation.set(.035, yaw, pose.roll);
      item.restPose.scale.setScalar(scale);
      item.restPose.updateMatrix();
      item.reflection.visible = item.group.visible && depth > .1;
      item.reflection.position.copy(item.group.position);
      item.reflection.position.y = FLOOR * 2 - item.group.position.y;
      item.reflection.rotation.set(-item.group.rotation.x, item.group.rotation.y, -item.group.rotation.z);
      item.reflection.scale.set(scale, -scale, scale);
      item.shadow.visible = item.group.visible;
      item.shadow.position.set(item.group.position.x, FLOOR + .035, item.group.position.z - .5);
      item.shadow.scale.set(3.2 * scale, .47 * scale, 1);
      item.shadow.material.opacity = (.35 + depth * .2) * (1 - lifts[i] / 130);
    });
  }

  hit(clientX, clientY) {
    if (!this.loaded) return null;
    const rect = this.container.getBoundingClientRect();
    const active = this.last?.hovered;
    if (active !== null && active !== undefined && this.items[active]?.group.visible) {
      const item = this.items[active];
      const box = this.baseBounds.clone().applyMatrix4(item.restPose.matrix);
      box.union(this.baseBounds.clone().applyMatrix4(item.group.matrixWorld));
      const a = box.min.clone().project(this.camera), b = box.max.clone().project(this.camera);
      const x = (clientX - rect.left) / rect.width * 2 - 1;
      const y = 1 - (clientY - rect.top) / rect.height * 2;
      if (x >= a.x - .015 && x <= b.x + .015 && y >= a.y - .015 && y <= b.y + .015) {
        return { index: active, x: THREE.MathUtils.clamp((x - (a.x + b.x) / 2) / ((b.x - a.x) / 2), -1, 1), y: THREE.MathUtils.clamp(-(y - (a.y + b.y) / 2) / ((b.y - a.y) / 2), -1, 1) };
      }
    }
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.items.filter((item) => item.group.visible).map((item) => item.group), true);
    if (!hits.length) return null;
    let object = hits[0].object;
    while (object.userData.index === undefined && object.parent) object = object.parent;
    const index = object.userData.index;
    if (index === undefined) return null;
    const point = hits[0].point.clone();
    object.worldToLocal(point);
    return { index, x: THREE.MathUtils.clamp(point.x / 1.7, -1, 1), y: THREE.MathUtils.clamp(-point.y / 1.9, -1, 1) };
  }

  collect(model) {
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      this.geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) this.textures.add(value);
      }
    });
  }

  disposeResources() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }

  destroy() {
    this.disposed = true;
    this.disposeResources();
    this.env.dispose(); this.pmrem.dispose(); this.renderer.dispose();
    this.canvas.remove();
    delete this.container.dataset.volume;
  }
}
