import sharp from "sharp";

/** Projective map from the unit square to a photographed quadrilateral. */
function squareToQuad(quad) {
  const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    rows = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = uv[i],
      [x, y] = quad[i];
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let i = col + 1; i < 8; i++)
      if (Math.abs(rows[i][col]) > Math.abs(rows[pivot][col])) pivot = i;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = rows[col][col];
    if (Math.abs(scale) < 1e-8)
      throw new Error("Degenerate screen quadrilateral");
    for (let j = col; j <= 8; j++) rows[col][j] /= scale;
    for (let i = 0; i < 8; i++)
      if (i !== col) {
        const factor = rows[i][col];
        for (let j = col; j <= 8; j++) rows[i][j] -= factor * rows[col][j];
      }
  }
  return rows.map((row) => row[8]);
}

/** Rectification reads compositor pixels; no material or texture is changed. */
export async function rectifyScreen(image, quad, width = 128, height = 96) {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const h = squareToQuad(quad),
    result = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height,
        den = h[6] * u + h[7] * v + 1;
      const sx = (h[0] * u + h[1] * v + h[2]) / den,
        sy = (h[3] * u + h[4] * v + h[5]) / den;
      const ix = Math.max(0, Math.min(info.width - 2, Math.floor(sx))),
        iy = Math.max(0, Math.min(info.height - 2, Math.floor(sy)));
      const fx = Math.max(0, Math.min(1, sx - ix)),
        fy = Math.max(0, Math.min(1, sy - iy));
      for (let c = 0; c < 3; c++) {
        const at = (yy, xx) => data[(yy * info.width + xx) * 3 + c];
        result[(y * width + x) * 3 + c] =
          (at(iy, ix) * (1 - fx) + at(iy, ix + 1) * fx) * (1 - fy) +
          (at(iy + 1, ix) * (1 - fx) + at(iy + 1, ix + 1) * fx) * fy;
      }
    }
  return {
    pixels: result,
    width,
    height,
    png: await sharp(result, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
  };
}

export function pixelBlendEstimate(pixels, film, pepe) {
  let numerator = 0,
    denominator = 0,
    errorFilm = 0,
    errorPepe = 0,
    luminance = 0;
  for (let i = 0; i < pixels.length; i++) {
    const direction = film[i] - pepe[i];
    numerator += (pixels[i] - pepe[i]) * direction;
    denominator += direction * direction;
    errorFilm += Math.abs(pixels[i] - film[i]);
    errorPepe += Math.abs(pixels[i] - pepe[i]);
    luminance += pixels[i];
  }
  const mix = denominator ? numerator / denominator : 0;
  let residual = 0;
  for (let i = 0; i < pixels.length; i++)
    residual += Math.abs(pixels[i] - (pepe[i] + mix * (film[i] - pepe[i])));
  return {
    filmContribution: mix,
    maeToFilm: errorFilm / pixels.length,
    maeToPepe: errorPepe / pixels.length,
    meanChannel: luminance / pixels.length,
    blendResidual: residual / pixels.length,
  };
}

export async function bezelPixels(image, bounds) {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const b = bounds,
    centers = [
      [b.left - 6, b.top + b.height * 0.5],
      [b.left + b.width + 6, b.top + b.height * 0.5],
      [b.left + b.width * 0.5, b.top - 6],
      [b.left + b.width * 0.5, b.top + b.height + 6],
    ];
  return centers.map(([cx, cy]) => {
    let count = 0;
    for (
      let y = Math.max(0, Math.round(cy) - 12);
      y < Math.min(info.height, Math.round(cy) + 12);
      y++
    )
      for (
        let x = Math.max(0, Math.round(cx) - 12);
        x < Math.min(info.width, Math.round(cx) + 12);
        x++
      ) {
        const i = (y * info.width + x) * 4,
          r = data[i],
          g = data[i + 1],
          blue = data[i + 2];
        if (
          r > 90 &&
          g > 85 &&
          blue > 75 &&
          Math.abs(r - g) < 28 &&
          Math.abs(g - blue) < 25
        )
          count++;
      }
    return count;
  });
}
