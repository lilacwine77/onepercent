import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const TAU = Math.PI * 2;
const clamp = (value) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Scroll-driven viewer for the editable, optimized sealed foil pack GLB. */
export class PackTurntable {
  constructor({
    container,
    modelUrl = "/models/onepercent-foil.glb?v=signature-relief-6",
    reducedMotion = false,
  } = {}) {
    if (!container?.appendChild)
      throw new TypeError("PackTurntable requires a container element.");
    this.container = container;
    this.reducedMotion = reducedMotion;
    this.destroyed = false;
    this.progress = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
    this.camera.position.set(0, 0, 7.1);
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.setClearColor(0, 0);
    this.renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;";
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute(
      "aria-label",
      "The holographic Signature pack rotating to reveal its raised gold 1% mark, sculpted foil folds, sealed edge and branded back.",
    );
    container.appendChild(this.renderer.domElement);

    this.asset = { group: new THREE.Group() };
    this.scene.add(this.asset.group);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = new THREE.Scene();
    studio.background = new THREE.Color(0x565251);
    const card = (name, color, intensity, width, height, position) => {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      panel.material.color.copy(new THREE.Color(color).multiplyScalar(intensity));
      panel.name = name;
      panel.position.set(...position);
      panel.lookAt(0, 0, 0);
      studio.add(panel);
    };
    card("warm key", 0xfff3df, 7, 3.8, 7.5, [-4.4, 1.2, 5.8]);
    card("sweeping strip", 0xffffff, 16, 1.25, 8.0, [4.5, 0.6, 5.2]);
    card("top bounce", 0xf3f4ff, 7, 5.4, 2.1, [0, 6.1, 3.4]);
    card("rear silver", 0xf5f4f2, 13, 3.6, 7.4, [3.8, 1.0, -5.5]);
    card("rear rim", 0xe5ecff, 7, 1.3, 8.0, [-5.3, 0.8, -3.8]);
    card("dark flag", 0x08090b, 1, 1.4, 8.2, [1.7, 0.5, 6.6]);
    this.environmentTarget = this.pmrem.fromScene(studio, 0.025);
    studio.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      object.material.dispose();
    });
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 1.0;

    this.resize = () => {
      if (this.destroyed) return;
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      // Supersample fine foil edges on standard screens, while bounding the
      // drawing buffer on high-density displays. Render only when invalidated.
      const pixelRatio = Math.min(
        Math.max(devicePixelRatio || 1, 1.5),
        2.5,
        Math.sqrt(2_500_000 / (width * height)),
      );
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.invalidate();
    };
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.onVisibilityChange = () => {
      if (!document.hidden) this.invalidate();
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.resize();

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.ready = loader
      .loadAsync(modelUrl)
      .then((gltf) => {
        if (this.destroyed) {
          this.disposeModel(gltf.scene);
          return;
        }
        this.model = gltf.scene;
        this.meshes = [];
        this.model.traverse((object) => {
          if (!object.isMesh) return;
          object.name = object.name.replaceAll("_", " ");
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            for (const texture of Object.values(material)) {
              if (!texture?.isTexture) continue;
              texture.anisotropy = Math.min(
                this.renderer.capabilities.getMaxAnisotropy(),
                16,
              );
              texture.needsUpdate = true;
            }
          }
          this.meshes.push(object);
        });
        const expected = [
          "Printed front",
          "Branded reverse",
          "Sealed foil edge",
        ];
        if (
          expected.some(
            (name) => !this.meshes.some((mesh) => mesh.name === name),
          )
        ) {
          throw new Error("The foil GLB is missing a required surface.");
        }
        this.asset.group.add(this.model);
        this.setProgress(this.progress);
        container.dataset.ready = "true";
        this.invalidate();
      })
      .catch((error) => {
        this.destroy();
        throw error;
      });
  }

  setProgress(value) {
    const progress = clamp(value);
    if (progress === this.progress && this.model) return;
    this.progress = progress;
    this.asset.group.rotation.y = this.reducedMotion ? 0 : progress * TAU;
    this.asset.group.rotation.z = this.reducedMotion
      ? 0
      : Math.sin(progress * TAU) * 0.027;
    this.invalidate();
  }

  invalidate() {
    if (this.destroyed || document.hidden || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.destroyed) this.renderer.render(this.scene, this.camera);
    });
  }

  disposeModel(model) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    model.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value?.isTexture) textures.add(value);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (this.model) this.disposeModel(this.model);
    this.environmentTarget?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete this.container.dataset.ready;
  }
}
