"""Home image derivatives (WebP + AVIF, sized for DPR 2) into
app/apps/web/public/experience/home/. Pillow >= 11.3 with WebP and AVIF.

    python3 app/apps/web/src/experience/home/tools/make-assets.py
        Studio, packs, Pepe and foil swatches, from the landing's lossless sources
        (public/assets/*.png at the repository root, unchanged) and the My cards
        lab's foil crops (experience/cards-lab/public/assets/foil, read only; the labs
        sit next to the repository, override with LAB_ROOT).

    python3 app/apps/web/src/experience/home/tools/make-assets.py poster <tv-poster.png>
        The TV poster (the hero's LCP image) at 640/768/960/1440 w, from
        tools/render-tv.mjs poster.

    python3 app/apps/web/src/experience/home/tools/make-assets.py screen <crt-screen.png>
        The CRT screen texture as WebP q88 next to the PNG, for tools/patch-crt-glb.mjs.

    python3 app/apps/web/src/experience/home/tools/make-assets.py film
        The film player's CSS TV screen (no WebGL): the landing's crt-screen.png
        as crt-screen-1536.webp. The film itself is synced, not converted
        (scripts/sync-landing-assets.mjs).
"""
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../../../../../.."))
SRC = os.path.join(REPO, "public/assets")
OUT = os.path.abspath(os.path.join(HERE, "../../../../public/experience/home"))
LAB_ROOT = os.environ.get("LAB_ROOT", os.path.join(REPO, "../experience"))
os.makedirs(OUT, exist_ok=True)


def save(img, name, webp_q, avif_q):
    img.save(os.path.join(OUT, name + ".webp"), "WEBP", quality=webp_q, method=6, alpha_quality=100)
    img.save(os.path.join(OUT, name + ".avif"), "AVIF", quality=avif_q, speed=4)


def widths(path, name, sizes, webp_q, avif_q, crop=None):
    im = Image.open(path)
    im = im.convert("RGBA" if im.mode == "RGBA" else "RGB")
    if crop:
        im = im.crop(crop)
    for w in sizes:
        h = round(im.height * w / im.width)
        save(im.resize((w, h), Image.LANCZOS), f"{name}-{w}", webp_q, avif_q)


mode = sys.argv[1] if len(sys.argv) > 1 else "landing"
if mode == "poster":
    widths(sys.argv[2], "tv", [640, 768, 960, 1440], 84, 60)
elif mode == "film":
    screen = Image.open(os.path.join(SRC, "crt-screen.png")).convert("RGB")
    screen.save(os.path.join(OUT, "crt-screen-1536.webp"), "WEBP", quality=84, method=6)
elif mode == "screen":
    png = sys.argv[2]
    Image.open(png).convert("RGB").save(os.path.splitext(png)[0] + ".webp", "WEBP", quality=88, method=6)
else:
    # Studio backdrop: a soft photo, so moderate sizes and quality are invisible losses.
    studio = os.path.join(SRC, "hero-studio-clean.png")
    widths(studio, "studio", [960, 1440, 1672], 62, 50)
    # Portrait crop for phones: the darker wall left of the window light (cream text reads best).
    widths(studio, "studio-portrait", [560], 66, 52, crop=(300, 0, 865, 941))
    # The four editions (DA §1 finishes), and Pepe.
    for src, ed in [("pack-silver.png", "original"), ("pack-first-light.png", "blue_shift"),
                    ("pack-closed.png", "signature"), ("pack-anthracite.png", "after_hours")]:
        widths(os.path.join(SRC, src), f"pack-{ed}", [440, 720], 84, 60)
    widths(os.path.join(SRC, "pepe-mascot-white.png"), "pepe", [360, 720], 84, 60)
    # Foil swatches for the My cards step: the cards lab's crops of the pack foils
    # (DA §17 item 3), resized.
    foil = os.path.join(LAB_ROOT, "cards-lab/public/assets/foil")
    for tier in ["silver", "blue", "holo"]:
        im = Image.open(os.path.join(foil, f"{tier}.webp")).convert("RGB")
        save(im.resize((240, round(im.height * 240 / im.width)), Image.LANCZOS), f"card-{tier}-240", 82, 58)
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)))
