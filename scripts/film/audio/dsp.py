"""Small synthesis / mixing / metering toolkit (numpy + scipy only, nothing downloaded)."""
import numpy as np
import scipy.signal as sig
from scipy.ndimage import minimum_filter1d

SR = 48000


def N(d):
    return int(round(d * SR))


def tt(d):
    return np.arange(N(d)) / SR


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def db(x):
    return 10 ** (x / 20)


def rng(seed):
    return np.random.default_rng(seed)


# ---------------------------------------------------------------- stereo helpers
def pan2(x, p=0.0):
    """Constant-power pan; centre keeps unity gain per channel. p may be an array."""
    a = (np.asarray(p) + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], 1) * np.sqrt(2)


def st(x):
    return x if x.ndim == 2 else np.stack([x, x], 1)


def add(buf, x, t, g=1.0, p=0.0):
    x = x if x.ndim == 2 else pan2(x, p)
    i = N(t)
    if i < 0:
        x = x[-i:]
        i = 0
    n = min(len(x), len(buf) - i)
    if n > 0:
        buf[i:i + n] += x[:n] * g


def fades(x, fi=0.001, fo=0.005):
    x = x.copy()
    a, b = N(fi), N(fo)
    if a > 1:
        r = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
        x[:a] *= r[:, None] if x.ndim == 2 else r
    if b > 1:
        r = np.cos(np.linspace(0, np.pi / 2, b)) ** 2
        x[-b:] *= r[:, None] if x.ndim == 2 else r
    return x


# ---------------------------------------------------------------- filters
def bw(x, kind, fc, order=2, zero_phase=False):
    sos = sig.butter(order, fc, btype=kind, fs=SR, output='sos')
    return sig.sosfiltfilt(sos, x, axis=0) if zero_phase else sig.sosfilt(sos, x, axis=0)


def _biquad(kind, fc, Q):
    w = 2 * np.pi * fc / SR
    cw, sw = np.cos(w), np.sin(w)
    a = sw / (2 * Q)
    if kind == 'lp':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0
    elif kind == 'hp':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0
    else:  # band-pass, 0 dB peak
        b0 = a; b1 = 0.0; b2 = -a
    a0 = 1 + a
    return np.array([b0 / a0, b1 / a0, b2 / a0, 1.0, -2 * cw / a0, (1 - a) / a0])


def tvfilt(x, kind, fc, Q=0.707, stages=1, block=32):
    """Time-varying biquad (block-updated coefficients, state carried)."""
    x2 = x if x.ndim == 2 else x[:, None]
    fc = np.broadcast_to(np.asarray(fc, float), (len(x2),))
    out = np.empty_like(x2)
    zi = np.zeros((stages, 2, x2.shape[1]))
    for s in range(0, len(x2), block):
        c = _biquad(kind, float(np.clip(fc[s], 20, SR * 0.45)), Q)
        out[s:s + block], zi = sig.sosfilt(np.tile(c, (stages, 1)), x2[s:s + block], axis=0, zi=zi)
    return out if x.ndim == 2 else out[:, 0]


def curve(total, points, log=True):
    """Breakpoint automation -> per-sample array."""
    ts = np.array([p[0] for p in points]); vs = np.array([p[1] for p in points], float)
    t = np.arange(N(total)) / SR
    if log:
        return np.exp(np.interp(t, ts, np.log(vs)))
    return np.interp(t, ts, vs)


# ---------------------------------------------------------------- oscillators
def saw(f, n, ph0=0.0):
    """PolyBLEP band-limited sawtooth. f scalar or per-sample array."""
    f = np.asarray(f, float)
    dt = np.broadcast_to(f / SR, (n,)) if f.ndim == 0 else f / SR
    if f.ndim == 0:
        ph = (ph0 + dt[0] * np.arange(n)) % 1.0
    else:
        ph = (ph0 + np.cumsum(dt) - dt) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= t + t - t * t - 1
    m = ph > 1 - dt
    t = (ph[m] - 1) / dt[m]
    y[m] -= t * t + t + t + 1
    return y


DET = np.array([-33, -21, -9, 0, 9, 21, 33])
DPAN = np.array([-1, -0.66, -0.33, 0, 0.33, 0.66, 1])
DAMP = np.array([0.42, 0.5, 0.6, 0.75, 0.6, 0.5, 0.42])


def supersaw(notes, dur, width=0.85, seed=0):
    r = rng(seed)
    n = N(dur)
    out = np.zeros((n, 2))
    for m in notes:
        f0 = mtof(m)
        for c, p, a in zip(DET, DPAN, DAMP):
            v = saw(f0 * 2 ** (c / 1200), n, r.random())
            out += pan2(v * a, p * width)
    return out / np.sqrt(len(notes) * len(DET))


def pluck(m, dur=0.5, bright=1.0, decay=0.35, detune=7, fmax=15000):
    """Additive saw-spectrum pluck; upper partials decay faster (clean, alias-free)."""
    f = mtof(m)
    t = tt(dur)
    K = int(min(fmax / f, 70))
    out = np.zeros((len(t), 2))
    for ch, dc in enumerate([-detune, detune]):
        ff = f * 2 ** (dc / 1200)
        y = np.zeros(len(t))
        for k in range(1, K + 1):
            tau = decay / (1 + 0.45 * (k - 1) / max(bright, 1e-3))
            y += np.sin(2 * np.pi * ff * k * t) * np.exp(-t / tau) / k
        out[:, ch] = y
    out *= (1 - np.exp(-t / 0.0012))[:, None]
    return fades(out, 0, 0.01) * 0.6


def bell(f, dur=1.0, decay=0.6, parts=((1, 1, 1), (2.76, .45, .45), (5.40, .22, .25), (8.93, .1, .14))):
    t = tt(dur)
    y = np.zeros(len(t))
    for r_, a, d in parts:
        if f * r_ < 20000:
            y += a * np.sin(2 * np.pi * f * r_ * t) * np.exp(-t / (decay * d))
    return fades(y * (1 - np.exp(-t / 0.0008)), 0, 0.01)


# ---------------------------------------------------------------- drums
def kick(vel=1.0, tail=0.3, seed=1):
    t = tt(0.55)
    f = 49 + 135 * np.exp(-t / 0.032) + 60 * np.exp(-t / 0.004)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tail) * (1 - np.exp(-t / 0.0006))
    nz = bw(rng(seed).standard_normal(len(t)), 'highpass', 1800) * np.exp(-t / 0.0035) * 0.3
    y = np.tanh(2.0 * (body + nz)) / np.tanh(2.0)
    return fades(y, 0, 0.05) * vel


def sub_boom(f0=72, f1=43.65, dur=2.0, decay=0.7):
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.07)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay) * (1 - np.exp(-t / 0.002))
    y = np.tanh(1.6 * y) / np.tanh(1.6)
    return fades(y, 0, 0.1)


def clap(vel=1.0, tone=1.0, seed=2):
    r = rng(seed)
    t = tt(0.5)
    env = np.zeros(len(t))
    for k, o in enumerate([0, 0.0095, 0.0195]):
        m = t >= o
        env[m] += np.exp(-(t[m] - o) / 0.0032) * (0.75 if k < 2 else 1.0)
    m = t >= 0.026
    env[m] += np.exp(-(t[m] - 0.026) / 0.12) * 0.75
    c = r.standard_normal(len(t))
    nz = np.stack([0.8 * c + 0.35 * r.standard_normal(len(t)), 0.8 * c + 0.35 * r.standard_normal(len(t))], 1)
    nz = bw(nz, 'bandpass', [850 * tone, 7000], 2)
    body = (np.sin(2 * np.pi * 195 * tone * t) * 0.5 + np.sin(2 * np.pi * 330 * tone * t) * 0.25) * np.exp(-t / 0.045)
    y = nz * env[:, None] * 1.4 + st(body * (1 - np.exp(-t / 0.0005)))
    return fades(y, 0, 0.05) * vel


def snare(vel=1.0, tone=1.0, seed=3):
    r = rng(seed)
    t = tt(0.3)
    nz = bw(r.standard_normal(len(t)), 'bandpass', [1400 * tone, 9000], 2) * np.exp(-t / 0.075)
    body = np.sin(2 * np.pi * 185 * tone * t) * np.exp(-t / 0.05)
    y = (nz * 1.2 + body * 0.7) * (1 - np.exp(-t / 0.0004))
    return fades(y, 0, 0.03) * vel


def hat(vel=1.0, decay=0.035, seed=4, dur=None):
    r = rng(seed)
    t = tt(dur or max(decay * 7, 0.06))
    n = r.standard_normal(len(t))
    y = bw(n, 'highpass', 7200, 4) + 0.6 * bw(n, 'bandpass', [8200, 9000], 2) + 0.4 * bw(n, 'bandpass', [10800, 11800], 2)
    y *= np.exp(-t / decay) * (1 - np.exp(-t / 0.0004))
    return fades(y, 0, 0.01) * vel


def crash(vel=1.0, dur=2.2, seed=5):
    r = rng(seed)
    t = tt(dur)
    n = r.standard_normal((len(t), 2))
    y = bw(n, 'highpass', 3200, 2) + 0.5 * bw(n, 'bandpass', [5200, 6400], 2) + 0.35 * bw(n, 'bandpass', [8500, 10500], 2)
    env = (np.exp(-t / 0.55) * 0.75 + 0.25 * np.exp(-t / 0.08)) * (1 - np.exp(-t / 0.0008))
    return fades(y * env[:, None], 0, 0.2) * vel


def reverse_crash(dur=1.0, seed=6):
    x = crash(1.0, dur + 0.4, seed)[::-1]
    x = x[-N(dur):]
    t = tt(dur)
    shape = (t / dur) ** 2.2
    return fades(x * shape[:, None], 0.01, 0.004)


# ---------------------------------------------------------------- envelopes
def gate_env(total, events, a=0.003, r=0.05, floor=0.0):
    """events: (t_on, t_off, level[, decay_tau])."""
    e = np.full(N(total), floor)
    for ev in events:
        t0, t1, lv = ev[:3]
        dec = ev[3] if len(ev) > 3 else np.inf
        i0 = N(t0)
        L = N(t1 - t0) + N(r * 6)
        L = min(L, len(e) - i0)
        if L <= 0:
            continue
        x = np.arange(L) / SR
        on = (1 - np.exp(-x / a)) * np.exp(-x / dec)
        hold = (1 - np.exp(-(t1 - t0) / a)) * np.exp(-(t1 - t0) / dec)
        env = np.where(x < (t1 - t0), on, hold * np.exp(-(x - (t1 - t0)) / r))
        e[i0:i0 + L] = np.maximum(e[i0:i0 + L], env * lv)
    return e


def sc_env(total, times, depth=0.6, rel=0.13, att=0.004):
    e = np.ones(N(total))
    for t0 in times:
        i0 = max(N(t0 - att), 0)
        L = min(N(att + rel * 6), len(e) - i0)
        x = np.arange(L) / SR
        g = 1 - depth * np.minimum(x / att, 1) * np.exp(-np.maximum(x - att, 0) / rel)
        e[i0:i0 + L] = np.minimum(e[i0:i0 + L], g)
    return e


# ---------------------------------------------------------------- space
def make_ir(T=2.4, dur=3.2, pre=0.018, seed=9, damp=0.4):
    r = rng(seed)
    t = tt(dur)
    n = r.standard_normal((len(t), 2))
    lo = bw(n, 'lowpass', 500, 2)
    hi = bw(n, 'highpass', 4500, 2)
    mid = n - lo - hi
    dec = lambda TT: (10 ** (-3 * t / TT))[:, None]
    ir = lo * dec(T * 1.1) * 0.7 + mid * dec(T) + hi * dec(T * damp) * 0.6
    ir *= (1 - np.exp(-t / 0.015))[:, None]
    ir = np.vstack([np.zeros((N(pre), 2)), ir])
    ir = fades(ir, 0, 0.3)
    return ir / np.sqrt(np.sum(ir ** 2, 0)).max()


def reverb(x, ir, hp=220, lp=9000):
    x = st(x)
    y = np.stack([sig.fftconvolve(x[:, c], ir[:, c]) for c in range(2)], 1)
    y = bw(y, 'highpass', hp, 2)
    return bw(y, 'lowpass', lp, 2)


def pingpong(x, d=0.375, fb=0.4, taps=6, lp=4500, hp=300):
    xm = st(x).mean(1)
    out = np.zeros((len(xm), 2))
    cur = bw(xm, 'highpass', hp, 2)
    for k in range(1, taps + 1):
        cur = bw(cur, 'lowpass', lp, 1)
        i = N(d * k)
        if i >= len(xm):
            break
        out[i:, (k - 1) % 2] += cur[:len(xm) - i] * fb ** (k - 1)
    return out


# ---------------------------------------------------------------- metering
def lufs(x):
    x = st(np.asarray(x, float))
    y = sig.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285],
                    [1.0, -1.69065929318241, 0.73248077421585], x, axis=0)
    y = sig.lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621], y, axis=0)
    p = np.sum(y ** 2, 1)
    blk, hop = N(0.4), N(0.1)
    if len(p) < blk:
        p = np.concatenate([p, np.zeros(blk - len(p))])
    cs = np.concatenate([[0], np.cumsum(p)])
    starts = np.arange(0, len(p) - blk + 1, hop)
    ms = (cs[starts + blk] - cs[starts]) / blk
    lk = -0.691 + 10 * np.log10(ms + 1e-20)
    g = ms[lk > -70]
    if len(g) == 0:
        return -np.inf
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g2 = ms[(lk > -70) & (lk > rel)]
    return -0.691 + 10 * np.log10(g2.mean())


def short_term(x, win=3.0, hop=0.1):
    x = st(x)
    y = sig.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285],
                    [1.0, -1.69065929318241, 0.73248077421585], x, axis=0)
    y = sig.lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621], y, axis=0)
    p = np.sum(y ** 2, 1)
    cs = np.concatenate([[0], np.cumsum(p)])
    w = N(win)
    ts, vals = [], []
    for i in range(0, len(p), N(hop)):
        a = max(0, i - w)
        e = cs[i] - cs[a]
        ts.append(i / SR)
        vals.append(-0.691 + 10 * np.log10(e / w + 1e-20))
    return np.array(ts), np.array(vals)


def true_peak_db(x):
    up = sig.resample_poly(st(x), 4, 1, axis=0)
    return 20 * np.log10(np.abs(up).max() + 1e-20)


def sample_peak_db(x):
    return 20 * np.log10(np.abs(x).max() + 1e-20)


# ---------------------------------------------------------------- mastering
def limiter(x, ceiling, look=0.0025, release=0.07, dec=16):
    up = np.abs(sig.resample_poly(x, 4, 1, axis=0)).max(1)  # true-peak aware detection
    pk = np.maximum(np.abs(x).max(1), up[:len(x) * 4].reshape(-1, 4).max(1))
    g = np.minimum(1.0, ceiling / np.maximum(pk, 1e-12))
    nb = int(np.ceil(len(g) / dec))
    gp = np.pad(g, (0, nb * dec - len(g)), constant_values=1.0).reshape(nb, dec).min(1)
    a = np.exp(-dec / (release * SR))
    out = np.empty(nb)
    cur = 1.0
    for i in range(nb):
        v = gp[i]
        cur = v if v < cur else v + (cur - v) * a
        out[i] = cur
    g = np.repeat(out, dec)[:len(g)]
    L = N(look)
    g = minimum_filter1d(g, 2 * L + 1)
    w = np.hanning(2 * L + 3)[1:-1]
    g = np.convolve(g, w / w.sum(), mode='same')
    return x * g[:, None]


def mono_low(x, fc=120):
    M = (x[:, 0] + x[:, 1]) / 2
    S = (x[:, 0] - x[:, 1]) / 2
    S = bw(S, 'highpass', fc, 4, zero_phase=True)
    return np.stack([M + S, M - S], 1)


def master(mix, target, tp_max=-1.0, fade_in=0.0005, fade_out=0.3):
    x = bw(st(mix), 'highpass', 22, 2, zero_phase=True)
    x = mono_low(x)
    x = x - x.mean(0)
    ceiling = db(tp_max - 0.15)
    g = target - lufs(x)
    for _ in range(4):
        for _ in range(6):
            y = limiter(x * db(g), ceiling)
            l = lufs(y)
            if abs(target - l) < 0.03:
                break
            g += target - l
        tp = true_peak_db(y)
        if tp <= tp_max - 0.05:
            break
        ceiling *= db(tp_max - 0.1 - tp)
    y = fades(y, fade_in, fade_out)
    return y


def finalize_sfx(x, peak_db=-1.0, thr_db=-50, tail_db=-66, fo=0.02):
    """DC-block, trim leading silence & dead tail, clickless edges, true-peak normalise.
    Returns (audio, samples_trimmed_at_start)."""
    x = st(x)
    x = bw(x, 'highpass', 18, 2)
    a = np.abs(x).max(1)
    pk = a.max()
    i0 = max(int(np.argmax(a > pk * db(thr_db))) - 2, 0)
    i1 = len(a) - int(np.argmax(a[::-1] > pk * db(tail_db)))
    x = x[i0:i1]
    x = fades(x, 0.0003, min(fo, 0.25 * len(x) / SR))
    x = x / db(true_peak_db(x)) * db(peak_db)
    return x, i0


def write_wav24(path, x):
    x = st(np.asarray(x, float))
    d = (np.random.default_rng(0).random(x.shape) - np.random.default_rng(1).random(x.shape)) / 2 ** 23
    q = np.clip(np.round((x + d) * (2 ** 23 - 1)), -2 ** 23, 2 ** 23 - 1).astype('<i4')
    raw = q.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    ch, bps = x.shape[1], 3
    import struct
    hdr = b'RIFF' + struct.pack('<I', 36 + len(raw)) + b'WAVE'
    hdr += b'fmt ' + struct.pack('<IHHIIHH', 16, 1, ch, SR, SR * ch * bps, ch * bps, 24)
    hdr += b'data' + struct.pack('<I', len(raw))
    with open(path, 'wb') as f:
        f.write(hdr + raw)


def read_wav(path):
    import struct
    b = open(path, 'rb').read()
    i = 12
    fmt = None
    while i < len(b):
        cid, sz = b[i:i + 4], struct.unpack('<I', b[i + 4:i + 8])[0]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', b[i + 8:i + 24])
        if cid == b'data':
            data = b[i + 8:i + 8 + sz]
            break
        i += 8 + sz + (sz & 1)
    ch, sr, bits = fmt[1], fmt[2], fmt[5]
    if bits == 24:
        u = np.frombuffer(data, np.uint8).reshape(-1, 3)
        v = (u[:, 0].astype(np.int32) | (u[:, 1].astype(np.int32) << 8) | (u[:, 2].astype(np.int32) << 16))
        v = np.where(v >= 2 ** 23, v - 2 ** 24, v) / 2 ** 23
    elif bits == 16:
        v = np.frombuffer(data, '<i2') / 2 ** 15
    elif bits == 32 and fmt[0] in (3, 0xFFFE):
        v = np.frombuffer(data, '<f4').astype(float)
    else:
        v = np.frombuffer(data, '<i4') / 2 ** 31
    return v.reshape(-1, ch), sr
