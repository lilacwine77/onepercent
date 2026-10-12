"""Blurred placeholders for the large art, for styles.css --lqip-*.

    python3 app/apps/web/scripts/lqip.py

While a large image downloads and decodes, its box shows this tiny copy of it
(24 px on the long side, WebP with alpha, inline), blurred by CSS; the image fades
in over it only once decoded (main.tsx), so a half-painted image never shows.
Prints one custom property per image. Pillow with WebP.
"""
import base64
import io
import os

from PIL import Image

PUBLIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../public/experience")
SOURCES = {
    "tv": "home/tv-640.webp",
    "machine": "rip/machine-poster.webp",
    "machine-portrait": "rip/machine-poster-portrait.webp",
    "pack-original": "home/pack-original-440.webp",
    "pack-blue_shift": "home/pack-blue_shift-440.webp",
    "pack-signature": "home/pack-signature-440.webp",
    "pack-after_hours": "home/pack-after_hours-440.webp",
    "pepe": "home/pepe-360.webp",
}

for name, path in SOURCES.items():
    image = Image.open(os.path.join(PUBLIC, path)).convert("RGBA")
    scale = 24 / max(image.size)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    buffer = io.BytesIO()
    image.resize(size, Image.LANCZOS).save(buffer, "WEBP", quality=45, method=6, alpha_quality=60)
    data = base64.b64encode(buffer.getvalue()).decode()
    print(f'--lqip-{name}: url("data:image/webp;base64,{data}");')
