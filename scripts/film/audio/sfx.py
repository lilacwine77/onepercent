"""SFX designs. Each returns (stereo_audio, sync_offset_s) where sync_offset is the
designed hit point measured from the start of the (untrimmed) render."""
import numpy as np
from dsp import *

ROOM = None


def room():
    global ROOM
    if ROOM is None:
        ROOM = make_ir(T=1.1, dur=1.6, pre=0.01, seed=31, damp=0.5)
    return ROOM


def grains(n, times, amps, tau=0.0012, seed=0):
    imp = np.zeros(n)
    idx = np.clip((np.asarray(times) * SR).astype(int), 0, n - 1)
    np.add.at(imp, idx, amps)
    return sig.lfilter([1.0], [1.0, -np.exp(-1 / (SR * tau))], imp)


def density_times(r, dur, rate_fn, max_rate):
    """Poisson events with time-varying rate (thinning)."""
    t = 0.0
    out = []
    while True:
        t += r.exponential(1 / max_rate)
        if t >= dur:
            break
        if r.random() < rate_fn(t) / max_rate:
            out.append(t)
    return np.array(out)


def ui_tick():
    t = tt(0.07)
    r = rng(41)
    y = np.sin(2 * np.pi * 3150 * t) * np.exp(-t / 0.0055) * 0.8
    y += np.sin(2 * np.pi * 1320 * t) * np.exp(-t / 0.009) * 0.35
    y += bw(r.standard_normal(len(t)), 'highpass', 5000, 2) * np.exp(-t / 0.0006) * 0.6
    y *= 1 - np.exp(-t / 0.00015)
    x = pan2(y) + 0.08 * reverb(y, room())[:len(y)]
    return x, 0.0


def card_flip(seed=51, pitch=1.0, tw=0.07):
    r = rng(seed)
    d = 0.26
    t = tt(d)
    hit = tw * 0.72
    n = r.standard_normal((len(t), 2))
    fc = 1100 * pitch * 5.5 ** np.clip(t / tw, 0, 1)
    thw = tvfilt(n, 'bp', fc, Q=1.3) * ((np.clip(t / hit, 0, 1) ** 2) * np.exp(-np.maximum(t - hit, 0) / 0.01))[:, None]
    pos = np.clip(t / hit, 0, 1) * 0.6 - 0.3
    thw = np.stack([thw[:, 0] * np.cos((pos + 1) * np.pi / 4), thw[:, 1] * np.sin((pos + 1) * np.pi / 4)], 1) * np.sqrt(2)
    m = t >= hit
    ts = t[m] - hit
    snap = np.zeros(len(t))
    snap[m] = bw(r.standard_normal(m.sum()), 'bandpass', [2300 * pitch, 9500], 2) * np.exp(-ts / 0.0028)
    tap = np.zeros(len(t))
    m2 = t >= hit + 0.006
    ts2 = t[m2] - hit - 0.006
    tap[m2] = np.sin(2 * np.pi * 300 * pitch * ts2) * np.exp(-ts2 / 0.014) * (1 - np.exp(-ts2 / 0.0005))
    x = thw * 0.75 + pan2(snap * 1.2 + tap * 0.55)
    x = x + 0.12 * reverb(x, room())[:len(x)]
    return x, hit


def foil_shimmer(seed=61, dur=1.7):
    r = rng(seed)
    t = tt(dur)
    n = len(t)
    rate = lambda u: 900 * (u / 0.18 if u < 0.18 else np.exp(-(u - 0.18) / 0.45))
    out = np.zeros((n, 2))
    for c in range(2):
        tm = density_times(r, dur, rate, 900)
        env = grains(n, tm, r.uniform(0.2, 1.0, len(tm)) * r.choice([-1, 1], len(tm)), tau=0.0009)
        nz = bw(r.standard_normal(n), 'bandpass', [3000, 15000], 2)
        out[:, c] = nz * np.abs(env)
    sh = np.zeros((n, 2))
    for k, f in enumerate([4186, 5274, 6272, 7040, 8372, 9397, 10548]):
        am = 0.55 + 0.45 * np.sin(2 * np.pi * r.uniform(6, 14) * t + r.random() * 6.28)
        env = (1 - np.exp(-t / 0.12)) * np.exp(-t / 0.7)
        sh += pan2(np.sin(2 * np.pi * f * t + r.random() * 6.28) * am * env / (1 + 0.25 * k), r.uniform(-0.8, 0.8))
    x = out * 1.0 + sh * 0.06
    x = x + 0.25 * reverb(x, room())[:n]
    return x, 0.0


def pack_rip(seed=71):
    r = rng(seed)
    d = 1.0
    t = tt(d)
    n = len(t)
    pop = 0.30
    out = np.zeros((n, 2))
    # stick-slip tear: accelerating impulse train, louder towards the pop
    rate = lambda u: 120 + 1400 * (u / pop) ** 1.6 if u < pop else 0
    for c in range(2):
        tm = density_times(r, pop, rate, 1600)
        amps = (0.25 + 0.75 * (tm / pop) ** 0.8) * r.uniform(0.4, 1.0, len(tm))
        env = grains(n, tm, amps, tau=0.0011)
        bright = bw(r.standard_normal(n), 'bandpass', [900, 7500], 2)
        body = bw(r.standard_normal(n), 'bandpass', [180, 1100], 2)
        out[:, c] = bright * env * 1.2 + body * bw(env, 'lowpass', 60, 1) * 2.5
    m = t >= pop
    ts = t[m] - pop
    p = np.zeros(n)
    p[m] = bw(r.standard_normal(m.sum()), 'bandpass', [600, 12000], 2) * np.exp(-ts / 0.012) * 2.2
    p[m] += np.sin(2 * np.pi * 110 * ts) * np.exp(-ts / 0.045) * (1 - np.exp(-ts / 0.001)) * 1.4
    out += pan2(p)
    # foil crinkle settling after the pop
    tail = np.zeros((n, 2))
    for c in range(2):
        tm = pop + density_times(r, d - pop, lambda u: 700 * np.exp(-u / 0.12), 700)
        env = grains(n, tm, r.uniform(0.1, 0.6, len(tm)), tau=0.0008)
        tail[:, c] = bw(r.standard_normal(n), 'highpass', 3500, 2) * env
    x = out + tail
    x = x + 0.18 * reverb(x, room())[:n]
    return x, pop


def big_impact(seed=81):
    r = rng(seed)
    d = 3.6
    t = tt(d)
    n = len(t)
    boom = sub_boom(78, 36, d, 0.95)
    crack = bw(r.standard_normal((n, 2)), 'bandpass', [500, 10000], 2) * np.exp(-t / 0.02)[:, None] * 1.6
    crack += bw(r.standard_normal((n, 2)), 'highpass', 3000, 2) * np.exp(-t / 0.09)[:, None] * 0.35
    punch = np.tanh(4 * np.sin(2 * np.pi * 105 * t) * np.exp(-t / 0.06)) * 0.55
    metal = np.zeros(n)
    for k, f in enumerate([233.1, 370.4, 587.3, 811.0, 1186.0, 1663.0, 2490.0]):
        metal += np.sin(2 * np.pi * f * t + r.random() * 6.28) * np.exp(-t / (1.1 / (1 + 0.6 * k))) / (1 + 0.5 * k)
    metal *= (1 - np.exp(-t / 0.002)) * 0.22
    mid = crack + pan2(punch + metal)
    wet = reverb(mid, make_ir(T=2.8, dur=3.4, pre=0.02, seed=82), hp=150, lp=7000)[:n]
    x = pan2(boom * 1.1) + mid + 0.55 * wet
    x[:, :] *= 1 - np.exp(-t / 0.0004)[:, None]
    return fades(x, 0, 0.4), 0.0


def coin_sparkle(seed=91):
    r = rng(seed)
    d = 1.5
    t = tt(d)
    n = len(t)
    x = np.zeros((n, 2))
    add(x, bell(mtof(89), 1.2, 0.55), 0.0, 0.9, -0.15)   # F6
    add(x, bell(mtof(96), 1.2, 0.6), 0.065, 0.85, 0.15)  # C7
    tones = [mtof(m) for m in (96, 99, 101, 103, 104, 108)]
    for i in range(16):
        tm = 0.05 + r.exponential(0.18)
        if tm > 0.9:
            continue
        add(x, bell(r.choice(tones) * r.choice([1, 2]), 0.4, 0.14), tm, 0.35 * np.exp(-tm / 0.4), r.uniform(-0.9, 0.9))
    air = bw(r.standard_normal((n, 2)), 'highpass', 9000, 2) * ((1 - np.exp(-t / 0.02)) * np.exp(-t / 0.25))[:, None] * 0.07
    x += air
    x = x + 0.3 * reverb(x, room())[:n]
    return x, 0.0


def crt_on(seed=101):
    r = rng(seed)
    d = 1.5
    t = tt(d)
    n = len(t)
    x = np.zeros((n, 2))
    # relay clack + chassis thump
    clk = bw(r.standard_normal(n), 'highpass', 2500, 2) * np.exp(-t / 0.0015)
    thump = np.sin(2 * np.pi * 68 * t) * np.exp(-t / 0.07) * (1 - np.exp(-t / 0.001))
    x += pan2(clk * 0.9 + thump * 0.9)
    # degauss buzz: 60 Hz rich hum with wobble, swelling then decaying
    hum = np.tanh(3 * np.sin(2 * np.pi * 60 * t)) + 0.4 * np.sin(2 * np.pi * 120 * t)
    hum = bw(hum, 'bandpass', [90, 2400], 2)
    henv = (1 - np.exp(-t / 0.03)) * np.exp(-t / 0.35) * (0.75 + 0.25 * np.sin(2 * np.pi * 9 * t))
    x += pan2(hum * henv * 0.45)
    # beam charge zap
    m = t >= 0.04
    ts = t[m] - 0.04
    f = 180 * (2700 / 180) ** np.clip(ts / 0.2, 0, 1)
    zap = np.zeros(n)
    zap[m] = np.sin(2 * np.pi * np.cumsum(f) / SR + 1.5 * np.sin(2 * np.pi * 37 * ts)) * np.clip(ts / 0.05, 0, 1) * np.exp(-ts / 0.16)
    x += pan2(zap * 0.3)
    # static crackle
    for c in range(2):
        tm = density_times(r, d, lambda u: 260 * np.exp(-u / 0.3) if u > 0.02 else 0, 260)
        env = grains(n, tm, r.uniform(0.2, 1, len(tm)), tau=0.0007)
        x[:, c] += bw(r.standard_normal(n), 'highpass', 2600, 2) * env * 0.7
    # bright bloom (picture coming up)
    m = t >= 0.12
    ts = t[m] - 0.12
    bloom = np.zeros((n, 2))
    bloom[m] = bw(r.standard_normal((m.sum(), 2)), 'bandpass', [3000, 12000], 2) * ((1 - np.exp(-ts / 0.08)) * np.exp(-ts / 0.35))[:, None] * 0.18
    x += bloom
    # faint flyback whine
    w = np.sin(2 * np.pi * 15734 * t) * np.clip((t - 0.1) / 0.2, 0, 1) * np.exp(-np.maximum(t - 0.5, 0) / 0.3) * 0.025
    x += pan2(w)
    x = x + 0.15 * reverb(x, room())[:n]
    return fades(x, 0, 0.2), 0.0


def crt_off(seed=111):
    r = rng(seed)
    d = 1.0
    t = tt(d)
    n = len(t)
    x = np.zeros((n, 2))
    pop = bw(r.standard_normal(n), 'bandpass', [400, 9000], 2) * np.exp(-t / 0.004) + np.sin(2 * np.pi * 90 * t) * np.exp(-t / 0.04)
    x += pan2(pop * (1 - np.exp(-t / 0.0004)) * 0.9)
    f = 55 + (2800 - 55) * np.exp(-t / 0.075)
    ph = 2 * np.pi * np.cumsum(f) / SR
    pew = (np.sin(ph) + 0.3 * np.sin(2 * ph)) * (1 - np.exp(-t / 0.002)) * np.exp(-t / 0.22)
    x += pan2(pew * 0.45)
    for c in range(2):
        tm = density_times(r, d, lambda u: 400 * np.exp(-u / 0.12), 400)
        env = grains(n, tm, r.uniform(0.2, 1, len(tm)), tau=0.0007)
        x[:, c] += bw(r.standard_normal(n), 'highpass', 2500, 2) * (env * 0.6 + 0.15 * np.exp(-t / 0.15))
    w = np.sin(2 * np.pi * 15734 * t) * np.exp(-t / 0.05) * 0.025
    x += pan2(w)
    x = x + 0.15 * reverb(x, room())[:n]
    return fades(x, 0, 0.2), 0.0


def whoosh(d=0.6, peak=0.38, seed=121, f_lo=320, f_hi=5200, tonal=True):
    r = rng(seed)
    t = tt(d)
    n = len(t)
    u = np.where(t < peak, (t / peak), 1 + (t - peak) / (d - peak))
    env = np.where(t < peak, (t / peak) ** 2.6, np.exp(-(t - peak) / ((d - peak) / 4.5)))
    fc = np.where(t < peak, f_lo * (f_hi / f_lo) ** (t / peak), f_hi * (f_lo * 1.6 / f_hi) ** np.clip((t - peak) / (d - peak), 0, 1))
    nz = r.standard_normal((n, 2))
    air = tvfilt(nz, 'bp', fc, Q=0.85)
    rum = tvfilt(nz[:, ::-1], 'lp', fc * 0.25, Q=0.7)
    y = air * 1.0 + rum * 0.5
    if tonal:
        ph = 2 * np.pi * np.cumsum(fc * 0.12) / SR
        y += st(np.sin(ph) * 0.12)
    p = -0.75 + 1.5 * np.clip(t / d, 0, 1)
    a = (p + 1) * np.pi / 4
    y = np.stack([y[:, 0] * np.cos(a), y[:, 1] * np.sin(a)], 1) * np.sqrt(2) * env[:, None]
    y = y + 0.12 * reverb(y, room())[:n]
    return fades(y, 0.002, 0.02), peak


def riser(d=2.0, seed=131, tone_lvl=0.5, noise_lvl=1.0, root=53):
    r = rng(seed)
    t = tt(d)
    n = len(t)
    x = t / d
    fc = 300 * 30 ** (x ** 1.5)
    nz = tvfilt(r.standard_normal((n, 2)), 'bp', fc, Q=1.4)
    nz += 0.35 * bw(r.standard_normal((n, 2)), 'highpass', 6000, 2) * (x ** 3)[:, None]
    f0 = mtof(root) * 4 ** (x ** 1.8)
    ton = np.zeros((n, 2))
    for c, p in zip([-14, 0, 14], [-0.8, 0, 0.8]):
        v = saw(f0 * 2 ** (c / 1200), n, r.random())
        ton += pan2(v, p * x)
    ton = tvfilt(ton, 'lp', np.minimum(f0 * 6, 16000), Q=0.9)
    rate = 4 + 26 * x ** 2
    gate = 1 - (0.55 * x) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * np.cumsum(rate) / SR)))
    gate = bw(gate, 'lowpass', 200, 1)
    amp = db(-30 * (1 - x) ** 1.4)
    y = (nz * noise_lvl + ton * 0.18 * tone_lvl) * (amp * gate)[:, None]
    return fades(y, 0.005, 0.004), d
