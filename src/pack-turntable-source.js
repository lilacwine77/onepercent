import * as THREE from "three";

const TAU = Math.PI * 2;
const clamp = (value) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

// Segment only the four bright, connected strokes of the photographed 1% mark.
// Its dark counters and the surrounding holographic foil stay at body height.
function makeLogoRelief(image) {
  const x0 = 390;
  const y0 = 100;
  const width = 585;
  const height = 320;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, x0, y0, width, height, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const bright = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);
  const selected = new Uint8Array(width * height);
  for (let i = 0; i < bright.length; i++) {
    const p = i * 4;
    const luminance =
      pixels[p] * 0.24 + pixels[p + 1] * 0.67 + pixels[p + 2] * 0.09;
    bright[i] = pixels[p + 3] > 92 && luminance > 100 ? 1 : 0;
  }
  const queue = new Int32Array(bright.length);
  for (let start = 0; start < bright.length; start++) {
    if (!bright[start] || seen[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    seen[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      const cx = current % width;
      const cy = Math.floor(current / width);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (!bright[neighbor] || seen[neighbor]) continue;
          seen[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
    if (tail > 8000) {
      for (let i = 0; i < tail; i++) selected[queue[i]] = 255;
    }
  }
  // Seal tiny dark islands caused by ink grain; preserve the large counters in 0.
  seen.fill(0);
  for (let start = 0; start < selected.length; start++) {
    if (selected[start] || seen[start]) continue;
    let head = 0;
    let tail = 1;
    let touchesBorder = false;
    queue[0] = start;
    seen[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      const cx = current % width;
      const cy = Math.floor(current / width);
      if (!cx || !cy || cx === width - 1 || cy === height - 1) touchesBorder = true;
      for (const neighbor of [current - 1, current + 1, current - width, current + width]) {
        if (neighbor < 0 || neighbor >= selected.length) continue;
        if (Math.abs((neighbor % width) - cx) > 1) continue;
        if (selected[neighbor] || seen[neighbor]) continue;
        seen[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (!touchesBorder && tail <= 280) {
      for (let i = 0; i < tail; i++) selected[queue[i]] = 255;
    }
  }
  const mask = context.createImageData(width, height);
  for (let i = 0; i < selected.length; i++) {
    const p = i * 4;
    mask.data[p] = mask.data[p + 1] = mask.data[p + 2] = 255;
    mask.data[p + 3] = selected[i];
  }
  context.putImageData(mask, 0, 0);
  const smoothCanvas = document.createElement("canvas");
  smoothCanvas.width = width;
  smoothCanvas.height = height;
  const smoothContext = smoothCanvas.getContext("2d", { willReadFrequently: true });
  smoothContext.filter = "blur(5px)";
  smoothContext.drawImage(canvas, 0, 0);
  const smooth = smoothContext.getImageData(0, 0, width, height).data;
  return (x, y) => {
    const px = Math.round(x - x0);
    const py = Math.round(y - y0);
    if (px < 0 || px >= width || py < 0 || py >= height) return 0;
    const alpha = smooth[(py * width + px) * 4 + 3] / 255;
    const t = clamp((alpha - 0.12) / 0.72);
    return t * t * (3 - 2 * t);
  };
}

const FOLD_RIDGES = [
  [310, 410, 310, 590, 0.024, 24],
  [310, 590, 575, 590, 0.022, 22],
  [310, 590, 265, 918, 0.026, 25],
  [575, 590, 975, 450, 0.032, 28],
  [575, 590, 965, 835, 0.029, 31],
  [975, 450, 1080, 520, 0.025, 22],
  [1080, 520, 965, 835, 0.025, 25],
  [965, 835, 1004, 1003, 0.019, 24],
];

// The photographed foil has broad connected cells between its visible pinch
// points. Give those cells a raised, softly curved face instead of thin pipes.
const FOLD_FACETS = [
  [310, 410, 975, 450, 575, 590, 0.105],
  [310, 590, 575, 590, 265, 918, 0.105],
  [575, 590, 965, 835, 265, 918, 0.145],
  [575, 590, 975, 450, 965, 835, 0.12],
  [975, 450, 1080, 520, 965, 835, 0.07],
  [265, 918, 965, 835, 1004, 1003, 0.055],
];

function facetBulges(x, y) {
  let height = 0;
  for (const [ax, ay, bx, by, cx, cy, amplitude] of FOLD_FACETS) {
    const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / determinant;
    const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / determinant;
    const c = 1 - a - b;
    if (a <= 0 || b <= 0 || c <= 0) continue;
    height += amplitude * Math.pow(27 * a * b * c, 0.56);
  }
  return height;
}

function structuredFolds(x, y) {
  let height = 0;
  for (const [ax, ay, bx, by, amplitude, width] of FOLD_RIDGES) {
    const vx = bx - ax;
    const vy = by - ay;
    const length = Math.hypot(vx, vy);
    const t = clamp(((x - ax) * vx + (y - ay) * vy) / (length * length));
    const signed = ((x - ax) * vy - (y - ay) * vx) / length;
    const fade = Math.sin(Math.PI * t) ** 0.7;
    const core = Math.exp(-0.5 * (signed / width) ** 2);
    const trough = Math.exp(-0.5 * ((Math.abs(signed) - width * 2) / (width * 1.4)) ** 2);
    height += amplitude * fade * (core - 0.3 * trough);
  }
  for (const [cx, cy, amplitude, radius] of [
    [310, 410, 0.028, 52], [310, 590, 0.03, 55],
    [575, 590, 0.031, 62], [975, 450, 0.027, 52],
    [1080, 520, 0.018, 48], [965, 835, 0.025, 55],
    [265, 918, 0.023, 50], [1004, 1003, 0.016, 46],
  ]) {
    const distanceSquared = (x - cx) ** 2 + (y - cy) ** 2;
    height += amplitude * Math.exp(-distanceSquared / (2 * radius * radius));
  }
  // The printed lower title stays taut while the corner foil still gathers.
  if (x > 335 && x < 965 && y > 850) {
    height *= clamp((920 - y) / 70);
  }
  return Math.max(-0.025, Math.min(0.085, height));
}

// The foil is meshed to the photograph's actual alpha silhouette. A distance
// field pulls its two printed skins together at the edge, so the profile has a
// pillow curve rather than a broad rectangular side wall.
function makeSilhouette(image) {
  const size = 1024;
  const logoRelief = makeLogoRelief(image);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const distance = new Float32Array(size * size);
  const left = new Int16Array(size).fill(-1);
  const right = new Int16Array(size).fill(-1);
  let first = size;
  let last = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const visible = pixels[(y * size + x) * 4 + 3] > 92;
      distance[y * size + x] = visible ? 1e5 : 0;
      if (!visible) continue;
      if (left[y] < 0) left[y] = x;
      right[y] = x;
      first = Math.min(first, y);
      last = y;
    }
  }
  const diagonal = Math.SQRT2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let value = distance[i];
      if (x) value = Math.min(value, distance[i - 1] + 1);
      if (y) value = Math.min(value, distance[i - size] + 1);
      if (x && y) value = Math.min(value, distance[i - size - 1] + diagonal);
      if (x < size - 1 && y)
        value = Math.min(value, distance[i - size + 1] + diagonal);
      distance[i] = value;
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      let value = distance[i];
      if (x < size - 1) value = Math.min(value, distance[i + 1] + 1);
      if (y < size - 1) value = Math.min(value, distance[i + size] + 1);
      if (x < size - 1 && y < size - 1)
        value = Math.min(value, distance[i + size + 1] + diagonal);
      if (x && y < size - 1)
        value = Math.min(value, distance[i + size - 1] + diagonal);
      distance[i] = value;
    }
  }
  const heightAt = (x, y, isBack) => {
    const xi = Math.max(0, Math.min(size - 1.001, x));
    const yi = Math.max(0, Math.min(size - 1.001, y));
    const x0 = Math.floor(xi);
    const y0 = Math.floor(yi);
    const x1 = Math.min(size - 1, x0 + 1);
    const y1 = Math.min(size - 1, y0 + 1);
    const fx = xi - x0;
    const fy = yi - y0;
    const top = distance[y0 * size + x0] * (1 - fx) + distance[y0 * size + x1] * fx;
    const bottom = distance[y1 * size + x0] * (1 - fx) + distance[y1 * size + x1] * fx;
    const edgeDistance = Math.max(0, top * (1 - fy) + bottom * fy - 1) * (4 / size);
    const fullness = 1 - Math.exp(-edgeDistance / 0.16);
    const horizontal =
      (x - left[y0]) / Math.max(1, right[y0] - left[y0]);
    const vertical = (y - first) / Math.max(1, last - first);
    const broadDome =
      Math.sin(Math.PI * Math.max(0, Math.min(1, horizontal))) *
      Math.sin(Math.PI * Math.max(0, Math.min(1, vertical))) *
      0.112;
    const originalX = (x / size) * image.width;
    const originalY = (y / size) * image.height;
    const topSeal = originalY - (-30 + originalX * 0.145);
    const bottomSeal = 1070 + originalX * 0.12 - originalY;
    const sealDistance = Math.min(topSeal, bottomSeal);
    const crimp =
      sealDistance > 0 && sealDistance < 64
        ? Math.sin(originalX * 0.157) *
          0.0035 *
          (1 - sealDistance / 64) *
          fullness
        : 0;
    const logo = isBack ? 0 : logoRelief(originalX, originalY) * 0.062;
    const folds = isBack
      ? 0
      : (structuredFolds(originalX, originalY) + facetBulges(originalX, originalY)) * fullness;
    return 0.012 + fullness * 0.16 + broadDome + folds + logo * fullness + crimp;
  };
  const rows = [];
  for (let row = 0; row <= 512; row++) {
    let y = Math.round(first + ((last - first) * row) / 512);
    while (left[y] < 0 && y < last) y++;
    rows.push({ y, left: left[y], right: right[y] });
  }
  return { size, rows, heightAt };
}

function makeFaceGeometry(silhouette, isBack) {
  const { size, rows, heightAt } = silhouette;
  const columns = isBack ? 96 : 256;
  const positions = [];
  const uv = [];
  const indices = [];
  const leftEdge = [];
  const rightEdge = [];
  for (const row of rows) {
    const y = 2 - ((row.y + 0.5) / size) * 4;
    for (let col = 0; col <= columns; col++) {
      const blend = (1 - Math.cos((Math.PI * col) / columns)) / 2;
      const px = row.left + (row.right - row.left) * blend;
      const x = ((px + 0.5) / size) * 4 - 2;
      const z = heightAt(px, row.y, isBack);
      positions.push(x, y, (isBack ? -1 : 1) * z);
      const u = (px + 0.5) / size;
      uv.push(isBack ? 1 - u : u, 1 - (row.y + 0.5) / size);
      if (col === 0) leftEdge.push({ x, y, z });
      if (col === columns) rightEdge.push({ x, y, z });
    }
  }
  for (let row = 0; row < rows.length - 1; row++) {
    for (let col = 0; col < columns; col++) {
      const a = row * (columns + 1) + col;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      if (isBack) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, outline: [...leftEdge, ...rightEdge.reverse()] };
}

function makeSideGeometry(outline) {
  const positions = [];
  const indices = [];
  const ring = 4;
  for (let i = 0; i < outline.length; i++) {
    const point = outline[i];
    const previous = outline[(i - 1 + outline.length) % outline.length];
    const next = outline[(i + 1) % outline.length];
    const tx = next.x - previous.x;
    const ty = next.y - previous.y;
    const tangentLength = Math.hypot(tx, ty) || 1;
    const outwardX = ty / tangentLength;
    const outwardY = -tx / tangentLength;
    const seam = Math.min(0.006, point.z * 0.4);
    for (let band = 0; band < ring; band++) {
      const offset = band === 1 || band === 2 ? 0.005 : 0;
      const z = [point.z, seam, -seam, -point.z][band];
      positions.push(
        point.x + outwardX * offset,
        point.y + outwardY * offset,
        z,
      );
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    for (let band = 0; band < ring - 1; band++) {
      const a = i * ring + band;
      const b = next * ring + band;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeSignatureBackTexture(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(image, 0, 0);
  context.resetTransform();
  const plate = context.createLinearGradient(559, 558, 929, 685);
  plate.addColorStop(0, "rgba(10, 7, 23, .98)");
  plate.addColorStop(1, "rgba(35, 14, 54, .96)");
  context.beginPath();
  context.roundRect(559, 558, 370, 124, 14);
  context.fillStyle = plate;
  context.fill();
  context.strokeStyle = "rgba(245, 194, 94, .8)";
  context.lineWidth = 2;
  context.stroke();
  context.shadowColor = "rgba(0, 0, 0, .75)";
  context.shadowBlur = 8;
  context.fillStyle = "#f5c76f";
  context.font = "bold 48px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("ONEPERCENT", 744, 617, 340);
  context.shadowBlur = 0;
  context.font = "bold 23px Arial, sans-serif";
  context.letterSpacing = "4px";
  context.fillText("RIP. REVEAL. OWN.", 744, 655, 315);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

export class PackTurntable {
  constructor({
    container,
    assetsBase = "/assets/",
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
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.setClearColor(0, 0);
    this.renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;";
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute(
      "aria-label",
      "A sealed holographic Signature 1% pack rotating to reveal its gold mark, folded edge and branded back.",
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
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.invalidate();
    };
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();

    const base = assetsBase.endsWith("/") ? assetsBase : `${assetsBase}/`;
    const loader = new THREE.TextureLoader();
    this.ready = Promise.all([
      loader.loadAsync(`${base}pack-closed.png`),
      loader.loadAsync(`${base}pack-back.png`).catch(() => null),
    ])
      .then(([frontTexture, backPhotoTexture]) => {
        if (this.destroyed) {
          frontTexture.dispose();
          backPhotoTexture?.dispose();
          return;
        }
        frontTexture.colorSpace = THREE.SRGBColorSpace;
        frontTexture.anisotropy = Math.min(
          this.renderer.capabilities.getMaxAnisotropy(),
          16,
        );
        const backImage = backPhotoTexture?.image;
        const backTexture = makeSignatureBackTexture(backImage || frontTexture.image);
        backPhotoTexture?.dispose();
        this.textures = [frontTexture, backTexture];
        const frontMaterial = new THREE.MeshPhysicalMaterial({
          map: frontTexture,
          metalness: 0.62,
          roughness: 0.28,
          clearcoat: 0.18,
          clearcoatRoughness: 0.24,
          alphaTest: 0.08,
          side: THREE.FrontSide,
        });
        const backMaterial = new THREE.MeshPhysicalMaterial({
          map: backTexture,
          metalness: 0.62,
          roughness: 0.28,
          clearcoat: 0.18,
          clearcoatRoughness: 0.24,
          alphaTest: 0.08,
          side: THREE.FrontSide,
        });
        const sideMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xb5a9dd,
          metalness: 0.94,
          roughness: 0.2,
          clearcoat: 0.28,
          clearcoatRoughness: 0.18,
          side: THREE.DoubleSide,
        });
        this.materials = [frontMaterial, backMaterial, sideMaterial];
        const silhouette = makeSilhouette(frontTexture.image);
        const frontShape = makeFaceGeometry(silhouette, false);
        const backShape = makeFaceGeometry(silhouette, true);
        const front = new THREE.Mesh(frontShape.geometry, frontMaterial);
        const back = new THREE.Mesh(backShape.geometry, backMaterial);
        const side = new THREE.Mesh(
          makeSideGeometry(frontShape.outline),
          sideMaterial,
        );
        front.name = "Printed front";
        back.name = "Branded reverse";
        side.name = "Sealed foil edge";
        this.meshes = [front, back, side];
        this.meshes.forEach((mesh) => this.asset.group.add(mesh));
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
    this.progress = clamp(value);
    this.asset.group.rotation.y = this.reducedMotion ? 0 : this.progress * TAU;
    this.asset.group.rotation.z = this.reducedMotion
      ? 0
      : Math.sin(this.progress * TAU) * 0.027;
    this.invalidate();
  }

  invalidate() {
    if (this.destroyed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.destroyed) this.renderer.render(this.scene, this.camera);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.meshes?.forEach((mesh) => mesh.geometry.dispose());
    this.materials?.forEach((material) => material.dispose());
    this.textures?.forEach((texture) => texture.dispose());
    this.environmentTarget?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete this.container.dataset.ready;
  }
}
