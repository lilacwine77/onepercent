"""Rip tap: after the press, the app leaves a gold focus ring round the vanished
Rip button for about 20 frames. This writes copies of those frames without it.

  python3 ringfix.py <cap/mobile> <first> <last>

Per frame, in the band where the ring can be (capture CSS y 596-712): the
floor is estimated by a separable median (61 px along x, then 25 px along y,
device px), which a thin line does not survive; pixels whose yellowness
((R+G)/2 - B) stands above that floor (and whose floor is the pink stage, not
the machine's gold) are replaced by the floor estimate, with a soft edge.
Lossless WebP into <cap/mobile>/rip-fix/ (the compositor reads those frames).
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, gaussian_filter, median_filter

D = 2.5
src, first, last = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
out = os.path.join(src, "rip-fix")
os.makedirs(out, exist_ok=True)
Y0, Y1 = int(596 * D), int(712 * D)


def floor_of(a):
    return median_filter(median_filter(a, size=(1, 61), mode="nearest"), size=(25, 1), mode="nearest")


for n in range(first, last + 1):
    im = np.asarray(Image.open(os.path.join(src, "rip-tap", f"{n:05d}.webp")).convert("RGB")).astype(np.float64)
    band = im[Y0:Y1]
    yel = (band[..., 0] + band[..., 1]) / 2 - band[..., 2]
    yel_f = floor_of(yel)
    excess = yel - yel_f
    mask = (excess > 3.0) & (yel_f > 2) & (yel_f < 30)
    # Keep the mask to the ring's own outline (a band round its edges), so the
    # dock's fading text inside and around it is never touched.
    strong = excess > max(8.0, 0.45 * float(excess.max()))
    rows = np.where(strong.sum(1) > 120)[0]
    if len(rows):
        top, bot = rows.min(), rows.max()
        cols = np.where(strong[top:bot + 1].sum(0) > 0.3 * (bot - top + 1))[0]
        left = cols.min() if len(cols) and cols.min() < im.shape[1] * 0.2 else None
        right = cols.max() if len(cols) and cols.max() > im.shape[1] * 0.8 else None
        band_m = np.zeros_like(mask)
        e, r = 10, 70  # band half-width and corner size (device px)
        x0 = 0 if left is None else max(0, left - e)
        x1 = im.shape[1] if right is None else min(im.shape[1], right + e + 1)
        band_m[max(0, top - e):top + e + 1, x0:x1] = True
        band_m[max(0, bot - e):bot + e + 1, x0:x1] = True
        # The ring's ends sit at the frame's sides (or beyond): side bands.
        band_m[max(0, top - e):bot + e + 1, :100] = True
        band_m[max(0, top - e):bot + e + 1, -100:] = True
        for c in [v for v in (left, right) if v is not None]:
            band_m[max(0, top - e):bot + e + 1, max(0, c - e):c + e + 1] = True
            cs = slice(max(0, c - e), min(im.shape[1], c + r)) if c == left else slice(max(0, c - r), c + e + 1)
            band_m[max(0, top - e):top + r, cs] = True
            band_m[max(0, bot - r):bot + e + 1, cs] = True
        mask &= band_m
    mask = binary_dilation(mask, iterations=2)
    soft = np.clip(gaussian_filter(mask.astype(np.float64), 1.2) * 1.6, 0, 1)[..., None]
    floor = np.stack([floor_of(band[..., c]) for c in range(3)], -1)
    fixed = im.copy()
    fixed[Y0:Y1] = band * (1 - soft) + floor * soft
    Image.fromarray(np.clip(fixed + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(out, f"{n:05d}.webp"), lossless=True, quality=60, method=4)
    print(f"{n} masked {int(mask.sum())} px, max excess {float((yel - yel_f).max()):.1f}")
