"""Mixes the film soundtrack: the score bed plus the SFX kit on frame-exact times.

  python3 scripts/film/mix.py --audio <film-audio dir> --cues scripts/film/sfx.json --out mix.wav

The bed (bed-22s.wav, 120 BPM, its own landmarks) plays at -6 dB. Each SFX file
(normalised to -1 dBTP by the kit) is placed so its sync point lands on the
film time given in sfx.json, at its gain. The sum is limited (4x oversampled
peak detection, look-ahead) and normalised to about -14 LUFS integrated with a
-1 dBTP ceiling (ITU-R BS.1770-4 K-weighting and gating). Needs numpy only.
"""
import argparse
import json
import wave
from pathlib import Path

import numpy as np

RATE = 48000


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        rate, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    if width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    elif width == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        data = v.astype(np.float64) / float(1 << 23)
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float64) / float(1 << 31)
    else:
        raise ValueError(f"unsupported sample width {width}")
    data = data.reshape(-1, ch)
    if ch == 1:
        data = np.repeat(data, 2, axis=1)
    if rate != RATE:
        raise ValueError(f"{path}: {rate} Hz, expected {RATE}")
    return data[:, :2]


def write_wav(path, data):
    pcm = np.clip(np.round(data * 32767.0), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def k_weight(x):
    """BS.1770-4 K-weighting (pre-filter shelf + RLB high-pass, 48 kHz coefficients),
    applied in the frequency domain with the filters' exact response (padded)."""
    stages = [
        ((1.53512485958697, -2.69169618940638, 1.19839281085285), (1.0, -1.69065929318241, 0.73248077421585)),
        ((1.0, -2.0, 1.0), (1.0, -1.99004745483398, 0.99007225036621)),
    ]
    pad = RATE  # one second of tail
    n = len(x) + pad
    nfft = 1 << (n - 1).bit_length()
    w = np.exp(-1j * np.pi * np.arange(nfft // 2 + 1) / (nfft // 2))
    h = np.ones(nfft // 2 + 1, dtype=complex)
    for b, a in stages:
        h *= (b[0] + b[1] * w + b[2] * w * w) / (a[0] + a[1] * w + a[2] * w * w)
    out = np.empty_like(x)
    for c in range(x.shape[1]):
        out[:, c] = np.fft.irfft(np.fft.rfft(x[:, c], nfft) * h, nfft)[: len(x)]
    return out


def loudness(x):
    """Integrated loudness in LUFS (BS.1770-4, stereo, gated)."""
    y = k_weight(x)
    block, hop = int(0.4 * RATE), int(0.1 * RATE)
    power = []
    for start in range(0, len(y) - block + 1, hop):
        seg = y[start : start + block]
        power.append(np.mean(seg[:, 0] ** 2) + np.mean(seg[:, 1] ** 2))
    power = np.array(power)
    lk = -0.691 + 10 * np.log10(np.maximum(power, 1e-12))
    gated = power[lk > -70]
    if not len(gated):
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(gated)) - 10
    final = power[(lk > -70) & (lk > rel)]
    return -0.691 + 10 * np.log10(np.mean(final))


def oversample4(x):
    """4x band-limited upsampling per channel (FFT zero padding)."""
    n = len(x)
    out = np.zeros((n * 4, x.shape[1]))
    for c in range(x.shape[1]):
        spec = np.fft.rfft(x[:, c])
        padded = np.zeros(n * 2 + 1, dtype=complex)
        padded[: len(spec)] = spec
        out[:, c] = np.fft.irfft(padded, n * 4) * 4
    return out


def true_peak(x):
    return float(np.max(np.abs(oversample4(x))))


def limiter(x, ceiling, lookahead_ms=1.5, release_ms=90.0):
    """Look-ahead peak limiter on the 4x oversampled peak envelope."""
    up = np.max(np.abs(oversample4(x)), axis=1).reshape(-1, 4).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(up, 1e-9))
    la = max(1, int(lookahead_ms * RATE / 1000))
    # Minimum over the look-ahead window, so gain is down before the peak.
    padded = np.concatenate([need, np.ones(la)])
    win = np.lib.stride_tricks.sliding_window_view(padded, la + 1)[: len(need)]
    target = win.min(axis=1)
    rel = np.exp(-1.0 / (release_ms * RATE / 1000))
    gain = np.empty_like(target)
    g = 1.0
    for i, t in enumerate(target):
        g = t if t < g else t + (g - t) * rel
        gain[i] = g
    # Smooth the attack over the look-ahead (raised cosine).
    k = np.hanning(2 * la + 1)
    k /= k.sum()
    smooth = np.convolve(np.concatenate([np.full(la, gain[0]), gain, np.full(la, gain[-1])]), k, mode="valid")
    gain = np.minimum(gain, smooth)
    return x * gain[:, None], float(gain.min())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--cues", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bed", default=None)
    ap.add_argument("--bed-db", type=float, default=-6.0)
    ap.add_argument("--lufs", type=float, default=-14.0)
    ap.add_argument("--ceiling", type=float, default=-1.0)
    ap.add_argument("--duration", type=float, default=None)
    ap.add_argument("--report", default=None)
    args = ap.parse_args()

    audio = Path(args.audio)
    kit = json.loads((audio / "cues.json").read_text())["sfx"]
    offsets = {Path(v["file"]).name: v["sync_offset_s"] for v in kit.values()}
    sheet = json.loads(Path(args.cues).read_text())
    cues = sheet["sfx"]
    # The cue sheet names its bed and length unless the command line overrides them.
    if args.bed is None:
        args.bed = sheet.get("bed", "bed-22s.wav")
    if args.duration is None:
        args.duration = float(sheet.get("duration", 22.0))

    n = int(round(args.duration * RATE))
    mix = np.zeros((n, 2))
    bed = read_wav(audio / args.bed)[:n]
    mix[: len(bed)] += bed * 10 ** (args.bed_db / 20)
    placed = []
    for cue in cues:
        name = Path(cue["file"]).name
        data = read_wav(audio / "sfx" / name) * 10 ** (cue.get("gain_db", 0) / 20)
        if cue.get("rate"):  # pitch/speed change by resampling (e.g. 0.8 = lower)
            r = cue["rate"]
            idx = np.arange(0, len(data) - 1, r)
            data = np.stack([np.interp(idx, np.arange(len(data)), data[:, c]) for c in range(2)], axis=1)
        if cue.get("pan"):
            p = cue["pan"]  # -1 left .. 1 right, equal power
            a = (p + 1) * np.pi / 4
            data = data * np.array([np.cos(a), np.sin(a)]) * np.sqrt(2)
        offset = offsets.get(name, 0.0) / (cue.get("rate") or 1)
        start = int(round((cue["at"] - offset) * RATE))
        a, b = max(0, start), min(n, start + len(data))
        if b > a:
            mix[a:b] += data[a - start : b - start]
        placed.append({"file": name, "at": cue["at"], "start_s": round(start / RATE, 4), "gain_db": cue.get("gain_db", 0)})

    # Fade the very end so the file closes on silence.
    fade = int(0.25 * RATE)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    pre = loudness(mix)
    gain_db = args.lufs - pre
    mix *= 10 ** (gain_db / 20)
    ceiling = 10 ** ((args.ceiling - 0.3) / 20)
    for _ in range(3):
        mix, gmin = limiter(mix, ceiling)
        lufs = loudness(mix)
        if abs(lufs - args.lufs) < 0.3:
            break
        mix *= 10 ** ((args.lufs - lufs) / 20)
    mix, gmin = limiter(mix, ceiling)
    tp = 20 * np.log10(true_peak(mix))
    lufs = loudness(mix)
    write_wav(args.out, mix)
    report = {
        "out": args.out,
        "duration_s": n / RATE,
        "integrated_lufs": round(lufs, 2),
        "true_peak_dbtp": round(tp, 2),
        "limiter_max_reduction_db": round(-20 * np.log10(max(gmin, 1e-9)), 2),
        "bed": args.bed,
        "bed_db": args.bed_db,
        "sfx": placed,
    }
    print(json.dumps({k: v for k, v in report.items() if k != "sfx"}, indent=1))
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
