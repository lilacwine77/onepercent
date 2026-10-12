"""Rip result chip: the app counts "≈ 0.0 → 0.4 SOL if sold now" while the chip
fades in. This writes copies of those frames where the chip already reads its
real value, so the film never shows a stray number.

  python3 pillfix.py <cap/mobile> <first> <last> [ref]

ref is a frame of the settled chip (default: 72 frames after cue:hit.burst).

The chip box keeps its size while the text re-centres for each digit, so the
whole text line is replaced: per frame, measure the chip's vertical offset
(its left padding's gold profile against the settled chip's) and opacity
(that gold against the page just outside the chip), erase the text with the
chip's own local colour (left and right paddings, interpolated), and lay the
settled chip's text (frame REF) at the same offset and opacity:

  P' = P + a * (cov_now - cov(x, y - dy)) * (gold(y - dy) - ink)

cov_now is the frame's own text ink, read against B, the chip's colour without
text (a*gold + (1-a)*bg from the paddings); cov the settled text's ink and
gold the settled chip's gradient. Anything else behind the chip is kept. Lossless WebP
into <cap/mobile>/rip-fix/ (the compositor reads those frames instead).
"""
import os
import sys

import numpy as np
from PIL import Image

D = 2.5
src, first, last = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
if len(sys.argv) > 4:
    REF = int(sys.argv[4])
else:
    import json

    meta = json.load(open(os.path.join(src, "rip-tap", "clip.json")))
    REF = next(e["frame"] for e in meta["events"] if e["label"] == "cue:hit.burst") + 72
out = os.path.join(src, "rip-fix")
os.makedirs(out, exist_ok=True)


def load(n):
    return np.asarray(Image.open(os.path.join(src, "rip-tap", f"{n:05d}.webp")).convert("RGB")).astype(np.float64)


def px(v):
    return int(round(v * D))


def shift_rows(arr, dy):
    """Rows of `arr` (first axis) moved down by dy device px (linear interpolation)."""
    n = arr.shape[0]
    idx = np.arange(n) - dy
    i0 = np.clip(np.floor(idx).astype(int), 0, n - 1)
    i1 = np.clip(i0 + 1, 0, n - 1)
    f = (idx - np.floor(idx)).reshape((-1,) + (1,) * (arr.ndim - 1))
    return arr[i0] * (1 - f) + arr[i1] * f


ref = load(REF)
INK = np.array([38.0, 6.0, 46.0])
M = 32  # row margin (device px) for the chip's spring offset
# Settled chip (frame REF), capture CSS px: box 124.4-306.8 × 123.2-156.8, text
# 136.4-296.0 × 134.0-145.8. Text box to replace, with a margin:
TY0, TY1 = px(132.0), px(148.0)
TX0, TX1 = px(134.4), px(298.6)
PADL = (px(127.6), px(133.6))  # gold left of the text, inside the chip
PADR = (px(299.6), px(303.4))  # gold right of the text, inside the chip
OUTL = (px(113.0), px(120.0))  # page left of the chip
CHIP = (px(118.0), px(162.0))  # rows for the offset match (chip 123.2-156.8)

gold_ref = ref[:, PADL[0]:PADL[1]].mean(1)  # per-row settled gold
cov_full = np.zeros((ref.shape[0], TX1 - TX0))
cov_full[TY0 - M:TY1 + M] = np.clip(
    (gold_ref[TY0 - M:TY1 + M, None, 0] - ref[TY0 - M:TY1 + M, TX0:TX1, 0]) / (gold_ref[TY0 - M:TY1 + M, None, 0] - INK[0]), 0, 1
)
prof_ref = ref[CHIP[0] - M:CHIP[1] + M, PADL[0]:PADL[1]].mean(1)  # (rows, 3)
mid_l, mid_r = (PADL[0] + PADL[1]) / 2, (PADR[0] + PADR[1]) / 2
xs = np.clip((np.arange(TX0, TX1) - mid_l) / (mid_r - mid_l), 0, 1)[None, :, None]

for n in range(first, last + 1):
    cur = load(n)
    name = os.path.join(out, f"{n:05d}.webp")
    # Offset: the chip's left padding profile (gold, borders, corner shadow)
    # against the settled one, normalized (the chip may be translucent).
    win = cur[CHIP[0]:CHIP[1], PADL[0]:PADL[1]].mean(1)[:, 2]
    best = None
    for dy in np.arange(-30, 12.01, 0.25):
        t = shift_rows(prof_ref, dy)[M:-M][:, 2]
        a_ = t - t.mean()
        b_ = win - win.mean()
        den = np.sqrt((a_ * a_).sum() * (b_ * b_).sum())
        c = (a_ * b_).sum() / den if den > 0 else -1
        if best is None or c > best[0]:
            best = (c, dy)
    corr, dy = best
    oy = int(np.floor(dy))
    r0, r1 = TY0 + oy, TY1 + oy + 1  # frame rows covering the shifted text box
    # Opacity: the padding's colour between the page (just left of the chip)
    # and the settled gold, on the text rows (blue has the most contrast).
    pad_now = cur[r0:r1, PADL[0]:PADL[1]].mean(1)
    bg_now = cur[r0:r1, OUTL[0]:OUTL[1]].mean(1)
    gold_now = shift_rows(gold_ref, dy)[r0:r1]
    den = gold_now[:, 2] - bg_now[:, 2]
    a = float(np.clip(np.median((pad_now[:, 2] - bg_now[:, 2]) / np.where(np.abs(den) > 1, den, -1)), 0, 1))
    if corr < 0.6 or a < 0.05:
        Image.fromarray(cur.astype(np.uint8)).save(name, lossless=True, quality=60, method=4)
        print(f"{n} untouched (corr {corr:.3f}, a {a:.2f})")
        continue
    # The chip's own colour without text, per row, from both paddings.
    left = cur[r0:r1, PADL[0]:PADL[1]].mean(1)[:, None, :]
    right = cur[r0:r1, PADR[0]:PADR[1]].mean(1)[:, None, :]
    base = left * (1 - xs) + right * xs
    cov_now = shift_rows(cov_full, dy)[r0:r1]
    gold_shift = gold_now[:, None, :]
    # Differential: estimate the current text's ink from the red channel
    # (base - P = a * cov_old * (gold - ink)), remove it and add the settled
    # text's ink. Anything else in the box (confetti behind the chip) stays.
    P = cur[r0:r1, TX0:TX1]
    cov_old = np.clip((base[..., 0] - P[..., 0]) / (a * (gold_shift[..., 0] - INK[0])), 0, 1)
    patched = cur.copy()
    patched[r0:r1, TX0:TX1] = P + a * (cov_old - cov_now)[..., None] * (gold_shift - INK)
    Image.fromarray(np.clip(patched + 0.5, 0, 255).astype(np.uint8)).save(name, lossless=True, quality=60, method=4)
    print(f"{n} dy {dy / D:+.2f} css  a {a:.2f}  corr {corr:.3f}")
