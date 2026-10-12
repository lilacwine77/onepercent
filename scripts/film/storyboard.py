"""One key frame per beat, as a labelled storyboard sheet (PNG).

  python3 scripts/film/storyboard.py <frames dir> <out.png> [--vertical]

Reads the final rendered frames (00000.png ...) at the beats' key times.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BEATS = [
    (2.6, "0.0-3.5  Your bags are dust."),
    (5.3, "3.5-6.0  Feed the machine."),
    (7.4, "6.0-8.0  pays up to 0.02 SOL when pulled"),
    (8.15, "8.0  Rip a pack. (0.10 SOL)"),
    (14.25, "14.0  Holo Foil 4x $WIF"),
    (18.9, "16-19.5  Sell it instantly. Or keep it in My cards."),
    (21.2, "19.5-22  Go for the 1%."),
    (24.6, "22-25  Dust in, Packs out."),
]


def main():
    frames, out = Path(sys.argv[1]), Path(sys.argv[2])
    vertical = "--vertical" in sys.argv
    tw, th = (270, 480) if vertical else (640, 360)
    cols = 4 if vertical else 2
    label_h = 34
    rows = (len(BEATS) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + label_h)), (38, 6, 46))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    for i, (t, label) in enumerate(BEATS):
        frame = frames / f"{round(t * 60):05d}.png"
        x, y = (i % cols) * tw, (i // cols) * (th + label_h)
        with Image.open(frame) as im:
            sheet.paste(im.convert("RGB").resize((tw, th), Image.LANCZOS), (x, y))
        draw.text((x + 10, y + th + 8), label, fill=(255, 241, 231), font=font)
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
