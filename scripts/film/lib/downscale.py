"""Frame finisher for the film renderer (reads jobs on stdin, one per line).

  frame <dst.png> <width> <height> <src1.png> [<src2.png> ...]

Averages the sources (temporal supersampling for motion blur), resizes them
with Lanczos to the output size (spatial supersampling: the compositor renders
at 2x), writes an RGB PNG and deletes the sources. Prints "ok <dst>" per job.
"""
import os
import sys

import numpy as np
from PIL import Image


def finish(dst, width, height, sources):
    acc = None
    for src in sources:
        with Image.open(src) as im:
            arr = np.asarray(im.convert("RGB"), dtype=np.float32)
        acc = arr if acc is None else acc + arr
    acc /= len(sources)
    # Average in linear light would be more physical; sRGB averaging matches
    # what a camera shutter looks like on screen closely enough for 2-6 samples.
    image = Image.fromarray(np.clip(acc + 0.5, 0, 255).astype(np.uint8))
    if image.size != (width, height):
        image = image.resize((width, height), Image.LANCZOS)
    tmp = dst + ".tmp.png"
    image.save(tmp, compress_level=1)
    os.replace(tmp, dst)
    for src in sources:
        try:
            os.remove(src)
        except OSError:
            pass


def main():
    for line in sys.stdin:
        parts = line.strip().split("\t")
        if not parts or parts[0] != "frame":
            continue
        dst, width, height = parts[1], int(parts[2]), int(parts[3])
        finish(dst, width, height, parts[4:])
        sys.stdout.write("ok " + dst + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
