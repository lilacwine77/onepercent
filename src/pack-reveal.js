import * as THREE from 'three';
import { createPackAsset } from './pack-asset.js';

const clamp = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Camera-projected 3D reconstruction, optimized for the reference view. */
export class PackReveal {
  constructor({ container, assetsBase = '/assets/', onProgress, interactive = true, reducedMotion } = {}) {
    if (!container || !container.appendChild) throw new TypeError('PackReveal requires a container element.');
    this.container = container;
    this.onProgress = onProgress;
    this.target = 0;
    this.progress = 0;
    this.destroyed = false;
    this.pointer = new THREE.Vector2();
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = reducedMotion ?? this.motionQuery.matches;
    this.motionOverride = reducedMotion;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-2.3, 2.3, 2.3, -2.3, 0.1, 50);
    this.camera.position.set(0, 0, 10);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'Pack 1 % holographique. Le sachet se déchire et révèle Pepe au défilement.');
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;';
    container.appendChild(this.renderer.domElement);
    this.stage = new THREE.Group();
    this.scene.add(this.stage);
    this.resize = () => {
      if (this.destroyed) return;
      const { width, height } = this.container.getBoundingClientRect();
      if (!width || !height) return;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height, false);
      const aspect = width / height;
      const halfWidth = aspect > 1 ? 2.18 * aspect : 2.18;
      const halfHeight = aspect > 1 ? 2.18 : 2.18 / aspect;
      this.camera.left = -halfWidth;
      this.camera.right = halfWidth;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.updateProjectionMatrix();
      this.invalidate();
    };
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    window.addEventListener('resize', this.resize);
    this.onPointerMove = event => {
      if (!interactive || this.reducedMotion || event.pointerType === 'touch') return;
      const rect = container.getBoundingClientRect();
      this.pointer.set(((event.clientX - rect.left) / rect.width - 0.5) * 2, ((event.clientY - rect.top) / rect.height - 0.5) * 2);
      this.invalidate();
    };
    this.onPointerLeave = () => { this.pointer.set(0, 0); this.invalidate(); };
    this.onMotionChange = () => {
      if (this.motionOverride === undefined) this.reducedMotion = this.motionQuery.matches;
      if (this.reducedMotion) this.pointer.set(0, 0);
      this.invalidate();
    };
    this.onVisibilityChange = () => {
      if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; }
      else this.invalidate();
    };
    container.addEventListener('pointermove', this.onPointerMove);
    container.addEventListener('pointerleave', this.onPointerLeave);
    this.motionQuery.addEventListener('change', this.onMotionChange);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resize();
    const loader = new THREE.TextureLoader();
    const base = assetsBase.endsWith('/') ? assetsBase : `${assetsBase}/`;
    this.textures = [];
    const loadTexture = async url => {
      const texture = await loader.loadAsync(url);
      if (this.destroyed) texture.dispose();
      else this.textures.push(texture);
      return texture;
    };
    this.ready = Promise.all([
      loadTexture(`${base}pack-closed.png`),
      loadTexture(`${base}pepe-all-white.png`),
    ]).then(textures => {
      if (this.destroyed) return;
      this.textures = textures;
      textures.forEach(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
      });
      this.asset = createPackAsset({ closedTexture: textures[0], referenceTexture: textures[1] });
      this.stage.add(this.asset.group);
      this.progress = this.reducedMotion ? 1 : this.target;
      this.asset.setProgress(this.progress);
      this.container.dataset.ready = 'true';
      this.invalidate();
    }).catch(error => {
      this.destroy();
      throw error;
    });
  }

  setProgress(value) {
    this.target = clamp(value);
    this.invalidate();
  }

  invalidate() {
    if (this.destroyed || this.raf || document.hidden) return;
    this.raf = requestAnimationFrame(time => this.render(time));
  }

  render(time) {
    this.raf = 0;
    if (this.destroyed) return;
    const dt = Math.min((time - (this.lastTime || time - 16.67)) / 1000, 0.05);
    this.lastTime = time;
    const ease = 1 - Math.exp(-dt * 13);
    const target = this.reducedMotion ? 1 : this.target;
    this.progress = this.reducedMotion ? target : THREE.MathUtils.lerp(this.progress, target, ease);
    if (Math.abs(this.progress - target) < 0.00005) this.progress = target;
    const rx = this.reducedMotion ? 0 : -this.pointer.y * 0.035;
    const ry = this.reducedMotion ? 0 : this.pointer.x * 0.045;
    this.stage.rotation.x = this.reducedMotion ? rx : THREE.MathUtils.lerp(this.stage.rotation.x, rx, ease);
    this.stage.rotation.y = this.reducedMotion ? ry : THREE.MathUtils.lerp(this.stage.rotation.y, ry, ease);
    if (this.asset) this.asset.setProgress(this.progress);
    this.renderer.render(this.scene, this.camera);
    this.onProgress?.(this.progress);
    const moving = Math.abs(this.progress - target) > 0.00001 || Math.abs(this.stage.rotation.x - rx) > 0.00001 || Math.abs(this.stage.rotation.y - ry) > 0.00001;
    if (moving) this.invalidate();
  }

  async exportGLB() {
    await this.ready;
    if (this.destroyed || !this.asset) throw new Error('The pack is not available.');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    if (this.destroyed) throw new Error('The pack is not available.');
    const textures = this.textures.map(texture => texture.clone());
    const asset = createPackAsset({ closedTexture: textures[0], referenceTexture: textures[1] });
    asset.setProgress(0);
    asset.group.updateMatrixWorld(true);
    try {
      return await new GLTFExporter().parseAsync(asset.group, {
        binary: true,
        onlyVisible: false,
        animations: asset.animationClips || [],
        includeCustomExtensions: true,
      });
    } finally {
      asset.dispose();
      textures.forEach(texture => texture.dispose());
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerleave', this.onPointerLeave);
    this.motionQuery.removeEventListener('change', this.onMotionChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.asset?.dispose();
    this.textures.forEach(texture => texture.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete this.container.dataset.ready;
  }
}
