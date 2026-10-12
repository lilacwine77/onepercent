"""Encodes the film with Blender's bundled FFmpeg (libx264 + AAC). Run with Blender:

  Blender --background --factory-startup --python scripts/film/encode.py -- \
      --frames <dir of 00000.png...> --audio mix.wav --out film.mp4 \
      --width 1280 --height 720 --fps 60 --crf 20 [--maxrate 4500]

The Mac has no ffmpeg; Blender's video output links FFmpeg with x264, so the
sequencer turns the PNG frames and the WAV mix into H.264 High + AAC. Colour
management is pass-through (sRGB in, "Standard" view). Run faststart.py after.
"""
import argparse
import os
import re
import sys

import bpy


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--audio", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, required=True)
    ap.add_argument("--height", type=int, required=True)
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--crf", type=int, default=20)
    ap.add_argument("--maxrate", type=int, default=0, help="kbit/s VBV cap (0 = none)")
    ap.add_argument("--gop", type=int, default=120)
    ap.add_argument("--audio-kbps", type=int, default=160)
    args = ap.parse_args(argv)

    files = sorted(f for f in os.listdir(args.frames) if re.fullmatch(r"\d{5}\.png", f))
    if not files:
        raise SystemExit("no frames")

    scene = bpy.context.scene
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
    scene.render.fps = args.fps
    scene.render.fps_base = 1
    scene.frame_start = 1
    scene.frame_end = len(files)
    # Pass-through colour: the frames are display-referred sRGB already.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.display_settings.display_device = "sRGB"
    scene.sequencer_colorspace_settings.name = "sRGB"

    seq = scene.sequence_editor_create()
    strips = seq.strips if hasattr(seq, "strips") else seq.sequences
    image = strips.new_image(name="frames", filepath=os.path.join(args.frames, files[0]), channel=1, frame_start=1)
    for name in files[1:]:
        image.elements.append(name)
    image.colorspace_settings.name = "sRGB"
    if args.audio:
        sound = strips.new_sound(name="mix", filepath=args.audio, channel=2, frame_start=1)
        sound.volume = 1.0

    r = scene.render
    r.use_sequencer = True
    r.use_compositing = False
    if hasattr(r.image_settings, "media_type"):  # Blender 4.5+
        r.image_settings.media_type = "VIDEO"
    r.image_settings.file_format = "FFMPEG"
    ff = r.ffmpeg
    ff.format = "MPEG4"
    ff.codec = "H264"
    ff.constant_rate_factor = "CUSTOM"
    ff.custom_constant_rate_factor = args.crf
    ff.ffmpeg_preset = "BEST"
    ff.gopsize = args.gop
    ff.use_max_b_frames = True
    ff.max_b_frames = 3
    if args.maxrate:
        ff.maxrate = args.maxrate
        ff.buffersize = args.maxrate * 2
    ff.audio_codec = "AAC" if args.audio else "NONE"
    ff.audio_bitrate = args.audio_kbps
    ff.audio_channels = "STEREO"
    ff.audio_mixrate = 48000
    ff.audio_volume = 1.0
    r.filepath = args.out
    r.use_file_extension = False
    bpy.ops.render.render(animation=True)
    print("ENCODED", args.out, os.path.getsize(args.out))


main()
