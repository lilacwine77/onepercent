"""MP4 helpers without ffmpeg: faststart (moov before mdat) and a probe.

  python3 scripts/film/mp4tool.py faststart in.mp4 out.mp4
  python3 scripts/film/mp4tool.py probe film.mp4 [--json]

faststart rewrites the chunk offsets (stco/co64) and moves the moov box ahead
of mdat, like qt-faststart. probe reports the container layout, duration, the
video track (codec, H.264 profile/level, size, frame count, frame rate, color
tags) and the audio track (codec, rate, channels), plus the bitrates.
"""
import json
import struct
import sys

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"dinf", b"udta", b"mvex"}


def boxes(data, start=0, end=None):
    end = len(data) if end is None else end
    pos = start
    while pos + 8 <= end:
        size, kind = struct.unpack(">I4s", data[pos : pos + 8])
        header = 8
        if size == 1:
            size = struct.unpack(">Q", data[pos + 8 : pos + 16])[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header:
            break
        yield kind, pos, size, header
        pos += size


def find(data, path, start=0, end=None):
    """All boxes matching a path like [b'moov', b'trak']."""
    out = []
    for kind, pos, size, header in boxes(data, start, end):
        if kind == path[0]:
            if len(path) == 1:
                out.append((pos, size, header))
            else:
                out.extend(find(data, path[1:], pos + header, pos + size))
    return out


def faststart(src, dst):
    data = bytearray(open(src, "rb").read())
    top = list(boxes(data))
    kinds = [k for k, *_ in top]
    if b"moov" not in kinds or b"mdat" not in kinds:
        raise SystemExit("not an mp4 with moov and mdat")
    moov_i, mdat_i = kinds.index(b"moov"), kinds.index(b"mdat")
    if moov_i < mdat_i:
        open(dst, "wb").write(data)
        return "already faststart"
    _, mpos, msize, _ = top[moov_i]
    moov = bytearray(data[mpos : mpos + msize])
    shift = msize
    # Patch chunk offsets inside the moov copy.
    def patch(buf, start, end):
        for kind, pos, size, header in boxes(buf, start, end):
            if kind in CONTAINERS:
                patch(buf, pos + header, pos + size)
            elif kind == b"stco":
                count = struct.unpack(">I", buf[pos + 12 : pos + 16])[0]
                for i in range(count):
                    o = pos + 16 + 4 * i
                    value = struct.unpack(">I", buf[o : o + 4])[0] + shift
                    if value > 0xFFFFFFFF:
                        raise SystemExit("offset overflow: needs co64")
                    buf[o : o + 4] = struct.pack(">I", value)
            elif kind == b"co64":
                count = struct.unpack(">I", buf[pos + 12 : pos + 16])[0]
                for i in range(count):
                    o = pos + 16 + 8 * i
                    buf[o : o + 8] = struct.pack(">Q", struct.unpack(">Q", buf[o : o + 8])[0] + shift)

    patch(moov, 8, len(moov))
    out = bytearray()
    for i, (kind, pos, size, header) in enumerate(top):
        if i == moov_i:
            continue
        if i == mdat_i:
            out += moov
        out += data[pos : pos + size]
    open(dst, "wb").write(out)
    return "moved moov before mdat"


def full_box(data, pos, header):
    version = data[pos + header]
    return version, pos + header + 4


def probe(path):
    data = open(path, "rb").read()
    info = {"file": path, "bytes": len(data), "top_level": [k.decode("latin-1") for k, *_ in boxes(data)]}
    kinds = info["top_level"]
    info["faststart"] = "moov" in kinds and "mdat" in kinds and kinds.index("moov") < kinds.index("mdat")
    (mvhd_pos, mvhd_size, mvhd_h), = find(data, [b"moov", b"mvhd"])
    v, p = full_box(data, mvhd_pos, mvhd_h)
    if v == 1:
        timescale, duration = struct.unpack(">IQ", data[p + 16 : p + 28])
    else:
        timescale, duration = struct.unpack(">II", data[p + 8 : p + 16])
    info["duration_s"] = round(duration / timescale, 4)
    info["tracks"] = []
    for tpos, tsize, th in find(data, [b"moov", b"trak"]):
        track = {}
        (hpos, hsize, hh), = find(data, [b"mdia", b"hdlr"], tpos + th, tpos + tsize)
        track["handler"] = data[hpos + hh + 8 : hpos + hh + 12].decode("latin-1")
        (mpos, msize, mh), = find(data, [b"mdia", b"mdhd"], tpos + th, tpos + tsize)
        v, p = full_box(data, mpos, mh)
        if v == 1:
            ts, dur = struct.unpack(">IQ", data[p + 16 : p + 28])
        else:
            ts, dur = struct.unpack(">II", data[p + 8 : p + 16])
        track["timescale"] = ts
        track["duration_s"] = round(dur / ts, 4)
        stbl = find(data, [b"mdia", b"minf", b"stbl"], tpos + th, tpos + tsize)[0]
        spos, ssize, sh = stbl
        (dpos, dsize, dh), = find(data, [b"stsd"], spos + sh, spos + ssize)
        entry = dpos + dh + 8
        esize, ekind = struct.unpack(">I4s", data[entry : entry + 8])
        track["codec"] = ekind.decode("latin-1")
        (zpos, zsize, zh), = find(data, [b"stsz"], spos + sh, spos + ssize)
        sample_size, count = struct.unpack(">II", data[zpos + zh + 4 : zpos + zh + 12])
        if sample_size:
            total = sample_size * count
        else:
            sizes = struct.unpack(f">{count}I", data[zpos + zh + 12 : zpos + zh + 12 + 4 * count])
            total = sum(sizes)
            track["max_sample_bytes"] = max(sizes)
        track["samples"] = count
        track["bytes"] = total
        track["kbps"] = round(total * 8 / max(track["duration_s"], 1e-9) / 1000, 1)
        if track["handler"] == "vide":
            w, h = struct.unpack(">HH", data[entry + 32 : entry + 36])
            track["width"], track["height"] = w, h
            track["fps"] = round(count / track["duration_s"], 3) if track["duration_s"] else None
            for kind, pos, size, header in boxes(data, entry + 86, entry + esize):
                if kind == b"avcC":
                    c = data[pos + header : pos + size]
                    profile = {66: "Baseline", 77: "Main", 100: "High", 110: "High 10", 122: "High 4:2:2"}.get(c[1], str(c[1]))
                    track["profile"] = profile
                    track["level"] = c[3] / 10
                if kind == b"colr":
                    c = data[pos + header : pos + size]
                    if c[:4] in (b"nclx", b"nclc"):
                        prim, trc, matrix = struct.unpack(">HHH", c[4:10])
                        track["colr"] = {"primaries": prim, "transfer": trc, "matrix": matrix, "full_range": bool(c[10] >> 7) if len(c) > 10 else None}
            # Keyframes (stss) and composition offsets.
            stss = find(data, [b"stss"], spos + sh, spos + ssize)
            if stss:
                p0, s0, h0 = stss[0]
                track["keyframes"] = struct.unpack(">I", data[p0 + h0 + 4 : p0 + h0 + 8])[0]
        if track["handler"] == "soun":
            ch, bits = struct.unpack(">HH", data[entry + 24 : entry + 28])
            rate = struct.unpack(">I", data[entry + 32 : entry + 36])[0] >> 16
            track["channels"], track["sample_rate"] = ch, rate
        info["tracks"].append(track)
    info["total_kbps"] = round(len(data) * 8 / info["duration_s"] / 1000, 1)
    return info


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "faststart":
        print(faststart(sys.argv[2], sys.argv[3]))
    elif cmd == "probe":
        result = probe(sys.argv[2])
        print(json.dumps(result, indent=1))
