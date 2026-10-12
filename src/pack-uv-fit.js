const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

function alphaAt(image, x, y) {
  const { data, width, height } = image;
  x = clamp(x, 0, width - 1);
  y = clamp(y, 0, height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0, fy = y - y0;
  const a = (px, py) => data[(py * width + px) * 4 + 3];
  return (a(x0, y0) * (1 - fx) + a(x1, y0) * fx) * (1 - fy)
    + (a(x0, y1) * (1 - fx) + a(x1, y1) * fx) * fy;
}

function envelope(image, threshold) {
  const { width, height, data } = image;
  if (!width || !height || data.length !== width * height * 4) {
    throw new TypeError('Pack artwork must be a non-empty RGBA image.');
  }
  const left = new Float32Array(height).fill(-1);
  const right = new Float32Array(height).fill(-1);
  let first = height, last = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < threshold) continue;
      if (left[y] < 0) left[y] = x;
      right[y] = x;
    }
    if (left[y] >= 0) { first = Math.min(first, y); last = y; }
  }
  if (last < first) throw new RangeError('Pack artwork has no opaque silhouette.');
  // Interpolate missing scanlines so a tiny detached crimp tip does not divide
  // the pouch into separate vertical coordinate systems.
  let previous = first;
  for (let y = first + 1; y <= last; y++) {
    if (left[y] < 0) continue;
    for (let gap = previous + 1; gap < y; gap++) {
      const t = (gap - previous) / (y - previous);
      left[gap] = left[previous] + (left[y] - left[previous]) * t;
      right[gap] = right[previous] + (right[y] - right[previous]) * t;
    }
    previous = y;
  }
  return { left, right, first, last };
}

function rowBounds(profile, y) {
  y = clamp(y, profile.first, profile.last);
  const a = Math.floor(y), b = Math.min(a + 1, profile.last), fraction = y - a;
  return [
    profile.left[a] * (1 - fraction) + profile.left[b] * fraction,
    profile.right[a] * (1 - fraction) + profile.right[b] * fraction,
  ];
}

function nearestInk(image, x, y, bounds, threshold) {
  if (alphaAt(image, x, y) >= threshold) return x;
  // Small gaps between crimp teeth can occur inside a row's outer envelope.
  // Project onto the nearest printed point without reversing the row order.
  const lower = Math.max(0, Math.floor(bounds[0]));
  const upper = Math.min(image.width - 1, Math.ceil(bounds[1]));
  let left = Math.floor(x), right = Math.ceil(x);
  while (left >= lower || right <= upper) {
    const useLeft = right > upper || (left >= lower && x - left <= right - x);
    const candidate = useLeft ? left-- : right++;
    if (alphaAt(image, candidate, y) >= threshold) return candidate;
  }
  return x;
}

/**
 * Fit a native edition image to the canonical foil mesh without changing its
 * geometry or either image. UV v is bottom-origin: native pixel y=(1-v)*h-.5.
 * The printed rows retain their order; transparent margins never stretch over
 * the physical foil. Return a new Float32Array, leaving the canonical UVs intact.
 */
export function fitPackUVs(nativeUVs, canonicalRGBA, editionRGBA, { alphaThreshold = 64, edgeInset = 1 } = {}) {
  if (!nativeUVs || nativeUVs.length % 2) throw new TypeError('Expected interleaved UV coordinates.');
  const from = envelope(canonicalRGBA, alphaThreshold);
  const to = envelope(editionRGBA, alphaThreshold);
  return remapPackUVs(nativeUVs, canonicalRGBA, editionRGBA, from, to, alphaThreshold, edgeInset);
}

function remapPackUVs(nativeUVs, canonicalRGBA, editionRGBA, from, to, alphaThreshold, edgeInset) {
  const mapped = new Float32Array(nativeUVs.length);
  for (let i = 0; i < nativeUVs.length; i += 2) {
    const sourceX = nativeUVs[i] * canonicalRGBA.width - .5;
    const sourceY = (1 - nativeUVs[i + 1]) * canonicalRGBA.height - .5;
    const t = clamp((sourceY - from.first) / Math.max(1, from.last - from.first), 0, 1);
    const targetY = to.first + t * (to.last - to.first);
    const sourceBounds = rowBounds(from, sourceY);
    const targetBounds = rowBounds(to, targetY);
    const across = clamp((sourceX - sourceBounds[0]) / Math.max(1, sourceBounds[1] - sourceBounds[0]), 0, 1);
    const inset = Math.min(edgeInset, (targetBounds[1] - targetBounds[0]) / 4);
    const targetX = targetBounds[0] + inset + across * (targetBounds[1] - targetBounds[0] - inset * 2);
    const inkX = nearestInk(editionRGBA, targetX, targetY, targetBounds, alphaThreshold);
    mapped[i] = (inkX + .5) / editionRGBA.width;
    mapped[i + 1] = 1 - (targetY + .5) / editionRGBA.height;
  }
  return mapped;
}

function readRGBA(image) {
  if (image.data && image.width && image.height) return image;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

/** One fitter per carousel: keep canonical native artwork, cache by edition id. */
export function createPackUVFitter(nativeUVs, canonicalImage, options) {
  const canonicalRGBA = readRGBA(canonicalImage);
  const cache = new Map();
  return (editionId, editionImage) => {
    if (!cache.has(editionId)) cache.set(editionId, fitPackUVs(nativeUVs, canonicalRGBA, readRGBA(editionImage), options));
    return cache.get(editionId);
  };
}

/** Fit the shell to the artwork as well as its UVs. Moving only UVs stretches
 * the printed logo onto a different edition's silhouette. The original asset
 * uses a four-unit native image plane; matching XY to UV preserves every
 * printed feature's native aspect ratio, while Z keeps the closed foil volume.
 */
export function createPackShapeFitter(canonicalImage) {
  const canonical = readRGBA(canonicalImage);
  const from = envelope(canonical, 64);
  const editions = new WeakMap();
  return (nativePositions, editionImage) => {
    if (!editions.has(editionImage)) {
      const rgba = readRGBA(editionImage);
      editions.set(editionImage, { rgba, profile: envelope(rgba, 64) });
    }
    const edition = editions.get(editionImage);
    const nativeUVs = new Float32Array(nativePositions.length / 3 * 2);
    for (let i = 0; i < nativePositions.length / 3; i++) {
      nativeUVs[i * 2] = nativePositions[i * 3] / 4 + .5;
      nativeUVs[i * 2 + 1] = nativePositions[i * 3 + 1] / 4 + .5;
    }
    const uv = remapPackUVs(nativeUVs, canonical, edition.rgba, from, edition.profile, 64, 0);
    const positions = new Float32Array(nativePositions);
    for (let i = 0; i < uv.length / 2; i++) {
      positions[i * 3] = (uv[i * 2] - .5) * 4;
      positions[i * 3 + 1] = (uv[i * 2 + 1] - .5) * 4;
    }
    return { positions, uv };
  };
}
