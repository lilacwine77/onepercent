"""Changes the end of an encoded film without re-encoding the rest.

  python3 scripts/film/splice.py <base.mp4> <new.mp4> <out.mp4> --first-changed-frame 1320

Use it when only the end of the film changes (for example the end card).
<new> is either a full encode of the new cut (same length as <base>), or a
"tail": only the frames from the splice keyframe on, encoded with the same
settings (render those frames, then encode.py without audio). The output takes
the video samples before the splice keyframe byte for byte from <base>, the
rest from <new>, and the whole audio track from <base>, in <base>'s layout.

The splice keyframe is the last sync sample of <base> at or before the first
changed frame (for a tail, it must be where the tail starts). The script checks
that both encodes share the decoder configuration (avcC), the frame duration
and the encoder delay (edit list), that both sides of the splice are closed
GOPs, and that the samples it keeps are the same bytes as their source.
"""
import argparse
import hashlib
import struct

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"dinf", b"udta", b"mvex"}


class Box:
    def __init__(self, kind, payload=b"", children=None):
        self.kind, self.payload, self.children = kind, payload, children

    def serialize(self):
        body = b"".join(c.serialize() for c in self.children) if self.children is not None else self.payload
        return struct.pack(">I4s", 8 + len(body), self.kind) + body

    def find(self, *path):
        node = self
        for kind in path:
            node = next(c for c in node.children if c.kind == kind)
        return node

    def get(self, kind):
        return next((c for c in self.children if c.kind == kind), None)


def parse(data, start=0, end=None):
    end = len(data) if end is None else end
    out, pos = [], start
    while pos + 8 <= end:
        size, kind = struct.unpack(">I4s", data[pos : pos + 8])
        if size in (0, 1):
            raise SystemExit("64-bit or open-ended boxes are not supported")
        if kind in CONTAINERS:
            out.append(Box(kind, children=parse(data, pos + 8, pos + size)))
        else:
            out.append(Box(kind, payload=data[pos + 8 : pos + size]))
        pos += size
    return out


class Track:
    def __init__(self, data, trak):
        self.data, self.trak = data, trak
        self.stbl = trak.find(b"mdia", b"minf", b"stbl")
        p = self.stbl.get(b"stsz").payload
        size, count = struct.unpack(">II", p[4:12])
        self.sizes = [size] * count if size else list(struct.unpack(">%dI" % count, p[12 : 12 + 4 * count]))
        p = self.stbl.get(b"stco").payload
        n = struct.unpack(">I", p[4:8])[0]
        self.chunks = list(struct.unpack(">%dI" % n, p[8 : 8 + 4 * n]))
        p = self.stbl.get(b"stsc").payload
        runs = [struct.unpack(">III", p[8 + 12 * i : 20 + 12 * i]) for i in range(struct.unpack(">I", p[4:8])[0])]
        self.per_chunk = []
        for i, (first, per, _) in enumerate(runs):
            last = runs[i + 1][0] - 1 if i + 1 < len(runs) else len(self.chunks)
            self.per_chunk += [per] * (last - first + 1)
        self.samples = []
        k = 0
        for c, off in enumerate(self.chunks):
            for _ in range(self.per_chunk[c]):
                self.samples.append(data[off : off + self.sizes[k]])
                off += self.sizes[k]
                k += 1
        assert k == len(self.sizes), "stsc does not cover every sample"
        stts = self.stbl.get(b"stts").payload
        entries = [struct.unpack(">II", stts[8 + 8 * i : 16 + 8 * i]) for i in range(struct.unpack(">I", stts[4:8])[0])]
        self.deltas = sorted({d for _, d in entries})
        box = self.stbl.get(b"ctts")
        self.ctts_version = 0
        self.ctts = [0] * len(self.sizes)
        if box is not None:
            p = box.payload
            self.ctts_version = p[0]
            fmt = ">I" + ("i" if p[0] else "I")
            out = []
            for i in range(struct.unpack(">I", p[4:8])[0]):
                c, o = struct.unpack(fmt, p[8 + 8 * i : 16 + 8 * i])
                out += [o] * c
            assert len(out) == len(self.sizes), "ctts does not cover every sample"
            self.ctts = out
        stss = self.stbl.get(b"stss")
        if stss is None:
            self.sync = list(range(len(self.sizes)))
        else:
            n = struct.unpack(">I", stss.payload[4:8])[0]
            self.sync = [x - 1 for x in struct.unpack(">%dI" % n, stss.payload[8 : 8 + 4 * n])]
        elst = trak.find(b"edts", b"elst").payload
        # version 0: segment_duration (4), media_time (4), rate (4)
        self.media_time = struct.unpack(">i", elst[12:16])[0] if elst[0] == 0 else struct.unpack(">q", elst[16:24])[0]

    def avcc(self):
        stsd = self.stbl.get(b"stsd").payload
        k = stsd.find(b"avcC")
        n = struct.unpack(">I", stsd[k - 4 : k])[0]
        return stsd[k + 4 : k - 4 + n]


def handler(trak):
    return trak.find(b"mdia", b"hdlr").payload[8:12]


def ctts_payload(offsets, version):
    runs = []
    for o in offsets:
        if runs and runs[-1][1] == o:
            runs[-1][0] += 1
        else:
            runs.append([1, o])
    fmt = ">I" + ("i" if version else "I")
    return bytes([version, 0, 0, 0]) + struct.pack(">I", len(runs)) + b"".join(struct.pack(fmt, c, o) for c, o in runs)


def table(values):
    return b"\x00\x00\x00\x00" + struct.pack(">I", len(values)) + struct.pack(">%dI" % len(values), *values)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("new")
    ap.add_argument("out")
    ap.add_argument("--first-changed-frame", type=int, required=True)
    args = ap.parse_args()

    A, B = open(args.base, "rb").read(), open(args.new, "rb").read()
    ta, tb = parse(A), parse(B)
    moov_a = next(b for b in ta if b.kind == b"moov")
    moov_b = next(b for b in tb if b.kind == b"moov")
    traks_a = {handler(t): t for t in moov_a.children if t.kind == b"trak"}
    traks_b = {handler(t): t for t in moov_b.children if t.kind == b"trak"}
    va, vb = Track(A, traks_a[b"vide"]), Track(B, traks_b[b"vide"])
    au = Track(A, traks_a[b"soun"])
    n, nb = len(va.sizes), len(vb.sizes)

    checks = [
        ("avcC (SPS/PPS)", va.avcc() == vb.avcc()),
        ("constant frame duration", len(va.deltas) == 1 and va.deltas == vb.deltas),
        ("encoder delay (edit list media time)", va.media_time == vb.media_time),
        ("length", nb <= n),
    ]
    for name, ok in checks:
        if not ok:
            raise SystemExit(f"cannot splice: {name} differs")
    delta = va.deltas[0]

    def display_order(track):
        pts = [i * delta + track.ctts[i] for i in range(len(track.sizes))]
        order = sorted(range(len(pts)), key=lambda i: pts[i])
        return pts, {i: r for r, i in enumerate(order)}

    pts_a, disp_a = display_order(va)
    if nb == n:  # a full encode of the new cut: splice at a keyframe both share
        shared = sorted(set(va.sync) & set(vb.sync))
        candidates = [k for k in shared if disp_a[k] <= args.first_changed_frame]
        if not candidates:
            raise SystemExit("no shared keyframe before the first changed frame")
        K, offset = max(candidates), 0
    else:  # a tail that starts at the splice keyframe
        K, offset = n - nb, n - nb
        if K not in va.sync or 0 not in vb.sync:
            raise SystemExit(f"cannot splice: frame {K} is not a keyframe in both files")
        if disp_a[K] > args.first_changed_frame:
            raise SystemExit("the tail starts after the first changed frame")
    pts_b = [i * delta + vb.ctts[i] for i in range(nb)]
    # Closed GOPs: nothing before K is shown after it, nothing after it before it.
    if max(pts_a[:K]) >= pts_a[K]:
        raise SystemExit("cannot splice: the base's GOP before the splice is open")
    jb = K - offset
    if min(pts_b[jb:]) < pts_b[jb]:
        raise SystemExit("cannot splice: the new encode's GOP at the splice is open")

    video = va.samples[:K] + vb.samples[jb:]
    ctts = va.ctts[:K] + vb.ctts[jb:]
    sync = [k for k in va.sync if k < K] + [k + offset for k in vb.sync if k + offset >= K]
    assert len(video) == n

    # Rebuild <base>'s moov with the new video tables, in <base>'s chunk layout.
    sv, sa = va.stbl, au.stbl
    sv.get(b"stsz").payload = b"\x00\x00\x00\x00" + struct.pack(">II", 0, n) + struct.pack(">%dI" % n, *[len(s) for s in video])
    if sv.get(b"ctts") is not None:
        sv.get(b"ctts").payload = ctts_payload(ctts, va.ctts_version)
    if sv.get(b"stss") is not None:
        sv.get(b"stss").payload = table([k + 1 for k in sync])
    layout = sorted([(o, "v", i) for i, o in enumerate(va.chunks)] + [(o, "a", i) for i, o in enumerate(au.chunks)])
    vstart, astart = [0], [0]
    for c in va.per_chunk:
        vstart.append(vstart[-1] + c)
    for c in au.per_chunk:
        astart.append(astart[-1] + c)
    head = b"".join(b.serialize() for b in ta if b.kind not in (b"moov", b"mdat"))
    sv.get(b"stco").payload = table(va.chunks)  # fixed width: size does not depend on values
    sa.get(b"stco").payload = table(au.chunks)
    base_offset = len(head) + len(moov_a.serialize()) + 8
    mdat = bytearray()
    new_v, new_a = [0] * len(va.chunks), [0] * len(au.chunks)
    for _, kind, i in layout:
        if kind == "v":
            new_v[i] = base_offset + len(mdat)
            mdat += b"".join(video[vstart[i] : vstart[i + 1]])
        else:
            new_a[i] = base_offset + len(mdat)
            mdat += b"".join(au.samples[astart[i] : astart[i + 1]])
    sv.get(b"stco").payload = table(new_v)
    sa.get(b"stco").payload = table(new_a)
    out = head + moov_a.serialize() + struct.pack(">I4s", 8 + len(mdat), b"mdat") + bytes(mdat)
    open(args.out, "wb").write(out)

    # Report: the samples kept from <base> are its bytes, the audio is <base>'s.
    h = lambda xs: hashlib.sha256(b"".join(xs)).hexdigest()[:16]
    print(f"splice keyframe: sample {K} (display frame {disp_a[K]}, {disp_a[K] / 60:.3f} s at 60 fps)")
    print(f"video 0-{K - 1} from base: sha256 {h(video[:K])} (base {h(va.samples[:K])})")
    print(f"video {K}-{n - 1} from new: sha256 {h(video[K:])}")
    print(f"audio from base: {len(au.samples)} samples")
    print(f"wrote {args.out}: {len(out)} bytes")


if __name__ == "__main__":
    main()
