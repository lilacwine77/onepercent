"""120 BPM hype bed in F minor. render_bed(G, tail) -> (stereo premaster, landmarks, accents)."""
import numpy as np
from dsp import *
from sfx import riser

S16 = 0.125
GAP = 0.0625  # 1/32 of air before the drop and before the final hit

CH = {  # voicings (MIDI)
    'Fm': [53, 56, 60, 63, 67],
    'Db': [49, 53, 56, 60, 63],
    'Ab': [51, 56, 58, 60, 63],
    'Eb': [51, 55, 58, 63, 65],
}
ROOT = {'Fm': 29, 'Db': 37, 'Ab': 32, 'Eb': 39}

TARGET = {  # bus loudness (LUFS, gated) before the master
    'kick': -22.5, 'boom': -27.5, 'bass': -24, 'clap': -22.5, 'hats': -26.5,
    'chords': -20, 'pad': -26, 'lead': -24.5, 'arp': -26, 'cym': -27, 'fxr': -26,
}
SEND = {'kick': 0.02, 'boom': 0, 'bass': 0, 'clap': 0.22, 'hats': 0.08, 'chords': 0.16,
        'pad': 0.2, 'lead': 0.3, 'arp': 0.22, 'cym': 0.12, 'fxr': 0.18}


def render_bed(G=2, tail=2.0, return_buses=False):
    Tg = 2.0
    Tr = Tg + 2 * G
    Td = Tr + 2
    Tv = Td + 6
    Tl = Tv + 4
    Tf = Tl + 2
    Te = Tf + tail
    total = Te
    n = N(total)
    B = {k: np.zeros((n, 2)) for k in TARGET}
    kicks = []
    stp = lambda t0, s: t0 + s * S16

    def K(t, v=1.0):
        kicks.append(t)
        add(B['kick'], kick(v), t)

    def CL(t, v=1.0):
        add(B['clap'], clap(v), t)

    def HT(t, v=0.6, op=False, p=0.18):
        add(B['hats'], hat(v, 0.17 if op else 0.032, seed=int(t * 1000) % 97), t, 1.0, -0.2 if op else p)

    chord_segs, pad_segs, gates, pad_gates, bass_notes, arp, lead = [], [], [], [], [], [], []

    # ---------------- intro 0-2: hook hit + filtered intro
    K(0.0, 1.1)
    add(B['boom'], sub_boom(80, 43.65, 1.8, 0.6), 0.0)
    add(B['cym'], crash(0.9), 0.0)
    add(B['fxr'], downlifter(1.2, 4), 0.0, 0.6)
    chord_segs.append((0.0, Tg, 'Fm'))
    gates.append((0.0, 0.32, 1.0, 0.5))
    pad_segs.append((0.0, Tg, 'Fm'))
    for i in range(2, 16, 2):
        pad_gates.append((stp(0, i), stp(0, i) + 0.19, 1.1 + 0.06 * i))
    for s in (4, 8, 12):  # muffled pulse under the filter
        kicks.append(stp(0, s))
        add(B['kick'], bw(kick(0.75), 'lowpass', 260, 2), stp(0, s))
    seq = [0, 2, 3, 4, 2, 3, 4, 2, 0, 2, 3, 4, 3, 2, 4, 3]
    for s in range(4, 16):
        arp.append((stp(0, s), CH['Fm'][seq[s]] + 12, 0.5 + 0.04 * s, 0.3))
    add(B['cym'], reverse_crash(0.9), Tg - 0.9, 0.45)

    # ---------------- groove
    gch = ['Db', 'Eb'] if G == 2 else ['Db', 'Ab', 'Eb']
    for b in range(G):
        t0 = Tg + 2 * b
        c = gch[b]
        last = b == G - 1
        for s in ([0, 7, 10] if last else [0, 10]):
            K(stp(t0, s), 0.95 if s == 0 else 0.8)
        for s in (4, 12):
            CL(stp(t0, s), 0.6)
        for s in range(0, 16, 2):
            HT(stp(t0, s), 0.55 if s % 4 else 0.42)
        for s in (7, 15):
            HT(stp(t0, s), 0.28)
        bass_notes.append((t0, 2.0, ROOT[c], b > 0))
        chord_segs.append((t0, t0 + 2, c))
        pad_segs.append((t0, t0 + 2, c))
        gates.append((t0, t0 + 2, 0.42))
        pad_gates.append((t0, t0 + 2, 1.0))
        for s in range(16):
            arp.append((stp(t0, s), CH[c][seq[s]] + 12, 0.55 + 0.3 * (s % 4 == 0), 0.45 + 0.1 * b))

    # ---------------- riser bar
    c = 'Eb'
    for s in (0, 8):
        K(stp(Tr, s), 0.9)
    for s in range(0, 12, 2):
        HT(stp(Tr, s), 0.5)
    roll = [Tr + k * 0.25 for k in range(4)] + [Tr + 1 + k * S16 for k in range(4)] + [Tr + 1.5 + k * 0.0625 for k in range(6)]
    for k, tr in enumerate(roll):
        u = k / (len(roll) - 1)
        add(B['clap'], snare(0.3 + 0.7 * u ** 1.3, 1.0 + 0.5 * u, seed=k), tr)
    bass_notes.append((Tr, 1.0, ROOT[c], True))
    chord_segs.append((Tr, Td - GAP, c))
    pad_segs.append((Tr, Td - GAP, c))
    gates.append((Tr, Td - GAP, 0.5))
    gates.append((Tr + 1.0, Td - GAP, 0.85))
    pad_gates.append((Tr, Td - GAP, 0.9))
    for s in range(15):
        arp.append((stp(Tr, s), CH[c][seq[s]] + 12 + (12 if s >= 8 else 0), 0.5 + 0.03 * s, 0.7))
    rz, _ = riser(2.0 - GAP, seed=7, tone_lvl=1.0, noise_lvl=0.5, root=51)
    add(B['fxr'], rz, Tr)
    add(B['cym'], reverse_crash(1.2), Td - 1.2, 0.6)

    # ---------------- drop (pack rip) 6 s
    dch = [('Fm', 'Fm'), ('Db', 'Db'), ('Ab', 'Eb')]
    kp = [[0, 7, 10], [0, 3, 7, 10, 14], [0, 7, 10, 11]]
    stabs = [(0, 2.5), (3, 2.5), (6, 3.5), (10, 1.5), (12, 3.5)]
    motif = [
        [(0, 84, 2), (3, 80, 2), (6, 79, 1), (7, 80, 2), (10, 84, 2), (12, 87, 2), (14, 84, 2)],
        [(0, 85, 2), (3, 84, 2), (6, 80, 1), (7, 77, 2), (10, 80, 2), (12, 84, 4)],
        [(0, 84, 2), (3, 87, 2), (6, 84, 1), (7, 82, 2), (10, 79, 2), (12, 82, 2), (14, 79, 2)],
    ]
    for b in range(3):
        t0 = Td + 2 * b
        ca, cb = dch[b]
        for s in kp[b]:
            K(stp(t0, s), 1.0 if s == 0 else 0.9)
            cc = ca if s < 8 else cb
            glide = (b == 1 and s == 14)
            nn = ROOT[cc] + (12 if glide else 0)
            nxt = [x for x in kp[b] if x > s]
            dur = ((nxt[0] if nxt else 16) - s) * S16
            bass_notes.append((stp(t0, s), dur, nn, glide))
        for s in (4, 12):
            CL(stp(t0, s), 1.0)
        if b == 2:
            CL(stp(t0, 15), 0.45)
        for s in range(16):
            HT(stp(t0, s), [0.75, 0.35, 0.55, 0.35][s % 4])
        for s in (2, 6, 10, 14):
            HT(stp(t0, s), 0.32, op=True)
        if b == 1:
            for k in range(8):
                HT(stp(t0, 12) + k * 0.0625, 0.25 + 0.06 * k, p=0.35)
        if ca == cb:
            chord_segs.append((t0, t0 + 2, ca)); pad_segs.append((t0, t0 + 2, ca))
        else:
            chord_segs += [(t0, t0 + 1, ca), (t0 + 1, t0 + 2, cb)]
            pad_segs += [(t0, t0 + 1, ca), (t0 + 1, t0 + 2, cb)]
        for s, l in stabs:
            gates.append((stp(t0, s), stp(t0, s + l), 1.0))
        pad_gates.append((t0, t0 + 2, 0.8))
        for s, m, l in motif[b]:
            lead.append((stp(t0, s), m, l * S16 + 0.25, 1.0))
    for th in (Td, Td + 4):
        add(B['boom'], sub_boom(85, 43.65, 1.8, 0.55), th)
        add(B['cym'], crash(1.0, seed=int(th)), th)
        add(B['fxr'], downlifter(1.6, int(th)), th, 0.8)
    add(B['cym'], reverse_crash(0.8, seed=12), Td + 4 - 0.8, 0.5)

    # ---------------- driving 4 s
    vch = ['Fm', 'Ab']
    for b in range(2):
        t0 = Tv + 2 * b
        c = vch[b]
        for s in (0, 4, 8, 12):
            K(stp(t0, s), 0.95)
        for s in (4, 12):
            CL(stp(t0, s), 0.9)
        for s in range(16):
            HT(stp(t0, s), [0.6, 0.3, 0.5, 0.3][s % 4])
        for s in (2, 6, 10, 14):
            HT(stp(t0, s), 0.4, op=True)
            bass_notes.append((stp(t0, s), 1.6 * S16, ROOT[c] + 12, False))
        chord_segs.append((t0, t0 + 2, c)); pad_segs.append((t0, t0 + 2, c))
        gates.append((t0, t0 + 2, 0.72))
        pad_gates.append((t0, t0 + 2, 0.8))
        for s in range(16):
            arp.append((stp(t0, s), CH[c][seq[s]] + 24, 0.5 + 0.35 * (s % 4 == 0), 0.9))
    add(B['cym'], crash(0.6, seed=21), Tv)

    # ---------------- lift 2 s ("Go for the 1%")
    K(Tl, 1.0)
    CL(Tl, 0.9)
    add(B['cym'], crash(0.55, seed=31), Tl)
    for k, tr in enumerate([Tl + 1 + i * S16 for i in range(4)] + [Tl + 1.5 + i * 0.0625 for i in range(7)]):
        u = k / 10
        add(B['clap'], snare(0.3 + 0.75 * u ** 1.2, 1.0 + 0.6 * u, seed=40 + k), tr)
    bass_notes.append((Tl, 1.0, ROOT['Db'], True))
    bass_notes.append((Tl + 1, 1.0 - GAP, ROOT['Eb'], True))
    chord_segs += [(Tl, Tl + 1, 'Db'), (Tl + 1, Tf - GAP, 'Eb')]
    pad_segs += [(Tl, Tl + 1, 'Db'), (Tl + 1, Tf - GAP, 'Eb')]
    gates.append((Tl, Tf - GAP, 0.55))
    gates.append((Tl + 1, Tf - GAP, 0.95))
    pad_gates.append((Tl, Tf - GAP, 1.0))
    for s in range(15):
        c = 'Db' if s < 8 else 'Eb'
        arp.append((stp(Tl, s), CH[c][seq[s]] + 24, 0.45 + 0.04 * s, 1.0))
    rz, _ = riser(1.0 - GAP, seed=9, tone_lvl=1.0, noise_lvl=0.4, root=58)
    add(B['fxr'], rz, Tl + 1, 0.8)
    add(B['cym'], reverse_crash(1.0, seed=13), Tf - 1.0, 0.6)

    # ---------------- final hit + tail
    K(Tf, 1.15)
    add(B['boom'], sub_boom(90, 43.65, tail + 0.2, 0.9), Tf)
    add(B['cym'], crash(1.1, dur=tail + 0.2, seed=41), Tf)
    add(B['fxr'], downlifter(min(tail, 2.0), 51), Tf, 0.9)
    chord_segs.append((Tf, Te, 'Fm'))
    pad_segs.append((Tf, Te, 'Fm'))
    gates.append((Tf, Te - 0.05, 1.0, 0.75 * tail / 2))
    pad_gates.append((Tf, Te - 0.05, 0.9, 0.9 * tail / 2))
    lead.append((Tf, 77, tail, 1.2))
    lead.append((Tf, 84, tail, 1.2))
    lead.append((Tf + 0.0625, 89, tail, 1.0))

    # ================= render tonal buses
    sc_all = sorted(kicks)
    # chords: supersaw, gated, filtered, pumped
    ch = np.zeros((n, 2))
    for i, (a, b_, c) in enumerate(chord_segs):
        notes = CH[c] + ([CH[c][0] + 12, CH[c][2] + 12] if a >= Td - 0.01 and a < Tv or a >= Tf else [])
        add(ch, fades(supersaw(notes, b_ - a + 0.03, seed=i), 0.004, 0.025), a)
    ch *= gate_env(total, gates, a=0.003, r=0.06)[:, None]
    fc = curve(total, [(0, 14000), (0.5, 2600), (Tg - 0.01, 1300), (Tg, 900), (Tr, 2600),
                       (Td - GAP, 15000), (Td, 16000), (Tv - 0.01, 16000), (Tv, 9000), (Tl - 0.01, 7000),
                       (Tl, 1800), (Tf - GAP, 14000), (Tf, 16000), (Te, 700)])
    ch = tvfilt(ch, 'lp', fc, Q=0.9)
    ch = bw(ch, 'highpass', 130, 2)
    ch *= sc_env(total, sc_all, 0.62, 0.13)[:, None]
    B['chords'] += ch
    # pad: darker, wider, octave down top-voice removed
    pd = np.zeros((n, 2))
    for i, (a, b_, c) in enumerate(pad_segs):
        pd_notes = [m - 12 for m in CH[c][1:]] + [CH[c][0]]
        add(pd, fades(supersaw(pd_notes, b_ - a + 0.03, width=1.0, seed=100 + i), 0.01, 0.03), a)
    pd *= gate_env(total, pad_gates, a=0.012, r=0.12)[:, None]
    pd = tvfilt(pd, 'lp', curve(total, [(0, 500), (Tg, 750), (Tr, 1600), (Td, 2400), (Tf, 3000), (Te, 350)]), Q=0.7)
    pd = bw(pd, 'highpass', 140, 2)
    pd *= sc_env(total, sc_all, 0.72, 0.16)[:, None]
    B['pad'] += pd
    # arp plucks + ping-pong
    ar = np.zeros((n, 2))
    for (t0, m, v, br) in arp:
        add(ar, pluck(m, 0.45, bright=br, decay=0.22), t0, v, 0)
    ar = bw(ar, 'highpass', 200, 2)
    ar = ar + 0.32 * pingpong(ar, 0.375, 0.42)
    ar *= sc_env(total, sc_all, 0.35, 0.1)[:, None]
    B['arp'] += ar
    # lead motif
    ld = np.zeros((n, 2))
    for (t0, m, l, br) in lead:
        p = pluck(m, l + 0.3, bright=br * 1.4, decay=0.35 if l < 1 else 0.9, detune=11)
        add(ld, p, t0, 1.0)
        add(ld, pluck(m + 12, l + 0.3, bright=br, decay=0.2 if l < 1 else 0.6, detune=5), t0, 0.25)
    ld = bw(ld, 'highpass', 250, 2)
    ld = ld + 0.3 * pingpong(ld, 0.375, 0.38, lp=6000)
    ld *= sc_env(total, sc_all, 0.25, 0.08)[:, None]
    B['lead'] += ld
    # 808: one continuous oscillator (no phase resets -> no clicks)
    B['bass'] += pan2(bass808(total, bass_notes, sc_all))

    # ================= balance buses, space, sum
    B['hats'] = bw(B['hats'], 'lowpass', 14000, 2)
    B['cym'] = bw(B['cym'], 'lowpass', 15000, 2)
    for k in B:
        l = lufs(B[k])
        if np.isfinite(l):
            B[k] *= db(TARGET[k] - l)
    hall = make_ir(T=2.5, dur=3.4, pre=0.022, seed=19)
    send = sum(B[k] * SEND[k] for k in B)
    wet = reverb(send, hall)[:n]
    wet *= db(-28 - lufs(wet))
    B['verb'] = wet
    mix = sum(B.values())
    land = dict(hook_hit=0.0, intro=0.0, groove=Tg, riser=Tr, drop=Td, hit_reveal=Td + 4, driving=Tv,
                lift=Tl, final_hit=Tf, tail=Tf, end=Te)
    gaps = [[round(Td - GAP, 4), Td], [round(Tf - GAP, 4), Tf]]
    if return_buses:
        return mix, land, gaps, B
    return mix, land, gaps


def downlifter(d=1.4, seed=0):
    r = rng(seed)
    t = tt(d)
    fc = 7000 * (250 / 7000) ** (t / d) ** 0.7
    y = tvfilt(r.standard_normal((len(t), 2)), 'bp', fc, Q=1.1)
    y *= ((1 - np.exp(-t / 0.004)) * np.exp(-t / (d / 3.5)))[:, None]
    return fades(y, 0, 0.05)


def bass808(total, notes, kicks):
    n = N(total)
    f = np.full(n, mtof(29))
    amp = np.zeros(n)
    notes = sorted(notes)
    prevf = mtof(notes[0][2])
    for i, (t0, dur, m, glide) in enumerate(notes):
        i0 = N(t0)
        nxt = N(notes[i + 1][0]) if i + 1 < len(notes) else n
        rel = N(0.03)
        i1 = min(N(t0 + dur) + rel, nxt, n)
        ft = mtof(m)
        L = (nxt if i + 1 < len(notes) else n) - i0
        x = np.arange(L) / SR
        if glide:
            f[i0:i0 + L] = ft + (prevf - ft) * np.exp(-x / 0.035)
        else:
            f[i0:i0 + L] = ft
        Ln = i1 - i0
        xn = np.arange(Ln) / SR
        env = (1 - np.exp(-xn / 0.003)) * (0.55 + 0.45 * np.exp(-xn / 0.5))
        k = N(dur)
        if k < Ln:
            env[k:] *= np.exp(-(xn[k:] - xn[k]) / 0.008)
        amp[i0:i1] = env
        prevf = ft
    amp = bw(amp, 'lowpass', 180, 2, zero_phase=True)
    amp *= sc_env(total, kicks, 0.55, 0.035, 0.002)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.tanh(2.4 * amp * np.sin(ph)) / np.tanh(2.4)
    y = bw(y, 'lowpass', 2500, 2)
    return y
